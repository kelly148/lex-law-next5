/**
 * Orchestration tRPC procedures — FOLD-ORCH-1 (Increment 3b-2).
 *
 * Consolidation READ API + the idempotent divergent-item registration. This automates the LABOR
 * (group + classify + surface) but never the JUDGMENT — it never adopts, never regenerates, never
 * closes anything. The attorney is always final.
 *
 *   - getConsolidation (query, READ-ONLY): the matter's toggled-on set (session.selectedReviewers)
 *     is the N-of-M denominator; the persisted evaluator issueGroups (Inc3b-1) are the grouping
 *     source; the Inc1 engine classifies (convergent-low-risk = the only bulk-eligible class;
 *     divergent / convergent-high-risk / single-reviewer = per-item). Content-preserving divergent
 *     items are returned for display. NO writes.
 *   - registerDivergentItems (mutation): persists the divergent groups as open_items via the
 *     never-auto-close registry (Fork E). IDEMPOTENT per session — re-running is a no-op (it never
 *     duplicates, and never closes a prior run's items).
 *
 * userId is always ctx.userId (Ch 35.2). Ownership flows through the owner-scoped query wrappers.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import {
  getReviewSessionById,
  listFeedbackForSession,
  getEvaluationForIteration,
} from '../db/queries/phase4b.js';
import { getDocumentById } from '../db/queries/documents.js';
import { listOpenItemsForMatter, registerDivergentOpenItem } from '../db/queries/openItems.js';
import {
  assembleSessionConsolidation,
  type SessionConsolidationProjection,
} from '../orchestration/sessionConsolidation.js';

const DIVERGENT_ORIGIN = 'orchestration';

/** Read the session + feedback + persisted evaluator grouping and run the PURE consolidation. */
async function loadConsolidation(
  reviewSessionId: string,
  userId: string,
): Promise<{ projection: SessionConsolidationProjection; documentId: string }> {
  const session = await getReviewSessionById(reviewSessionId, userId);
  if (!session) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Review session not found' });
  }
  const feedbackRows = await listFeedbackForSession(reviewSessionId, userId);
  const evaluation = await getEvaluationForIteration(session.documentId, session.iterationNumber, userId);

  const projection = assembleSessionConsolidation({
    reviewSessionId,
    intendedReviewers: session.selectedReviewers,
    feedbackRows: feedbackRows.map((r) => ({ reviewerRole: r.reviewerRole, suggestions: r.suggestions })),
    issueGroups: evaluation?.issueGroups ?? null,
  });

  return { projection, documentId: session.documentId };
}

export const orchestrationRouter = router({
  // ============================================================
  // orchestration.getConsolidation — READ-ONLY (the labor, never the judgment)
  // ============================================================
  getConsolidation: protectedProcedure
    .input(z.object({ reviewSessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { projection } = await loadConsolidation(input.reviewSessionId, ctx.userId);
      return {
        groups: projection.consolidation.groups,
        denominator: projection.consolidation.denominator,
        convergenceFloorMet: projection.consolidation.convergenceFloorMet,
        bulkEligibleIssueIds: projection.consolidation.bulkEligibleIssueIds,
        divergentItems: projection.divergentItems,
      };
    }),

  // ============================================================
  // orchestration.registerDivergentItems — idempotent per session (Fork E, never auto-close)
  // ============================================================
  registerDivergentItems: protectedProcedure
    .input(z.object({ reviewSessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { projection, documentId } = await loadConsolidation(input.reviewSessionId, ctx.userId);

      const doc = await getDocumentById(documentId, ctx.userId);
      if (!doc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }

      // Idempotency (session-granular): if orchestration already registered divergent items for
      // THIS session, do nothing — never duplicate, never re-open. A NEW run (new session) is a
      // fresh registration; prior items stay open until the attorney resolves them.
      const existing = await listOpenItemsForMatter(doc.matterId, ctx.userId);
      const alreadyRegistered = existing.some(
        (o) => o.origin === DIVERGENT_ORIGIN && o.reviewSessionId === input.reviewSessionId,
      );
      if (alreadyRegistered) {
        return { registered: 0, alreadyRegistered: true, divergentCount: projection.divergentItems.length };
      }

      let registered = 0;
      for (const item of projection.divergentItems) {
        await registerDivergentOpenItem({
          userId: ctx.userId,
          matterId: doc.matterId,
          documentId,
          severity: item.severity,
          summary: item.summary,
          detail: item.detail,
          reviewSessionId: input.reviewSessionId,
          versionId: null,
        });
        registered += 1;
      }

      return { registered, alreadyRegistered: false, divergentCount: projection.divergentItems.length };
    }),
});
