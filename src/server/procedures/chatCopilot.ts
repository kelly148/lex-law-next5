/**
 * CHAT-COPILOT-1 (Inc 1) — chat copilot lifecycle procedures.
 *
 * The attorney-facing surface for the persisted-conversation LIFECYCLE: create / read (windowed list is
 * Inc 2) / delete (legal-hold honored) / legal-hold / do-not-persist + exclude-from-grounding marks
 * (per conversation AND per turn) / export-to-matter-file. The actual per-turn PERSISTENCE during a chat
 * (append + the fresh per-turn gate) is wired into chatDispatch in Inc 2.
 *
 * Gated behind CHAT_COPILOT_ENABLED (default OFF, fail-closed): when OFF every procedure refuses with
 * PRECONDITION_FAILED and NO chat_* row is read or written — byte-for-byte the prior chat substrate.
 * userId is ALWAYS ctx.userId (Ch 35.2); every conversation use is owner + matter (+ document) isolation
 * guarded (assertConversationContext) on top of ownerScope().
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isChatCopilotEnabled } from '../config/featureFlags.js';
import { getMatterById } from '../db/queries/matters.js';
import { getDocumentById } from '../db/queries/documents.js';
import {
  createConversation,
  getConversationInContext,
  listConversations,
  listMessages,
  listConversationSummaries,
  appendChatMessage,
  freezeConversation,
  softDeleteConversation,
  setLegalHold,
  setConversationMark,
  setMessageExcludeFromGrounding,
  redactMessage,
  exportConversationToMatterFile,
} from '../db/queries/chatCopilot.js';
import { executeCanonicalMutation } from '../db/canonicalMutation.js';
import { PRIMARY_DRAFTER_MODEL, parseModelString } from '../llm/config.js';
import { resolveChatMaster, CHAT_MASTER_UI_NOTICE } from '../llm/chatMasterComposition.js';
import { CHAT_TURN_SYSTEM_PROMPT } from './chatDispatch.js';
import {
  buildCapacitySnapshot,
  evaluateFreeze,
  assembleCopilotWindow,
  draftingGateDecisionId,
  type WindowMessage,
  type AssembledWindow,
} from '../llm/chatCopilotPolicy.js';
import { isGroundedChatProviderAllowed } from '../llm/chatCopilotConfig.js';
import { assembleGroundedChatContext, parseChatCitations } from '../llm/chatGrounding.js';
import type { ChatCitation } from '../../shared/schemas/chatCopilot.js';

/** Inc 2: default windowed-history size (last-N turns), overridable per call. */
const DEFAULT_WINDOW_LIMIT = 12;

/** Render the posture-compatible summaries + scrubbed window into a text block for the model. */
function renderWindow(assembled: AssembledWindow): string {
  const parts: string[] = [];
  if (assembled.includedSummaries.length > 0) {
    parts.push('[CONVERSATION SUMMARY]');
    for (const s of assembled.includedSummaries) parts.push(s.summaryText);
  }
  if (assembled.windowMessages.length > 0) {
    parts.push('[PRIOR TURNS]');
    for (const m of assembled.windowMessages) parts.push(`${m.role}: ${m.content ?? ''}`);
  }
  return parts.join('\n');
}

function assertChatCopilotEnabled(): void {
  if (!isChatCopilotEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'CHAT_COPILOT_DISABLED' });
  }
}

export const chatCopilotRouter = router({
  // Ungated flag read so a future composer can decide whether to render the copilot surface.
  isEnabled: protectedProcedure.query(() => ({ enabled: isChatCopilotEnabled() })),

  // ============================================================
  // Inc 2 — submitTurn: persisted, windowed, fresh-per-turn-gated chat turn with the laundering mitigations.
  // ============================================================
  submitTurn: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        matterId: z.string().uuid(),
        turnText: z.string().min(1).max(8000),
        windowLimit: z.number().int().min(0).max(100).optional(),
        doNotPersist: z.boolean().optional(),
        // Inc 3+4: optional mode (dynamic grounding budget) + the attorney's affirmative per-turn
        // material selection (overrides the default NPI category-level withhold for those materials).
        mode: z.string().max(32).optional(),
        selectedMaterialIds: z.array(z.string().uuid()).max(50).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      // LIVE matter (owner-scoped). The whole turn re-derives posture from this — never from stored flags.
      const matter = await getMatterById(input.matterId, ctx.userId);
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      const cctx = { userId: ctx.userId, matterId: input.matterId };
      const conv = await getConversationInContext(input.conversationId, cctx); // isolation guard

      // (b) FREEZE-ON-CAPACITY-DIVERGENCE. A thread cannot continue under a posture different from the one
      // it was born in — the primary defense against replaying a master-applied history into a new posture.
      const liveSnapshot = buildCapacitySnapshot(matter);
      const freeze = evaluateFreeze(conv, liveSnapshot);
      if (freeze.alreadyFrozen) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'CONVERSATION_FROZEN' });
      }
      if (freeze.freeze) {
        await freezeConversation(conv.id, ctx.userId, freeze.reason ?? 'capacity_divergence');
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'CONVERSATION_FROZEN_CAPACITY_DIVERGENCE' });
      }

      // (a) FRESH per-turn gate — recompute principal + capacity + election + title-signal + the conflict
      // gate from LIVE matter state EVERY turn. Persisted masterApplied/masterSource are AUDIT-ONLY and are
      // never read to decide injection. The non-suppressible R4 addendum is re-asserted inside the decision.
      const chat = await resolveChatMaster({
        matterId: input.matterId,
        userId: ctx.userId,
        matter,
        principal: { userId: ctx.userId },
      });
      const currentMasterApplied = chat.inject;
      const gateId = draftingGateDecisionId({ allowed: chat.inject, clearance: { state: chat.reason } });

      // Windowed history: last-N -> (c) window-scrub (drop master-applied priors when this turn is neutral)
      // -> (d) posture-compatible summaries only. No silent scrub — the scrubbed count is returned.
      const prior = await listMessages(input.conversationId, cctx);
      const summaries = await listConversationSummaries(input.conversationId, cctx);
      const window: WindowMessage[] = prior.map((m) => ({
        seq: m.seq,
        role: m.role,
        content: m.content,
        masterApplied: m.masterApplied,
        doNotPersist: m.doNotPersist,
        excludeFromGrounding: m.excludeFromGrounding,
        capacitySnapshot: m.capacitySnapshot,
      }));
      const assembled = assembleCopilotWindow({
        priorMessages: window,
        summaries,
        currentMasterApplied,
        currentCapacitySnapshot: liveSnapshot,
        limit: input.windowLimit ?? DEFAULT_WINDOW_LIMIT,
      });

      // ── Inc 3+4: GROUNDING (FAIL-CLOSED). Eligible ONLY when the turn's provider is on the grounded-chat
      // allowlist (ships EMPTY) AND the conversation is not sensitivity-downgraded (excludeFromGrounding).
      // With the default EMPTY allowlist this is ALWAYS false -> NO grounding -> matter-state-only, i.e.
      // byte-for-byte the Inc 2 turn (no document/material text is assembled or sent). When eligible, the
      // assembler applies NPI minimization + mints sourceIds the model cannot invent; citations are
      // validated against that set after the response (a hallucinated sourceId is rejected, not rendered).
      const provider = parseModelString(PRIMARY_DRAFTER_MODEL).providerId;
      const groundingEligible = isGroundedChatProviderAllowed(provider) && conv.excludeFromGrounding !== true;
      const grounding = groundingEligible
        ? await assembleGroundedChatContext({
            matterId: input.matterId,
            userId: ctx.userId,
            documentId: conv.documentId,
            mode: input.mode ?? null,
            selectedMaterialIds: input.selectedMaterialIds ?? [],
          })
        : null;
      const groundedSourceIds = new Set<string>(grounding?.sourceIds ?? []);

      // Persist the attorney turn by-reference (store-by-reference + per-turn do-not-persist honored).
      await appendChatMessage({
        conversationId: conv.id,
        ctx: cctx,
        turn: {
          role: 'attorney',
          text: input.turnText,
          masterApplied: currentMasterApplied,
          masterSource: chat.source,
          capacitySnapshot: liveSnapshot,
          draftingGateDecisionId: gateId,
          ...(input.doNotPersist === true ? { doNotPersist: true } : {}),
        },
      });

      // Model call through the canonical chokepoint. The scrubbed/posture-filtered history is prepended to
      // the user prompt; the master text (with its re-asserted R4 addendum) is layered only when injected.
      const historyText = renderWindow(assembled);
      const groundedPrefix = grounding && grounding.contextText ? `${grounding.contextText}\n\n` : '';
      const turnAndHistory = historyText
        ? `${historyText}\n\n[CURRENT TURN]\nattorney: ${input.turnText}`
        : input.turnText;
      // groundedPrefix is '' whenever grounding is inert (the default), so the OFF path is byte-for-byte Inc 2.
      const userPrompt = groundedPrefix + turnAndHistory;
      let response = '';
      const result = await executeCanonicalMutation({
        userId: ctx.userId,
        jobType: 'chat_turn',
        modelString: PRIMARY_DRAFTER_MODEL,
        matterId: input.matterId,
        ...(chat.layeredMasterText !== null ? { chatMasterText: chat.layeredMasterText } : {}),
        txn1Enqueue: (jobId) => Promise.resolve({ jobId }),
        buildLlmParams: () => ({
          systemPrompt: CHAT_TURN_SYSTEM_PROMPT,
          userPrompt,
          temperature: 0.3,
          maxTokens: 2048,
        }),
        txn2Commit: ({ output }) => {
          response = typeof output === 'string' ? output : JSON.stringify(output);
          return Promise.resolve();
        },
        txn2Revert: () => Promise.resolve(),
        telemetryCtx: { userId: ctx.userId, matterId: input.matterId, documentId: null, jobId: null },
      });

      // CITATION FIDELITY: validate the model's [[cite:...]] markers against the assembled sourceId set —
      // a cited sourceId not present is a hallucination and is REJECTED (dropped, not rendered/persisted).
      // Only meaningful on a grounded turn (no grounding -> no sourceIds -> any citation is rejected/empty).
      const { citations: validCitations, rejectedCount: rejectedCitationCount }: {
        citations: ChatCitation[];
        rejectedCount: number;
      } = grounding ? parseChatCitations(response, groundedSourceIds) : { citations: [], rejectedCount: 0 };

      // Persist the assistant response by-reference (masterApplied/masterSource AUDIT-ONLY; citations
      // reference-only — sanitized to sourceId + locator by the Inc 1 store-by-reference projection).
      await appendChatMessage({
        conversationId: conv.id,
        ctx: cctx,
        turn: {
          role: 'assistant',
          text: response,
          masterApplied: currentMasterApplied,
          masterSource: chat.source,
          capacitySnapshot: liveSnapshot,
          draftingGateDecisionId: gateId,
          modelProvider: 'anthropic',
          modelId: PRIMARY_DRAFTER_MODEL,
          ...(validCitations.length > 0 ? { citations: validCitations } : {}),
          ...(input.doNotPersist === true ? { doNotPersist: true } : {}),
        },
      });

      return {
        jobId: result.jobId,
        status: result.status,
        response,
        master: {
          applied: chat.inject,
          source: chat.source,
          representational: chat.representational,
          notice: chat.inject ? CHAT_MASTER_UI_NOTICE : null,
        },
        // No silent truncation/scrub: the UI is told how much history was windowed/scrubbed.
        window: {
          included: assembled.windowMessages.length,
          scrubbedMasterTurns: assembled.scrubbedMasterTurns,
          summaries: assembled.includedSummaries.length,
        },
        // Inc 3+4: citations (reference-only) + grounding posture surfaced for the future copilot UI.
        citations: validCitations,
        rejectedCitationCount,
        grounding: {
          grounded: grounding !== null,
          sources: grounding?.sources.length ?? 0,
          // No SILENT truncation: omitted materials + truncation + NPI-withheld counts are surfaced.
          omittedCount: grounding?.omittedCount ?? 0,
          truncated: grounding?.truncated ?? false,
          npiWithheldCount: grounding?.npiWithheldCount ?? 0,
        },
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        documentId: z.string().uuid().nullable().optional(),
        title: z.string().max(256).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      const matter = await getMatterById(input.matterId, ctx.userId);
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      let documentVersionId: string | null = null;
      if (input.documentId) {
        const doc = await getDocumentById(input.documentId, ctx.userId);
        // The document must belong to the BOUND matter (current-matter scope, like chatDispatch R7).
        if (!doc || doc.matterId !== input.matterId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found in this matter' });
        }
        documentVersionId = doc.currentVersionId ?? null;
      }
      return createConversation({
        userId: ctx.userId,
        matterId: input.matterId,
        matter,
        documentId: input.documentId ?? null,
        documentVersionId,
        title: input.title ?? null,
        matterType: matter.paKey ?? matter.practiceArea ?? null,
      });
    }),

  list: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      return listConversations(input.matterId, ctx.userId);
    }),

  get: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        matterId: z.string().uuid(),
        documentId: z.string().uuid().nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      return getConversationInContext(input.conversationId, {
        userId: ctx.userId,
        matterId: input.matterId,
        documentId: input.documentId ?? null,
      });
    }),

  messages: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid(), matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      return listMessages(input.conversationId, { userId: ctx.userId, matterId: input.matterId });
    }),

  delete: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      await softDeleteConversation(input.conversationId, ctx.userId);
      return { deleted: true };
    }),

  setLegalHold: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid(), on: z.boolean(), reason: z.string().max(2000).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      return setLegalHold(input.conversationId, ctx.userId, input.on, input.reason ?? null);
    }),

  setMark: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        doNotPersist: z.boolean().optional(),
        excludeFromGrounding: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      const marks: { doNotPersist?: boolean; excludeFromGrounding?: boolean } = {};
      if (input.doNotPersist !== undefined) marks.doNotPersist = input.doNotPersist;
      if (input.excludeFromGrounding !== undefined) marks.excludeFromGrounding = input.excludeFromGrounding;
      return setConversationMark(input.conversationId, ctx.userId, marks);
    }),

  setMessageExcludeFromGrounding: protectedProcedure
    // matterId binds the per-message op to the caller's matter CONTEXT (isolation hardening, not owner-scope alone).
    .input(z.object({ messageId: z.string().uuid(), matterId: z.string().uuid(), on: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      return setMessageExcludeFromGrounding(input.messageId, ctx.userId, input.matterId, input.on);
    }),

  redactMessage: protectedProcedure
    // matterId binds the per-message op to the caller's matter CONTEXT (isolation hardening, not owner-scope alone).
    .input(z.object({ messageId: z.string().uuid(), matterId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      return redactMessage(input.messageId, ctx.userId, input.matterId);
    }),

  exportToMatterFile: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      return exportConversationToMatterFile(input.conversationId, ctx.userId);
    }),
});
