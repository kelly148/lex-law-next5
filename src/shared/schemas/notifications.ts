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
</content>
</invoke>
