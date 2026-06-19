/**
 * Notification schemas (Zod Wall) — FOLD-NOTIFY-1 (in-app notification CORE).
 *
 * An ADDITIVE, OWNER-scoped in-app notification record. One row is one informational
 * notice for ONE attorney, OPTIONALLY about one matter. The store + read + display tier
 * only: this model NEVER auto-adopts, auto-sends, or makes any decision — it is purely
 * informational. The OUTBOX-EMIT WIRING (producers that create notifications) and the
 * hold/ack notification types are DEFERRED to after EGRESS Inc 3b; the table may
 * legitimately sit empty until producers land. Behind NOTIFICATIONS_ENABLED (default OFF).
 *
 * This is the single source of truth for the notification-type enum: schema.ts (the
 * Drizzle table) imports NOTIFICATION_TYPE_VALUES from here so the column enum and the
 * Zod Wall can never drift (the repo convention used by matterDeliverables / partyModel).
 *
 * SCOPE FENCE (FOLD-NOTIFY-1): OWNER-scoped everywhere; matterId is OPTIONAL (a matter-
 * less, owner-level notice is valid). readAt is the per-user "seen" marker (null = unread).
 */

import { z } from 'zod';

// What KIND of in-app notice this is. 'generic' is the safe default. 'matter_ready'
// drives the per-matter "ready" badge (a matter has work ready for the attorney). The
// hold/ack-bearing types are DEFERRED (post EGRESS Inc 3b) and are NOT enumerated here.
export const NOTIFICATION_TYPE_VALUES = [
  'generic',
  'matter_ready',
  // NOTIFY-SUITE-1 N2: a deadline/tickler is approaching its effective due date. Drives the per-matter
  // "deadline approaching" badge (distinct from 'matter_ready'). Informational only; never auto-acts.
  'deadline',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPE_VALUES)[number];

export const NotificationRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  // matterId: OPTIONAL — a notification may be matter-scoped (drives the per-matter
  // "ready" badge) or a matter-less owner-level notice. Nullable.
  matterId: z.string().uuid().nullable(),
  type: z.enum(NOTIFICATION_TYPE_VALUES),
  title: z.string().min(1).max(256),
  // body: optional longer text. Nullable (a title-only notice is valid).
  body: z.string().max(8000).nullable(),
  // readAt: the per-user "seen" marker. null = unread; a timestamp = seen by the owner.
  readAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type NotificationRow = z.infer<typeof NotificationRowSchema>;

// ── NOTIFY-SUITE-1 N1 — "while you were away" digest (pure projection over the UNREAD set) ──
/**
 * The single derived summary the client shows ON RETURN — ONE coherent line, not N toasts. Derived from
 * the owner's UNREAD notifications (readAt IS NULL is the per-user last-seen cursor); informational only.
 */
export interface NotificationDigest {
  total: number; // total unread
  matterReady: number; // unread 'matter_ready'
  deadline: number; // unread 'deadline'
  generic: number; // unread 'generic'
  matterCount: number; // distinct matters with an unread matter-scoped notice
  summaryLine: string; // human one-liner ('' when nothing is unread)
}

/**
 * PURE: build the "while you were away" digest from the owner's UNREAD notification rows. Derive, never
 * duplicate — the rows are the source. Groups by type so the client renders ONE summary line.
 */
export function buildNotificationDigest(unread: NotificationRow[]): NotificationDigest {
  let matterReady = 0;
  let deadline = 0;
  let generic = 0;
  const matters = new Set<string>();
  for (const n of unread) {
    if (n.type === 'matter_ready') matterReady += 1;
    else if (n.type === 'deadline') deadline += 1;
    else generic += 1;
    if (n.matterId) matters.add(n.matterId);
  }
  const parts: string[] = [];
  if (matterReady > 0) parts.push(`${matterReady} ${matterReady === 1 ? 'matter has' : 'matters have'} results`);
  if (deadline > 0) parts.push(`${deadline} deadline${deadline === 1 ? '' : 's'} approaching`);
  if (generic > 0) parts.push(`${generic} update${generic === 1 ? '' : 's'}`);
  return { total: unread.length, matterReady, deadline, generic, matterCount: matters.size, summaryLine: parts.join(' · ') };
}
