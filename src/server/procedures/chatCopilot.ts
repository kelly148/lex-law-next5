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
  softDeleteConversation,
  setLegalHold,
  setConversationMark,
  setMessageExcludeFromGrounding,
  redactMessage,
  exportConversationToMatterFile,
} from '../db/queries/chatCopilot.js';

function assertChatCopilotEnabled(): void {
  if (!isChatCopilotEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'CHAT_COPILOT_DISABLED' });
  }
}

export const chatCopilotRouter = router({
  // Ungated flag read so a future composer can decide whether to render the copilot surface.
  isEnabled: protectedProcedure.query(() => ({ enabled: isChatCopilotEnabled() })),

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
    .input(z.object({ messageId: z.string().uuid(), on: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      return setMessageExcludeFromGrounding(input.messageId, ctx.userId, input.on);
    }),

  redactMessage: protectedProcedure
    .input(z.object({ messageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      return redactMessage(input.messageId, ctx.userId);
    }),

  exportToMatterFile: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertChatCopilotEnabled();
      return exportConversationToMatterFile(input.conversationId, ctx.userId);
    }),
});
