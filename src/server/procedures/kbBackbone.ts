/**
 * Knowledge Backbone Phase 2 tRPC procedures — KNOWLEDGE-BACKBONE-PHASE2 (Increment 1: CAPTURE + SCHEMA).
 *
 * Implements the triad-reviewed design (rides the KNOWLEDGE-BACKBONE-PHASE2 disposition — does not re-fire).
 * Flag-dark behind KB_BACKBONE_ENABLED (default OFF): with the flag OFF every procedure here fail-closes with
 * PRECONDITION_FAILED and NOTHING ELSE CHANGES (the legacy practiceKb lifecycle is untouched).
 *
 * I1 is CAPTURE + SCHEMA ONLY — it gets verified firm knowledge IN with provenance, activates the dormant
 * authority_source registry, populates the lawReliedOn[].authoritySourceId link, and enforces the safety gates.
 * It NEVER retrieves or applies KB content into any LLM call (surface-not-inject stays fully intact); retrieval
 * (I2) and auto-apply (I3) are later, separately-gated increments.
 *
 * Reuses (does NOT fork) the existing primitives: insertPracticeMemo / markMemoReverified / setMemoAutoApplyEligible
 * (db/queries/practiceMemos), insertKbEvent (db/queries/kbEvents — the append-only audit spine), and the new
 * authority_source wrappers (db/queries/authoritySources). Owner-scoped throughout (userId always from ctx).
 *
 * SAFETY INVARIANTS enforced here:
 *  - Capture only (no inject/apply); most-private default (unverified / raw / matter_only); autoApplyEligible FALSE.
 *  - AI/system NEVER sets verified: capture cannot set verificationStatus at all; verifyMemo is an attorney act.
 *  - "No reviewBy -> cannot verify" (D6): verifyMemo refuses attorney_verified_current without a reviewBy date.
 *  - D3 lock: a raw decision-stream entry can never become firm-wide (promote gates on abstracted) or
 *    autoApplyEligible (setMemoAutoApplyEligible gates on abstracted + firm-wide).
 *  - authority_source promotion gate (§2): authoritative only with a pinned pinpoint + a checkedBy signature.
 *  - Cross-owner authoritySourceId references are refused.
 *  - Append-only kb_events on every lifecycle action.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isKbBackboneEnabled } from '../config/featureFlags.js';
import {
  createAuthoritySource,
  getAuthoritySourceById,
  listAuthoritySourcesByJurisdiction,
  listAuthoritySourcesApproachingReview,
  updateAuthoritySource,
} from '../db/queries/authoritySources.js';
import {
  insertPracticeMemo,
  getPracticeMemoById,
  markMemoReverified,
  setMemoAutoApplyEligible,
} from '../db/queries/practiceMemos.js';
import { insertKbEvent } from '../db/queries/kbEvents.js';
import {
  CreateAuthoritySourceInputSchema,
  UpdateAuthoritySourceInputSchema,
  PromoteAuthoritativeInputSchema,
  meetsAuthoritativePromotionGate,
} from '../../shared/schemas/authoritySource.js';
import { LawReliedOnEntrySchema, ConflictsHookSchema, MEMO_RISK_LEVELS } from '../../shared/schemas/practiceKb.js';

/** Fail-closed flag gate — the FIRST line of every procedure (mirrors the deed-draft-agent gate pattern). */
function assertKbBackboneEnabled(): void {
  if (!isKbBackboneEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'KB_BACKBONE_DISABLED: the knowledge backbone is not enabled.' });
  }
}

// Capture input. NOTE: verificationStatus is intentionally ABSENT — capture is always 'unverified' (the AI/capture
// path can never set a memo verified). autoApplyEligible is ABSENT — it always lands FALSE and is flipped only via
// the gated setAutoApplyEligible (D3). reuseScope/privilegeTag/abstractionStatus are the most-private defaults.
const CaptureMemoInputSchema = z.object({
  title: z.string().min(1).max(256),
  body: z.string().min(1),
  practiceArea: z.string().max(128).nullable().optional(),
  jurisdiction: z.string().max(128).nullable().optional(),
  documentType: z.string().max(64).nullable().optional(),
  riskLevel: z.enum(MEMO_RISK_LEVELS).nullable().optional(),
  lawReliedOn: z.array(LawReliedOnEntrySchema).nullable().optional(),
  topicTags: z.array(z.string()).nullable().optional(),
  // Origin-matter tag (disposition D2) — the durable origin pointer; conflictsHook carries the conflict metadata.
  originMatterId: z.string().uuid().nullable().optional(),
  sourceAnalysisId: z.string().uuid().nullable().optional(),
  sourceDocumentId: z.string().uuid().nullable().optional(),
  conflictsHook: ConflictsHookSchema.nullable().optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').nullable().optional(),
  reviewBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').nullable().optional(),
  writtenOn: z.coerce.date().nullable().optional(),
});

const VerifyMemoInputSchema = z.object({
  memoId: z.string().uuid(),
  verificationStatus: z.enum(['unverified', 'attorney_verified_current', 'stale', 'superseded', 'not_legal_authority']),
  reviewBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').nullable().optional(),
  verifiedThroughDate: z.coerce.date().nullable().optional(),
  verificationMethod: z.string().max(64).nullable().optional(),
  verificationNote: z.string().nullable().optional(),
});

export const kbBackboneRouter = router({
  // ── authority_source registry (activation) ────────────────────────────────────────────────────
  authoritySourceCreate: protectedProcedure.input(CreateAuthoritySourceInputSchema).mutation(async ({ ctx, input }) => {
    assertKbBackboneEnabled();
    // Explicit map (not a spread) so optional zod fields coerce to T|null — never an explicit `undefined`, which
    // exactOptionalPropertyTypes rejects against the wrapper's `field?: T | null` params.
    const row = await createAuthoritySource({
      userId: ctx.userId,
      jurisdiction: input.jurisdiction,
      authorityType: input.authorityType,
      citationText: input.citationText,
      pinpoint: input.pinpoint ?? null,
      sourceUrlOrLocation: input.sourceUrlOrLocation ?? null,
      sourceSnapshotHash: input.sourceSnapshotHash ?? null,
      effectiveDate: input.effectiveDate ?? null,
      lastCheckedDate: input.lastCheckedDate ?? null,
      reviewByDate: input.reviewByDate ?? null,
      checkedBy: input.checkedBy ?? null,
      notes: input.notes ?? null,
    });
    await insertKbEvent({
      userId: ctx.userId,
      action: 'authority_source_created',
      targetType: 'authority_source',
      targetId: row.id,
      summary: `Authority source created: ${row.jurisdiction} ${row.citationText}`.slice(0, 512),
    });
    return row;
  }),

  authoritySourceGet: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    assertKbBackboneEnabled();
    const row = await getAuthoritySourceById(input.id, ctx.userId);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Authority source not found' });
    return row;
  }),

  authoritySourceListByJurisdiction: protectedProcedure
    .input(z.object({ jurisdiction: z.string().min(1).max(128) }))
    .query(async ({ ctx, input }) => {
      assertKbBackboneEnabled();
      return listAuthoritySourcesByJurisdiction(input.jurisdiction, ctx.userId);
    }),

  authoritySourceListApproachingReview: protectedProcedure
    .input(z.object({ onOrBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional())
    .query(async ({ ctx, input }) => {
      assertKbBackboneEnabled();
      return listAuthoritySourcesApproachingReview(ctx.userId, input?.onOrBefore ? { onOrBefore: input.onOrBefore } : undefined);
    }),

  authoritySourceUpdate: protectedProcedure.input(UpdateAuthoritySourceInputSchema).mutation(async ({ ctx, input }) => {
    assertKbBackboneEnabled();
    // Conditional spreads OMIT keys the caller didn't send (preserving patch semantics: absent = leave as-is) and
    // avoid passing an explicit `undefined` (exactOptionalPropertyTypes). A present null still clears the column.
    const row = await updateAuthoritySource({
      id: input.id,
      userId: ctx.userId,
      ...(input.jurisdiction !== undefined ? { jurisdiction: input.jurisdiction } : {}),
      ...(input.authorityType !== undefined ? { authorityType: input.authorityType } : {}),
      ...(input.citationText !== undefined ? { citationText: input.citationText } : {}),
      ...(input.pinpoint !== undefined ? { pinpoint: input.pinpoint } : {}),
      ...(input.sourceUrlOrLocation !== undefined ? { sourceUrlOrLocation: input.sourceUrlOrLocation } : {}),
      ...(input.sourceSnapshotHash !== undefined ? { sourceSnapshotHash: input.sourceSnapshotHash } : {}),
      ...(input.effectiveDate !== undefined ? { effectiveDate: input.effectiveDate } : {}),
      ...(input.lastCheckedDate !== undefined ? { lastCheckedDate: input.lastCheckedDate } : {}),
      ...(input.reviewByDate !== undefined ? { reviewByDate: input.reviewByDate } : {}),
      ...(input.checkedBy !== undefined ? { checkedBy: input.checkedBy } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Authority source not found' });
    return row;
  }),

  // §2 promotion gate — a citation may be promoted AUTHORITATIVE only with a pinned pinpoint + a checkedBy
  // signature (supplied here or already on the row). Refused otherwise. Audited on the kb_events spine.
  authoritySourcePromote: protectedProcedure.input(PromoteAuthoritativeInputSchema).mutation(async ({ ctx, input }) => {
    assertKbBackboneEnabled();
    const existing = await getAuthoritySourceById(input.id, ctx.userId);
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Authority source not found' });
    const pinpoint = input.pinpoint ?? existing.pinpoint;
    const checkedBy = input.checkedBy ?? existing.checkedBy;
    if (!meetsAuthoritativePromotionGate({ pinpoint, checkedBy })) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'PROMOTION_GATE_UNMET: an authoritative citation requires BOTH a pinned pinpoint and a checkedBy signature.',
      });
    }
    const updated = await updateAuthoritySource({
      id: input.id,
      userId: ctx.userId,
      pinpoint,
      checkedBy,
      ...(input.lastCheckedDate ? { lastCheckedDate: input.lastCheckedDate } : {}),
    });
    if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Authority source not found' });
    await insertKbEvent({
      userId: ctx.userId,
      action: 'authority_source_promoted',
      targetType: 'authority_source',
      targetId: updated.id,
      summary: `Authority source promoted authoritative (pinpoint + checkedBy): ${updated.citationText}`.slice(0, 512),
      payload: { pinpoint, checkedBy },
    });
    return updated;
  }),

  // ── capture (into practice_memos; reuses insertPracticeMemo) ───────────────────────────────────
  captureMemo: protectedProcedure.input(CaptureMemoInputSchema).mutation(async ({ ctx, input }) => {
    assertKbBackboneEnabled();
    // Populate the dormant link, OWNER-SCOPED: any lawReliedOn entry that references an authority_source must
    // reference one OWNED by this user — a cross-owner (or dangling) reference is refused.
    if (input.lawReliedOn) {
      for (const entry of input.lawReliedOn) {
        if (entry.authoritySourceId) {
          const ref = await getAuthoritySourceById(entry.authoritySourceId, ctx.userId);
          if (!ref) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'CROSS_OWNER_AUTHORITY_REFERENCE: lawReliedOn.authoritySourceId must reference an authority source you own.',
            });
          }
        }
      }
    }
    const memo = await insertPracticeMemo({
      userId: ctx.userId,
      originMatterId: input.originMatterId ?? null,
      sourceAnalysisId: input.sourceAnalysisId ?? null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      title: input.title,
      body: input.body,
      practiceArea: input.practiceArea ?? null,
      jurisdiction: input.jurisdiction ?? null,
      lawReliedOn: input.lawReliedOn ?? null,
      topicTags: input.topicTags ?? null,
      writtenOn: input.writtenOn ?? null,
      documentType: input.documentType ?? null,
      riskLevel: input.riskLevel ?? null,
      conflictsHook: input.conflictsHook ?? null,
      effectiveDate: input.effectiveDate ?? null,
      reviewBy: input.reviewBy ?? null,
    });
    // kb_events spine: capture is a lifecycle action. (Most-private posture is guaranteed by insertPracticeMemo:
    // unverified / client_confidential / raw / matter_only / autoApplyEligible FALSE.)
    await insertKbEvent({
      userId: ctx.userId,
      action: 'memo_created',
      targetType: 'practice_memo',
      targetId: memo.id,
      summary: `Captured knowledge entry "${memo.title}" (unverified, ${memo.privilegeTag}, ${memo.reuseScope})`.slice(0, 512),
      payload: { originMatterId: memo.originMatterId, documentType: memo.documentType ?? null, riskLevel: memo.riskLevel ?? null },
    });
    return memo;
  }),

  getMemo: protectedProcedure.input(z.object({ memoId: z.string().uuid() })).query(async ({ ctx, input }) => {
    assertKbBackboneEnabled();
    const memo = await getPracticeMemoById(input.memoId, ctx.userId);
    if (!memo) throw new TRPCError({ code: 'NOT_FOUND', message: 'Practice memo not found' });
    return memo;
  }),

  // ── verify (attorney act; "no reviewBy -> cannot verify", D6) ──────────────────────────────────
  verifyMemo: protectedProcedure.input(VerifyMemoInputSchema).mutation(async ({ ctx, input }) => {
    assertKbBackboneEnabled();
    const memo = await getPracticeMemoById(input.memoId, ctx.userId);
    if (!memo) throw new TRPCError({ code: 'NOT_FOUND', message: 'Practice memo not found' });
    if (input.verificationStatus === 'attorney_verified_current') {
      // D6: attorney_verified_current REQUIRES a reviewBy — supplied now or already on the memo.
      const effectiveReviewBy = input.reviewBy ?? memo.reviewBy ?? null;
      if (!effectiveReviewBy) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'REVIEW_BY_REQUIRED: a memo cannot be set attorney_verified_current without a reviewBy date (set a conservative recheck horizon).',
        });
      }
      // PERSIST the computed effectiveReviewBy (NOT the raw input). Otherwise an explicit `reviewBy: null` would
      // fall through the `??` gate (passing on the stored value) yet still be written as null — clearing a prior
      // reviewBy and leaving a verified row with reviewBy NULL, the exact state D6 forbids.
      return markMemoReverified({
        memoId: input.memoId,
        userId: ctx.userId,
        verificationStatus: input.verificationStatus,
        verifiedThroughDate: input.verifiedThroughDate ?? null,
        verificationMethod: input.verificationMethod ?? null,
        verificationNote: input.verificationNote ?? null,
        reviewBy: effectiveReviewBy,
      });
    }
    // Non-verified statuses (unverified / stale / superseded / not_legal_authority) do NOT require a reviewBy; the
    // attorney may set or clear it freely — forward it only when explicitly supplied (undefined -> leave as-is).
    return markMemoReverified({
      memoId: input.memoId,
      userId: ctx.userId,
      verificationStatus: input.verificationStatus,
      verifiedThroughDate: input.verifiedThroughDate ?? null,
      verificationMethod: input.verificationMethod ?? null,
      verificationNote: input.verificationNote ?? null,
      ...(input.reviewBy !== undefined ? { reviewBy: input.reviewBy } : {}),
    });
  }),

  // ── auto-apply eligibility (D3-gated; store-only input to a FUTURE I3 gate) ─────────────────────
  setAutoApplyEligible: protectedProcedure
    .input(z.object({ memoId: z.string().uuid(), autoApplyEligible: z.boolean(), rationale: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      assertKbBackboneEnabled();
      return setMemoAutoApplyEligible({
        memoId: input.memoId,
        userId: ctx.userId,
        autoApplyEligible: input.autoApplyEligible,
        rationale: input.rationale ?? null,
      });
    }),
});
