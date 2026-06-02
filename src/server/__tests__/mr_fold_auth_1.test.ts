/**
 * FOLD-AUTH-1 — Auth bypass removal + always-enforced auth (regression)
 *
 * Replaces mr_auth_bypass_1.test.ts. The env-gated auth bypass (MR-AUTH-BYPASS-1,
 * middleware/authBypass.ts) was REMOVED in FOLD-AUTH-1. These tests assert:
 *
 *   T-FOLD-AUTH-1-1: auth.me requires a session (UNAUTHORIZED with no userId).
 *   T-FOLD-AUTH-1-2: setting AUTH_BYPASS_ENABLED=true has NO effect — auth.me
 *                    still throws UNAUTHORIZED. The env can no longer disable auth.
 *   T-FOLD-AUTH-1-3: the new auth.changePassword and auth.logout are protected.
 *   T-FOLD-AUTH-1-4: source audit — the bypass module is gone and no auth call
 *                    site references it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import { appRouter } from '../router.js';

// Mock the users DB query module so no real DB connection is needed.
vi.mock('../db/queries/users.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/users.js')>();
  return {
    ...actual,
    getUser: vi.fn(),
    getUserByUsername: vi.fn(),
    updateUserPassword: vi.fn(),
  };
});

// Helper: a tRPC caller with no session userId (an unauthenticated request).
function makeUnauthCaller() {
  return appRouter.createCaller({
    req: {} as Request,
    res: {} as Response,
    userId: undefined,
  });
}

describe('T-FOLD-AUTH-1-1: auth always requires a session', () => {
  beforeEach(() => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    delete process.env['AUTH_BYPASS_USER_ID'];
  });
  afterEach(() => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    delete process.env['AUTH_BYPASS_USER_ID'];
  });

  it('auth.me throws UNAUTHORIZED with no userId in ctx', async () => {
    const caller = makeUnauthCaller();
    await expect(caller.auth.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('T-FOLD-AUTH-1-2: AUTH_BYPASS_ENABLED has NO effect (bypass removed)', () => {
  afterEach(() => {
    delete process.env['AUTH_BYPASS_ENABLED'];
    delete process.env['AUTH_BYPASS_USER_ID'];
  });

  it('auth.me STILL throws UNAUTHORIZED even when AUTH_BYPASS_ENABLED="true"', async () => {
    process.env['AUTH_BYPASS_ENABLED'] = 'true';
    process.env['AUTH_BYPASS_USER_ID'] = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const caller = makeUnauthCaller();
    await expect(caller.auth.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('T-FOLD-AUTH-1-3: new/changed auth procedures are protected', () => {
  beforeEach(() => {
    delete process.env['AUTH_BYPASS_ENABLED'];
  });

  it('auth.changePassword throws UNAUTHORIZED without a session', async () => {
    const caller = makeUnauthCaller();
    await expect(
      caller.auth.changePassword({ currentPassword: 'x', newPassword: 'xxxxxxxxxx' })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('auth.logout throws UNAUTHORIZED without a session', async () => {
    const caller = makeUnauthCaller();
    await expect(caller.auth.logout()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('T-FOLD-AUTH-1-4: source audit — bypass removed', () => {
  it('middleware/authBypass.ts no longer exists', () => {
    const p = fileURLToPath(new URL('../middleware/authBypass.ts', import.meta.url));
    expect(existsSync(p)).toBe(false);
  });

  it('trpc.ts has no bypass references', () => {
    const src = readFileSync(fileURLToPath(new URL('../trpc.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/authBypass|isAuthBypassEnabled|getBypassUserId/);
  });

  it('index.ts has no bypass references', () => {
    const src = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/authBypass|isAuthBypassEnabled|getBypassUserId/);
  });
});
