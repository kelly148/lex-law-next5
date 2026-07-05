/**
 * titleExam.ts — TITLE-EXAM-1 (TEX1-10), the flag-gated tRPC surface for the title-examination module.
 *
 * DEFAULT OFF (isTitleExamEnabled). Byte-neutral when OFF: every real op refuses with PRECONDITION_FAILED
 * (TITLE_EXAM_DISABLED); only the ungated `isEnabled` probe is callable. Owner-scoped via ctx.userId + the
 * matter-ownership gate. Live provider calls happen ONLY inside `runExam` when the flag is ON and the operator
 * drives a run — dispatched through the fail-closed egress broker (surface-level allowlist), with the model per
 * lane resolved from the §4b central config (never a literal). The whole pipeline is exercised in tests through
 * runExamPipeline's injected seams with MOCKS — no live provider call is made in the build.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isTitleExamEnabled } from '../config/featureFlags.js';
import { getMatterById } from '../db/queries/matters.js';
import { listMaterialsForMatter } from '../db/queries/materials.js';
import {
  getTitleExamMatterAttribute,
  upsertTitleExamMatterAttribute,
  getDcExamVisibility,
  getTitleExamSessionById,
  listTitleExamSessionsForMatter,
  listTitleExamFindingsBySession,
} from '../db/queries/titleExam.js';
import { recordFindingDecision } from '../db/queries/titleExamDecisions.js';
import { recordImportResolution } from '../db/queries/titleExamContamination.js';
import { recordClientDeliveryApproval } from '../db/queries/titleExamApproval.js';
import { resolveTitleExamModel } from '../titleExam/roles.js';
import { resolveHat } from '../titleExam/hatGate.js';
import { makeLlmLaneExaminer } from '../titleExam/laneExaminer.js';
import { makeReconcilerDispatch } from '../titleExam/reconcilerDispatch.js';
import { runTitleExamPipeline } from '../titleExam/runExamPipeline.js';
import type { EgressSubject } from '../../shared/schemas/egress.js';
import { TITLE_EXAM_NPI_POSTURE_VALUES } from '../db/schema.js';

/** Flag + matter-ownership gate. Returns the owned, non-archived matter (for hat/jurisdiction). */
async function assertTitleExamAllowed(userId: string, matterId: string) {
  if (!isTitleExamEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'TITLE_EXAM_DISABLED: the title-exam module is not enabled.' });
  }
  const matter = await getMatterById(matterId, userId);
  if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
  if (matter.archivedAt !== null) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'MATTER_ARCHIVED' });
  return matter;
}

const matterInput = z.object({ matterId: z.string().uuid() });

export const titleExamRouter = router({
  /** Ungated probe so the client can decide whether to mount the surface. */
  isEnabled: protectedProcedure.query(() => ({ enabled: isTitleExamEnabled() })),

  getMatterAttribute: protectedProcedure.input(matterInput).query(async ({ ctx, input }) => {
    await assertTitleExamAllowed(ctx.userId, input.matterId);
    return getTitleExamMatterAttribute(input.matterId, ctx.userId);
  }),

  setMatterAttribute: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        npiPosture: z.enum(TITLE_EXAM_NPI_POSTURE_VALUES).optional(),
        entityHatAtSet: z.string().max(64).optional(),
        dcCaveatAcknowledged: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTitleExamAllowed(ctx.userId, input.matterId);
      const id = await upsertTitleExamMatterAttribute({
        userId: ctx.userId,
        matterId: input.matterId,
        ...(input.npiPosture !== undefined ? { npiPosture: input.npiPosture } : {}),
        ...(input.entityHatAtSet !== undefined ? { entityHatAtSet: input.entityHatAtSet } : {}),
        ...(input.dcCaveatAcknowledged ? { dcCaveatAcknowledgedAt: new Date() } : {}),
      });
      return { id };
    }),

  /** §2 — the owner's DC-exam visibility signal (a review-prompt nudge, never a legal determination). */
  dcExamVisibility: protectedProcedure.query(async ({ ctx }) => getDcExamVisibility(ctx.userId)),

  listExamSessions: protectedProcedure.input(matterInput).query(async ({ ctx, input }) => {
    await assertTitleExamAllowed(ctx.userId, input.matterId);
    return listTitleExamSessionsForMatter(input.matterId, ctx.userId);
  }),

  getExamSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await getTitleExamSessionById(input.sessionId, ctx.userId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Exam session not found' });
      const findings = await listTitleExamFindingsBySession(input.sessionId, ctx.userId);
      return { session, findings };
    }),

  /**
   * Run a full title examination on a matter's abstract materials: build the identical record set, dispatch the
   * two role-bound lanes + the fresh-context reconciler (LIVE, through the fail-closed broker, §4b config
   * models), reconcile per NC-1, synthesize the NON-FINAL memo, and persist. Live provider calls occur here
   * ONLY when the flag is ON and the operator drives it.
   */
  runExam: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        jurisdiction: z.string().max(16).optional(),
        effectiveDate: z.string().max(32).optional(),
        incompletenessBanner: z.string().optional(),
        completeness: z.enum(['complete', 'incomplete']).optional(),
        droppedPageCount: z.number().int().min(0).optional(),
        seedFacts: z.array(z.object({ sourceMatterId: z.string(), text: z.string() })).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const matter = await assertTitleExamAllowed(ctx.userId, input.matterId);
      const hat = resolveHat(matter.engagementCapacity);
      const materials = await listMaterialsForMatter(input.matterId, ctx.userId);
      const abstractText = materials
        .map((m) => (typeof m.textContent === 'string' ? m.textContent : ''))
        .filter((t) => t.length > 0)
        .join('\n\n');
      const materialsCensus = materials.map((m) => m.filename ?? 'paste-text');

      const subject: EgressSubject = { type: 'matter', subjectId: input.matterId, matterId: input.matterId, userId: ctx.userId };
      const result = await runTitleExamPipeline(
        { examiner: makeLlmLaneExaminer({ subject }), reconcile: makeReconcilerDispatch({ subject }) },
        {
          userId: ctx.userId,
          matterId: input.matterId,
          jurisdiction: input.jurisdiction ?? matter.jurisdiction ?? null,
          entityHat: hat,
          matterTitle: matter.title,
          abstractText,
          materialsCensus,
          ...(input.effectiveDate !== undefined ? { effectiveDate: input.effectiveDate } : {}),
          ...(input.incompletenessBanner !== undefined ? { incompletenessBanner: input.incompletenessBanner } : {}),
          ...(input.completeness !== undefined ? { completeness: input.completeness } : {}),
          ...(input.droppedPageCount !== undefined ? { droppedPageCount: input.droppedPageCount } : {}),
          ...(input.seedFacts !== undefined ? { seedFacts: input.seedFacts } : {}),
          models: {
            examiner_a: resolveTitleExamModel('examiner_a'),
            examiner_b: resolveTitleExamModel('examiner_b'),
            reconciler: resolveTitleExamModel('reconciler'),
          },
        },
      );
      return result;
    }),

  /** NC-1 — the attorney's logged ADOPT/MODIFY/HOLD for an escalated finding. */
  recordFindingDecision: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        findingId: z.string().uuid(),
        disposition: z.enum(['adopt', 'modify', 'hold']),
        rationale: z.string().optional(),
        modifiedText: z.string().optional(),
        sessionId: z.string().uuid().optional(),
        findingTitle: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTitleExamAllowed(ctx.userId, input.matterId);
      return recordFindingDecision({
        userId: ctx.userId,
        matterId: input.matterId,
        findingId: input.findingId,
        disposition: input.disposition,
        ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
        ...(input.modifiedText !== undefined ? { modifiedText: input.modifiedText } : {}),
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.findingTitle !== undefined ? { findingTitle: input.findingTitle } : {}),
      });
    }),

  /** NC-7 — the attorney's logged import / do-not-import resolution for a contamination-flagged seed finding. */
  recordImportResolution: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        findingId: z.string().uuid(),
        decision: z.enum(['import', 'do_not_import']),
        justification: z.string().optional(),
        sessionId: z.string().uuid().optional(),
        findingTitle: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTitleExamAllowed(ctx.userId, input.matterId);
      return recordImportResolution({
        userId: ctx.userId,
        matterId: input.matterId,
        findingId: input.findingId,
        decision: input.decision,
        ...(input.justification !== undefined ? { justification: input.justification } : {}),
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.findingTitle !== undefined ? { findingTitle: input.findingTitle } : {}),
      });
    }),

  /** T6 / NC-3 — the distinct, logged Approve-for-Client-Delivery act (version-locked; NO send path). */
  approveForClientDelivery: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        sessionId: z.string().uuid(),
        documentId: z.string().uuid().optional(),
        approvedMemoText: z.string().min(1),
        hat: z.string().max(64),
        recipientClass: z.enum(['client', 'lender', 'underwriter', 'agent', 'counsel', 'other']),
        posture: z.enum(['exam_only', 'exam_with_curative_identification']),
        advicePermitted: z.boolean(),
        caveats: z.array(z.string()).optional(),
        exclusions: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTitleExamAllowed(ctx.userId, input.matterId);
      return recordClientDeliveryApproval({
        userId: ctx.userId,
        matterId: input.matterId,
        sessionId: input.sessionId,
        ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
        approvedMemoText: input.approvedMemoText,
        approval: {
          attorneyUserId: ctx.userId,
          hat: input.hat,
          recipientClass: input.recipientClass,
          posture: input.posture,
          advicePermitted: input.advicePermitted,
          caveats: input.caveats ?? [],
          exclusions: input.exclusions ?? [],
        },
      });
    }),
});
