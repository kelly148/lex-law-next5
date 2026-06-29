/**
 * practice_memos query wrapper — FOLD-KB-1 (Increment 1: insert + owner-scoped reads).
 *
 * Ch 35.1 Zod Wall; owner-scoped via ownerScope(). CAPTURE IS ALWAYS THE MOST-PRIVATE
 * POSTURE (Fork G): a newly filed memo is client_confidential / raw / matter_only /
 * unverified — the insert does not accept a less-private posture. Abstraction, promotion to
 * firm-wide reuse, and re-verification are explicit, audited attorney acts added in
 * Increment 2 (they require an audit_events disposition). The cross-matter access gate lives
 * in server/practiceKb/gate.ts.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, desc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../connection.js';
import { practiceMemos } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { insertKbEvent } from './kbEvents.js';
import { isPromotableToReuse, canBecomeAutoApplyEligible } from '../../practiceKb/gate.js';
import {
  PracticeMemoRowSchema,
  type PracticeMemoRow,
  type LawReliedOnEntry,
  type MemoVerificationStatus,
  type MemoRiskLevel,
  type ConflictsHook,
} from '../../../shared/schemas/practiceKb.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseRow(raw: unknown, userId: string): PracticeMemoRow {
  try {
    return PracticeMemoRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry('zod_parse_failed', { schemaName: 'PracticeMemoRowSchema', tableName: 'practice_memos', errorPath: err.errors[0]?.path.join('.') ?? '', errorMessage: err.errors[0]?.message ?? 'ZodError' }, { userId, matterId: null, documentId: null, jobId: null });
    }
    throw err;
  }
}

/**
 * File a new practice memo. ALWAYS captured most-private (client_confidential / raw /
 * matter_only / unverified) — promotion is a separate gated act. The procedure layer
 * (Increment 2) additionally requires lawReliedOn + jurisdiction for a conclusion memo.
 */
export async function insertPracticeMemo(data: {
  id?: string;
  userId: string;
  originMatterId?: string | null;
  sourceAnalysisId?: string | null;
  sourceDocumentId?: string | null;
  title: string;
  body: string;
  practiceArea?: string | null;
  jurisdiction?: string | null;
  lawReliedOn?: LawReliedOnEntry[] | null;
  topicTags?: string[] | null;
  writtenOn?: Date | null;
  // KNOWLEDGE-BACKBONE-PHASE2 (I1) scope-metadata tags settable at capture (store-only). autoApplyEligible is
  // intentionally NOT a capture input — it always lands FALSE (DB default) and is flipped only via the gated
  // setMemoAutoApplyEligible (abstracted + firm-wide required). effectiveDate/reviewBy are optional provenance.
  documentType?: string | null;
  riskLevel?: MemoRiskLevel | null;
  conflictsHook?: ConflictsHook | null;
  effectiveDate?: string | null;
  reviewBy?: string | null;
}): Promise<PracticeMemoRow> {
  const id = data.id ?? uuidv4();
  await db.insert(practiceMemos).values({
    id,
    userId: data.userId,
    originMatterId: data.originMatterId ?? null,
    sourceAnalysisId: data.sourceAnalysisId ?? null,
    sourceDocumentId: data.sourceDocumentId ?? null,
    title: data.title,
    body: data.body,
    practiceArea: data.practiceArea ?? null,
    jurisdiction: data.jurisdiction ?? null,
    lawReliedOn: (data.lawReliedOn ?? null) as never,
    topicTags: (data.topicTags ?? null) as never,
    writtenOn: data.writtenOn ?? null,
    // Most-private posture — never overridable at capture (Fork G).
    verificationStatus: 'unverified',
    privilegeTag: 'client_confidential',
    abstractionStatus: 'raw',
    reuseScope: 'matter_only',
    // KNOWLEDGE-BACKBONE-PHASE2 (I1) — scope-metadata floor + provenance. autoApplyEligible omitted (DB default
    // FALSE); it is NEVER true at capture (raw decision-stream entries never auto-apply — D3).
    documentType: data.documentType ?? null,
    riskLevel: data.riskLevel ?? null,
    conflictsHook: (data.conflictsHook ?? null) as never,
    effectiveDate: data.effectiveDate ?? null,
    reviewBy: data.reviewBy ?? null,
  });
  const row = await getPracticeMemoById(id, data.userId);
  if (!row) throw new Error(`insertPracticeMemo: row not found after insert (id=${id})`);
  return row;
}

export async function getPracticeMemoById(id: string, userId: string): Promise<PracticeMemoRow | null> {
  const rows = await db.select().from(practiceMemos).where(and(eq(practiceMemos.id, id), ownerScope(practiceMemos.userId, userId))).limit(1);
  if (rows.length === 0) return null;
  return parseRow(rows[0]!, userId);
}

/** Memos derived from a specific origin matter (owner-scoped). */
export async function listMemosForOriginMatter(originMatterId: string, userId: string): Promise<PracticeMemoRow[]> {
  const rows = await db
    .select()
    .from(practiceMemos)
    .where(and(ownerScope(practiceMemos.userId, userId), eq(practiceMemos.originMatterId, originMatterId)))
    .orderBy(desc(practiceMemos.createdAt));
  return rows.map((r) => parseRow(r, userId));
}

/**
 * Firm-wide reusable memos (owner-scoped): reuseScope='firm_wide' AND abstractionStatus=
 * 'abstracted'. The gate (server/practiceKb/gate.ts) is the authoritative cross-matter
 * decision; this read pre-filters to the only memos that can cross a matter boundary.
 */
export async function listFirmWideReusableMemos(userId: string): Promise<PracticeMemoRow[]> {
  const rows = await db
    .select()
    .from(practiceMemos)
    .where(and(ownerScope(practiceMemos.userId, userId), eq(practiceMemos.reuseScope, 'firm_wide'), eq(practiceMemos.abstractionStatus, 'abstracted')))
    .orderBy(desc(practiceMemos.createdAt));
  return rows.map((r) => parseRow(r, userId));
}

/** All memos for the owner (owner-scoped), newest first. */
export async function listMemosForOwner(userId: string): Promise<PracticeMemoRow[]> {
  const rows = await db
    .select()
    .from(practiceMemos)
    .where(ownerScope(practiceMemos.userId, userId))
    .orderBy(desc(practiceMemos.createdAt));
  return rows.map((r) => parseRow(r, userId));
}

// ============================================================
// Increment 3 — attorney-act mutations (each audited via kb_events, transactionally)
// ============================================================

/**
 * Create an ABSTRACTED memo from a raw one (Fork B/G). LLM-assisted-but-ATTORNEY-ATTESTED:
 * the model may draft the body, but performing this act IS the attorney's de-identification
 * certification (recorded as the kb_events attestation). The raw memo is left UNCHANGED
 * (still client_confidential / raw / matter_only); the new abstracted memo links back to it
 * via abstractedFromMemoId (owner-only provenance for remediation). The abstracted memo is
 * still matter_only until separately promoted.
 */
export async function abstractMemoFromRaw(params: {
  rawMemoId: string;
  userId: string;
  abstractedTitle?: string;
  abstractedBody: string;
  abstractedBy: 'attorney' | 'system_assisted_attorney';
}): Promise<PracticeMemoRow> {
  const raw = await getPracticeMemoById(params.rawMemoId, params.userId);
  if (!raw) throw new TRPCError({ code: 'NOT_FOUND', message: 'Practice memo not found' });
  if (raw.abstractionStatus === 'abstracted') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'ALREADY_ABSTRACTED: this memo is already an abstracted memo' });
  }
  const newId = uuidv4();
  const eventId = uuidv4();
  await db.transaction(async (tx) => {
    await tx.insert(practiceMemos).values({
      id: newId,
      userId: params.userId,
      originMatterId: raw.originMatterId,
      sourceAnalysisId: raw.sourceAnalysisId,
      sourceDocumentId: raw.sourceDocumentId,
      title: params.abstractedTitle ?? `${raw.title} (abstracted)`,
      body: params.abstractedBody,
      practiceArea: raw.practiceArea,
      jurisdiction: raw.jurisdiction,
      lawReliedOn: (raw.lawReliedOn ?? null) as never,
      topicTags: (raw.topicTags ?? null) as never,
      writtenOn: raw.writtenOn,
      // Currency carries over from the raw memo (re-verification is a separate act).
      verificationStatus: raw.verificationStatus,
      privilegeTag: 'abstracted',
      abstractionStatus: 'abstracted',
      abstractionAttestedByEventId: eventId,
      abstractedAt: new Date(),
      abstractedBy: params.abstractedBy,
      // Still matter_only — promotion to firm-wide reuse is a separate explicit act.
      reuseScope: 'matter_only',
      abstractedFromMemoId: raw.id,
    });
    await insertKbEvent(
      {
        id: eventId,
        userId: params.userId,
        action: 'memo_abstracted',
        targetType: 'practice_memo',
        targetId: newId,
        summary: `Abstracted memo created from "${raw.title}" (attorney-attested de-identification)`,
        payload: { rawMemoId: raw.id, abstractedBy: params.abstractedBy },
      },
      tx,
    );
  });
  const created = await getPracticeMemoById(newId, params.userId);
  if (!created) throw new Error('abstractMemoFromRaw: row not found after insert');
  return created;
}

/**
 * Promote a memo to firm-wide reuse (Fork B). GATED: the memo MUST be abstracted (not a mere
 * opt-in — abstraction is required). firm_wide means firm-scoped (all firm attorneys), gated
 * by abstraction; owner-scoped today and wideable to firm-scope via ownerScope later.
 */
export async function promoteMemoToReuse(params: { memoId: string; userId: string; rationale?: string | null }): Promise<PracticeMemoRow> {
  const memo = await getPracticeMemoById(params.memoId, params.userId);
  if (!memo) throw new TRPCError({ code: 'NOT_FOUND', message: 'Practice memo not found' });
  if (!isPromotableToReuse(memo)) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'ABSTRACTION_REQUIRED: only an abstracted memo can be promoted to firm-wide reuse.' });
  }
  const eventId = uuidv4();
  await db.transaction(async (tx) => {
    await insertKbEvent(
      {
        id: eventId,
        userId: params.userId,
        action: 'memo_promoted_to_reuse',
        targetType: 'practice_memo',
        targetId: memo.id,
        summary: `Promoted abstracted memo "${memo.title}" to firm-wide reuse`,
        rationale: params.rationale ?? null,
      },
      tx,
    );
    await tx
      .update(practiceMemos)
      .set({ reuseScope: 'firm_wide' })
      .where(and(eq(practiceMemos.id, memo.id), ownerScope(practiceMemos.userId, params.userId)));
  });
  const updated = await getPracticeMemoById(memo.id, params.userId);
  if (!updated) throw new Error('promoteMemoToReuse: row not found after update');
  return updated;
}

/**
 * Record a re-verification (Fork C): WHAT was verified against + WHEN, not a boolean+timestamp.
 * Sets the discrete verificationStatus + lastVerifiedAt + the verifiedThrough/method/note.
 */
export async function markMemoReverified(params: {
  memoId: string;
  userId: string;
  verificationStatus: MemoVerificationStatus;
  verifiedThroughDate?: Date | null;
  verificationMethod?: string | null;
  verificationNote?: string | null;
  // KNOWLEDGE-BACKBONE-PHASE2 (I1) — optional reviewBy to set in the same transaction. Legacy callers
  // (practiceKb.markReverified) omit it -> reviewBy is left untouched (no behavior change). The reviewBy-REQUIRED
  // gate (disposition D6: "no reviewBy -> cannot verify") is enforced in the kbBackbone verify procedure, NOT
  // here, so this shared wrapper stays behavior-preserving for its existing caller.
  reviewBy?: string | null;
}): Promise<PracticeMemoRow> {
  const memo = await getPracticeMemoById(params.memoId, params.userId);
  if (!memo) throw new TRPCError({ code: 'NOT_FOUND', message: 'Practice memo not found' });
  const eventId = uuidv4();
  const now = new Date();
  // Only touch reviewBy when the caller explicitly passes it (undefined -> leave the column as-is). The
  // conditional spread keeps the object well-typed for Drizzle's .set().
  const setFields = {
    verificationStatus: params.verificationStatus,
    lastVerifiedAt: now,
    verifiedThroughDate: params.verifiedThroughDate ?? null,
    verificationMethod: params.verificationMethod ?? null,
    verificationNote: params.verificationNote ?? null,
    ...(params.reviewBy !== undefined ? { reviewBy: params.reviewBy } : {}),
  };
  await db.transaction(async (tx) => {
    await insertKbEvent(
      {
        id: eventId,
        userId: params.userId,
        action: 'memo_marked_reverified',
        targetType: 'practice_memo',
        targetId: memo.id,
        summary: `Re-verification recorded: ${params.verificationStatus}`,
        rationale: params.verificationNote ?? null,
        payload: {
          verificationStatus: params.verificationStatus,
          verifiedThroughDate: params.verifiedThroughDate ?? null,
          verificationMethod: params.verificationMethod ?? null,
          reviewBy: params.reviewBy ?? null,
        },
      },
      tx,
    );
    await tx
      .update(practiceMemos)
      .set(setFields)
      .where(and(eq(practiceMemos.id, memo.id), ownerScope(practiceMemos.userId, params.userId)));
  });
  const updated = await getPracticeMemoById(memo.id, params.userId);
  if (!updated) throw new Error('markMemoReverified: row not found after update');
  return updated;
}

/**
 * KNOWLEDGE-BACKBONE-PHASE2 (I1) — set autoApplyEligible (the v1 input to a FUTURE auto-apply gate). D3 LOCK:
 * an entry may become auto-applicable ONLY once it is abstracted AND promoted to firm-wide reuse (the
 * attorney-driven graduation path). A raw decision-stream entry can NEVER be auto-applicable, full stop.
 * Setting it false is always allowed (a kill-switch). Audited on the kb_events spine.
 */
export async function setMemoAutoApplyEligible(params: {
  memoId: string;
  userId: string;
  autoApplyEligible: boolean;
  rationale?: string | null;
}): Promise<PracticeMemoRow> {
  const memo = await getPracticeMemoById(params.memoId, params.userId);
  if (!memo) throw new TRPCError({ code: 'NOT_FOUND', message: 'Practice memo not found' });
  if (params.autoApplyEligible && !canBecomeAutoApplyEligible(memo)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'GRADUATION_REQUIRED: an entry can become auto-apply-eligible only after it is abstracted and promoted to firm-wide reuse (raw decision-stream entries never auto-apply).',
    });
  }
  const eventId = uuidv4();
  await db.transaction(async (tx) => {
    await insertKbEvent(
      {
        id: eventId,
        userId: params.userId,
        action: 'memo_auto_apply_eligibility_set',
        targetType: 'practice_memo',
        targetId: memo.id,
        summary: `Auto-apply eligibility set to ${params.autoApplyEligible} for "${memo.title}"`,
        rationale: params.rationale ?? null,
        payload: { autoApplyEligible: params.autoApplyEligible },
      },
      tx,
    );
    await tx
      .update(practiceMemos)
      .set({ autoApplyEligible: params.autoApplyEligible })
      .where(and(eq(practiceMemos.id, memo.id), ownerScope(practiceMemos.userId, params.userId)));
  });
  const updated = await getPracticeMemoById(memo.id, params.userId);
  if (!updated) throw new Error('setMemoAutoApplyEligible: row not found after update');
  return updated;
}

/** Supersede a memo (e.g. a newer version replaces it). Audited via kb_events. */
export async function supersedeMemo(params: { memoId: string; userId: string; supersededById?: string | null; rationale?: string | null }): Promise<void> {
  const memo = await getPracticeMemoById(params.memoId, params.userId);
  if (!memo) throw new TRPCError({ code: 'NOT_FOUND', message: 'Practice memo not found' });
  const eventId = uuidv4();
  await db.transaction(async (tx) => {
    await insertKbEvent(
      {
        id: eventId,
        userId: params.userId,
        action: 'memo_superseded',
        targetType: 'practice_memo',
        targetId: memo.id,
        summary: `Superseded memo "${memo.title}"`,
        rationale: params.rationale ?? null,
        payload: { supersededById: params.supersededById ?? null },
      },
      tx,
    );
    await tx
      .update(practiceMemos)
      .set({ supersededById: params.supersededById ?? null, verificationStatus: 'superseded' })
      .where(and(eq(practiceMemos.id, memo.id), ownerScope(practiceMemos.userId, params.userId)));
  });
}
