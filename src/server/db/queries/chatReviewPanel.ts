/**
 * chat_review_* query layer (Zod Wall + ownerScope) — CHAT-COPILOT-2 Increment B (multi-model panel).
 *
 * The SOLE read/write path for the three panel-review tables (chat_review_runs / chat_review_raw_outputs
 * / chat_review_items). Every read parses through the Zod Wall; every owner filter goes through
 * ownerScope(). Work-product (purges WITH the matter — see matterPurge.ts). Written/read ONLY when
 * CHAT_REVIEW_PANEL_ENABLED is ON (the procedure layer gates this).
 *
 * TEST SEAM (repo convention, mirroring chatEgress.ts): setChatReviewStore(...) injects an in-memory
 * store so the panel flow is fully exercised WITHOUT a DB. Default is the real Drizzle store.
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import {
  chatReviewRuns,
  chatReviewRawOutputs,
  chatReviewItems,
  type NewChatReviewRun,
  type NewChatReviewRawOutput,
  type NewChatReviewItem,
} from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import {
  ChatReviewRunRowSchema,
  ChatReviewRawOutputRowSchema,
  ChatReviewItemRowSchema,
  type ChatReviewRunRow,
  type ChatReviewRawOutputRow,
  type ChatReviewItemRow,
  type ChatReviewRunStatus,
  type ChatReviewDispositionerStatus,
  type ChatReviewDisposition,
  type ChatReviewAttorneyDecision,
} from '../../../shared/schemas/chatCopilot.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseRow<T>(schema: { parse: (raw: unknown) => T }, raw: unknown, table: string, userId: string): T {
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

// ── Patch shapes ──────────────────────────────────────────────────────────────────────────────────────

export interface ReviewRunPatch {
  status?: ChatReviewRunStatus;
  dispositionerStatus?: ChatReviewDispositionerStatus;
}

export interface ReviewItemDispositionPatch {
  primaryDisposition: ChatReviewDisposition;
  primaryReasoning: string;
}

// ── Store seam (in-memory injectable for DB-free tests) ─────────────────────────────────────────────────

export interface ChatReviewStore {
  insertRun(row: NewChatReviewRun): Promise<ChatReviewRunRow>;
  getRun(id: string, userId: string): Promise<ChatReviewRunRow | null>;
  updateRun(id: string, userId: string, patch: ReviewRunPatch): Promise<ChatReviewRunRow | null>;
  listRunsForConversation(conversationId: string, userId: string): Promise<ChatReviewRunRow[]>;
  insertRawOutput(row: NewChatReviewRawOutput): Promise<ChatReviewRawOutputRow>;
  listRawOutputsForRun(runId: string, userId: string): Promise<ChatReviewRawOutputRow[]>;
  insertItems(rows: NewChatReviewItem[]): Promise<void>;
  updateItemDisposition(id: string, userId: string, patch: ReviewItemDispositionPatch): Promise<void>;
  setItemAttorneyDecision(
    id: string,
    userId: string,
    decision: ChatReviewAttorneyDecision,
    overrideReason: string | null,
  ): Promise<ChatReviewItemRow | null>;
  listItemsForRun(runId: string, userId: string): Promise<ChatReviewItemRow[]>;
}

const drizzleStore: ChatReviewStore = {
  async insertRun(row) {
    await db.insert(chatReviewRuns).values(row);
    const got = await this.getRun(row.id!, row.userId!);
    if (!got) throw new Error(`insertReviewRun: row not found after insert (id=${row.id})`);
    return got;
  },
  async getRun(id, userId) {
    const rows = await db
      .select()
      .from(chatReviewRuns)
      .where(and(eq(chatReviewRuns.id, id), ownerScope(chatReviewRuns.userId, userId)))
      .limit(1);
    if (rows.length === 0) return null;
    return parseRow(ChatReviewRunRowSchema, rows[0]!, 'chat_review_runs', userId);
  },
  async updateRun(id, userId, patch) {
    const set: Partial<NewChatReviewRun> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.dispositionerStatus !== undefined) set.dispositionerStatus = patch.dispositionerStatus;
    await db
      .update(chatReviewRuns)
      .set(set)
      .where(and(eq(chatReviewRuns.id, id), ownerScope(chatReviewRuns.userId, userId)));
    return this.getRun(id, userId);
  },
  async listRunsForConversation(conversationId, userId) {
    const rows = await db
      .select()
      .from(chatReviewRuns)
      .where(and(eq(chatReviewRuns.conversationId, conversationId), ownerScope(chatReviewRuns.userId, userId)))
      .orderBy(desc(chatReviewRuns.createdAt));
    return rows.map((r) => parseRow(ChatReviewRunRowSchema, r, 'chat_review_runs', userId));
  },
  async insertRawOutput(row) {
    await db.insert(chatReviewRawOutputs).values(row);
    const rows = await db
      .select()
      .from(chatReviewRawOutputs)
      .where(and(eq(chatReviewRawOutputs.id, row.id!), ownerScope(chatReviewRawOutputs.userId, row.userId!)))
      .limit(1);
    if (rows.length === 0) throw new Error(`insertReviewRawOutput: row not found after insert (id=${row.id})`);
    return parseRow(ChatReviewRawOutputRowSchema, rows[0]!, 'chat_review_raw_outputs', row.userId!);
  },
  async listRawOutputsForRun(runId, userId) {
    const rows = await db
      .select()
      .from(chatReviewRawOutputs)
      .where(and(eq(chatReviewRawOutputs.runId, runId), ownerScope(chatReviewRawOutputs.userId, userId)))
      .orderBy(asc(chatReviewRawOutputs.createdAt));
    return rows.map((r) => parseRow(ChatReviewRawOutputRowSchema, r, 'chat_review_raw_outputs', userId));
  },
  async insertItems(rows) {
    if (rows.length === 0) return;
    await db.insert(chatReviewItems).values(rows);
  },
  async updateItemDisposition(id, userId, patch) {
    await db
      .update(chatReviewItems)
      .set({ primaryDisposition: patch.primaryDisposition, primaryReasoning: patch.primaryReasoning })
      .where(and(eq(chatReviewItems.id, id), ownerScope(chatReviewItems.userId, userId)));
  },
  async setItemAttorneyDecision(id, userId, decision, overrideReason) {
    await db
      .update(chatReviewItems)
      .set({ attorneyDecision: decision, attorneyOverrideReason: overrideReason })
      .where(and(eq(chatReviewItems.id, id), ownerScope(chatReviewItems.userId, userId)));
    const rows = await db
      .select()
      .from(chatReviewItems)
      .where(and(eq(chatReviewItems.id, id), ownerScope(chatReviewItems.userId, userId)))
      .limit(1);
    if (rows.length === 0) return null;
    return parseRow(ChatReviewItemRowSchema, rows[0]!, 'chat_review_items', userId);
  },
  async listItemsForRun(runId, userId) {
    const rows = await db
      .select()
      .from(chatReviewItems)
      .where(and(eq(chatReviewItems.runId, runId), ownerScope(chatReviewItems.userId, userId)))
      .orderBy(asc(chatReviewItems.createdAt));
    return rows.map((r) => parseRow(ChatReviewItemRowSchema, r, 'chat_review_items', userId));
  },
};

let _store: ChatReviewStore | null = null;
/** Test seam: inject an in-memory store (pass null to restore the real Drizzle store). */
export function setChatReviewStore(store: ChatReviewStore | null): void {
  _store = store;
}
function store(): ChatReviewStore {
  return _store ?? drizzleStore;
}

// ── Higher-level operations (owner-scoped throughout) ───────────────────────────────────────────────────

export const insertReviewRun = (row: NewChatReviewRun): Promise<ChatReviewRunRow> => store().insertRun(row);
export const getReviewRun = (id: string, userId: string): Promise<ChatReviewRunRow | null> =>
  store().getRun(id, userId);
export const updateReviewRun = (id: string, userId: string, patch: ReviewRunPatch): Promise<ChatReviewRunRow | null> =>
  store().updateRun(id, userId, patch);
export const listReviewRunsForConversation = (
  conversationId: string,
  userId: string,
): Promise<ChatReviewRunRow[]> => store().listRunsForConversation(conversationId, userId);
export const insertReviewRawOutput = (row: NewChatReviewRawOutput): Promise<ChatReviewRawOutputRow> =>
  store().insertRawOutput(row);
export const listReviewRawOutputsForRun = (runId: string, userId: string): Promise<ChatReviewRawOutputRow[]> =>
  store().listRawOutputsForRun(runId, userId);
export const insertReviewItems = (rows: NewChatReviewItem[]): Promise<void> => store().insertItems(rows);
export const updateReviewItemDisposition = (
  id: string,
  userId: string,
  patch: ReviewItemDispositionPatch,
): Promise<void> => store().updateItemDisposition(id, userId, patch);
export const setReviewItemAttorneyDecision = (
  id: string,
  userId: string,
  decision: ChatReviewAttorneyDecision,
  overrideReason: string | null,
): Promise<ChatReviewItemRow | null> => store().setItemAttorneyDecision(id, userId, decision, overrideReason);
export const listReviewItemsForRun = (runId: string, userId: string): Promise<ChatReviewItemRow[]> =>
  store().listItemsForRun(runId, userId);
