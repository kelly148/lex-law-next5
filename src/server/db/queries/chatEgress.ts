/**
 * chat_egress_events query layer (Zod Wall + ownerScope) — CHAT-COPILOT-2 Increment A (G3 / Q7).
 *
 * The SOLE read/write path for the append-only egress audit log. Every read parses through the Zod Wall;
 * every owner filter goes through ownerScope(). The broker (src/server/llm/egressClient.ts) writes a row
 * via recordEgressDecision() BEFORE dispatch (the gate decision is logged atomically — blocked sends too)
 * and fills in the dispatch outcome via completeEgressEvent() once. Supervision (Q7) reads via
 * listEgressEvents() (by matter / provider / recency).
 *
 * TEST SEAM (repo convention): setEgressEventStore(...) injects an in-memory store so the broker's
 * gate/log/dispatch behavior is fully exercised WITHOUT a DB. Default is the real Drizzle store.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import { chatEgressEvents, type NewChatEgressEvent } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import {
  ChatEgressEventRowSchema,
  type ChatEgressEventRow,
  type ChatEgressStatus,
} from '../../../shared/schemas/chatCopilot.js';

function parse(raw: unknown, userId: string): ChatEgressEventRow {
  try {
    return ChatEgressEventRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'chat_egress_eventsRowSchema',
          tableName: 'chat_egress_events',
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

/** Only the dispatch-outcome fields are mutable (one completion update); the decision + hash are immutable. */
export interface EgressCompletionPatch {
  status: ChatEgressStatus;
  failureReason?: string | null;
  completedAt: Date;
}

/** Supervision filter (Q7): queryable by matter / provider / recency. userId is always applied separately. */
export interface EgressEventFilter {
  matterId?: string;
  conversationId?: string;
  provider?: string;
  sinceCreatedAt?: Date;
}

export interface EgressEventStore {
  insert(row: NewChatEgressEvent): Promise<ChatEgressEventRow>;
  complete(id: string, userId: string, patch: EgressCompletionPatch): Promise<ChatEgressEventRow | null>;
  get(id: string, userId: string): Promise<ChatEgressEventRow | null>;
  list(userId: string, filter: EgressEventFilter): Promise<ChatEgressEventRow[]>;
}

const drizzleStore: EgressEventStore = {
  async insert(row) {
    await db.insert(chatEgressEvents).values(row);
    const got = await this.get(row.id!, row.userId!);
    if (!got) throw new Error(`insertEgressEvent: row not found after insert (id=${row.id})`);
    return got;
  },
  async complete(id, userId, patch) {
    await db
      .update(chatEgressEvents)
      .set({ status: patch.status, failureReason: patch.failureReason ?? null, completedAt: patch.completedAt })
      .where(and(eq(chatEgressEvents.id, id), ownerScope(chatEgressEvents.userId, userId)));
    return this.get(id, userId);
  },
  async get(id, userId) {
    const rows = await db
      .select()
      .from(chatEgressEvents)
      .where(and(eq(chatEgressEvents.id, id), ownerScope(chatEgressEvents.userId, userId)))
      .limit(1);
    if (rows.length === 0) return null;
    return parse(rows[0]!, userId);
  },
  async list(userId, filter) {
    const conds = [ownerScope(chatEgressEvents.userId, userId)];
    if (filter.matterId) conds.push(eq(chatEgressEvents.matterId, filter.matterId));
    if (filter.conversationId) conds.push(eq(chatEgressEvents.conversationId, filter.conversationId));
    if (filter.provider) conds.push(eq(chatEgressEvents.provider, filter.provider));
    if (filter.sinceCreatedAt) conds.push(gte(chatEgressEvents.createdAt, filter.sinceCreatedAt));
    const rows = await db
      .select()
      .from(chatEgressEvents)
      .where(and(...conds))
      .orderBy(desc(chatEgressEvents.createdAt));
    return rows.map((r) => parse(r, userId));
  },
};

let _store: EgressEventStore | null = null;
/** Test seam: inject an in-memory store (pass null to restore the real Drizzle store). */
export function setEgressEventStore(store: EgressEventStore | null): void {
  _store = store;
}
function store(): EgressEventStore {
  return _store ?? drizzleStore;
}

// ── Higher-level operations ───────────────────────────────────────────────────────────────────────────

/** Write the egress decision row (allowed OR blocked) — called by the broker BEFORE any dispatch. */
export function recordEgressDecision(row: NewChatEgressEvent): Promise<ChatEgressEventRow> {
  return store().insert(row);
}

/** Fill in the dispatch outcome (one completion update). */
export function completeEgressEvent(
  id: string,
  userId: string,
  patch: EgressCompletionPatch,
): Promise<ChatEgressEventRow | null> {
  return store().complete(id, userId, patch);
}

/** Supervision query (Q7): egress events by matter / provider / recency, owner-scoped. */
export function listEgressEvents(userId: string, filter: EgressEventFilter): Promise<ChatEgressEventRow[]> {
  return store().list(userId, filter);
}
