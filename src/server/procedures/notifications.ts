/**
 * notifications router — FOLD-NOTIFY-1 (in-app notification core; store + read + display).
 *
 * Owner-scoped READ + "mark seen" over the dedicated `notifications` table. Mirrors the
 * matterDeliverable / matterEntity router conventions: protectedProcedure everywhere; an
 * assertEnabled() flag gate (NOTIFICATIONS_ENABLED, default OFF) on every op except the
 * ungated isEnabled probe; userId is ALWAYS ctx.userId, NEVER read from input (Ch 35.2).
 *
 * INFORMATIONAL ONLY: this surface NEVER auto-adopts, auto-sends, or makes any decision.
 *
 * SCOPE FENCE (FOLD-NOTIFY-1): READ + display tier ONLY. There is NO producer procedure
 * (creating notifications) — the outbox-emit wiring is DEFERRED to after EGRESS Inc 3b.
 * `list` returns the feed + unread count + the matterIds with unread matter-scoped notices
 * (for the per-matter "ready" badge); markAllSeen / markSeen are the per-user last-seen
 * cursor mutations.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isNotificationsEnabled } from '../config/featureFlags.js';
import {
  listNotificationsForOwner,
  countUnreadForOwner,
  listUnreadMatterIdsForOwner,
  markAllNotificationsSeen,
  markNotificationSeen,
} from '../db/queries/notifications.js';

function assertEnabled(): void {
  if (!isNotificationsEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'NOTIFICATIONS_DISABLED' });
  }
}

export const notificationsRouter = router({
  // Ungated probe so the client can decide whether to mount the bell + start polling.
  isEnabled: protectedProcedure.query(() => ({ enabled: isNotificationsEnabled() })),

  // ── Read: the owner feed + unread count + per-matter "ready" badge data ────
  // One owner-scoped read powers the bell badge (unreadCount), the dropdown list (items),
  // and the per-matter "ready" badge (unreadMatterIds). Lightweight enough to poll.
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      assertEnabled();
      const limit = input?.limit ?? 50;
      const [items, unreadCount, unreadMatterIds] = await Promise.all([
        listNotificationsForOwner(ctx.userId, limit),
        countUnreadForOwner(ctx.userId),
        listUnreadMatterIdsForOwner(ctx.userId),
      ]);
      return { items, unreadCount, unreadMatterIds };
    }),

  // ── "Mark seen" / last-seen cursor (per-user; owner-scoped) ────────────────
  markAllSeen: protectedProcedure.mutation(async ({ ctx }) => {
    assertEnabled();
    const marked = await markAllNotificationsSeen(ctx.userId);
    return { ok: true, marked };
  }),

  markSeen: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      await markNotificationSeen(input.id, ctx.userId);
      return { ok: true };
    }),
});
</content>
