/**
 * NOTIFY-SUITE-1 N1 — "while you were away" digest projection (pure).
 *
 * buildNotificationDigest derives ONE coherent summary from the owner's UNREAD notifications so the client
 * shows a single line on return (not N toasts). Pure — no DB, no IO.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { buildNotificationDigest, type NotificationRow } from '../../shared/schemas/notifications.js';
import { appRouter } from '../router.js';
import {
  setNotificationStore,
  createNotification,
  markNotificationSeen,
} from '../db/queries/notifications.js';
import { createInMemoryNotificationStore } from './inMemoryNotificationStore.js';

function n(type: NotificationRow['type'], matterId: string | null = null): NotificationRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    userId: '11111111-1111-1111-1111-111111111111',
    matterId,
    type,
    title: 'x',
    body: null,
    readAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('NOTIFY-SUITE-1 N1 — buildNotificationDigest', () => {
  it('empty unread set -> all zeroes + empty summary line', () => {
    expect(buildNotificationDigest([])).toEqual({
      total: 0,
      matterReady: 0,
      deadline: 0,
      generic: 0,
      matterCount: 0,
      summaryLine: '',
    });
  });

  it('groups by type, counts DISTINCT matters, and builds a coherent one-liner', () => {
    const d = buildNotificationDigest([
      n('matter_ready', 'm1'),
      n('matter_ready', 'm2'),
      n('matter_ready', 'm3'),
      n('deadline', 'm1'), // same matter as a matter_ready -> distinct matter count is still 3
      n('generic', null),
      n('generic', null),
    ]);
    expect(d.total).toBe(6);
    expect(d.matterReady).toBe(3);
    expect(d.deadline).toBe(1);
    expect(d.generic).toBe(2);
    expect(d.matterCount).toBe(3); // m1, m2, m3
    expect(d.summaryLine).toBe('3 matters have results · 1 deadline approaching · 2 updates');
  });

  it('singular/plural phrasing', () => {
    const d = buildNotificationDigest([n('matter_ready', 'm1'), n('deadline', 'm1')]);
    expect(d.summaryLine).toBe('1 matter has results · 1 deadline approaching');
  });

  it('only deadlines -> deadline-only summary', () => {
    const d = buildNotificationDigest([n('deadline', 'm1'), n('deadline', 'm2'), n('deadline', 'm2')]);
    expect(d).toMatchObject({ total: 3, deadline: 3, matterReady: 0, generic: 0, matterCount: 2 });
    expect(d.summaryLine).toBe('3 deadlines approaching');
  });
});

// Proc-level: lock in that the digest projects over the UNREAD set itself (listUnreadForOwner), so the
// per-type breakdown can never disagree with the authoritative unread total (the adversarial-review M1 fix).
const FLAG = 'NOTIFICATIONS_ENABLED';
const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MATTER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
function caller(userId: string | undefined) {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });
}

describe('NOTIFY-SUITE-1 N1 — notifications.digest (proc reconciles breakdown with the unread total)', () => {
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

  it('projects over UNREAD only — a READ notice never inflates the digest, and the breakdown sums to total', async () => {
    await createNotification({ userId: U1, matterId: MATTER_A, type: 'matter_ready', title: 'a' });
    await createNotification({ userId: U1, matterId: MATTER_B, type: 'deadline', title: 'b' });
    const seen = await createNotification({ userId: U1, type: 'generic', title: 'c' });
    await markNotificationSeen(seen.id, U1); // READ -> excluded from the digest

    const d = await caller(U1).notifications.digest();
    expect(d.total).toBe(2); // authoritative unread (the read 'generic' is excluded)
    expect(d.matterReady).toBe(1);
    expect(d.deadline).toBe(1);
    expect(d.generic).toBe(0); // the only generic was read
    expect(d.matterReady + d.deadline + d.generic).toBe(d.total); // breakdown reconciles with total
    expect(d.matterCount).toBe(2);
    expect(d.summaryLine).toBe('1 matter has results · 1 deadline approaching');
  });

  it('is owner-scoped — another owner\'s unread never appears in the digest', async () => {
    await createNotification({ userId: U1, type: 'deadline', title: 'mine' });
    await createNotification({ userId: U2, type: 'deadline', title: 'theirs' });

    const d = await caller(U1).notifications.digest();
    expect(d.total).toBe(1);
    expect(d.deadline).toBe(1);
  });

  it('refuses when NOTIFICATIONS_ENABLED is OFF (fail-closed)', async () => {
    delete process.env[FLAG];
    await expect(caller(U1).notifications.digest()).rejects.toThrow(/NOTIFICATIONS_DISABLED/);
  });
});
