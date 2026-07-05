/**
 * NOTIFY-STALE-1 — Fix A (revoke a now-deleted target's "ready" badge, best-effort, via the deterministic
 * dedup id) + Fix B (flag a "ready" notice whose matter has no documents as stale so the client tombstones it).
 * Behavioral (in-memory store) + pure.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setNotificationStore,
  emitDraftReadyNotification,
  emitReviewReadyNotification,
  computeNotificationDedupId,
  revokeNotificationsForVersions,
  revokeNotificationsForReviewSessions,
  annotateNotificationStaleness,
  listNotificationsForOwner,
  countUnreadForOwner,
} from '../db/queries/notifications.js';
import { createInMemoryNotificationStore } from './inMemoryNotificationStore.js';
import type { NotificationRow } from '../../shared/schemas/notifications.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VERSION_1 = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const SESSION_1 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const FLAG = 'NOTIFICATIONS_ENABLED';
let saved: string | undefined;
beforeEach(() => {
  saved = process.env[FLAG];
  process.env[FLAG] = 'true';
  setNotificationStore(createInMemoryNotificationStore());
});
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
  setNotificationStore(null);
});

describe('NOTIFY-STALE-1 Fix A — revoke addresses the exact producer row', () => {
  it('computeNotificationDedupId equals the id the draft-ready producer writes (recomputable without the stored key)', async () => {
    await emitDraftReadyNotification({ versionId: VERSION_1, userId: U1, matterId: MATTER_A });
    const rows = await listNotificationsForOwner(U1, 50);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(computeNotificationDedupId(`draft_ready:${VERSION_1}`));
  });

  it('revokeNotificationsForVersions marks the version-keyed badge read (unread clears)', async () => {
    await emitDraftReadyNotification({ versionId: VERSION_1, userId: U1, matterId: MATTER_A });
    expect(await countUnreadForOwner(U1)).toBe(1);
    await revokeNotificationsForVersions(U1, [VERSION_1]);
    expect(await countUnreadForOwner(U1)).toBe(0);
  });

  it('revokeNotificationsForReviewSessions marks the session-keyed badge read', async () => {
    await emitReviewReadyNotification({ reviewSessionId: SESSION_1, userId: U1, matterId: MATTER_A });
    expect(await countUnreadForOwner(U1)).toBe(1);
    await revokeNotificationsForReviewSessions(U1, [SESSION_1]);
    expect(await countUnreadForOwner(U1)).toBe(0);
  });

  it('revoke is best-effort — an unknown target is a no-op, never throws', async () => {
    await expect(revokeNotificationsForVersions(U1, ['unknown-version'])).resolves.toBeUndefined();
  });
});

describe('NOTIFY-STALE-1 Fix B — annotateNotificationStaleness (pure)', () => {
  const mk = (over: Partial<NotificationRow>): NotificationRow => ({
    id: '00000000-0000-0000-0000-000000000001',
    userId: U1,
    matterId: MATTER_A,
    type: 'matter_ready',
    title: 'Draft ready',
    body: null,
    readAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  it('a matter_ready notice whose matter has NO documents is stale (targetLive false)', () => {
    const out = annotateNotificationStaleness([mk({})], new Set());
    expect(out[0]!.targetLive).toBe(false);
  });

  it('a matter_ready notice whose matter HAS documents is live', () => {
    const out = annotateNotificationStaleness([mk({})], new Set([MATTER_A]));
    expect(out[0]!.targetLive).toBe(true);
  });

  it('a non-matter_ready notice is never stale', () => {
    const out = annotateNotificationStaleness([mk({ type: 'generic' })], new Set());
    expect(out[0]!.targetLive).toBe(true);
  });

  it('a matter-less notice is never stale', () => {
    const out = annotateNotificationStaleness([mk({ matterId: null })], new Set());
    expect(out[0]!.targetLive).toBe(true);
  });
});
