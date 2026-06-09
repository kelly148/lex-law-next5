/**
 * conflict_checks / conflict_hits query wrapper — FOLD-L0-1 (Fork A + Fork G).
 *
 * Ch 35.1 Zod Wall. Owner-scoped via ownerScope(). The matching is DETERMINISTIC + DB-side
 * (computeConflictHits) — NO LLM (Fork G). Disposing a BLOCKER REQUIRES a rationale and is
 * written transactionally with an audit_events disposition (the RPC-defense record).
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, desc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../connection.js';
import { conflictChecks, conflictHits } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { insertAuditEvent } from './auditEvents.js';
import { listPartiesForMatter, listOtherPartiesForOwner } from './matterParties.js';
import { computeConflictHits, hasBlocker, dispositionNeedsRationale, type PartyLite } from '../../conflicts/engine.js';
import {
  ConflictCheckRowSchema,
  ConflictHitRowSchema,
  type ConflictCheckRow,
  type ConflictHitRow,
  type ConflictHitDisposition,
} from '../../../shared/schemas/layer0.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseCheck(raw: unknown, userId: string): ConflictCheckRow {
  try {
    return ConflictCheckRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry('zod_parse_failed', { schemaName: 'ConflictCheckRowSchema', tableName: 'conflict_checks', errorPath: err.errors[0]?.path.join('.') ?? '', errorMessage: err.errors[0]?.message ?? 'ZodError' }, { userId, matterId: null, documentId: null, jobId: null });
    }
    throw err;
  }
}
function parseHit(raw: unknown, userId: string): ConflictHitRow {
  try {
    return ConflictHitRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry('zod_parse_failed', { schemaName: 'ConflictHitRowSchema', tableName: 'conflict_hits', errorPath: err.errors[0]?.path.join('.') ?? '', errorMessage: err.errors[0]?.message ?? 'ZodError' }, { userId, matterId: null, documentId: null, jobId: null });
    }
    throw err;
  }
}

function toLite(p: { id: string; matterId: string; role: PartyLite['role']; displayName: string; normalizedName: string }): PartyLite {
  return { id: p.id, matterId: p.matterId, role: p.role, displayName: p.displayName, normalizedName: p.normalizedName };
}

/**
 * RPC-mandatory check: compute this matter's hits against every other owned matter,
 * persist the check + hits. Deterministic; no LLM. Returns the new check + hits.
 */
export async function runConflictCheck(matterId: string, userId: string): Promise<{ check: ConflictCheckRow; hits: ConflictHitRow[] }> {
  const thisParties = (await listPartiesForMatter(matterId, userId)).map(toLite);
  const otherParties = (await listOtherPartiesForOwner(userId, matterId)).map(toLite);
  const computed = computeConflictHits(thisParties, otherParties);

  const checkId = uuidv4();
  const status = computed.length === 0 ? 'clear' : 'hits_pending';
  // R2-PRE-CONFLICT-1 §3D (Inc 4): snapshot the exact party-id set this check evaluated. The
  // clearance predicate later compares it to the matter's CURRENT party set so a party added/removed
  // after a clear invalidates the clearance (re-check required). thisParties is what was screened.
  await db.insert(conflictChecks).values({ id: checkId, userId, matterId, status, checkedPartyIds: thisParties.map((p) => p.id) });

  for (const c of computed) {
    await db.insert(conflictHits).values({
      id: uuidv4(),
      userId,
      checkId,
      matterId,
      matchedMatterId: c.matchedMatterId,
      thisPartyId: c.thisPartyId,
      matchedPartyId: c.matchedPartyId,
      matchBasis: c.matchBasis,
      matchType: c.matchType,
      severity: c.severity,
      disposition: 'pending',
    });
  }

  const check = await getConflictCheckById(checkId, userId);
  if (!check) throw new Error('runConflictCheck: check not found after insert');
  const hits = await listHitsForCheck(checkId, userId);
  return { check, hits };
}

export async function getConflictCheckById(id: string, userId: string): Promise<ConflictCheckRow | null> {
  const rows = await db.select().from(conflictChecks).where(and(eq(conflictChecks.id, id), ownerScope(conflictChecks.userId, userId))).limit(1);
  if (rows.length === 0) return null;
  return parseCheck(rows[0]!, userId);
}

/** The matter's most recent conflict check (currency: a new check supersedes older ones). */
export async function getLatestCheckForMatter(matterId: string, userId: string): Promise<ConflictCheckRow | null> {
  const rows = await db
    .select()
    .from(conflictChecks)
    .where(and(ownerScope(conflictChecks.userId, userId), eq(conflictChecks.matterId, matterId)))
    .orderBy(desc(conflictChecks.runAt))
    .limit(1);
  if (rows.length === 0) return null;
  return parseCheck(rows[0]!, userId);
}

export async function listHitsForCheck(checkId: string, userId: string): Promise<ConflictHitRow[]> {
  const rows = await db
    .select()
    .from(conflictHits)
    .where(and(ownerScope(conflictHits.userId, userId), eq(conflictHits.checkId, checkId)))
    .orderBy(desc(conflictHits.severity)); // 'review' < 'blocker' lexically; ordering is cosmetic
  return rows.map((r) => parseHit(r, userId));
}

export async function getConflictHitById(id: string, userId: string): Promise<ConflictHitRow | null> {
  const rows = await db.select().from(conflictHits).where(and(eq(conflictHits.id, id), ownerScope(conflictHits.userId, userId))).limit(1);
  if (rows.length === 0) return null;
  return parseHit(rows[0]!, userId);
}

/**
 * Disposition a conflict hit (Fork A). For a BLOCKER, a non-empty rationale is REQUIRED
 * (empty "cleared" is not allowed — the RPC-defense record). Written transactionally with
 * an audit_events disposition; the hit links to that immutable event.
 */
export async function dispositionConflictHit(params: {
  hitId: string;
  userId: string;
  disposition: ConflictHitDisposition;
  rationale?: string | null;
}): Promise<ConflictHitRow> {
  const hit = await getConflictHitById(params.hitId, params.userId);
  if (!hit) throw new TRPCError({ code: 'NOT_FOUND', message: 'Conflict hit not found' });
  if (params.disposition === 'pending') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot disposition to pending' });
  }
  const rationale = (params.rationale ?? '').trim();
  if (dispositionNeedsRationale(hit.severity) && rationale.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'RATIONALE_REQUIRED: a blocker-severity conflict requires a recorded rationale to disposition.' });
  }

  const eventId = uuidv4();
  await db.transaction(async (tx) => {
    await insertAuditEvent(
      {
        id: eventId,
        userId: params.userId,
        matterId: hit.matterId,
        eventType: 'disposition',
        actor: 'attorney',
        summary: `Conflict hit ${params.disposition} (${hit.severity})`,
        targetType: 'conflict_hit',
        targetId: params.hitId,
        action: params.disposition,
        rationale: rationale || null,
        scope: 'matter',
      },
      tx,
    );
    await tx
      .update(conflictHits)
      .set({ disposition: params.disposition, dispositionRationale: rationale || null, dispositionedByEventId: eventId })
      .where(and(eq(conflictHits.id, params.hitId), ownerScope(conflictHits.userId, params.userId)));
  });

  // Recompute the parent check's status: all hits dispositioned -> 'dispositioned'.
  const siblings = await listHitsForCheck(hit.checkId, params.userId);
  const anyPending = siblings.some((h) => h.disposition === 'pending');
  await db
    .update(conflictChecks)
    .set({ status: anyPending ? 'hits_pending' : 'dispositioned' })
    .where(and(eq(conflictChecks.id, hit.checkId), ownerScope(conflictChecks.userId, params.userId)));

  const updated = await getConflictHitById(params.hitId, params.userId);
  if (!updated) throw new Error('dispositionConflictHit: hit not found after update');
  return updated;
}

/**
 * Hard-block predicate (Fork A): does the matter's LATEST check have an undispositioned
 * BLOCKER? Gates advance-to-drafting and plan-lock. (No check yet => no known blockers,
 * but the lock path separately REQUIRES a check to have run.)
 */
export async function hasUndispositionedBlocker(matterId: string, userId: string): Promise<boolean> {
  const latest = await getLatestCheckForMatter(matterId, userId);
  if (!latest) return false;
  const hits = await listHitsForCheck(latest.id, userId);
  return hasBlocker(hits.filter((h) => h.disposition === 'pending'));
}

// ============================================================
// R2-PRE-CONFLICT-1 §3A/§3B/§3C — AFFIRMATIVE conflict-clearance predicate
// ============================================================

export type ConflictClearanceState = 'CLEARED' | 'BLOCKED' | 'NOT_ESTABLISHED';
export interface ConflictClearance {
  state: ConflictClearanceState;
  /** machine reasons (never silently empty for a non-cleared state). */
  reasons: string[];
}

/**
 * R2-PRE-CONFLICT-1 §3D (Inc 4) currency check (PURE). Is the latest check's snapshotted party-id set
 * IDENTICAL (as a set, order-independent) to the matter's CURRENT party-id set? A null/absent snapshot
 * (a pre-Inc-4 check) is treated as NOT current — fail-closed, forcing a re-check. Adding or removing
 * a party changes the set (=> stale); CONFIRMING a party does NOT change the id set (=> still current),
 * so confirmation enables clearance without forcing a re-check. The exported pure fn is unit-tested.
 */
export function partyIdSetUnchanged(snapshot: readonly string[] | null | undefined, currentIds: readonly string[]): boolean {
  if (!Array.isArray(snapshot)) return false;
  if (snapshot.length !== currentIds.length) return false;
  const snap = new Set(snapshot);
  return currentIds.every((id) => snap.has(id));
}

/**
 * The headline fix. Replaces the overloaded `hasUndispositionedBlocker` boolean ("not blocked" was
 * read as "cleared", satisfied vacuously when the client was never a checked party). Returns an
 * AFFIRMATIVE three-state result. CLEARED is asserted ONLY when ALL hold:
 *   - a conflict check exists for the matter;
 *   - it has no undispositioned BLOCKER;
 *   - the matter has a CONFIRMED role='client' party — structural (existence of a confirmed client
 *     party), never name-match (§3B; real legal names produce false-negatives). The client is
 *     screened from creation (Inc 2 auto-party) but confirmation is the explicit attorney judgment.
 * "No check" and "unconfirmed/absent client party" are DISTINCT NOT_ESTABLISHED states, never
 * silently false. (Inc 4 adds the 4th condition: the check is current vs the snapshotted party set.)
 *
 * This is the SINGLE source of truth every conflict-sensitive transition must consume (§3C):
 * cleared-disposition, lockPlan, advance-to-drafting, export — wired in Inc 3b. Use `isConflictCleared`
 * for a boolean gate.
 */
export async function evaluateConflictClearance(matterId: string, userId: string): Promise<ConflictClearance> {
  const parties = await listPartiesForMatter(matterId, userId);
  const clientParties = parties.filter((p) => p.role === 'client');
  const hasConfirmedClient = clientParties.some((p) => p.confirmed === true);

  const check = await getLatestCheckForMatter(matterId, userId);
  if (!check) {
    return { state: 'NOT_ESTABLISHED', reasons: ['no_conflict_check'] };
  }
  // §3D (Inc 4): the latest check must be CURRENT vs the matter's party set. A party added/removed
  // since the check — or a pre-Inc-4 null snapshot — makes the check stale: its hit verdict was
  // computed against a different party set, so neither CLEARED nor the BLOCKED verdict can be trusted.
  // Re-check required. (Confirming a party does not change the id set, so it does NOT trip this.)
  if (!partyIdSetUnchanged(check.checkedPartyIds, parties.map((p) => p.id))) {
    return { state: 'NOT_ESTABLISHED', reasons: ['check_stale_parties_changed'] };
  }
  const hits = await listHitsForCheck(check.id, userId);
  if (hasBlocker(hits.filter((h) => h.disposition === 'pending'))) {
    return { state: 'BLOCKED', reasons: ['undispositioned_blocker'] };
  }
  if (!hasConfirmedClient) {
    return {
      state: 'NOT_ESTABLISHED',
      reasons: [clientParties.length > 0 ? 'unconfirmed_client_party' : 'no_client_party'],
    };
  }
  return { state: 'CLEARED', reasons: [] };
}

/** §3C boolean gate: a matter is conflict-clearable IFF the affirmative predicate is CLEARED. */
export async function isConflictCleared(matterId: string, userId: string): Promise<boolean> {
  return (await evaluateConflictClearance(matterId, userId)).state === 'CLEARED';
}

/** Plan-lock gate (Fork A): every hit of the latest check must be dispositioned. */
export async function allHitsDispositionedForLatest(matterId: string, userId: string): Promise<{ checkId: string; ok: boolean } | null> {
  const latest = await getLatestCheckForMatter(matterId, userId);
  if (!latest) return null;
  const hits = await listHitsForCheck(latest.id, userId);
  return { checkId: latest.id, ok: hits.every((h) => h.disposition !== 'pending') };
}

/**
 * CONFLICT-GATE-OVERRIDE-1: the NON-short-circuiting clearance evaluation. evaluateConflictClearance (above)
 * SHORT-CIRCUITS and reports only the FIRST failing precondition — correct for the bare gate, but it would
 * let an attested override of an EARLIER precondition mask a LATER one (override conflicts => identity never
 * surfaces). This sibling evaluates BOTH preconditions INDEPENDENTLY and returns the COMPLETE set of
 * currently-failing reasons, so the override-aware gate (resolveDraftingGate) can require every blocking
 * precondition to be cleared OR overridden. evaluateConflictClearance is left byte-for-byte UNCHANGED for
 * all other callers (lockPlan, export display, the boolean gate). Reason codes are identical to
 * evaluateConflictClearance so the reason->precondition mapping is shared.
 */
export async function evaluateAllClearanceReasons(matterId: string, userId: string): Promise<ConflictClearance> {
  const parties = await listPartiesForMatter(matterId, userId);
  const clientParties = parties.filter((p) => p.role === 'client');
  const hasConfirmedClient = clientParties.some((p) => p.confirmed === true);

  const reasons: string[] = [];
  // Conflicts precondition — independent of identity.
  const check = await getLatestCheckForMatter(matterId, userId);
  if (!check) {
    reasons.push('no_conflict_check');
  } else if (!partyIdSetUnchanged(check.checkedPartyIds, parties.map((p) => p.id))) {
    reasons.push('check_stale_parties_changed');
  } else {
    const hits = await listHitsForCheck(check.id, userId);
    if (hasBlocker(hits.filter((h) => h.disposition === 'pending'))) {
      reasons.push('undispositioned_blocker');
    }
  }
  // Identity precondition — independent of the conflicts-check state.
  if (!hasConfirmedClient) {
    reasons.push(clientParties.length > 0 ? 'unconfirmed_client_party' : 'no_client_party');
  }

  const state: ConflictClearanceState =
    reasons.length === 0 ? 'CLEARED' : reasons.includes('undispositioned_blocker') ? 'BLOCKED' : 'NOT_ESTABLISHED';
  return { state, reasons };
}
