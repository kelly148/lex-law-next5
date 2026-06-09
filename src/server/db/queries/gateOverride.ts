/**
 * gate_override query wrapper + the override-aware drafting-gate resolver — CONFLICT-GATE-OVERRIDE-1.
 *
 * Ch 35.1 Zod Wall: the ONLY read path for gate_override; every row parses through GateOverrideRowSchema.
 * Owner-scoped via ownerScope() (FOLD-AUTH-1 chokepoint). APPEND-ONLY: insert + read only — an attested
 * override is an immutable matter record. A re-attestation appends a new row, and RE-ARM is DERIVED (the
 * current precondition state's snapshot hash no longer equals the stored hash), never a row mutation.
 *
 * The gate DEFAULT stays fail-closed: resolveDraftingGate calls evaluateConflictClearance UNCHANGED and
 * lets a non-CLEARED matter proceed ONLY when every blocking precondition has an ACTIVE (snapshot-current)
 * attested override. With no override rows the result is byte-for-byte the bare clearance gate. This module
 * NEVER disables the gate.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, desc, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import { gateOverride } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import {
  GateOverrideRowSchema,
  GATE_OVERRIDE_PRECONDITION_VALUES,
  type GateOverrideRow,
  type GateOverridePrecondition,
  type GateOverrideReasonCode,
} from '../../../shared/schemas/gateOverride.js';
import { evaluateAllClearanceReasons, getLatestCheckForMatter, type ConflictClearance } from './conflicts.js';
import { listPartiesForMatter } from './matterParties.js';
import { insertAuditEvent, recordAuditEvent } from './auditEvents.js';
import {
  blockingPreconditionsForReasons,
  canonicalConflictsSnapshot,
  canonicalIdentitySnapshot,
  hashSnapshot,
  resolveGateAllowed,
} from '../../conflicts/gateOverride.js';

function parseRow(raw: unknown, userId: string): GateOverrideRow {
  try {
    return GateOverrideRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'GateOverrideRowSchema',
          tableName: 'gate_override',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

// ── Snapshot of the precondition STATE (the re-arm key) ─────────────────────────────────────────────
export interface PreconditionSnapshot {
  snapshot: unknown;
  snapshotHash: string;
}

/**
 * Compute the canonical snapshot + hash for one precondition's CURRENT state. Used both at attestation
 * time (to store) and at gate-evaluation time (to compare). Conflicts = latest check id + party-id set;
 * identity = the client parties' { partyId, confirmed, normalizedName }.
 */
export async function computePreconditionSnapshot(
  matterId: string,
  userId: string,
  precondition: GateOverridePrecondition,
): Promise<PreconditionSnapshot> {
  if (precondition === 'conflicts') {
    const check = await getLatestCheckForMatter(matterId, userId);
    const parties = await listPartiesForMatter(matterId, userId);
    const canonical = canonicalConflictsSnapshot({
      latestCheckId: check?.id ?? null,
      partyIds: parties.map((p) => p.id),
    });
    return { snapshot: canonical, snapshotHash: hashSnapshot(canonical) };
  }
  const parties = await listPartiesForMatter(matterId, userId);
  const clientParties = parties
    .filter((p) => p.role === 'client')
    .map((p) => ({ partyId: p.id, confirmed: p.confirmed === true, normalizedName: p.normalizedName }));
  const canonical = canonicalIdentitySnapshot(clientParties);
  return { snapshot: canonical, snapshotHash: hashSnapshot(canonical) };
}

// ── Reads ───────────────────────────────────────────────────────────────────────────────────────────
export async function getGateOverrideById(id: string, userId: string): Promise<GateOverrideRow | null> {
  const rows = await db
    .select()
    .from(gateOverride)
    .where(and(eq(gateOverride.id, id), ownerScope(gateOverride.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseRow(rows[0]!, userId);
}

/** The most recent attested override for one precondition on a matter (newest first), or null. */
export async function getLatestGateOverride(
  matterId: string,
  userId: string,
  precondition: GateOverridePrecondition,
): Promise<GateOverrideRow | null> {
  const rows = await db
    .select()
    .from(gateOverride)
    .where(
      and(
        ownerScope(gateOverride.userId, userId),
        eq(gateOverride.matterId, matterId),
        eq(gateOverride.precondition, precondition),
      ),
    )
    .orderBy(desc(gateOverride.createdAt))
    .limit(1);
  if (rows.length === 0) return null;
  return parseRow(rows[0]!, userId);
}

/**
 * Is there an ACTIVE attested override for this precondition? Active = the LATEST attestation's snapshot
 * hash equals the CURRENT precondition state's hash (build spec: "the latest attestation MATCHED to the
 * CURRENT precondition state; a state mismatch => not active (re-armed)"). Returns the row when active,
 * else null. A material change (new party / identity-record change) flips this to null automatically.
 */
export async function getActiveGateOverride(
  matterId: string,
  userId: string,
  precondition: GateOverridePrecondition,
): Promise<GateOverrideRow | null> {
  const latest = await getLatestGateOverride(matterId, userId, precondition);
  if (!latest) return null;
  const { snapshotHash } = await computePreconditionSnapshot(matterId, userId, precondition);
  return latest.snapshotHash === snapshotHash ? latest : null;
}

/** Every currently-ACTIVE override for the matter (both preconditions). Banner + provenance source. */
export async function listActiveGateOverrides(matterId: string, userId: string): Promise<GateOverrideRow[]> {
  const out: GateOverrideRow[] = [];
  for (const pc of GATE_OVERRIDE_PRECONDITION_VALUES) {
    const ov = await getActiveGateOverride(matterId, userId, pc);
    if (ov) out.push(ov);
  }
  return out;
}

// ── The override-aware drafting gate ─────────────────────────────────────────────────────────────────
export interface DraftingGateResult {
  allowed: boolean;
  clearance: ConflictClearance;
  /** Reasons NOT covered by an active override — empty IFF allowed. */
  blockingReasons: string[];
  /** Preconditions currently blocking (per the raw clearance). */
  blockingPreconditions: GateOverridePrecondition[];
  /** Preconditions whose block was suppressed by an active override. */
  overriddenPreconditions: GateOverridePrecondition[];
  /** The active override rows consulted (for provenance + the banner). */
  activeOverrides: GateOverrideRow[];
}

/**
 * The single override-aware gate decision. Calls evaluateAllClearanceReasons (the NON-short-circuiting
 * sibling that reports ALL failing preconditions, so an override of one precondition can never mask
 * another); a non-CLEARED matter is allowed ONLY when EVERY blocking precondition has an active attested
 * override. FAIL-CLOSED on any error — an evaluation/override-lookup error is treated as blocked, never
 * opened by an override. The default path (no override rows) is identical to the bare clearance gate.
 */
export async function resolveDraftingGate(matterId: string, userId: string): Promise<DraftingGateResult> {
  let clearance: ConflictClearance;
  try {
    clearance = await evaluateAllClearanceReasons(matterId, userId);
  } catch {
    // Fail-closed: if clearance cannot be established, block (no override covers this synthetic reason).
    clearance = { state: 'NOT_ESTABLISHED', reasons: ['clearance_evaluation_failed'] };
  }
  if (clearance.state === 'CLEARED') {
    return {
      allowed: true,
      clearance,
      blockingReasons: [],
      blockingPreconditions: [],
      overriddenPreconditions: [],
      activeOverrides: [],
    };
  }
  let activeOverrides: GateOverrideRow[] = [];
  try {
    activeOverrides = await listActiveGateOverrides(matterId, userId);
  } catch {
    activeOverrides = []; // fail-closed: an override-lookup error never opens the gate
  }
  const activeSet = new Set<GateOverridePrecondition>(activeOverrides.map((o) => o.precondition));
  const r = resolveGateAllowed(clearance, activeSet);
  return {
    allowed: r.allowed,
    clearance,
    blockingReasons: r.blockingReasons,
    blockingPreconditions: blockingPreconditionsForReasons(clearance.reasons),
    overriddenPreconditions: r.overriddenPreconditions,
    activeOverrides,
  };
}

// ── Writes (append-only) ─────────────────────────────────────────────────────────────────────────────
/**
 * Record an attested override of one precondition, transactionally with its immutable audit_events ledger
 * row (the disposition stream — no new event type / migration, mirroring sendability_override's audit
 * mirror). FAIL-VISIBLY (insertAuditEvent enlisted in the same tx): a material attorney decision and its
 * audit row commit together or roll back together.
 */
export async function recordGateOverrideAttestation(params: {
  userId: string;
  matterId: string;
  precondition: GateOverridePrecondition;
  snapshot: unknown;
  snapshotHash: string;
  reasonCode: GateOverrideReasonCode;
  reasonText?: string | null;
}): Promise<GateOverrideRow> {
  const id = uuidv4();
  const eventId = uuidv4();
  await db.transaction(async (tx) => {
    await tx.insert(gateOverride).values({
      id,
      userId: params.userId,
      matterId: params.matterId,
      precondition: params.precondition,
      snapshot: params.snapshot,
      snapshotHash: params.snapshotHash,
      reasonCode: params.reasonCode,
      reasonText: params.reasonText ?? null,
    });
    await insertAuditEvent(
      {
        id: eventId,
        userId: params.userId,
        matterId: params.matterId,
        eventType: 'disposition',
        actor: 'attorney',
        summary: `Attested override of the ${params.precondition} drafting gate (${params.reasonCode})`,
        targetType: 'gate_override',
        targetId: id,
        action: 'attest_gate_override',
        scope: 'matter',
        rationale: params.reasonText ?? null,
        payload: { precondition: params.precondition, reasonCode: params.reasonCode, snapshotHash: params.snapshotHash },
      },
      tx,
    );
  });
  const row = await getGateOverrideById(id, params.userId);
  if (!row) throw new Error(`recordGateOverrideAttestation: row not found after insert (id=${id})`);
  return row;
}

/**
 * Record (best-effort, append-only audit) that a draft VERSION was produced while gate override(s) were
 * active — Inc 4 provenance. Reuses the audit_events 'disposition' stream (no new event type / migration),
 * exactly like sendability_override's audit mirror. NEVER throws — a successful generation must not fail
 * on a provenance write.
 */
export async function recordDraftUnderOverride(params: {
  userId: string;
  matterId: string;
  documentId: string;
  versionId: string;
  overrides: readonly GateOverrideRow[];
}): Promise<void> {
  if (params.overrides.length === 0) return;
  const preconditions = params.overrides.map((o) => o.precondition);
  await recordAuditEvent({
    userId: params.userId,
    matterId: params.matterId,
    documentId: params.documentId,
    versionId: params.versionId,
    eventType: 'disposition',
    actor: 'attorney',
    summary: `Draft produced under attested gate override(s): ${preconditions.join(', ')}`,
    targetType: 'gate_override',
    // targetId is the produced VERSION (a single id fits varchar(64)); the override ids — possibly more
    // than one — live in the unbounded JSON payload below.
    targetId: params.versionId,
    action: 'draft_under_override',
    scope: 'document',
    payload: {
      preconditions,
      overrides: params.overrides.map((o) => ({
        id: o.id,
        precondition: o.precondition,
        snapshotHash: o.snapshotHash,
        reasonCode: o.reasonCode,
      })),
    },
  });
}
