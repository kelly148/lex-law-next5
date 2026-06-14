/**
 * In-memory ChatCopilotStore for tests (NOT a test file — no *.test suffix, so vitest never collects it).
 *
 * Mirrors the real Drizzle store's ownerScope() semantics: every read filters by userId, so a cross-owner
 * read returns null/empty exactly as the production owner filter would. Lets the CHAT-COPILOT-1 lifecycle /
 * isolation / store-by-reference / do-not-persist behavior be exercised fully and deterministically with no
 * database (the repo's seam convention). Shared by the Inc 1 and Inc 2 suites.
 */
import type {
  ChatCopilotStore,
  ConversationLifecyclePatch,
  MessagePatch,
} from '../db/queries/chatCopilot.js';
import type { NewChatConversation, NewChatMessage, NewChatSummary } from '../db/schema.js';
import type {
  ChatConversationRow,
  ChatMessageRow,
  ChatSummaryRow,
  CapacitySnapshot,
  ChatCitation,
  ChatSummaryPosture,
  ChatMessageRole,
} from '../../shared/schemas/chatCopilot.js';

export function createInMemoryChatCopilotStore(now: () => Date = () => new Date(2026, 5, 13)): ChatCopilotStore {
  const conversations: ChatConversationRow[] = [];
  const messages: ChatMessageRow[] = [];
  const summaries: ChatSummaryRow[] = [];

  return {
    insertConversation(row: NewChatConversation): Promise<ChatConversationRow> {
      const r: ChatConversationRow = {
        id: row.id!,
        userId: row.userId!,
        matterId: row.matterId!,
        documentId: row.documentId ?? null,
        documentVersionId: row.documentVersionId ?? null,
        title: row.title ?? null,
        capacitySnapshot: row.capacitySnapshot as CapacitySnapshot,
        retentionClass: row.retentionClass ?? 'active_matter_plus_5y',
        legalHold: row.legalHold ?? false,
        legalHoldReason: row.legalHoldReason ?? null,
        doNotPersist: row.doNotPersist ?? false,
        excludeFromGrounding: row.excludeFromGrounding ?? false,
        frozenAt: row.frozenAt ?? null,
        freezeReason: row.freezeReason ?? null,
        closedAt: row.closedAt ?? null,
        exportedAt: row.exportedAt ?? null,
        exportRef: row.exportRef ?? null,
        deletedAt: row.deletedAt ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      conversations.push(r);
      return Promise.resolve(r);
    },
    getConversation(id, userId) {
      return Promise.resolve(conversations.find((c) => c.id === id && c.userId === userId) ?? null);
    },
    listConversationsForMatter(matterId, userId, includeDeleted) {
      return Promise.resolve(
        conversations.filter(
          (c) => c.userId === userId && c.matterId === matterId && (includeDeleted || c.deletedAt === null),
        ),
      );
    },
    patchConversation(id, userId, patch: ConversationLifecyclePatch) {
      const c = conversations.find((x) => x.id === id && x.userId === userId);
      if (!c) return Promise.resolve(null);
      Object.assign(c, patch);
      c.updatedAt = now();
      return Promise.resolve(c);
    },
    insertMessage(row: NewChatMessage): Promise<ChatMessageRow> {
      const r: ChatMessageRow = {
        id: row.id!,
        userId: row.userId!,
        matterId: row.matterId!,
        conversationId: row.conversationId!,
        seq: row.seq!,
        role: row.role as ChatMessageRole,
        content: row.content ?? null,
        contentHash: row.contentHash ?? null,
        masterApplied: row.masterApplied ?? false,
        masterSource: row.masterSource ?? null,
        capacitySnapshot: (row.capacitySnapshot as CapacitySnapshot | null | undefined) ?? null,
        draftingGateDecisionId: row.draftingGateDecisionId ?? null,
        citations: (row.citations as ChatCitation[] | null | undefined) ?? null,
        modelProvider: row.modelProvider ?? null,
        modelId: row.modelId ?? null,
        doNotPersist: row.doNotPersist ?? false,
        excludeFromGrounding: row.excludeFromGrounding ?? false,
        createdAt: now(),
      };
      messages.push(r);
      return Promise.resolve(r);
    },
    getMessage(id, userId) {
      return Promise.resolve(messages.find((m) => m.id === id && m.userId === userId) ?? null);
    },
    listMessages(conversationId, userId) {
      return Promise.resolve(
        messages
          .filter((m) => m.conversationId === conversationId && m.userId === userId)
          .sort((a, b) => a.seq - b.seq),
      );
    },
    patchMessage(id, userId, patch: MessagePatch) {
      const m = messages.find((x) => x.id === id && x.userId === userId);
      if (!m) return Promise.resolve(null);
      if (patch.content !== undefined) m.content = patch.content;
      if (patch.contentHash !== undefined) m.contentHash = patch.contentHash;
      if (patch.citations !== undefined) m.citations = patch.citations as ChatCitation[] | null;
      if (patch.doNotPersist !== undefined) m.doNotPersist = patch.doNotPersist;
      if (patch.excludeFromGrounding !== undefined) m.excludeFromGrounding = patch.excludeFromGrounding;
      return Promise.resolve(m);
    },
    maxSeq(conversationId, userId) {
      const seqs = messages
        .filter((m) => m.conversationId === conversationId && m.userId === userId)
        .map((m) => m.seq);
      return Promise.resolve(seqs.length === 0 ? null : Math.max(...seqs));
    },
    insertSummary(row: NewChatSummary): Promise<ChatSummaryRow> {
      const r: ChatSummaryRow = {
        id: row.id!,
        userId: row.userId!,
        matterId: row.matterId!,
        conversationId: row.conversationId!,
        capacitySnapshot: row.capacitySnapshot as CapacitySnapshot,
        posture: row.posture as ChatSummaryPosture,
        coversFromSeq: row.coversFromSeq!,
        coversToSeq: row.coversToSeq!,
        summaryText: row.summaryText!,
        createdAt: now(),
      };
      summaries.push(r);
      return Promise.resolve(r);
    },
    listSummaries(conversationId, userId) {
      return Promise.resolve(
        summaries
          .filter((s) => s.conversationId === conversationId && s.userId === userId)
          .sort((a, b) => a.coversFromSeq - b.coversFromSeq),
      );
    },
  };
}
