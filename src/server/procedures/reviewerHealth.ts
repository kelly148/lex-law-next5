/**
 * reviewerHealth router — REVIEWER-HEALTH-VIEW-1 (the 5C observability panel).
 *
 * READ-ONLY, owner-scoped operational view over existing job/review data (the SUPERVISION-VIEW-1 shape):
 * protectedProcedure everywhere; an assertEnabled() gate (REVIEWER_HEALTH_VIEW_ENABLED, default OFF) on
 * every op except the ungated isEnabled probe; userId is ALWAYS ctx.userId. No mutation, no egress.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isReviewerHealthViewEnabled } from '../config/featureFlags.js';
import { getReviewerHealthSnapshot } from '../db/queries/reviewerHealth.js';

function assertEnabled(): void {
  if (!isReviewerHealthViewEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'REVIEWER_HEALTH_VIEW_DISABLED' });
  }
}

export const reviewerHealthRouter = router({
  // Ungated probe so the client can decide whether to mount the nav link + the page.
  isEnabled: protectedProcedure.query(() => ({ enabled: isReviewerHealthViewEnabled() })),

  // Owner-scoped read-only snapshot: reviewer_feedback job-status counts over a window + active sessions.
  snapshot: protectedProcedure
    .input(z.object({ windowHours: z.number().int().min(1).max(168).default(24) }).optional())
    .query(async ({ ctx, input }) => {
      assertEnabled();
      return getReviewerHealthSnapshot(ctx.userId, input?.windowHours ?? 24);
    }),
});
