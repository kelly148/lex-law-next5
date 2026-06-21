/**
 * NOTIFY-PRODUCERS-1 — outbox-emit producers (review-ready + draft-generated).
 *
 * Behavioral (DB-free, injected in-memory store): each producer emits EXACTLY ONE notification per event
 * and is IDEMPOTENT across re-fires / the 60s poll / re-renders (deterministic-id dedup); distinct events
 * produce distinct notices; the content is no-NPI ('matter_ready' + a matter ref + a fixed title); the flag
 * gates the producers (OFF -> no emit); and mark-seen clears the unread badge. Source-audit: the review-
 * ready emit fires ONLY on the non-hold settle (held/running -> no "ready"), and the four canonical
 * completion chokepoints call the producers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  setNotificationStore,
  emitReviewReadyNotification,
  emitDraftReadyNotification,
  emitNotificationOnce,
  listNotificationsForOwner,
  countUnreadForOwner,
  listUnreadMatterIdsForOwner,
  markAllNotificationsSeen,
} from '../db/queries/notifications.js';
import { createInMemoryNotificationStore } from './inMemoryNotificationStore.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SESSION_1 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SESSION_2 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const VERSION_1 = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const FLAG = 'NOTIFICATIONS_ENABLED';
let savedFlag: string | undefined;
beforeEach(() => {
  savedFlag = process.env[FLAG];
  process.env[FLAG] = 'true';
  setNotificationStore(createInMemoryNotificationStore());
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  setNotificationStore(null);
});

describe('NOTIFY-PRODUCERS-1 — review-ready', () => {
  it('emits exactly ONE matter-scoped "Review ready" notice (no-NPI: type + matter + fixed title)', async () => {
    await emitReviewReadyNotification({ reviewSessionId: SESSION_1, userId: U1, matterId: MATTER_A });
    const rows = await listNotificationsForOwner(U1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('matter_ready');
    expect(rows[0]!.matterId).toBe(MATTER_A);
    expect(rows[0]!.title).toBe('Review ready');
    expect(rows[0]!.body).toBeNull(); // no client data
    expect(await listUnreadMatterIdsForOwner(U1)).toEqual([MATTER_A]); // drives the per-matter badge
  });

  it('is IDEMPOTENT: re-firing for the same session (re-render / 60s poll / concurrent lane) never duplicates', async () => {
    await emitReviewReadyNotification({ reviewSessionId: SESSION_1, userId: U1, matterId: MATTER_A });
    await emitReviewReadyNotification({ reviewSessionId: SESSION_1, userId: U1, matterId: MATTER_A });
    await emitReviewReadyNotification({ reviewSessionId: SESSION_1, userId: U1, matterId: MATTER_A });
    expect(await listNotificationsForOwner(U1)).toHaveLength(1);
    expect(await countUnreadForOwner(U1)).toBe(1);
  });

  it('distinct sessions produce distinct notices (dedup is per-event, not blanket)', async () => {
    await emitReviewReadyNotification({ reviewSessionId: SESSION_1, userId: U1, matterId: MATTER_A });
    await emitReviewReadyNotification({ reviewSessionId: SESSION_2, userId: U1, matterId: MATTER_A });
    expect(await listNotificationsForOwner(U1)).toHaveLength(2);
  });
});

describe('NOTIFY-PRODUCERS-1 — draft-ready', () => {
  it('emits exactly ONE "Draft ready" notice per committed version; idempotent on re-fire', async () => {
    await emitDraftReadyNotification({ versionId: VERSION_1, userId: U1, matterId: MATTER_A });
    await emitDraftReadyNotification({ versionId: VERSION_1, userId: U1, matterId: MATTER_A });
    const rows = await listNotificationsForOwner(U1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Draft ready');
    expect(rows[0]!.type).toBe('matter_ready');
    expect(rows[0]!.matterId).toBe(MATTER_A);
  });

  it('a review-ready and a draft-ready on the same matter are TWO distinct notices', async () => {
    await emitReviewReadyNotification({ reviewSessionId: SESSION_1, userId: U1, matterId: MATTER_A });
    await emitDraftReadyNotification({ versionId: VERSION_1, userId: U1, matterId: MATTER_A });
    expect(await countUnreadForOwner(U1)).toBe(2);
  });
});

describe('NOTIFY-PRODUCERS-1 — flag gate + mark-seen', () => {
  it('flag OFF -> producers no-op (no row written)', async () => {
    process.env[FLAG] = 'false';
    await emitReviewReadyNotification({ reviewSessionId: SESSION_1, userId: U1, matterId: MATTER_A });
    await emitDraftReadyNotification({ versionId: VERSION_1, userId: U1, matterId: MATTER_A });
    expect(await listNotificationsForOwner(U1)).toHaveLength(0);
  });

  it('mark-seen clears the unread badge', async () => {
    await emitReviewReadyNotification({ reviewSessionId: SESSION_1, userId: U1, matterId: MATTER_A });
    expect(await countUnreadForOwner(U1)).toBe(1);
    const marked = await markAllNotificationsSeen(U1);
    expect(marked).toBe(1);
    expect(await countUnreadForOwner(U1)).toBe(0);
    expect(await listUnreadMatterIdsForOwner(U1)).toEqual([]); // per-matter badge cleared too
  });

  it('emitNotificationOnce returns true on first emit, false on the deduped re-emit', async () => {
    expect(
      await emitNotificationOnce({ dedupKey: 'x:1', userId: U1, matterId: MATTER_A, title: 'Review ready', type: 'matter_ready' }),
    ).toBe(true);
    expect(
      await emitNotificationOnce({ dedupKey: 'x:1', userId: U1, matterId: MATTER_A, title: 'Review ready', type: 'matter_ready' }),
    ).toBe(false);
    expect(await listNotificationsForOwner(U1)).toHaveLength(1);
  });
});

// ── source-audit: the gating (held/running never "ready") + the canonical chokepoints call the producers ──
const repoRoot = resolve(__dirname, '../../..');
const read = (p: string): string => readFileSync(resolve(repoRoot, p), 'utf8');

describe('NOTIFY-PRODUCERS-1 — emit-site wiring (source-audit)', () => {
  it('review-ready fires ONLY on the non-hold settle (a held/running session never emits "ready")', () => {
    const src = read('src/server/jobs/reviewerJobFactory.ts');
    // finalize emits AFTER the allTerminal early-return (running -> never reaches the emit) and ONLY when
    // not hold-blocked (held -> no "ready").
    expect(src).toContain('if (!allTerminal) return;');
    expect(src).toContain('if (!holdBlocked) {');
    expect(src).toContain('await emitReviewReadyNotification({ reviewSessionId, userId, matterId });');
  });

  it('the SYNC settle also emits review-ready (F2-off fallback)', () => {
    const src = read('src/server/procedures/reviewSession.ts');
    expect(src).toContain('await emitReviewReadyNotification({ reviewSessionId: sessionId, userId, matterId: doc.matterId });');
  });

  it('the ASYNC finalize AWAITS the lane write before finalize (race closed — no dropped emit)', () => {
    const src = read('src/server/jobs/reviewerJobFactory.ts');
    // The lane terminalize must be AWAITED before finalize so finalize's lane SELECT observes this lane's
    // terminal status. A fire-and-forget `void finalizeSessionLifecycleIfSettled(` could race ahead of the
    // un-committed lane write, hit the !allTerminal early-return, and PERMANENTLY drop the review-ready emit.
    expect(src).toContain('await markReviewerLaneTerminal(');
    expect(src).toContain('await finalizeSessionLifecycleIfSettled(reviewSessionId, userId, matterId);');
    expect(src).not.toContain('void finalizeSessionLifecycleIfSettled(');
  });

  it('draft-ready fires on the committed version in generate + regenerate (document + review-loop)', () => {
    const docs = read('src/server/procedures/documents4a.ts');
    const rs = read('src/server/procedures/reviewSession.ts');
    // two sites in documents4a (initial generate + regenerate), one in the review-loop regenerate
    expect(docs.split('await emitDraftReadyNotification({ versionId: newVersion.id, userId, matterId: doc.matterId });').length - 1).toBe(2);
    expect(rs).toContain('await emitDraftReadyNotification({ versionId: newVersion.id, userId, matterId });');
  });
});
