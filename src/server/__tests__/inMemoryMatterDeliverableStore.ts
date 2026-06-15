/**
 * In-memory MatterDeliverableStore for FOLD-PM-4 tests (NO .test suffix — vitest
 * does not collect this file). Backed by a plain array; EVERY read filters by
 * userId, exactly mirroring ownerScope(), so cross-owner reads naturally return
 * null/empty and the isolation tests pass without a database.
 */

import type {
  MatterDeliverableStore,
  DeliverablePatch,
} from '../db/queries/matterDeliverables.js';
import type { NewMatterDeliverable } from '../db/schema.js';
import type { MatterDeliverableRow } from '../../shared/schemas/matterDeliverables.js';

export function createInMemoryMatterDeliverableStore(
  now: () => Date = () => new Date('2026-06-14T12:00:00.000Z'),
): MatterDeliverableStore {
  const rows: MatterDeliverableRow[] = [];

  return {
    insert(row: NewMatterDeliverable): Promise<MatterDeliverableRow> {
      const r: MatterDeliverableRow = {
        id: row.id!,
        userId: row.userId!,
        matterId: row.matterId!,
        title: row.title!,
        status: row.status ?? 'open',
        dueDate: row.dueDate ?? null,
        notes: row.notes ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      rows.push(r);
      return Promise.resolve({ ...r });
    },

    getById(id: string, userId: string): Promise<MatterDeliverableRow | null> {
      const r = rows.find((x) => x.id === id && x.userId === userId);
      return Promise.resolve(r ? { ...r } : null);
    },

    listForMatter(matterId: string, userId: string): Promise<MatterDeliverableRow[]> {
      return Promise.resolve(
        rows
          .filter((x) => x.userId === userId && x.matterId === matterId)
          .map((x) => ({ ...x })),
      );
    },

    listForOwner(userId: string): Promise<MatterDeliverableRow[]> {
      return Promise.resolve(rows.filter((x) => x.userId === userId).map((x) => ({ ...x })));
    },

    patch(id: string, userId: string, patch: DeliverablePatch): Promise<MatterDeliverableRow | null> {
      const r = rows.find((x) => x.id === id && x.userId === userId);
      if (!r) return Promise.resolve(null);
      if (patch.title !== undefined) r.title = patch.title;
      if (patch.status !== undefined) r.status = patch.status;
      if (patch.dueDate !== undefined) r.dueDate = patch.dueDate;
      if (patch.notes !== undefined) r.notes = patch.notes;
      r.updatedAt = now();
      return Promise.resolve({ ...r });
    },
  };
}
