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

import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../connection.js';
import { notifications, type NewNotification } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { isNotificationsEnabled } from '../../config/featureFlags.js';
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
  /**
   * NOTIFY-PRODUCERS-1: insert IFF the row's id is not already present; returns true when a NEW row
   * was created, false when an identical-id row already existed. This is the single-emit / idempotency
   * primitive — producers pass a DETERMINISTIC id (uuidv5 of a stable source key), so a re-fired
   * state-transition (or a concurrent F2 lane finishing the same session) writes exactly ONE row.
   */
  insertIfAbsent(row: NewNotification): Promise<boolean>;
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

// ER_DUP_ENTRY (MySQL/TiDB errno 1062): a deterministic-id insert that lost the single-emit race.
function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; errno?: number };
  return e.code === 'ER_DUP_ENTRY' || e.errno === 1062;
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

  async insertIfAbsent(row: NewNotification): Promise<boolean> {
    try {
      await db.insert(notifications).values(row);
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false; // an identical-id row already exists -> single-emit holds
      throw err;
    }
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

// ============================================================
// NOTIFY-PRODUCERS-1 — outbox-emit producers (review-ready, draft-generated)
// ============================================================
// IN-APP ONLY (these never leave the app — no email/push/external), so the EGRESS Inc 3b dependency that
// deferred the HOLD/ACK notification types does NOT gate these informational producers (there is no
// external egress to govern). Each fires at a canonical completion chokepoint and is IDEMPOTENT via a
// DETERMINISTIC id (uuidv5 of a stable source key) + insertIfAbsent, so a re-fired transition, the 60s
// client poll, a re-render, or a concurrent F2 lane finishing the same session can never write a
// duplicate. Gated on NOTIFICATIONS_ENABLED (the same flag that renders the bell/badge/poll); OFF -> the
// producers no-op (fully reversible). BEST-EFFORT: a producer failure is logged and swallowed — emitting
// an informational badge must never break a review or a draft commit. CONTENT is NO-NPI: a type + a
// matter reference + a fixed title only ("Review ready" / "Draft ready"), never client data.

// Fixed namespace for deterministic notification ids (uuidv5). Not a secret; must never change (changing
// it re-keys dedup and could double-emit already-emitted events once).
const NOTIFICATION_DEDUP_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

/**
 * Emit exactly ONE notification for a stable source event. `dedupKey` is the source identity (e.g.
 * `review_ready:<sessionId>`); it is hashed (uuidv5) into the row's PRIMARY KEY id, so a second emit for
 * the same event is a PK no-op. Returns true when a NEW row was created. Gated on NOTIFICATIONS_ENABLED
 * (OFF -> no-op, returns false).
 */
export async function emitNotificationOnce(args: {
  dedupKey: string;
  userId: string;
  matterId?: string | null;
  type?: NotificationType;
  title: string;
  body?: string | null;
}): Promise<boolean> {
  if (!isNotificationsEnabled()) return false;
  const row: NewNotification = {
    id: uuidv5(args.dedupKey, NOTIFICATION_DEDUP_NAMESPACE),
    userId: args.userId,
    matterId: args.matterId ?? null,
    type: args.type ?? 'generic',
    title: args.title,
    body: args.body ?? null,
  };
  return store().insertIfAbsent(row);
}

/**
 * Producer: a review SESSION has RETURNED (reached its terminal/ready state — all lanes terminal, NOT a
 * hold). One matter-scoped 'matter_ready' notice -> the per-matter "ready" badge + the global unread
 * badge. BEST-EFFORT (swallows errors). The CALLER must invoke this only on the non-hold ready settle
 * (see finalizeSessionLifecycleIfSettled and the sync settle); a held/running session must NOT call it.
 */
export async function emitReviewReadyNotification(args: {
  reviewSessionId: string;
  userId: string;
  matterId: string;
}): Promise<void> {
  try {
    const created = await emitNotificationOnce({
      dedupKey: `review_ready:${args.reviewSessionId}`,
      userId: args.userId,
      matterId: args.matterId,
      type: 'matter_ready',
      title: 'Review ready',
    });
    // Turn the best-effort silence into evidence: a live run records whether a NEW row was written
    // (created=true), a dedup no-op (created=false), or a swallowed error (the catch below) — so the
    // "review completed but no badge" symptom is diagnosable from logs without guesswork.
    console.info(`[notify-producers] review-ready emit (session ${args.reviewSessionId}): created=${created}`);
  } catch (e) {
    console.error(`[notify-producers] review-ready emit failed (session ${args.reviewSessionId}):`, e);
  }
}

/**
 * Producer: a DRAFT version has been COMMITTED (initial generation or regeneration). One matter-scoped
 * 'matter_ready' notice -> the per-matter "ready" badge + the global unread badge. BEST-EFFORT. Keyed on
 * the new versionId so each committed version emits exactly one notice.
 */
export async function emitDraftReadyNotification(args: {
  versionId: string;
  userId: string;
  matterId: string;
}): Promise<void> {
  try {
    const created = await emitNotificationOnce({
      dedupKey: `draft_ready:${args.versionId}`,
      userId: args.userId,
      matterId: args.matterId,
      type: 'matter_ready',
      title: 'Draft ready',
    });
    console.info(`[notify-producers] draft-ready emit (version ${args.versionId}): created=${created}`);
  } catch (e) {
    console.error(`[notify-producers] draft-ready emit failed (version ${args.versionId}):`, e);
  }
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

// ── NOTIFY-STALE-1 — stale-notice revocation (Fix A) + click-time staleness (Fix B) ───────────────────────

/**
 * The deterministic row id for a notification source event. IDENTICAL to the id emitNotificationOnce writes
 * (uuidv5(dedupKey, namespace)). Exported so a delete/revoke path can address the exact row a producer wrote
 * from the SAME dedupKey inputs — without the dedupKey being stored on the row.
 */
export function computeNotificationDedupId(dedupKey: string): string {
  return uuidv5(dedupKey, NOTIFICATION_DEDUP_NAMESPACE);
}

/**
 * NOTIFY-STALE-1 Fix A — revoke (mark read) the "Draft ready" notices keyed to a set of now-deleted document
 * versionIds, best-effort (swallow-never-fail, mirroring the producers). The version ids are the delete-side
 * inputs, so the dedup id is recomputable without the dedupKey stored. NOTE: the matter-delete cascade already
 * deletes a matter's notifications BY MATTER (matterPurge), so this seam is for a future SINGLE-document
 * hard-delete op — no single-document hard-delete exists in the app today (documents are archived, not
 * individually hard-deleted), so it is exported ready-to-wire rather than called from a non-existent path.
 */
export async function revokeNotificationsForVersions(userId: string, versionIds: readonly string[]): Promise<void> {
  for (const versionId of versionIds) {
    try {
      await markNotificationSeen(computeNotificationDedupId(`draft_ready:${versionId}`), userId);
    } catch (e) {
      console.error(`[notify-stale] revoke draft_ready for version ${versionId} failed:`, e);
    }
  }
}

/** NOTIFY-STALE-1 Fix A — revoke (mark read) the "Review ready" notices keyed to now-deleted reviewSessionIds. */
export async function revokeNotificationsForReviewSessions(userId: string, reviewSessionIds: readonly string[]): Promise<void> {
  for (const sessionId of reviewSessionIds) {
    try {
      await markNotificationSeen(computeNotificationDedupId(`review_ready:${sessionId}`), userId);
    } catch (e) {
      console.error(`[notify-stale] revoke review_ready for session ${sessionId} failed:`, e);
    }
  }
}

/** A notification enriched with whether its announced target still exists (NOTIFY-STALE-1 Fix B). */
export type NotificationWithTarget = NotificationRow & { targetLive: boolean };

/**
 * NOTIFY-STALE-1 Fix B (PURE) — flag a stale "ready" notice. A 'matter_ready' badge ("Draft ready" / "Review
 * ready") whose matter has NO documents at all (active OR archived) is STALE: the document it announced was
 * deleted out-of-band, so its deep-link would land on an empty matter. The client renders a tombstone instead
 * of the dead-end deep-link. Non-'matter_ready' notices and matter-less notices are never stale by this rule.
 * Deliberately matter-level (schema-free): the dedupKey/versionId is not stored on the row, so precise
 * version-level existence is not checkable without a schema change — the empty-matter signal catches the
 * observed failure (a matter with zero documents) without one.
 */
export function annotateNotificationStaleness(
  items: readonly NotificationRow[],
  matterIdsWithDocuments: ReadonlySet<string>,
): NotificationWithTarget[] {
  return items.map((n) => {
    const stale = n.type === 'matter_ready' && n.matterId !== null && !matterIdsWithDocuments.has(n.matterId);
    return { ...n, targetLive: !stale };
  });
}
