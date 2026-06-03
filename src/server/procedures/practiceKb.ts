/**
 * Practice Knowledge Base tRPC procedures — FOLD-KB-1 (Increment 2: matter-scoped surface).
 *
 * practiceKb.createMemo            — file a memo (always most-private capture, Fork G)
 * practiceKb.listMemos/getMemo     — owner-scoped reads
 * practiceKb.listMemosForMatter    — memos derived from a matter (origin)
 * practiceKb.surfaceCandidates     — deterministic, gated, currency-annotated surfacing (Fork F)
 * practiceKb.adoptMemo             — explicit attorney adopt; durable provenance + flag (Fork A)
 * practiceKb.listAdoptions         — adoption provenance for a matter
 * practiceKb.addPaProfile/list/getActive — per-PA master-prompt layer (Fork E)
 *
 * Owner-scoped (userId always from ctx). Memos NEVER auto-inject — adoption is the explicit
 * authorize-use act. The attorney-act mutations that change a memo's privilege/currency
 * posture (abstract / promote / mark-reverified / activate-profile) are Increment 3.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getMatterById, setMatterPaKey } from '../db/queries/matters.js';
import {
  insertPracticeMemo,
  getPracticeMemoById,
  listMemosForOwner,
  listMemosForOriginMatter,
  abstractMemoFromRaw,
  promoteMemoToReuse,
  markMemoReverified,
  supersedeMemo,
} from '../db/queries/practiceMemos.js';
import {
  insertPaInstructionProfile,
  listPaInstructionProfilesForOwner,
  getActiveProfileForPaKey,
  activatePaProfile,
} from '../db/queries/paInstructionProfiles.js';
import { listAdoptionsForMatter } from '../db/queries/kbAdoptions.js';
import { listKbEventsForOwner, listKbEventsForTarget } from '../db/queries/kbEvents.js';
import { recordAuditEvent } from '../db/queries/auditEvents.js';
import { adoptMemoIntoMatter } from '../practiceKb/adopt.js';
import { surfaceCandidatesForMatter } from '../practiceKb/surface.js';
import { LawReliedOnEntrySchema } from '../../shared/schemas/practiceKb.js';

const MEMO_VERIFICATION_STATUS = z.enum([
  'unverified',
  'attorney_verified_current',
  'stale',
  'superseded',
  'not_legal_authority',
]);

async function assertMatterOwned(matterId: string, userId: string) {
  const m = await getMatterById(matterId, userId);
  if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
  return m;
}

export const practiceKbRouter = router({
  createMemo: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid().nullable().optional(), // origin matter (null = firm-level)
        sourceAnalysisId: z.string().uuid().nullable().optional(),
        sourceDocumentId: z.string().uuid().nullable().optional(),
        title: z.string().min(1).max(256),
        body: z.string().min(1),
        practiceArea: z.string().max(128).nullable().optional(),
        jurisdiction: z.string().max(128).nullable().optional(),
        lawReliedOn: z.array(LawReliedOnEntrySchema).nullable().optional(),
        topicTags: z.array(z.string()).nullable().optional(),
        writtenOn: z.coerce.date().nullable().optional(),
        // Fork C: a conclusion memo MUST carry its authority + jurisdiction (else uncheckable).
        hasLegalConclusion: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.matterId) await assertMatterOwned(input.matterId, ctx.userId);
      if (input.hasLegalConclusion) {
        const hasAuthority = (input.lawReliedOn ?? []).length > 0;
        if (!hasAuthority || !(input.jurisdiction ?? '').trim()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'AUTHORITY_REQUIRED: a memo that states a legal conclusion must record its lawReliedOn and jurisdiction (an un-sourced conclusion is uncheckable forever).',
          });
        }
      }
      const memo = await insertPracticeMemo({
        userId: ctx.userId,
        originMatterId: input.matterId ?? null,
        sourceAnalysisId: input.sourceAnalysisId ?? null,
        sourceDocumentId: input.sourceDocumentId ?? null,
        title: input.title,
        body: input.body,
        practiceArea: input.practiceArea ?? null,
        jurisdiction: input.jurisdiction ?? null,
        lawReliedOn: input.lawReliedOn ?? null,
        topicTags: input.topicTags ?? null,
        writtenOn: input.writtenOn ?? null,
      });
      // Matter-scoped audit when captured from a matter (firm-level memos have no matter record).
      if (memo.originMatterId) {
        await recordAuditEvent({
          userId: ctx.userId,
          matterId: memo.originMatterId,
          eventType: 'disposition',
          actor: 'attorney',
          summary: `Filed practice memo "${memo.title}"`,
          targetType: 'practice_memo',
          targetId: memo.id,
          action: 'memo_created',
          scope: 'matter',
        });
      }
      return memo;
    }),

  listMemos: protectedProcedure.query(async ({ ctx }) => listMemosForOwner(ctx.userId)),

  getMemo: protectedProcedure
    .input(z.object({ memoId: z.string().uuid() }))
    .query(async ({ ctx, input }) => getPracticeMemoById(input.memoId, ctx.userId)),

  listMemosForMatter: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => listMemosForOriginMatter(input.matterId, ctx.userId)),

  surfaceCandidates: protectedProcedure
    .input(z.object({ matterId: z.string().uuid(), tags: z.array(z.string()).optional() }))
    .query(async ({ ctx, input }) => {
      const matter = await assertMatterOwned(input.matterId, ctx.userId);
      return surfaceCandidatesForMatter({
        userId: ctx.userId,
        targetMatterId: input.matterId,
        query: { practiceArea: matter.practiceArea, jurisdiction: null, tags: input.tags ?? [] },
      });
    }),

  adoptMemo: protectedProcedure
    .input(
      z.object({
        memoId: z.string().uuid(),
        targetMatterId: z.string().uuid(),
        documentId: z.string().uuid().nullable().optional(),
        rationale: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMatterOwned(input.targetMatterId, ctx.userId);
      return adoptMemoIntoMatter({
        memoId: input.memoId,
        targetMatterId: input.targetMatterId,
        userId: ctx.userId,
        documentId: input.documentId ?? null,
        rationale: input.rationale ?? null,
      });
    }),

  listAdoptions: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => listAdoptionsForMatter(input.matterId, ctx.userId)),

  // --- Increment 3: attorney-act mutations (audited via kb_events) ---

  abstractMemo: protectedProcedure
    .input(
      z.object({
        rawMemoId: z.string().uuid(),
        abstractedTitle: z.string().max(256).optional(),
        abstractedBody: z.string().min(1),
        // The model may draft the abstraction, but performing this act IS the attorney's
        // de-identification certification (Fork B/G).
        abstractedBy: z.enum(['attorney', 'system_assisted_attorney']),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      abstractMemoFromRaw({
        rawMemoId: input.rawMemoId,
        userId: ctx.userId,
        ...(input.abstractedTitle !== undefined ? { abstractedTitle: input.abstractedTitle } : {}),
        abstractedBody: input.abstractedBody,
        abstractedBy: input.abstractedBy,
      }),
    ),

  promoteMemo: protectedProcedure
    .input(z.object({ memoId: z.string().uuid(), rationale: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) =>
      promoteMemoToReuse({ memoId: input.memoId, userId: ctx.userId, rationale: input.rationale ?? null }),
    ),

  markReverified: protectedProcedure
    .input(
      z.object({
        memoId: z.string().uuid(),
        verificationStatus: MEMO_VERIFICATION_STATUS,
        verifiedThroughDate: z.coerce.date().nullable().optional(),
        verificationMethod: z.string().max(64).nullable().optional(),
        verificationNote: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      markMemoReverified({
        memoId: input.memoId,
        userId: ctx.userId,
        verificationStatus: input.verificationStatus,
        verifiedThroughDate: input.verifiedThroughDate ?? null,
        verificationMethod: input.verificationMethod ?? null,
        verificationNote: input.verificationNote ?? null,
      }),
    ),

  supersedeMemo: protectedProcedure
    .input(z.object({ memoId: z.string().uuid(), supersededById: z.string().uuid().nullable().optional(), rationale: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      await supersedeMemo({ memoId: input.memoId, userId: ctx.userId, supersededById: input.supersededById ?? null, rationale: input.rationale ?? null });
      return { success: true };
    }),

  activatePaProfile: protectedProcedure
    .input(z.object({ profileId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => activatePaProfile({ profileId: input.profileId, userId: ctx.userId })),

  listKbEvents: protectedProcedure
    .input(z.object({ targetType: z.string(), targetId: z.string().uuid() }).optional())
    .query(async ({ ctx, input }) =>
      input ? listKbEventsForTarget(input.targetType, input.targetId, ctx.userId) : listKbEventsForOwner(ctx.userId),
    ),

  addPaProfile: protectedProcedure
    .input(
      z.object({
        paKey: z.string().min(1).max(64),
        title: z.string().min(1).max(256),
        body: z.string().min(1),
        version: z.string().min(1).max(32),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      insertPaInstructionProfile({
        userId: ctx.userId,
        paKey: input.paKey,
        title: input.title,
        body: input.body,
        version: input.version,
      }),
    ),

  listPaProfiles: protectedProcedure.query(async ({ ctx }) => listPaInstructionProfilesForOwner(ctx.userId)),

  /**
   * Confirm (or clear) the matter's practice-area key — the explicit attorney act that lets the
   * active per-PA profile auto-load into this matter's model calls (Fork E). Matter-scoped, so
   * it is recorded in the per-matter audit record. Pass paKey null to clear (base prompt).
   */
  confirmMatterPaKey: protectedProcedure
    .input(z.object({ matterId: z.string().uuid(), paKey: z.string().max(64).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertMatterOwned(input.matterId, ctx.userId);
      const updated = await setMatterPaKey(input.matterId, ctx.userId, input.paKey);
      await recordAuditEvent({
        userId: ctx.userId,
        matterId: input.matterId,
        eventType: 'disposition',
        actor: 'attorney',
        summary: input.paKey ? `Confirmed practice-area profile key "${input.paKey}"` : 'Cleared practice-area profile key',
        targetType: 'matter',
        targetId: input.matterId,
        action: 'confirm_pa_key',
        scope: 'matter',
        payload: { paKey: input.paKey },
      });
      return updated;
    }),

  getActivePaProfile: protectedProcedure
    .input(z.object({ paKey: z.string() }))
    .query(async ({ ctx, input }) => getActiveProfileForPaKey(input.paKey, ctx.userId)),
});
