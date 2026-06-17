/**
 * FOLD-NOTIFY-1 — in-app notification core behavioral tests.
 *
 * Covers: the READ surface (owner feed + unread count + per-matter "ready" badge data),
 * the "mark seen" cursor (markAllSeen / markSeen), owner-scope isolation (cross-owner =
 * empty/zero, no leak, no mutation), the flag gate (default OFF, fail-closed, zero store
 * I/O), the schema/enum shape, and the migration additive guards (with comment-stripping).
 * DB-free: the query layer runs against an injected in-memory store; tests seed SYNTHETIC
 * rows directly via createNotification (there is NO producer procedure — outbox-emit
 * wiring is DEFERRED). Authed callers are built off ctx.userId only (Ch 35.2 — userId is
 * NEVER a procedure input).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MATTER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

import { appRouter } from '../router.js';
import {
  setNotificationStore,
  createNotification,
  type NotificationStore,
} from '../db/queries/notifications.js';
import { createInMemoryNotificationStore } from './inMemoryNotificationStore.js';
import {
  NOTIFICATION_TYPE_VALUES,
  NotificationRowSchema,
} from '../../shared/schemas/notifications.js';

const FLAG = 'NOTIFICATIONS_ENABLED';
const MIGRATION_SQL = readFileSync(
  fileURLToPath(new URL('../db/migrations/0045_fold_notify_1_notifications.sql', import.meta.url)),
  'utf8',
);
// Executable DDL only: strip `/* */` and `-- …` comments so the destructive-DDL guards
// below scan statements, not prose. The header comment intentionally NAMES the `ALTER
// TABLE … ADD INDEX` TiDB trap it avoids, which must not trip the guard.
const MIGRATION_DDL = MIGRATION_SQL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

function caller(userId: string | undefined) {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });
}

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

describe('FOLD-NOTIFY-1 — read feed + unread count + per-matter ready badge', () => {
  it('lists the owner feed, counts unread, and reports matterIds with unread matter-scoped notices', async () => {
    // Seed synthetic rows (no producer procedure exists — outbox wiring is DEFERRED).
    await createNotification({ userId: U1, matterId: MATTER_A, type: 'matter_ready', title: 'Matter A ready' });
    await createNotification({ userId: U1, type: 'generic', title: 'Welcome', body: 'hello' });
    await createNotification({ userId: U2, matterId: MATTER_B, type: 'matter_ready', title: "U2's notice" });

    const u1 = caller(U1);
    const res = await u1.notifications.list();
    expect(res.items).toHaveLength(2); // only U1's, not U2's
    expect(res.unreadCount).toBe(2);
    // Only the matter-SCOPED unread notice contributes a matterId; the matter-less one does not.
    expect(res.unreadMatterIds).toEqual([MATTER_A]);
  });

  it('respects a limit input', async () => {
    for (let i = 0; i < 5; i++) {
      await createNotification({ userId: U1, title: `n${i}` });
    }
    const res = await caller(U1).notifications.list({ limit: 3 });
    expect(res.items).toHaveLength(3);
    expect(res.unreadCount).toBe(5); // count is over ALL unread, not just the page
  });
});

describe('FOLD-NOTIFY-1 — mark seen (per-user last-seen cursor)', () => {
  it('markAllSeen clears the unread count; markSeen clears one notice', async () => {
    const a = await createNotification({ userId: U1, matterId: MATTER_A, title: 'a' });
    await createNotification({ userId: U1, title: 'b' });
    const u1 = caller(U1);

    expect((await u1.notifications.list()).unreadCount).toBe(2);

    // markSeen one
    await u1.notifications.markSeen({ id: a.id });
    const afterOne = await u1.notifications.list();
    expect(afterOne.unreadCount).toBe(1);
    expect(afterOne.unreadMatterIds).toEqual([]); // the matter-scoped one is now seen

    // markAllSeen the rest
    const { marked } = await u1.notifications.markAllSeen();
    expect(marked).toBe(1);
    expect((await u1.notifications.list()).unreadCount).toBe(0);
  });
});

describe('FOLD-NOTIFY-1 — owner-scope isolation (cross-owner = empty/zero, no leak/mutation)', () => {
  it('U2 never sees or mutates U1 notices', async () => {
    const u1Notice = await createNotification({ userId: U1, matterId: MATTER_A, title: 'private' });
    const u2 = caller(U2);

    // U2's feed is empty; U2's count is zero.
    const u2List = await u2.notifications.list();
    expect(u2List.items).toHaveLength(0);
    expect(u2List.unreadCount).toBe(0);

    // U2 marking U1's notice seen is a no-op (owner-scoped) — U1's notice stays unread.
    await u2.notifications.markSeen({ id: u1Notice.id });
    await u2.notifications.markAllSeen();
    const u1List = await caller(U1).notifications.list();
    expect(u1List.unreadCount).toBe(1);
    expect(u1List.items[0]!.readAt).toBeNull();
  });

  it('an unauthenticated caller is rejected (UNAUTHORIZED)', async () => {
    await expect(caller(undefined).notifications.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('FOLD-NOTIFY-1 — flag gate (default OFF, fail-closed, zero store I/O)', () => {
  it('with NOTIFICATIONS_ENABLED OFF, every op refuses and never touches the store', async () => {
    delete process.env[FLAG];
    const throwingStore = new Proxy({} as NotificationStore, {
      get() {
        return () => {
          throw new Error('store must not be touched when the flag is OFF');
        };
      },
    });
    setNotificationStore(throwingStore);
    const u1 = caller(U1);

    await expect(u1.notifications.list()).rejects.toThrow(/NOTIFICATIONS_DISABLED/);
    await expect(u1.notifications.markAllSeen()).rejects.toThrow(/NOTIFICATIONS_DISABLED/);
    await expect(u1.notifications.markSeen({ id: U1 })).rejects.toThrow(/NOTIFICATIONS_DISABLED/);
  });

  it('isEnabled reports the flag state (ungated)', async () => {
    delete process.env[FLAG];
    expect(await caller(U1).notifications.isEnabled()).toEqual({ enabled: false });
    process.env[FLAG] = 'true';
    expect(await caller(U1).notifications.isEnabled()).toEqual({ enabled: true });
  });
});

describe('FOLD-NOTIFY-1 — schema / enum shape', () => {
  it('the row schema accepts a well-formed row and rejects bad enums / empty title', () => {
    const base = {
      id: U1, userId: U1, matterId: MATTER_A, type: 'matter_ready',
      title: 'A', body: null, readAt: null, createdAt: new Date(), updatedAt: new Date(),
    };
    expect(NotificationRowSchema.safeParse(base).success).toBe(true);
    expect(NotificationRowSchema.safeParse({ ...base, matterId: null }).success).toBe(true); // nullable
    expect(NotificationRowSchema.safeParse({ ...base, type: 'bogus' }).success).toBe(false);
    expect(NotificationRowSchema.safeParse({ ...base, title: '' }).success).toBe(false);

    expect(NOTIFICATION_TYPE_VALUES).toContain('generic');
    expect(NOTIFICATION_TYPE_VALUES).toContain('matter_ready');
  });
});

describe('FOLD-NOTIFY-1 — migration 0045 additive guards (CI-enforceable)', () => {
  it('creates the notifications table, is additive-only, and has NO ALTER ... ADD INDEX', () => {
    expect(/CREATE TABLE IF NOT EXISTS `notifications`/.test(MIGRATION_SQL)).toBe(true);
    // additive-only (scan stripped DDL so the header's mention of the trap does not trip it)
    expect(/\bDROP\s+(TABLE|COLUMN|DATABASE|INDEX)\b/i.test(MIGRATION_DDL)).toBe(false);
    expect(/\bTRUNCATE\b/i.test(MIGRATION_DDL)).toBe(false);
    expect(/\bDELETE\s+FROM\b/i.test(MIGRATION_DDL)).toBe(false);
    expect(/\bRENAME\b/i.test(MIGRATION_DDL)).toBe(false);
    // TiDB trap guard: indexes are INLINE in CREATE TABLE, never `ALTER TABLE ... ADD INDEX`.
    expect(/ALTER\s+TABLE[\s\S]*ADD\s+(UNIQUE\s+)?INDEX/i.test(MIGRATION_DDL)).toBe(false);
    // indexes ARE declared inline.
    expect(/INDEX `idx_notifications_owner`/.test(MIGRATION_SQL)).toBe(true);
    expect(/INDEX `idx_notifications_matter`/.test(MIGRATION_SQL)).toBe(true);
  });

  it('the migration is registered in the apply-prod-migrations allowlist + EXPECTED_TABLES_EXTRA', () => {
    const runner = readFileSync(
      fileURLToPath(new URL('../../../scripts/apply-prod-migrations.mjs', import.meta.url)),
      'utf8',
    );
    expect(runner).toContain('0045_fold_notify_1_notifications.sql');
    expect(runner).toContain("'notifications'");
  });
});
</content>
