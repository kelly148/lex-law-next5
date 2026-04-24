/**
 * Settings tRPC procedures — Ch 21.12 (Phase 3)
 *
 *   settings.get                    — get current user settings
 *   settings.updateReviewerEnablement — update reviewer on/off flags
 *
 * WOULD_DISABLE_ALL_REVIEWERS guard (Ch 21.12):
 *   If the update would result in all four reviewers being disabled,
 *   the procedure rejects with WOULD_DISABLE_ALL_REVIEWERS.
 *   At least one reviewer must remain enabled at all times.
 *
 * userId is always drawn from ctx.userId (Ch 35.2).
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import {
  getUserPreferences,
  updateReviewerEnablement,
} from '../db/queries/userPreferences.js';
import { ReviewerEnablementSchema } from '../../shared/schemas/matters.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';

export const settingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const prefs = await getUserPreferences(ctx.userId);
    return {
      reviewerEnablement: prefs.preferences.reviewerEnablement,
      voiceInput: prefs.preferences.voiceInput,
    };
  }),

  updateReviewerEnablement: protectedProcedure
    .input(
      z.object({
        reviewerEnablement: ReviewerEnablementSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { claude, gpt, gemini, grok } = input.reviewerEnablement;

      // WOULD_DISABLE_ALL_REVIEWERS guard (Ch 21.12)
      if (!claude && !gpt && !gemini && !grok) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'WOULD_DISABLE_ALL_REVIEWERS',
        });
      }

      const updated = await updateReviewerEnablement(
        ctx.userId,
        input.reviewerEnablement,
      );

      // Emit one event per reviewer (catalog requires per-reviewer payload shape)
      for (const [reviewer, enabled] of Object.entries(input.reviewerEnablement) as Array<['claude' | 'gpt' | 'gemini' | 'grok', boolean]>) {
        void emitTelemetry(
          'reviewer_enablement_changed',
          { reviewer, enabled },
          { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
        );
      }

      return {
        reviewerEnablement: updated.preferences.reviewerEnablement,
        voiceInput: updated.preferences.voiceInput,
      };
    }),
});
