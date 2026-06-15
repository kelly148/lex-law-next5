/**
 * chat copilot query layer (Zod Wall + ownerScope) — CHAT-COPILOT-1 (Inc 1).
 *
 * The SOLE read/write path for chat_conversations / chat_messages / chat_summaries. Every read parses
 * through the Zod Wall; every owner filter goes through ownerScope() (FOLD-AUTH chokepoint). Persistence
 * runs through the PURE policy (chatCopilotPolicy): the store-by-reference projection + assertPersistableSafe
 * before any INSERT, and assertConversationContext on every conversation use (cross-matter/owner/document
 * isolation).
 *
 * TEST SEAM (repo convention — setChatGateReader / setCompositionReaders / setJobWriteFunctions): the
 * low-level persistence is a `ChatCopilotStore`; setChatCopilotStore(...) injects an in-memory store so the
 * lifecycle / isolation / store-by-reference / do-not-persist behavior is fully exercised WITHOUT a DB.
 * The default store is the real Drizzle-backed implementation.
 *
 * IMMUTABILITY: matterId / documentId / documentVersionId / capacitySnapshot have NO setter — the patch
 * type carries only mutable lifecycle fields, so a conversation's bindings can never be updated.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { ZodError } from 'zod';
import { TRPCError } from '@trpc/server';
import { db } from '../connection.js';
import {
  chatConversations,
  chatMessages,
  chatSummaries,
  type NewChatConversation,
  type NewChatMessage,
  type NewChatSummary,
} from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import {
  ChatConversationRowSchema,
  ChatMessageRowSchema,
  ChatSummaryRowSchema,
  type ChatConversationRow,
  type ChatMessageRow,
  type ChatSummaryRow,
  type CapacitySnapshot,
} from '../../../shared/schemas/chatCopilot.js';
import {
  assertConversationContext,
  assertPersistableSafe,
  buildCapacitySnapshot,
  buildMatterFileExport,
  canDeleteConversation,
  toPersistableMessage,
  type CapacityMatter,
  type ConversationContext,
  type MatterFileExport,
  type RichChatTurnInput,
} from '../../llm/chatCopilotPolicy.js';
import { resolveRetentionPolicy } from '../../llm/chatCopilotConfig.js';

// ── Zod-Wall parse helpers ──────────────────────────────────────────────────────────────────────────
function parse<T>(schema: { parse: (r: unknown) => T }, raw: unknown, table: string, userId: string): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: `${table}RowSchema`,
          tableName: table,
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

// ── Store seam ────────────────────────────────────────────────────────────────────────────────────────

/** Only-mutable lifecycle fields (NO matterId/documentId/capacitySnapshot — those are immutable bindings). */
export interface ConversationLifecyclePatch {
  title?: string | null;
  legalHold?: boolean;
  legalHoldReason?: string | null;
  doNotPersist?: boolean;
  excludeFromGrounding?: boolean;
  frozenAt?: Date | null;
  freezeReason?: string | null;
  closedAt?: Date | null;
  exportedAt?: Date | null;
  exportRef?: string | null;
  deletedAt?: Date | null;
}

export interface MessagePatch {
  content?: string | null;
  contentHash?: string | null;
  citations?: unknown;
  doNotPersist?: boolean;
  excludeFromGrounding?: boolean;
}

export interface ChatCopilotStore {
  insertConversation(row: NewChatConversation): Promise<ChatConversationRow>;
  getConversation(id: string, userId: string): Promise<ChatConversationRow | null>;
  listConversationsForMatter(matterId: string, userId: string, includeDeleted: boolean): Promise<ChatConversationRow[]>;
  patchConversation(id: string, userId: string, patch: ConversationLifecyclePatch): Promise<ChatConversationRow | null>;
  insertMessage(row: NewChatMessage): Promise<ChatMessageRow>;
  getMessage(id: string, userId: string): Promise<ChatMessageRow | null>;
  listMessages(conversationId: string, userId: string): Promise<ChatMessageRow[]>;
  patchMessage(id: string, userId: string, patch: MessagePatch): Promise<ChatMessageRow | null>;
  maxSeq(conversationId: string, userId: string): Promise<number | null>;
  insertSummary(row: NewChatSummary): Promise<ChatSummaryRow>;
  listSummaries(conversationId: string, userId: string): Promise<ChatSummaryRow[]>;
}

// ── Real Drizzle-backed store ───────────────────────────────────────────────────────────────────────
const drizzleStore: ChatCopilotStore = {
  async insertConversation(row) {
    await db.insert(chatConversations).values(row);
    const got = await this.getConversation(row.id!, row.userId!);
    if (!got) throw new Error(`insertConversation: row not found after insert (id=${row.id})`);
    return got;
  },
  async getConversation(id, userId) {
    const rows = await db
      .select()
      .from(chatConversations)
      .where(and(eq(chatConversations.id, id), ownerScope(chatConversations.userId, userId)))
      .limit(1);
    if (rows.length === 0) return null;
    return parse(ChatConversationRowSchema, rows[0]!, 'chat_conversations', userId);
  },
  async listConversationsForMatter(matterId, userId, includeDeleted) {
    const conds = [ownerScope(chatConversations.userId, userId), eq(chatConversations.matterId, matterId)];
    if (!includeDeleted) conds.push(isNull(chatConversations.deletedAt));
    const rows = await db
      .select()
      .from(chatConversations)
      .where(and(...conds))
      .orderBy(desc(chatConversations.createdAt));
    return rows.map((r) => parse(ChatConversationRowSchema, r, 'chat_conversations', userId));
  },
  async patchConversation(id, userId, patch) {
    await db
      .update(chatConversations)
      .set(patch)
      .where(and(eq(chatConversations.id, id), ownerScope(chatConversations.userId, userId)));
    return this.getConversation(id, userId);
  },
  async insertMessage(row) {
    await db.insert(chatMessages).values(row);
    const got = await this.getMessage(row.id!, row.userId!);
    if (!got) throw new Error(`insertMessage: row not found after insert (id=${row.id})`);
    return got;
  },
  async getMessage(id, userId) {
    const rows = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.id, id), ownerScope(chatMessages.userId, userId)))
      .limit(1);
    if (rows.length === 0) return null;
    return parse(ChatMessageRowSchema, rows[0]!, 'chat_messages', userId);
  },
  async listMessages(conversationId, userId) {
    const rows = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.conversationId, conversationId), ownerScope(chatMessages.userId, userId)))
      .orderBy(asc(chatMessages.seq));
    return rows.map((r) => parse(ChatMessageRowSchema, r, 'chat_messages', userId));
  },
  async patchMessage(id, userId, patch) {
    await db
      .update(chatMessages)
      .set(patch as Record<string, unknown>)
      .where(and(eq(chatMessages.id, id), ownerScope(chatMessages.userId, userId)));
    return this.getMessage(id, userId);
  },
  async maxSeq(conversationId, userId) {
    const rows = await db
      .select({ seq: chatMessages.seq })
      .from(chatMessages)
      .where(and(eq(chatMessages.conversationId, conversationId), ownerScope(chatMessages.userId, userId)))
      .orderBy(desc(chatMessages.seq))
      .limit(1);
    return rows.length === 0 ? null : rows[0]!.seq;
  },
  async insertSummary(row) {
    await db.insert(chatSummaries).values(row);
    const got = (await this.listSummaries(row.conversationId!, row.userId!)).find((s) => s.id === row.id);
    if (!got) throw new Error(`insertSummary: row not found after insert (id=${row.id})`);
    return got;
  },
  async listSummaries(conversationId, userId) {
    const rows = await db
      .select()
      .from(chatSummaries)
      .where(and(eq(chatSummaries.conversationId, conversationId), ownerScope(chatSummaries.userId, userId)))
      .orderBy(asc(chatSummaries.coversFromSeq));
    return rows.map((r) => parse(ChatSummaryRowSchema, r, 'chat_summaries', userId));
  },
};

let _store: ChatCopilotStore | null = null;
/** Test seam: inject an in-memory store (pass null to restore the real Drizzle store). */
export function setChatCopilotStore(store: ChatCopilotStore | null): void {
  _store = store;
}
function store(): ChatCopilotStore {
  return _store ?? drizzleStore;
}

// ── Higher-level operations (store + pure policy) ─────────────────────────────────────────────────────

export interface CreateConversationArgs {
  userId: string;
  matterId: string;
  matter: CapacityMatter; // for the capacity snapshot binding
  documentId?: string | null;
  documentVersionId?: string | null;
  title?: string | null;
  matterType?: string | null; // for retention class resolution
}

/** Create a matter-bound conversation. Binds capacitySnapshot + retention class at start (immutable). */
export async function createConversation(args: CreateConversationArgs): Promise<ChatConversationRow> {
  const capacitySnapshot: CapacitySnapshot = buildCapacitySnapshot(args.matter);
  const retention = resolveRetentionPolicy(args.matterType);
  const row: NewChatConversation = {
    id: uuidv4(),
    userId: args.userId,
    matterId: args.matterId,
    documentId: args.documentId ?? null,
    documentVersionId: args.documentVersionId ?? null,
    title: args.title ?? null,
    capacitySnapshot,
    retentionClass: retention.class,
  };
  return store().insertConversation(row);
}

/** Read a conversation and ENFORCE its isolation binding (owner + matter + document). NOT_FOUND on mismatch. */
export async function getConversationInContext(
  conversationId: string,
  ctx: ConversationContext,
): Promise<ChatConversationRow> {
  const conv = await store().getConversation(conversationId, ctx.userId);
  if (!conv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
  assertConversationContext(conv, ctx);
  return conv;
}

export async function listConversations(matterId: string, userId: string): Promise<ChatConversationRow[]> {
  return store().listConversationsForMatter(matterId, userId, false);
}

/**
 * DELETEMATTER-ORPHAN-1: does the matter have ANY conversation under legal hold — INCLUDING soft-deleted
 * ones? `includeDeleted: true` is deliberate and load-bearing: a litigation hold is routinely placed on
 * already-"deleted" material (setLegalHold reads via getConversation, which has no deletedAt filter), and
 * the everyday matter.delete cascade removes chat rows regardless of deletedAt — so the delete's legal-hold
 * gate MUST see soft-deleted held conversations too (the normal listConversations excludes them, which
 * would let a held-but-soft-deleted conversation be destroyed). Owner-scoped via the store.
 */
export async function matterHasLegalHold(matterId: string, userId: string): Promise<boolean> {
  const all = await store().listConversationsForMatter(matterId, userId, true);
  return all.some((c) => c.legalHold);
}

/** Inc 2: posture-aware summaries for a conversation (isolation-guarded). */
export async function listConversationSummaries(
  conversationId: string,
  ctx: ConversationContext,
): Promise<ChatSummaryRow[]> {
  await getConversationInContext(conversationId, ctx);
  return store().listSummaries(conversationId, ctx.userId);
}

/**
 * Inc 2: FREEZE a conversation (freeze-on-capacity-divergence). After freezing, the thread refuses
 * further turns — the attorney must start a new conversation. Idempotent (stamps frozenAt + reason).
 */
export async function freezeConversation(
  conversationId: string,
  userId: string,
  reason: string,
): Promise<ChatConversationRow | null> {
  return store().patchConversation(conversationId, userId, { frozenAt: new Date(), freezeReason: reason });
}

export interface AppendMessageArgs {
  conversationId: string;
  ctx: ConversationContext;
  turn: RichChatTurnInput;
}

/**
 * Append a turn to a conversation. Enforces isolation (assertConversationContext), the store-by-reference
 * projection (toPersistableMessage) + assertPersistableSafe BEFORE insert, and per-conversation
 * doNotPersist (a do-not-persist conversation tombstones every turn). Returns the persisted row.
 */
export async function appendChatMessage(args: AppendMessageArgs): Promise<ChatMessageRow> {
  const conv = await getConversationInContext(args.conversationId, args.ctx);
  const turn: RichChatTurnInput = {
    ...args.turn,
    doNotPersist: args.turn.doNotPersist === true || conv.doNotPersist === true,
    excludeFromGrounding: args.turn.excludeFromGrounding === true || conv.excludeFromGrounding === true,
  };
  const persistable = toPersistableMessage(turn);
  assertPersistableSafe(persistable as unknown as Record<string, unknown>);
  const max = await store().maxSeq(args.conversationId, args.ctx.userId);
  const seq = (max ?? -1) + 1;
  const row: NewChatMessage = {
    id: uuidv4(),
    userId: args.ctx.userId,
    matterId: conv.matterId,
    conversationId: conv.id,
    seq,
    role: persistable.role,
    content: persistable.content,
    contentHash: persistable.contentHash,
    masterApplied: persistable.masterApplied,
    masterSource: persistable.masterSource,
    capacitySnapshot: persistable.capacitySnapshot,
    draftingGateDecisionId: persistable.draftingGateDecisionId,
    citations: persistable.citations,
    modelProvider: persistable.modelProvider,
    modelId: persistable.modelId,
    doNotPersist: persistable.doNotPersist,
    excludeFromGrounding: persistable.excludeFromGrounding,
  };
  return store().insertMessage(row);
}

export async function listMessages(conversationId: string, ctx: ConversationContext): Promise<ChatMessageRow[]> {
  await getConversationInContext(conversationId, ctx);
  return store().listMessages(conversationId, ctx.userId);
}

/** Soft-delete a conversation. A conversation under LEGAL HOLD cannot be deleted (PRECONDITION_FAILED). */
export async function softDeleteConversation(conversationId: string, userId: string): Promise<void> {
  const conv = await store().getConversation(conversationId, userId);
  if (!conv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
  const check = canDeleteConversation(conv);
  if (!check.ok) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: check.reason ?? 'CANNOT_DELETE' });
  await store().patchConversation(conversationId, userId, { deletedAt: new Date() });
}

export async function setLegalHold(
  conversationId: string,
  userId: string,
  on: boolean,
  reason?: string | null,
): Promise<ChatConversationRow | null> {
  const conv = await store().getConversation(conversationId, userId);
  if (!conv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
  return store().patchConversation(conversationId, userId, {
    legalHold: on,
    legalHoldReason: on ? (reason ?? null) : null,
  });
}

export async function setConversationMark(
  conversationId: string,
  userId: string,
  marks: { doNotPersist?: boolean; excludeFromGrounding?: boolean },
): Promise<ChatConversationRow | null> {
  const conv = await store().getConversation(conversationId, userId);
  if (!conv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
  // CHAT-COPILOT-1 (review hardening): legal hold PRESERVES the record. Flipping a held conversation to
  // doNotPersist (which tombstones every subsequent turn) would suppress the held record, so it is refused
  // under hold — mirroring the soft-delete hold gate. excludeFromGrounding is still allowed (it preserves
  // content, only withholding it from future grounding). Flagged for operator ratification.
  if (marks.doNotPersist === true && !canDeleteConversation(conv).ok) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'LEGAL_HOLD' });
  }
  const patch: ConversationLifecyclePatch = {};
  if (marks.doNotPersist !== undefined) patch.doNotPersist = marks.doNotPersist;
  if (marks.excludeFromGrounding !== undefined) patch.excludeFromGrounding = marks.excludeFromGrounding;
  return store().patchConversation(conversationId, userId, patch);
}

/** Per-turn exclude-from-grounding (the turn stays stored but is never fed to grounding — Inc 3). */
export async function setMessageExcludeFromGrounding(
  messageId: string,
  userId: string,
  matterId: string,
  on: boolean,
): Promise<ChatMessageRow | null> {
  const msg = await store().getMessage(messageId, userId);
  if (!msg) throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });
  // CHAT-COPILOT-1-GCFG isolation hardening: the message's conversation must match the caller's owner +
  // matter CONTEXT (not owner-scope alone) — a same-owner message from a DIFFERENT matter is rejected
  // (NOT_FOUND), mirroring assertConversationContext on every other conversation use.
  const conv = await store().getConversation(msg.conversationId, userId);
  if (!conv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
  assertConversationContext(conv, { userId, matterId });
  return store().patchMessage(messageId, userId, { excludeFromGrounding: on });
}

/** Per-turn do-not-persist applied POST-HOC: redact a stored turn's content (tombstone) on attorney request. */
export async function redactMessage(
  messageId: string,
  userId: string,
  matterId: string,
): Promise<ChatMessageRow | null> {
  const msg = await store().getMessage(messageId, userId);
  if (!msg) throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });
  const conv = await store().getConversation(msg.conversationId, userId);
  if (!conv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
  // CHAT-COPILOT-1-GCFG isolation hardening: owner + matter CONTEXT (not owner-scope alone) — a
  // same-owner message bound to a DIFFERENT matter is rejected (NOT_FOUND) before any redaction.
  assertConversationContext(conv, { userId, matterId });
  // CHAT-COPILOT-1 (review hardening): legal hold PRESERVES content — a held conversation's stored turns
  // cannot be destroyed by redaction (mirrors the soft-delete hold gate, so a hold cannot be defeated by
  // attorney redaction). Flagged for operator ratification.
  if (!canDeleteConversation(conv).ok) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'LEGAL_HOLD' });
  }
  return store().patchMessage(messageId, userId, {
    content: null,
    contentHash: null,
    citations: null,
    doNotPersist: true,
  });
}

/**
 * Export the full thread + citations to the matter file (the defensibility asset). Reference-only (no
 * chunk text was ever stored). Stamps exportedAt + an exportRef on the conversation. Returns the artifact.
 */
export async function exportConversationToMatterFile(
  conversationId: string,
  userId: string,
): Promise<MatterFileExport> {
  const conv = await store().getConversation(conversationId, userId);
  if (!conv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
  const messages = await store().listMessages(conversationId, userId);
  const summaries = await store().listSummaries(conversationId, userId);
  const artifact = buildMatterFileExport(conv, messages, summaries);
  const exportRef = `matterfile:${conv.matterId}:chat:${conv.id}`;
  await store().patchConversation(conversationId, userId, { exportedAt: new Date(), exportRef });
  return artifact;
}
