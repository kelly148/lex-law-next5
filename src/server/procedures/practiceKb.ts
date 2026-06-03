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
import { getMatterById } from '../db/queries/matters.js';
import {
  insertPracticeMemo,
  getPracticeMemoById,
  listMemosForOwner,
  listMemosForOriginMatter,
} from '../db/queries/practiceMemos.js';
import {
  insertPaInstructionProfile,
  listPaInstructionProfilesForOwner,
  getActiveProfileForPaKey,
} from '../db/queries/paInstructionProfiles.js';
import { listAdoptionsForMatter } from '../db/queries/kbAdoptions.js';
import { recordAuditEvent } from '../db/queries/auditEvents.js';
import { adoptMemoIntoMatter } from '../practiceKb/adopt.js';
import { surfaceCandidatesForMatter } from '../practiceKb/surface.js';
import { LawReliedOnEntrySchema } from '../../shared/schemas/practiceKb.js';

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

  getActivePaProfile: protectedProcedure
    .input(z.object({ paKey: z.string() }))
    .query(async ({ ctx, input }) => getActiveProfileForPaKey(input.paKey, ctx.userId)),
});
