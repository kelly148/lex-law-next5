/**
 * matter_deliverable query layer (Zod Wall + ownerScope) — FOLD-PM-4.
 *
 * The SOLE read/write path for matter_deliverable. Every read parses through the Zod
 * Wall (MatterDeliverableRowSchema); every owner filter goes through ownerScope()
 * (the FOLD-AUTH chokepoint — never an inline owner-column equality, which the CI
 * ratchet bans for new files). userId/matterId are immutable bindings (no setter).
 *
 * TEST SEAM (repo convention — see chatCopilot.ts setChatCopilotStore): the low-level
 * persistence is a `MatterDeliverableStore`; setMatterDeliverableStore(...) injects an
 * in-memory store so CRUD + owner-isolation behavior is fully exercised WITHOUT a DB.
 * The default store is the real Drizzle-backed implementation.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../connection.js';
import { matterDeliverable, type NewMatterDeliverable } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  MatterDeliverableRowSchema,
  type MatterDeliverableRow,
  type MatterDeliverableStatus,
} from '../../../shared/schemas/matterDeliverables.js';

// ── parse-on-read (Zod Wall) ──────────────────────────────────────────────
const parseDeliverable = (r: unknown): MatterDeliverableRow => MatterDeliverableRowSchema.parse(r);

// ── inputs ────────────────────────────────────────────────────────────────
export interface CreateDeliverableArgs {
  userId: string;
  matterId: string;
  title: string;
  dueDate?: string | null;
  notes?: string | null;
}

/** Mutable fields only — userId / matterId / id / createdAt are never patchable. */
export interface DeliverablePatch {
  title?: string;
  status?: MatterDeliverableStatus;
  dueDate?: string | null;
  notes?: string | null;
}

// ── store seam ─────────────────────────────────────────────────────────────
export interface MatterDeliverableStore {
  insert(row: NewMatterDeliverable): Promise<MatterDeliverableRow>;
  getById(id: string, userId: string): Promise<MatterDeliverableRow | null>;
  listForMatter(matterId: string, userId: string): Promise<MatterDeliverableRow[]>;
  listForOwner(userId: string): Promise<MatterDeliverableRow[]>;
  patch(id: string, userId: string, patch: DeliverablePatch): Promise<MatterDeliverableRow | null>;
}

const drizzleStore: MatterDeliverableStore = {
  async insert(row: NewMatterDeliverable): Promise<MatterDeliverableRow> {
    await db.insert(matterDeliverable).values(row);
    // Re-fetch through the owner-scoped getter so the returned row carries the
    // DB-populated createdAt/updatedAt and passes the Zod Wall.
    const created = await this.getById(row.id!, row.userId!);
    if (!created) {
      throw new Error('matter_deliverable insert did not materialize');
    }
    return created;
  },

  async getById(id: string, userId: string): Promise<MatterDeliverableRow | null> {
    const rows = await db
      .select()
      .from(matterDeliverable)
      .where(and(eq(matterDeliverable.id, id), ownerScope(matterDeliverable.userId, userId)))
      .limit(1);
    return rows[0] ? parseDeliverable(rows[0]) : null;
  },

  async listForMatter(matterId: string, userId: string): Promise<MatterDeliverableRow[]> {
    const rows = await db
      .select()
      .from(matterDeliverable)
      .where(and(eq(matterDeliverable.matterId, matterId), ownerScope(matterDeliverable.userId, userId)))
      .orderBy(desc(matterDeliverable.createdAt));
    return rows.map(parseDeliverable);
  },

  async listForOwner(userId: string): Promise<MatterDeliverableRow[]> {
    const rows = await db
      .select()
      .from(matterDeliverable)
      .where(ownerScope(matterDeliverable.userId, userId))
      .orderBy(desc(matterDeliverable.createdAt));
    return rows.map(parseDeliverable);
  },

  async patch(id: string, userId: string, patch: DeliverablePatch): Promise<MatterDeliverableRow | null> {
    const set: Partial<NewMatterDeliverable> = {};
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (Object.keys(set).length > 0) {
      await db
        .update(matterDeliverable)
        .set(set)
        .where(and(eq(matterDeliverable.id, id), ownerScope(matterDeliverable.userId, userId)));
    }
    // Owner-scoped re-fetch: returns null if the row does not exist OR is not owned.
    return this.getById(id, userId);
  },
};

let _store: MatterDeliverableStore | null = null;
/** Test seam: inject an in-memory store (pass null to restore the real Drizzle store). */
export function setMatterDeliverableStore(store: MatterDeliverableStore | null): void {
  _store = store;
}
function store(): MatterDeliverableStore {
  return _store ?? drizzleStore;
}

// ── public query API (owner-scoped; userId always from ctx, never input) ────
export async function createDeliverable(args: CreateDeliverableArgs): Promise<MatterDeliverableRow> {
  const row: NewMatterDeliverable = {
    id: uuidv4(),
    userId: args.userId,
    matterId: args.matterId,
    title: args.title,
    status: 'open',
    dueDate: args.dueDate ?? null,
    notes: args.notes ?? null,
  };
  return store().insert(row);
}

export async function getDeliverableById(
  id: string,
  userId: string,
): Promise<MatterDeliverableRow | null> {
  return store().getById(id, userId);
}

export async function listDeliverablesForMatter(
  matterId: string,
  userId: string,
): Promise<MatterDeliverableRow[]> {
  return store().listForMatter(matterId, userId);
}

export async function listDeliverablesForOwner(userId: string): Promise<MatterDeliverableRow[]> {
  return store().listForOwner(userId);
}

export async function updateDeliverable(
  id: string,
  userId: string,
  patch: DeliverablePatch,
): Promise<MatterDeliverableRow | null> {
  return store().patch(id, userId, patch);
}

export async function completeDeliverable(
  id: string,
  userId: string,
): Promise<MatterDeliverableRow | null> {
  return store().patch(id, userId, { status: 'done' });
}
