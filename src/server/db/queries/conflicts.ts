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
  await db.insert(conflictChecks).values({ id: checkId, userId, matterId, status });

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

/** Plan-lock gate (Fork A): every hit of the latest check must be dispositioned. */
export async function allHitsDispositionedForLatest(matterId: string, userId: string): Promise<{ checkId: string; ok: boolean } | null> {
  const latest = await getLatestCheckForMatter(matterId, userId);
  if (!latest) return null;
  const hits = await listHitsForCheck(latest.id, userId);
  return { checkId: latest.id, ok: hits.every((h) => h.disposition !== 'pending') };
}
