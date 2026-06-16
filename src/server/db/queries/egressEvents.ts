/**
 * egress_events query layer (Zod Wall + ownerScope) — EGRESS-CONTROL-PLANE-1.
 *
 * The SOLE read/write path for the surface-agnostic egress audit ledger. The shared egress PRIMITIVE
 * (src/server/egress/auditedEgress.ts) writes a row via recordEgressEvent() BEFORE dispatch (the gate
 * decision is logged synchronously — blocked sends too) and fills in the dispatch outcome via
 * completeEgressEvent() once. Compliance reads via listEgressEvents() (by matter / surface / document /
 * decision / recency).
 *
 * STORE-BY-REFERENCE: a row carries inputBundleHash (a hash) + metadata — NEVER the draft text.
 *
 * TEST SEAM (repo convention, mirrors chatEgress.ts): setEgressEventStore(...) injects an in-memory store
 * so the primitive's gate/log/dispatch behavior is fully exercised WITHOUT a DB. Default = the real
 * Drizzle store. This is a DISTINCT module/table from chat_egress_events (which is untouched).
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import { egressEvents, type NewEgressEvent } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import {
  EgressEventRowSchema,
  type EgressEventRow,
  type EgressStatus,
  type EgressSurface,
  type EgressDecision,
} from '../../../shared/schemas/egress.js';

function parse(raw: unknown, userId: string): EgressEventRow {
  try {
    return EgressEventRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'EgressEventRowSchema',
          tableName: 'egress_events',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

/** Only the dispatch-outcome fields are mutable (one completion update); the decision + hash are immutable. */
export interface EgressEventCompletionPatch {
  status: EgressStatus;
  failureReason?: string | null;
  completedAt: Date;
}

/** Compliance/supervision filter: blocked-egresses-by-matter / surface / document / decision / recency. */
export interface EgressEventFilter {
  matterId?: string;
  surface?: EgressSurface;
  documentId?: string;
  decision?: EgressDecision;
  sinceCreatedAt?: Date;
}

export interface EgressEventStore {
  insert(row: NewEgressEvent): Promise<EgressEventRow>;
  complete(id: string, userId: string, patch: EgressEventCompletionPatch): Promise<EgressEventRow | null>;
  get(id: string, userId: string): Promise<EgressEventRow | null>;
  list(userId: string, filter: EgressEventFilter): Promise<EgressEventRow[]>;
}

const drizzleStore: EgressEventStore = {
  async insert(row) {
    await db.insert(egressEvents).values(row);
    const got = await this.get(row.id!, row.userId!);
    if (!got) throw new Error(`recordEgressEvent: row not found after insert (id=${row.id})`);
    return got;
  },
  async complete(id, userId, patch) {
    await db
      .update(egressEvents)
      .set({ status: patch.status, failureReason: patch.failureReason ?? null, completedAt: patch.completedAt })
      .where(and(eq(egressEvents.id, id), ownerScope(egressEvents.userId, userId)));
    return this.get(id, userId);
  },
  async get(id, userId) {
    const rows = await db
      .select()
      .from(egressEvents)
      .where(and(eq(egressEvents.id, id), ownerScope(egressEvents.userId, userId)))
      .limit(1);
    if (rows.length === 0) return null;
    return parse(rows[0]!, userId);
  },
  async list(userId, filter) {
    const conds = [ownerScope(egressEvents.userId, userId)];
    if (filter.matterId) conds.push(eq(egressEvents.matterId, filter.matterId));
    if (filter.surface) conds.push(eq(egressEvents.surface, filter.surface));
    if (filter.documentId) conds.push(eq(egressEvents.documentId, filter.documentId));
    if (filter.decision) conds.push(eq(egressEvents.decision, filter.decision));
    if (filter.sinceCreatedAt) conds.push(gte(egressEvents.createdAt, filter.sinceCreatedAt));
    const rows = await db
      .select()
      .from(egressEvents)
      .where(and(...conds))
      .orderBy(desc(egressEvents.createdAt));
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

/** Write the egress decision row (allowed OR blocked) — called by the primitive BEFORE any dispatch. */
export function recordEgressEvent(row: NewEgressEvent): Promise<EgressEventRow> {
  return store().insert(row);
}

/** Fill in the dispatch outcome (one completion update). */
export function completeEgressEvent(
  id: string,
  userId: string,
  patch: EgressEventCompletionPatch,
): Promise<EgressEventRow | null> {
  return store().complete(id, userId, patch);
}

/** Compliance query: egress events by matter / surface / document / decision / recency, owner-scoped. */
export function listEgressEvents(userId: string, filter: EgressEventFilter): Promise<EgressEventRow[]> {
  return store().list(userId, filter);
}
