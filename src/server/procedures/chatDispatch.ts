/**
 * CHAT-DISPATCH-1 — chat→model dispatch substrate.
 *
 * `submitTurn` routes a single chat turn through the canonical LLM chokepoint
 * (executeCanonicalMutation — the DISPATCHER-COMPLETE-1 enqueue/run split) as a `chat_turn`
 * job and returns the model's text. The whole surface is gated behind CHAT_DISPATCH_ENABLED
 * (default OFF): when OFF the procedure refuses and no chat turn ever reaches a model, so
 * behavior is byte-for-byte unchanged (the chat composer stays the inert placeholder).
 *
 * SUBSTRATE + CHAT-INJ-1 master-into-chat (INSTR Phase D, behind MASTER_CHAT_ENABLED, default OFF):
 *  - With MASTER_CHAT_ENABLED OFF (default) the turn injects NO master — byte-for-byte the
 *    CHAT-DISPATCH-1 substrate (the neutral chat prompt + matter-state), with ZERO extra reads.
 *  - With MASTER_CHAT_ENABLED ON, the turn receives a representational master (lawfirm / te, NEVER
 *    title) ONLY for the supervising attorney (R6), a valid owner-authorized matter (R1) in the
 *    representational law_firm seat (R3) with no unresolved title signal (R2) and a CLEARED
 *    conflicts/identity gate (R10). The decision lives in chatMasterComposition.resolveChatMaster;
 *    the master + its non-suppressible addendum (R4) is layered by the chokepoint; provenance (R8)
 *    is appended to the existing audit_events ledger. There is NO send/share/export path.
 *  - userId is ALWAYS ctx.userId (Ch 35.2); the turn is matter-owner-scoped (getOwnedMatterOrThrow),
 *    so it inherits the same access-control as every other model-calling job.
 *  - No new table: the turn rides the existing jobs row (jobType is varchar(64) → no migration).
 *  - Runs INLINE (request→response, the matter_analysis template). The async/deferred-via-
 *    dispatcher variant and conversation-history persistence are deferred follow-ups.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isChatDispatchEnabled, isMasterChatEnabled } from '../config/featureFlags.js';
import { getMatterById } from '../db/queries/matters.js';
import { executeCanonicalMutation } from '../db/canonicalMutation.js';
import { recordAuditEvent } from '../db/queries/auditEvents.js';
import { PRIMARY_DRAFTER_MODEL } from '../llm/config.js';
import { resolveChatMaster, CHAT_MASTER_UI_NOTICE } from '../llm/chatMasterComposition.js';

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

/**
 * Owner-scoped matter lookup (R1 matter-binding). The SAME single read CHAT-DISPATCH-1 already
 * performed, now RETURNING the row so the master-injection decision (R2/R3) can read the matter's
 * capacity without a second query. A miss (no matter / unauthorized) throws NOT_FOUND, so the turn
 * never reaches a model.
 */
async function getOwnedMatterOrThrow(matterId: string, userId: string) {
  const matter = await getMatterById(matterId, userId);
  if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
  return matter;
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
      const matter = await getOwnedMatterOrThrow(input.matterId, ctx.userId);

      // CHAT-INJ-1: decide whether this turn receives a firm master. Flag OFF (default) => NEUTRAL
      // with ZERO extra reads (the conflicts gate is never consulted) => byte-for-byte the substrate.
      // Never title; never the Law Firm default — the affirmative signal is the cleared gate (R10).
      const chat = await resolveChatMaster({
        matterId: input.matterId,
        userId: ctx.userId,
        matter,
        principal: { userId: ctx.userId },
      });

      let response = '';
      const result = await executeCanonicalMutation({
        userId: ctx.userId,
        jobType: 'chat_turn',
        modelString: PRIMARY_DRAFTER_MODEL,
        matterId: input.matterId,
        ...(input.documentId ? { documentId: input.documentId } : {}),
        // Only present when a master was injected; absent => the chokepoint's chat branch is skipped.
        ...(chat.layeredMasterText !== null ? { chatMasterText: chat.layeredMasterText } : {}),
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

      // R8 — provenance for the persisted turn: matter binding, posture/master id (or 'neutral'),
      // flag state, and representational-vs-neutral. Best-effort append to the EXISTING audit_events
      // JSON payload (no new column/migration). Recorded only while the feature is ON — a flag-OFF
      // turn writes nothing extra (R9). NO send/share/export path exists from this procedure.
      if (isMasterChatEnabled()) {
        void recordAuditEvent({
          userId: ctx.userId,
          matterId: input.matterId,
          documentId: input.documentId ?? null,
          eventType: 'model_output',
          actor: 'system',
          summary: chat.inject
            ? `Chat master injected (${chat.source}) for matter ${input.matterId}`
            : `Chat turn — no master (neutral) for matter ${input.matterId}`,
          action: chat.inject ? 'chat_master_injected' : 'chat_master_neutral',
          targetType: 'chat_turn',
          targetId: result.jobId,
          scope: chat.representational ? 'representational' : 'neutral',
          payload: {
            matterId: input.matterId,
            jobId: result.jobId,
            masterId: chat.source,
            representational: chat.representational,
            flagEnabled: true,
            engagementCapacity: matter.engagementCapacity ?? null,
            reason: chat.reason,
          },
        });
      }

      return {
        jobId: result.jobId,
        status: result.status,
        response,
        // R4 UI treatment: tell the composer to mark an injected turn an internal working draft.
        master: {
          applied: chat.inject,
          source: chat.source,
          representational: chat.representational,
          notice: chat.inject ? CHAT_MASTER_UI_NOTICE : null,
        },
      };
    }),
});
