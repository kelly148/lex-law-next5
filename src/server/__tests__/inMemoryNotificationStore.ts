/**
 * In-memory NotificationStore for FOLD-NOTIFY-1 tests (NO .test suffix — vitest does not
 * collect this file). Backed by a plain array; EVERY read filters by userId, exactly
 * mirroring ownerScope(), so cross-owner reads naturally return empty/zero and the
 * isolation tests pass without a database. readAt is the per-user "seen" marker
 * (null = unread); markAllSeen / markSeen set it.
 */

import type { NotificationStore } from '../db/queries/notifications.js';
import type { NewNotification } from '../db/schema.js';
import type { NotificationRow } from '../../shared/schemas/notifications.js';

export function createInMemoryNotificationStore(
  now: () => Date = () => new Date('2026-06-17T12:00:00.000Z'),
): NotificationStore {
  const rows: NotificationRow[] = [];

  return {
    insert(row: NewNotification): Promise<NotificationRow> {
      const r: NotificationRow = {
        id: row.id!,
        userId: row.userId!,
        matterId: row.matterId ?? null,
        type: row.type ?? 'generic',
        title: row.title!,
        body: row.body ?? null,
        readAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      rows.push(r);
      return Promise.resolve({ ...r });
    },

    listForOwner(userId: string, limit: number): Promise<NotificationRow[]> {
      return Promise.resolve(
        rows
          .filter((x) => x.userId === userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit)
          .map((x) => ({ ...x })),
      );
    },

    unreadCount(userId: string): Promise<number> {
      return Promise.resolve(rows.filter((x) => x.userId === userId && x.readAt == null).length);
    },

    unreadMatterIds(userId: string): Promise<string[]> {
      const ids = new Set<string>();
      for (const x of rows) {
        if (x.userId === userId && x.readAt == null && x.matterId != null) ids.add(x.matterId);
      }
      return Promise.resolve([...ids]);
    },

    markAllSeen(userId: string, at: Date): Promise<number> {
      let n = 0;
      for (const x of rows) {
        if (x.userId === userId && x.readAt == null) {
          x.readAt = at;
          n += 1;
        }
      }
      return Promise.resolve(n);
    },

    markSeen(id: string, userId: string, at: Date): Promise<void> {
      const r = rows.find((x) => x.id === id && x.userId === userId);
      if (r) r.readAt = at;
      return Promise.resolve();
    },
  };
}
</content>
