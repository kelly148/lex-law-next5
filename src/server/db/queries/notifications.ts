/**
 * notifications query layer (Zod Wall + ownerScope) — FOLD-NOTIFY-1.
 *
 * The SOLE read/write path for the in-app `notifications` table. Every read parses
 * through the Zod Wall (NotificationRowSchema); every owner filter goes through
 * ownerScope() (the FOLD-AUTH chokepoint — never an inline owner-column equality, which
 * the CI ratchet bans for new files). userId is an immutable binding (always ctx.userId,
 * NEVER an input).
 *
 * SCOPE FENCE (FOLD-NOTIFY-1): this is the STORE + READ + DISPLAY tier. The READ surface
 * (list + unread count + per-matter ready-badge probe) and a "mark seen" cursor mutation
 * (markAllSeen / markSeen) are here. There is NO producer (outbox-emit wiring) in this
 * file — that is DEFERRED to after EGRESS Inc 3b. `insertNotification` exists ONLY so
 * tests can insert synthetic rows directly; no application path calls it yet.
 *
 * INFORMATIONAL ONLY: nothing here auto-adopts, auto-sends, or makes any decision.
 *
 * TEST SEAM (repo convention — see matterEntities.ts setMatterEntityStore): the low-level
 * persistence is a `NotificationStore`; setNotificationStore(...) injects an in-memory
 * store so read + owner-isolation behavior is fully exercised WITHOUT a DB. The default
 * store is the real Drizzle-backed implementation.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../connection.js';
import { notifications, type NewNotification } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  NotificationRowSchema,
  type NotificationRow,
  type NotificationType,
} from '../../../shared/schemas/notifications.js';

// ── parse-on-read (Zod Wall) ──────────────────────────────────────────────
const parse = (r: unknown): NotificationRow => NotificationRowSchema.parse(r);

// ── inputs ────────────────────────────────────────────────────────────────
/**
 * Synthetic-insert args. NOTE: no application path calls this in FOLD-NOTIFY-1 — the
 * outbox-emit producers are DEFERRED. It exists for tests to seed synthetic rows and for
 * the future producer tier to build on.
 */
export interface CreateNotificationArgs {
  userId: string;
  matterId?: string | null;
  type?: NotificationType;
  title: string;
  body?: string | null;
}

// ── store seam ─────────────────────────────────────────────────────────────
export interface NotificationStore {
  insert(row: NewNotification): Promise<NotificationRow>;
  listForOwner(userId: string, limit: number): Promise<NotificationRow[]>;
  /** owner-scoped UNREAD notices only (readAt IS NULL), newest first, capped. Powers the N1 digest. */
  listUnread(userId: string, limit: number): Promise<NotificationRow[]>;
  unreadCount(userId: string): Promise<number>;
  /** owner-scoped distinct matterIds that have at least one UNREAD matter-scoped notice. */
  unreadMatterIds(userId: string): Promise<string[]>;
  /** Mark ALL of the owner's unread notices seen; returns the count marked. */
  markAllSeen(userId: string, at: Date): Promise<number>;
  /** Mark ONE owner-scoped notice seen (no-op if missing/not owned). */
  markSeen(id: string, userId: string, at: Date): Promise<void>;
}

const drizzleStore: NotificationStore = {
  async insert(row: NewNotification): Promise<NotificationRow> {
    await db.insert(notifications).values(row);
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, row.id!), ownerScope(notifications.userId, row.userId!)))
      .limit(1);
    if (!rows[0]) throw new Error('notification insert did not materialize');
    return parse(rows[0]);
  },

  async listForOwner(userId: string, limit: number): Promise<NotificationRow[]> {
    const rows = await db
      .select()
      .from(notifications)
      .where(ownerScope(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    return rows.map(parse);
  },

  async listUnread(userId: string, limit: number): Promise<NotificationRow[]> {
    const rows = await db
      .select()
      .from(notifications)
      .where(and(ownerScope(notifications.userId, userId), isNull(notifications.readAt)))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    return rows.map(parse);
  },

  async unreadCount(userId: string): Promise<number> {
    const rows = await db
      .select()
      .from(notifications)
      .where(and(ownerScope(notifications.userId, userId), isNull(notifications.readAt)));
    return rows.length;
  },

  async unreadMatterIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ matterId: notifications.matterId })
      .from(notifications)
      .where(and(ownerScope(notifications.userId, userId), isNull(notifications.readAt)));
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.matterId != null) ids.add(r.matterId);
    }
    return [...ids];
  },

  async markAllSeen(userId: string, at: Date): Promise<number> {
    const unread = await this.unreadCount(userId);
    if (unread > 0) {
      await db
        .update(notifications)
        .set({ readAt: at })
        .where(and(ownerScope(notifications.userId, userId), isNull(notifications.readAt)));
    }
    return unread;
  },

  async markSeen(id: string, userId: string, at: Date): Promise<void> {
    await db
      .update(notifications)
      .set({ readAt: at })
      .where(and(eq(notifications.id, id), ownerScope(notifications.userId, userId)));
  },
};

let _store: NotificationStore | null = null;
/** Test seam: inject an in-memory store (pass null to restore the real Drizzle store). */
export function setNotificationStore(store: NotificationStore | null): void {
  _store = store;
}
function store(): NotificationStore {
  return _store ?? drizzleStore;
}

// ── public query API (owner-scoped; userId always from ctx, never input) ────

/**
 * Insert a synthetic notification. DEFERRED-PRODUCER NOTE: no application path calls this
 * in FOLD-NOTIFY-1 (the outbox-emit producers land after EGRESS Inc 3b). Tests use it to
 * seed synthetic rows; the future producer tier builds on it.
 */
export async function createNotification(args: CreateNotificationArgs): Promise<NotificationRow> {
  const row: NewNotification = {
    id: uuidv4(),
    userId: args.userId,
    matterId: args.matterId ?? null,
    type: args.type ?? 'generic',
    title: args.title,
    body: args.body ?? null,
  };
  return store().insert(row);
}

export async function listNotificationsForOwner(
  userId: string,
  limit = 50,
): Promise<NotificationRow[]> {
  return store().listForOwner(userId, limit);
}

/**
 * NOTIFY-SUITE-1 N1: owner-scoped UNREAD notices only (readAt IS NULL), newest first, capped. The digest
 * projects over THIS set — not the read-status-agnostic recent feed — so its per-type breakdown can never
 * diverge from the authoritative unread total for any owner with <= `limit` unread.
 */
export async function listUnreadForOwner(userId: string, limit = 200): Promise<NotificationRow[]> {
  return store().listUnread(userId, limit);
}

export async function countUnreadForOwner(userId: string): Promise<number> {
  return store().unreadCount(userId);
}

export async function listUnreadMatterIdsForOwner(userId: string): Promise<string[]> {
  return store().unreadMatterIds(userId);
}

export async function markAllNotificationsSeen(userId: string): Promise<number> {
  return store().markAllSeen(userId, new Date());
}

export async function markNotificationSeen(id: string, userId: string): Promise<void> {
  return store().markSeen(id, userId, new Date());
}
