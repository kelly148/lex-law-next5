/**
 * expressDurableRecords.ts — EXPRESS-AUTO-REVIEW-LOOP-1 E4b + E7b: the DURABLE persistence layer
 * (ULTRABUILD-1 W1) for the Express auto-review decision ledger and the attorney-approval attestation.
 *
 * WHY: the E4a decision ledger (decisionLedger.ts) and the E7a structural approval predicate
 * (approvalGate.ts) are PURE / in-memory only — they compute but never persist. The Fable audit (Top-5 #2)
 * requires the auto-adoption supervision record to be reconstructable after the fact BEFORE Express is
 * activated. This module writes that record to the durable tables (schema.ts express_loop_run /
 * express_ledger_entry / express_approval_attestation).
 *
 * FORK-C CONSISTENCY (FOLD-L1-1): audit_events is the SINGLE source of truth for ATTORNEY DECISIONS and
 * disposition history is a read-projection over it. So every per-escalation adopt/reject AND the approval
 * attestation act are written to audit_events via insertAuditEvent() (eventType='disposition',
 * targetType='express_escalation' / 'express_loop_run') inside the SAME transaction as the durable row —
 * these tables do NOT introduce a competing authoritative decision record. express_approval_attestation
 * carries operational STATE + a pointer (approvalEventId) to the deciding audit_events row.
 *
 * DORMANT: nothing calls this unless EXPRESS_DURABLE_RECORDS_ENABLED is ON (default OFF). Owner-scoped reads
 * route through ownerScope(); no inline eq(...userId). No new egress.
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'node:crypto';
import { and, eq, asc, desc } from 'drizzle-orm';
import { db } from '../connection.js';
import {
  expressLoopRun,
  expressLedgerEntry,
  expressApprovalAttestation,
  type ExpressLedgerRoute,
  type ExpressRiskBucket,
  type ExpressLoopRun,
} from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { insertAuditEvent } from './auditEvents.js';

/** A Drizzle tx handle (or the pooled db) able to insert — mirrors auditEvents.Executor. */
type Executor = Pick<typeof db, 'insert'>;

/** The attorney's explicit per-escalation dispositions, keyed by the in-run ledger-entry id. */
export type ExpressAttorneyDecisions = Readonly<Record<string, 'adopt' | 'reject'>>;

// ── E4b: persist a completed loop run + its ledger (append-only run; entries carry mutable `reverted`) ──

/** One ledger entry to persist (primitive-only — the procedure extracts these from the E4a LedgerEntry so
 *  this DB module never imports the express domain types). */
export interface ExpressLedgerEntryInput {
  ledgerEntryId: string;
  round: number;
  route: ExpressLedgerRoute;
  riskScore: number;
  riskBucket: ExpressRiskBucket;
  immutabilityForced: boolean;
  isDeletion: boolean;
  beforeText: string;
  afterText: string;
  offsetStart: number;
  offsetEnd: number;
  locus: unknown;
  classA: unknown;
  inlineEvent: unknown;
}

export interface PersistExpressLoopRunInput {
  userId: string;
  matterId: string;
  documentId: string;
  documentVersionId: string;
  reviewerModel: string;
  rounds: number;
  converged: boolean;
  hitCap: boolean;
  adoptedCount: number;
  escalationCount: number;
  candidateText: string;
  redline: unknown;
  roundSummaries: unknown;
  entries: readonly ExpressLedgerEntryInput[];
}

/** Write the run row + all ledger-entry rows in ONE transaction. Exported for a mock-tx unit test. */
export async function writeExpressLoopRunTx(
  tx: Executor,
  input: PersistExpressLoopRunInput & { runId: string },
): Promise<void> {
  await tx.insert(expressLoopRun).values({
    id: input.runId,
    userId: input.userId,
    matterId: input.matterId,
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
    reviewerModel: input.reviewerModel,
    rounds: input.rounds,
    converged: input.converged,
    hitCap: input.hitCap,
    adoptedCount: input.adoptedCount,
    escalationCount: input.escalationCount,
    candidateText: input.candidateText,
    redline: input.redline,
    roundSummaries: input.roundSummaries,
  });
  for (const e of input.entries) {
    await tx.insert(expressLedgerEntry).values({
      id: uuidv4(),
      runId: input.runId,
      userId: input.userId,
      matterId: input.matterId,
      documentId: input.documentId,
      ledgerEntryId: e.ledgerEntryId,
      round: e.round,
      route: e.route,
      riskScore: e.riskScore,
      riskBucket: e.riskBucket,
      immutabilityForced: e.immutabilityForced,
      isDeletion: e.isDeletion,
      beforeText: e.beforeText,
      afterText: e.afterText,
      offsetStart: e.offsetStart,
      offsetEnd: e.offsetEnd,
      locus: e.locus,
      classA: e.classA ?? null,
      inlineEvent: e.inlineEvent ?? null,
    });
  }
}

/** Persist a completed Express loop run (E4b). Returns the new run id. Fail-visible (throws on write error):
 *  when the flag is ON the durable record is the point, so a persistence failure must surface, never silently
 *  drop the supervision record. */
export async function persistExpressLoopRun(input: PersistExpressLoopRunInput): Promise<string> {
  const runId = uuidv4();
  await db.transaction(async (tx) => {
    await writeExpressLoopRunTx(tx, { ...input, runId });
  });
  return runId;
}

// ── E7b: the durable attorney-approval attestation (completeness + content-hash + Fork-C audit writes) ──

/**
 * Mirrors approvalGate.recordAttorneyApproval's rule against the PERSISTED escalation ids: approval requires an
 * explicit 'adopt'|'reject' for EVERY escalation. A missing key, or any non-adopt/reject value, is
 * un-dispositioned — never an implicit approval. Pure.
 */
export function evaluateAttestationCompleteness(
  escalationLedgerIds: readonly string[],
  decisions: ExpressAttorneyDecisions,
): { approved: boolean; undispositionedEscalationIds: string[] } {
  const undispositionedEscalationIds: string[] = [];
  for (const id of escalationLedgerIds) {
    const d = Object.prototype.hasOwnProperty.call(decisions, id) ? decisions[id] : undefined;
    if (d !== 'adopt' && d !== 'reject') undispositionedEscalationIds.push(id);
  }
  return { approved: undispositionedEscalationIds.length === 0, undispositionedEscalationIds };
}

/** Deterministic content hash binding the attestation to the run + candidate + decision set. Order-independent
 *  over decision keys (mirrors the gate_override canonical-JSON sha256 pattern). A material change re-arms the
 *  attestation (stored hash != recomputed hash). Pure. */
export function buildAttestationContentHash(input: {
  runId: string;
  candidateText: string;
  decisions: ExpressAttorneyDecisions;
}): string {
  const canonicalDecisions = Object.keys(input.decisions)
    .sort()
    .map((k) => [k, input.decisions[k]] as const);
  const canonical = JSON.stringify({
    runId: input.runId,
    candidateText: input.candidateText,
    decisions: canonicalDecisions,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Build the insertAuditEvent payload for ONE per-escalation attorney decision (Fork C disposition row). */
export function buildEscalationDecisionAuditEvent(input: {
  userId: string;
  matterId: string;
  documentId: string;
  documentVersionId: string;
  escalationLedgerId: string;
  decision: 'adopt' | 'reject';
}): Parameters<typeof insertAuditEvent>[0] {
  return {
    userId: input.userId,
    matterId: input.matterId,
    documentId: input.documentId,
    versionId: input.documentVersionId,
    eventType: 'disposition',
    actor: 'attorney',
    summary: `Express escalation ${input.escalationLedgerId} ${
      input.decision === 'adopt' ? 'adopted' : 'rejected'
    } by attorney`,
    targetType: 'express_escalation',
    targetId: input.escalationLedgerId,
    action: input.decision,
    scope: 'document',
  };
}

/** Build the insertAuditEvent payload for the approval ATTESTATION act (Fork C disposition row). */
export function buildApprovalAuditEvent(input: {
  userId: string;
  matterId: string;
  documentId: string;
  documentVersionId: string;
  runId: string;
  escalationCount: number;
}): Parameters<typeof insertAuditEvent>[0] {
  return {
    userId: input.userId,
    matterId: input.matterId,
    documentId: input.documentId,
    versionId: input.documentVersionId,
    eventType: 'disposition',
    actor: 'attorney',
    summary: `Express auto-review run ${input.runId} approved by attorney (${input.escalationCount} escalation(s) dispositioned)`,
    targetType: 'express_loop_run',
    targetId: input.runId,
    action: 'approve',
    scope: 'document',
  };
}

export interface RecordExpressAttestationInput {
  run: Pick<ExpressLoopRun, 'id' | 'matterId' | 'documentId' | 'documentVersionId' | 'candidateText'>;
  escalationLedgerIds: readonly string[];
  decisions: ExpressAttorneyDecisions;
  attorneyUserId: string;
  userId: string;
}

/** Write, in ONE transaction: each per-escalation decision -> audit_events; the approval act -> audit_events
 *  (yielding approvalEventId); the durable attestation row (state + pointer + hash + snapshot). Exported for a
 *  mock-tx unit test. Assumes completeness was already checked by the caller. */
export async function writeExpressAttestationTx(
  tx: Executor,
  input: RecordExpressAttestationInput & { contentHash: string; attestationId: string },
): Promise<{ approvalEventId: string }> {
  for (const escId of input.escalationLedgerIds) {
    const decision = input.decisions[escId];
    // decision is guaranteed 'adopt'|'reject' by the caller's completeness check.
    await insertAuditEvent(
      buildEscalationDecisionAuditEvent({
        userId: input.userId,
        matterId: input.run.matterId,
        documentId: input.run.documentId,
        documentVersionId: input.run.documentVersionId,
        escalationLedgerId: escId,
        decision: decision as 'adopt' | 'reject',
      }),
      tx,
    );
  }
  const approvalEventId = await insertAuditEvent(
    buildApprovalAuditEvent({
      userId: input.userId,
      matterId: input.run.matterId,
      documentId: input.run.documentId,
      documentVersionId: input.run.documentVersionId,
      runId: input.run.id,
      escalationCount: input.escalationLedgerIds.length,
    }),
    tx,
  );
  await tx.insert(expressApprovalAttestation).values({
    id: input.attestationId,
    runId: input.run.id,
    userId: input.userId,
    matterId: input.run.matterId,
    documentId: input.run.documentId,
    documentVersionId: input.run.documentVersionId,
    attorneyUserId: input.attorneyUserId,
    approved: true,
    decisionsSnapshot: {
      decisions: input.decisions,
      escalationIds: [...input.escalationLedgerIds],
    },
    escalationCount: input.escalationLedgerIds.length,
    contentHash: input.contentHash,
    approvalEventId,
  });
  return { approvalEventId };
}

/**
 * Record the attorney's affirmative, COMPLETE sign-off (E7b). Refuses (writes nothing) unless every escalation
 * carries an explicit adopt/reject — structural inertness (approvalGate.ts §E7): silence is never approval.
 */
export async function recordExpressAttestation(input: RecordExpressAttestationInput): Promise<{
  approved: boolean;
  undispositionedEscalationIds: string[];
  attestationId?: string;
  approvalEventId?: string;
}> {
  const completeness = evaluateAttestationCompleteness(input.escalationLedgerIds, input.decisions);
  if (!completeness.approved) {
    return { approved: false, undispositionedEscalationIds: completeness.undispositionedEscalationIds };
  }
  const contentHash = buildAttestationContentHash({
    runId: input.run.id,
    candidateText: input.run.candidateText,
    decisions: input.decisions,
  });
  const attestationId = uuidv4();
  const { approvalEventId } = await db.transaction(async (tx) =>
    writeExpressAttestationTx(tx, { ...input, contentHash, attestationId }),
  );
  return { approved: true, undispositionedEscalationIds: [], attestationId, approvalEventId };
}

// ── owner-scoped reads (used by the recordApproval procedure + any future review surface) ──

/** Fetch one persisted loop run, owner-scoped. Null when not found / not owned. */
export async function getExpressLoopRunById(runId: string, userId: string): Promise<ExpressLoopRun | null> {
  const rows = await db
    .select()
    .from(expressLoopRun)
    .where(and(ownerScope(expressLoopRun.userId, userId), eq(expressLoopRun.id, runId)));
  return rows[0] ?? null;
}

/** All ledger entries for a run, owner-scoped, in recording order. */
export async function listExpressLedgerEntriesByRun(runId: string, userId: string) {
  return db
    .select()
    .from(expressLedgerEntry)
    .where(and(ownerScope(expressLedgerEntry.userId, userId), eq(expressLedgerEntry.runId, runId)))
    .orderBy(asc(expressLedgerEntry.createdAt));
}

/** The matter's attestation history, owner-scoped, newest first. */
export async function listExpressAttestationsForMatter(matterId: string, userId: string) {
  return db
    .select()
    .from(expressApprovalAttestation)
    .where(and(ownerScope(expressApprovalAttestation.userId, userId), eq(expressApprovalAttestation.matterId, matterId)))
    .orderBy(desc(expressApprovalAttestation.createdAt));
}
