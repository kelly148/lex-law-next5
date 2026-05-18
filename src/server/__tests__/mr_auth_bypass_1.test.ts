/**
 * MR-AUTH-BYPASS-1 — Temporary Auth Bypass Tests
 *
 * Tests for the environment-gated authentication bypass introduced in
 * authBypass.ts, trpc.ts, and server/index.ts.
 *
 * Test IDs: T-AUTH-BYPASS-1 through T-AUTH-BYPASS-5
 *
 * Design:
 *   T-AUTH-BYPASS-1: AUTH_BYPASS_ENABLED unset/false preserves auth requirement
 *                    (auth.me throws UNAUTHORIZED without a session).
 *   T-AUTH-BYPASS-2: AUTH_BYPASS_ENABLED=true allows auth.me to succeed without
 *                    a session when AUTH_BYPASS_USER_ID resolves to a real DB user.
 *   T-AUTH-BYPASS-3: AUTH_BYPASS_ENABLED=true with AUTH_BYPASS_USER_ID supplies
 *                    that userId to downstream context (auth.me returns correct userId).
 *   T-AUTH-BYPASS-4: Inline REST auth checks use the bypass path when enabled
 *                    (unit test of helper functions as applied in REST handlers).
 *   T-AUTH-BYPASS-5: Login/auth endpoints remain present and unchanged (auth.login
 *                    is a publicProcedure; auth.logout is a protectedProcedure).
 *
 * Limitation:
 *   The full browser AuthGuard/useAuth flow cannot be tested in this harness
 *   (it requires a browser runtime). The server-side auth.me path is the
 *   authoritative gate tested here. When auth.me returns a user, useAuth sets
 *   isAuthenticated=true and AuthGuard renders the app.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { appRouter } from '../router.js';
import { isAuthBypassEnabled, getBypassUserId, BYPASS_SYNTHETIC_USER_ID } from '../middleware/authBypass.js';

// ── Mock the users DB query module ────────────────────────────────────────────
// auth.me uses a dynamic import: const { getUser } = await import('../db/queries/users.js')
// We mock the module so no real DB connection is needed.
vi.mock('../db/queries/users.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/users.js')>();
  return {
    ...actual,
    getUser: vi.fn(),
  };
});

// ── Mock getUserByUsername for auth.login (prevents DB calls in T-AUTH-BYPASS-5) ──
vi.mock('../db/queries/users.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/users.js')>();
  return {
    ...actual,
    getUser: vi.fn(),
    getUserByUsername: vi.fn(),
  };
});

const TEST_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const MOCK_USER = {
  id: TEST_UUID,
  username: 'kelly',
  displayName: 'Kelly Satterwhite',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// Helper: create a tRPC caller with no session userId (simulates unauthenticated browser)
function makeUnauthCaller() {
  return appRouter.createCaller({
    req: {} as Request,
    res: {} as Response,
    userId: undefined,
  });
}

// ============================================================
// T-AUTH-BYPASS-1 — AUTH_BYPASS_ENABLED unset/false preserves auth requirement
// ============================================================
describe('T-AUTH-BYPASS-1: bypass OFF — auth.me requires session', () => {
  beforeEach(() => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    delete process.env['AUTH_BYPASS_USER_ID'];
  });
  afterEach(() => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    delete process.env['AUTH_BYPASS_USER_ID'];
  });

  it('throws UNAUTHORIZED when AUTH_BYPASS_ENABLED is absent and no userId in ctx', async () => {
    const caller = makeUnauthCaller();
    await expect(caller.auth.me()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('throws UNAUTHORIZED when AUTH_BYPASS_ENABLED is "false" and no userId in ctx', async () => {
    process.env['AUTH_BYPASS_ENABLED'] = 'false';
    const caller = makeUnauthCaller();
    await expect(caller.auth.me()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('isAuthBypassEnabled() returns false when AUTH_BYPASS_ENABLED is absent', () => {
    expect(isAuthBypassEnabled()).toBe(false);
  });

  it('isAuthBypassEnabled() returns false when AUTH_BYPASS_ENABLED is "false"', () => {
    process.env['AUTH_BYPASS_ENABLED'] = 'false';
    expect(isAuthBypassEnabled()).toBe(false);
  });

  it('isAuthBypassEnabled() returns false when AUTH_BYPASS_ENABLED is "0"', () => {
    process.env['AUTH_BYPASS_ENABLED'] = '0';
    expect(isAuthBypassEnabled()).toBe(false);
  });
});

// ============================================================
// T-AUTH-BYPASS-2 — AUTH_BYPASS_ENABLED=true allows auth.me to succeed
//                   without a session when AUTH_BYPASS_USER_ID resolves to a real user
// ============================================================
describe('T-AUTH-BYPASS-2: bypass ON — auth.me succeeds without session', () => {
  beforeEach(async () => {
    process.env['AUTH_BYPASS_ENABLED'] = 'true';
    process.env['AUTH_BYPASS_USER_ID'] = TEST_UUID;
    // Mock getUser to return the test user when called with TEST_UUID
    const usersModule = await import('../db/queries/users.js');
    vi.mocked(usersModule.getUser).mockResolvedValue(MOCK_USER);
  });
  afterEach(() => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    delete process.env['AUTH_BYPASS_USER_ID'];
    vi.clearAllMocks();
  });

  it('auth.me returns user data without a session cookie when bypass is enabled', async () => {
    const caller = makeUnauthCaller();
    const result = await caller.auth.me();
    expect(result).toMatchObject({
      userId: TEST_UUID,
      displayName: 'Kelly Satterwhite',
      username: 'kelly',
    });
  });

  it('isAuthBypassEnabled() returns true when AUTH_BYPASS_ENABLED is "true"', () => {
    expect(isAuthBypassEnabled()).toBe(true);
  });
});

// ============================================================
// T-AUTH-BYPASS-3 — AUTH_BYPASS_USER_ID is supplied to downstream context
// ============================================================
describe('T-AUTH-BYPASS-3: bypass ON — AUTH_BYPASS_USER_ID propagates to ctx.userId', () => {
  beforeEach(async () => {
    process.env['AUTH_BYPASS_ENABLED'] = 'true';
    process.env['AUTH_BYPASS_USER_ID'] = TEST_UUID;
    const usersModule = await import('../db/queries/users.js');
    vi.mocked(usersModule.getUser).mockResolvedValue(MOCK_USER);
  });
  afterEach(() => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    delete process.env['AUTH_BYPASS_USER_ID'];
    vi.clearAllMocks();
  });

  it('auth.me returns the userId from AUTH_BYPASS_USER_ID, not the synthetic sentinel', async () => {
    const caller = makeUnauthCaller();
    const result = await caller.auth.me();
    expect(result.userId).toBe(TEST_UUID);
    expect(result.userId).not.toBe(BYPASS_SYNTHETIC_USER_ID);
  });

  it('getBypassUserId() returns AUTH_BYPASS_USER_ID when set', () => {
    expect(getBypassUserId()).toBe(TEST_UUID);
  });

  it('getBypassUserId() returns synthetic sentinel when AUTH_BYPASS_USER_ID is absent', () => {
    delete process.env['AUTH_BYPASS_USER_ID'];
    expect(getBypassUserId()).toBe(BYPASS_SYNTHETIC_USER_ID);
  });

  it('auth.me throws UNAUTHORIZED when bypass is ON but AUTH_BYPASS_USER_ID resolves to no DB user', async () => {
    // Simulate: bypass enabled, user UUID set, but getUser returns null (user not in DB)
    const usersModule = await import('../db/queries/users.js');
    vi.mocked(usersModule.getUser).mockResolvedValue(null);
    const caller = makeUnauthCaller();
    await expect(caller.auth.me()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('auth.me throws UNAUTHORIZED when bypass is ON but only synthetic sentinel is used (no DB user)', async () => {
    // Simulate: bypass enabled, no AUTH_BYPASS_USER_ID, synthetic sentinel used
    delete process.env['AUTH_BYPASS_USER_ID'];
    const usersModule = await import('../db/queries/users.js');
    vi.mocked(usersModule.getUser).mockResolvedValue(null);
    const caller = makeUnauthCaller();
    await expect(caller.auth.me()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

// ============================================================
// T-AUTH-BYPASS-4 — Inline REST auth checks use the bypass path when enabled
// ============================================================
describe('T-AUTH-BYPASS-4: inline REST auth bypass helper behavior', () => {
  afterEach(() => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    delete process.env['AUTH_BYPASS_USER_ID'];
  });

  it('bypass OFF: isAuthBypassEnabled() returns false — REST handler should call getSession', () => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    // Simulates the REST handler decision: if (!isAuthBypassEnabled()) { call getSession }
    expect(isAuthBypassEnabled()).toBe(false);
  });

  it('bypass ON: isAuthBypassEnabled() returns true — REST handler should skip getSession', () => {
    process.env['AUTH_BYPASS_ENABLED'] = 'true';
    expect(isAuthBypassEnabled()).toBe(true);
  });

  it('bypass ON with user ID: getBypassUserId() returns the configured UUID', () => {
    process.env['AUTH_BYPASS_ENABLED'] = 'true';
    process.env['AUTH_BYPASS_USER_ID'] = TEST_UUID;
    // Simulates the REST handler: userId = getBypassUserId()
    const userId = getBypassUserId();
    expect(userId).toBe(TEST_UUID);
    // userId is non-null, so the REST handler would NOT return 401
    expect(userId).toBeTruthy();
  });

  it('bypass ON without user ID: getBypassUserId() returns synthetic sentinel (non-null)', () => {
    process.env['AUTH_BYPASS_ENABLED'] = 'true';
    delete process.env['AUTH_BYPASS_USER_ID'];
    const userId = getBypassUserId();
    // Synthetic sentinel is non-null — REST handler proceeds (no 401)
    // but DB-touching routes will fail FK checks
    expect(userId).toBe(BYPASS_SYNTHETIC_USER_ID);
    expect(userId).toBeTruthy();
  });

  it('BYPASS_SYNTHETIC_USER_ID is the all-zeros UUID sentinel', () => {
    expect(BYPASS_SYNTHETIC_USER_ID).toBe('00000000-0000-0000-0000-000000000000');
  });
});

// ============================================================
// T-AUTH-BYPASS-5 — Login/auth endpoints remain present and unchanged
// ============================================================
describe('T-AUTH-BYPASS-5: login and auth routes remain present', () => {
  afterEach(() => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    vi.clearAllMocks();
  });

  it('auth.login exists as a public procedure (does not throw UNAUTHORIZED without session)', async () => {
    // auth.login is publicProcedure — it should NOT throw UNAUTHORIZED
    // It will throw UNAUTHORIZED with 'Invalid credentials.' for wrong credentials,
    // but that is a credentials error, not a missing-session error.
    const usersModule = await import('../db/queries/users.js');
    vi.mocked(usersModule.getUserByUsername).mockResolvedValue(null);
    const caller = makeUnauthCaller();
    // Should throw 'Invalid credentials.' (UNAUTHORIZED from login logic), not
    // 'UNAUTHENTICATED' (which would indicate the session middleware blocked it)
    await expect(caller.auth.login({ username: 'nobody', password: 'wrong' }))
      .rejects.toMatchObject({ message: 'Invalid credentials.' });
  });

  it('auth.login is accessible without bypass (bypass OFF does not affect public procedures)', async () => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    const usersModule = await import('../db/queries/users.js');
    vi.mocked(usersModule.getUserByUsername).mockResolvedValue(null);
    const caller = makeUnauthCaller();
    await expect(caller.auth.login({ username: 'nobody', password: 'wrong' }))
      .rejects.toMatchObject({ message: 'Invalid credentials.' });
  });

  it('auth.logout is a protectedProcedure — throws UNAUTHORIZED without session when bypass OFF', async () => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    const caller = makeUnauthCaller();
    await expect(caller.auth.logout()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('auth.me is present in the router (not removed by bypass changes)', async () => {
    // auth.me exists — calling it without bypass throws UNAUTHORIZED (not "not a function")
    delete process.env['AUTH_BYPASS_ENABLED'];
    const caller = makeUnauthCaller();
    await expect(caller.auth.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
