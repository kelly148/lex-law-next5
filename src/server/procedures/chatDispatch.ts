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
 *    so it inherits the same access-control as every other model-calling job. R7 hardening: an
 *    optional documentId is additionally bound to the matter (assertDocumentInMatter) — a same-owner
 *    document from a DIFFERENT matter is rejected, so layered context stays strictly current-matter.
 *  - No new table: the turn rides the existing jobs row (jobType is varchar(64) → no migration).
 *  - Runs INLINE (request→response, the matter_analysis template). The async/deferred-via-
 *    dispatcher variant and conversation-history persistence are deferred follow-ups.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isChatDispatchEnabled, isMasterChatEnabled } from '../config/featureFlags.js';
import { getMatterById } from '../db/queries/matters.js';
import { getDocumentById } from '../db/queries/documents.js';
// CHAT-COPILOT-2 G1: this chat-dispatch surface reaches a provider ONLY through the egress broker — the
// same single non-bypassable chokepoint as the matter copilot (no direct executeCanonicalMutation).
import { egressClient } from '../llm/egressClient.js';
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

/**
 * R7 (CHAT-INJ-1 hardening) — current-matter scope-read invariant for the optional documentId.
 *
 * Owner-scoping ALONE is insufficient: a document the caller owns but that belongs to a DIFFERENT
 * matter would, once any document context is layered into the chat turn (matter-state injection and
 * any Phase-D context assembly both receive this documentId), pull a SECOND matter's content into
 * this turn — an owner-internal cross-matter leak. So the document must belong to the BOUND matter,
 * not merely be owned. A miss (not found, or a different matter) is REJECTED so chat context stays
 * strictly current-matter. NOT_FOUND (rather than a distinct code) avoids confirming the document
 * exists under another matter. Independent of MASTER_CHAT_ENABLED: a no-document or same-matter turn
 * is byte-for-byte unchanged; only a cross-matter documentId — previously accepted — is now refused.
 */
async function assertDocumentInMatter(documentId: string, matterId: string, userId: string): Promise<void> {
  const doc = await getDocumentById(documentId, userId);
  if (!doc || doc.matterId !== matterId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found in this matter' });
  }
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
      // R7 hardening: an optional documentId must belong to the bound matter, not merely be owned —
      // otherwise a same-owner cross-matter document would pull another matter's context into the turn.
      if (input.documentId) {
        await assertDocumentInMatter(input.documentId, input.matterId, ctx.userId);
      }

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
      // CHAT-COPILOT-2 G1: the send routes through the SINGLE egress broker — it GATES (allowlist
      // FAIL-CLOSED + 'no_external' + text-only/G4), writes a chat_egress_events audit row (allowed OR
      // BLOCKED), then dispatches through the canonical chokepoint. With the default-EMPTY allowlist the
      // broker BLOCKS the send (the copilot cannot operate until a provider is allowlisted) and logs it.
      const egress = await egressClient.send({
        audit: {
          kind: 'chat_primary',
          matterId: input.matterId,
          conversationId: null,
          holdFlag: 'none', // inline dispatch — no persisted per-conversation hold
          minimizationApplied: false,
          // Q1 hash-at-gate: the copilot-composed outbound bundle (system + any layered master + turn).
          serializedPayload: [CHAT_TURN_SYSTEM_PROMPT, chat.layeredMasterText, input.turnText].filter(Boolean).join('\n\n'),
          carriesImageEgress: false,
        },
        canonical: {
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
        },
      });
      const result = egress.result;

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
