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
import { isNotificationsEnabled, isNotifySoundEnabled } from '../config/featureFlags.js';
import {
  listNotificationsForOwner,
  listUnreadForOwner,
  countUnreadForOwner,
  listUnreadMatterIdsForOwner,
  markAllNotificationsSeen,
  markNotificationSeen,
  annotateNotificationStaleness,
} from '../db/queries/notifications.js';
import { mattersWithDocuments } from '../db/queries/documents.js';
import { buildNotificationDigest } from '../../shared/schemas/notifications.js';

function assertEnabled(): void {
  if (!isNotificationsEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'NOTIFICATIONS_DISABLED' });
  }
}

export const notificationsRouter = router({
  // Ungated probe so the client can decide whether to mount the bell + start polling.
  // soundEnabled exposes the NOTIFY_SOUND_ENABLED flag (gavel cue) read-only; the client still
  // ANDs it with the per-user notificationPreferences.sound toggle (read via settings.get) before
  // playing. Pure/sync — no DB read here; OFF (default) keeps the client's sound path fully dark.
  isEnabled: protectedProcedure.query(() => ({
    enabled: isNotificationsEnabled(),
    soundEnabled: isNotifySoundEnabled(),
  })),

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
      // NOTIFY-STALE-1 Fix B: flag a "ready" notice whose matter has NO documents (its announced document was
      // deleted out-of-band) so the client renders a tombstone instead of a dead-end deep-link to an empty matter.
      // FAIL-OPEN: this is a display enrichment — a staleness-check failure must NEVER break the notification
      // feed, so on any error we treat all notices as live (no tombstone) rather than error the list.
      let annotated;
      try {
        const candidateMatterIds = [
          ...new Set(items.filter((n) => n.type === 'matter_ready' && n.matterId !== null).map((n) => n.matterId as string)),
        ];
        const liveMatterIds =
          candidateMatterIds.length > 0 ? await mattersWithDocuments(ctx.userId, candidateMatterIds) : new Set<string>();
        annotated = annotateNotificationStaleness(items, liveMatterIds);
      } catch (e) {
        console.error('[notify-stale] targetLive enrichment failed; treating all notices as live:', e);
        annotated = items.map((n) => ({ ...n, targetLive: true }));
      }
      return { items: annotated, unreadCount, unreadMatterIds };
    }),

  // ── NOTIFY-SUITE-1 N1 — "while you were away" digest ───────────────────────
  // ONE derived summary over the owner's UNREAD notices (readAt cursor) for display on return — not N
  // toasts. The breakdown is projected over the UNREAD set ITSELF (listUnreadForOwner — newest-first, capped),
  // NOT the read-status-agnostic recent feed, so the per-type counts can never disagree with the authoritative
  // total. total is the exact countUnreadForOwner; the projection covers up to the cap most-recent unread (for
  // an owner with more unread than the cap the summary is of the most-recent, total stays honest). Derive,
  // never duplicate; informational only.
  digest: protectedProcedure.query(async ({ ctx }) => {
    assertEnabled();
    const [unread, total] = await Promise.all([
      listUnreadForOwner(ctx.userId, 500),
      countUnreadForOwner(ctx.userId),
    ]);
    return { ...buildNotificationDigest(unread), total }; // authoritative total from countUnreadForOwner
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
