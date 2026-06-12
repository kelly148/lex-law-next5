/**
 * CHAT-DISPATCH-1 — chat→model dispatch substrate.
 *
 * `submitTurn` routes a single chat turn through the canonical LLM chokepoint
 * (executeCanonicalMutation — the DISPATCHER-COMPLETE-1 enqueue/run split) as a `chat_turn`
 * job and returns the model's text. The whole surface is gated behind CHAT_DISPATCH_ENABLED
 * (default OFF): when OFF the procedure refuses and no chat turn ever reaches a model, so
 * behavior is byte-for-byte unchanged (the chat composer stays the inert placeholder).
 *
 * SUBSTRATE ONLY:
 *  - Injects NO master prompt. callRoleForJobType('chat_turn') maps to 'other', so
 *    assemblePrompt returns legacy — master-into-chat selection (Law-Firm vs Title posture)
 *    is INSTR Phase D and is separately gated on the external triad review.
 *  - userId is ALWAYS ctx.userId (Ch 35.2); the turn is matter-owner-scoped (assertMatterOwned),
 *    so it inherits the same access-control as every other model-calling job.
 *  - No new table: the turn rides the existing jobs row (jobType is varchar(64) → no migration).
 *  - Runs INLINE (request→response, the matter_analysis template). The async/deferred-via-
 *    dispatcher variant and conversation-history persistence are deferred follow-ups.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isChatDispatchEnabled } from '../config/featureFlags.js';
import { getMatterById } from '../db/queries/matters.js';
import { executeCanonicalMutation } from '../db/canonicalMutation.js';
import { PRIMARY_DRAFTER_MODEL } from '../llm/config.js';

/**
 * Minimal neutral substrate system prompt. This is NOT the firm master — master-into-chat
 * selection is INSTR Phase D (triad-gated). It carries only the architectural floor in prose:
 * advise/draft, never take a consequential action (which is performed separately by the
 * attorney through an explicit confirmation step).
 */
export const CHAT_TURN_SYSTEM_PROMPT =
  'You are assisting a licensed attorney inside a legal-matter workspace. Respond to the ' +
  "attorney's message with concise, substantive legal analysis or drafting help. Provide " +
  'analysis and draft text only; do not send, file, record, execute, or transmit anything, ' +
  'and do not claim to have taken any action — every consequential act is performed separately ' +
  'by the attorney through an explicit confirmation step.';

function assertChatDispatchEnabled(): void {
  if (!isChatDispatchEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'CHAT_DISPATCH_DISABLED' });
  }
}

async function assertMatterOwned(matterId: string, userId: string): Promise<void> {
  const matter = await getMatterById(matterId, userId);
  if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
}

export const chatDispatchRouter = router({
  // Ungated read of the flag so a future composer can decide whether to enable itself.
  isEnabled: protectedProcedure.query(() => ({ enabled: isChatDispatchEnabled() })),

  // Route a single chat turn through the chokepoint and return the model's text. Gated.
  submitTurn: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        documentId: z.string().uuid().nullable().optional(),
        turnText: z.string().min(1).max(8000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertChatDispatchEnabled();
      await assertMatterOwned(input.matterId, ctx.userId);

      let response = '';
      const result = await executeCanonicalMutation({
        userId: ctx.userId,
        jobType: 'chat_turn',
        modelString: PRIMARY_DRAFTER_MODEL,
        matterId: input.matterId,
        ...(input.documentId ? { documentId: input.documentId } : {}),
        txn1Enqueue: (jobId) => Promise.resolve({ jobId }),
        buildLlmParams: () => ({
          systemPrompt: CHAT_TURN_SYSTEM_PROMPT,
          userPrompt: input.turnText,
          temperature: 0.3,
          maxTokens: 2048,
        }),
        txn2Commit: ({ output }) => {
          response = typeof output === 'string' ? output : JSON.stringify(output);
          return Promise.resolve();
        },
        // The turn owns no in-flight document mutation, so there is nothing to revert.
        txn2Revert: () => Promise.resolve(),
        telemetryCtx: {
          userId: ctx.userId,
          matterId: input.matterId,
          documentId: input.documentId ?? null,
          jobId: null,
        },
      });

      return { jobId: result.jobId, status: result.status, response };
    }),
});
