/**
 * FOLD-DEPLOY-VERIFY-1 — post-deploy smoke suite core logic.
 *
 * Exercises the pure check-runner, exit-code decision, tRPC batch parsing,
 * cookie extraction, and rollback executor with a fully mocked HTTP transport
 * (no network). Confirms: all-green -> exit 0; any required failure -> exit 1;
 * the unauth check requires a 401; rollback is alert-only with no token and
 * attempts the API with a token + targets configured.
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error - runtime .mjs tool module imported for test; it has no type declarations.
import { runChecks, decideExitCode, performRollback, rollbackInstructions, parseTrpcBatch, extractSessionCookie, trpcBatchBody } from '../../../tools/deploy/smokeCore.mjs';

type HttpRes = { status: number; json: unknown; headers: Record<string, string> };

/** A scripted transport: healthy prod by default; overrides tweak specific routes. */
function makeFakeHttp(overrides: Record<string, (req: { method: string; path: string; headers: Record<string, string>; body: string | undefined }) => HttpRes> = {}) {
  const calls: { method: string; path: string }[] = [];
  const http = async (method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}): Promise<HttpRes> => {
    const headers = opts.headers ?? {};
    calls.push({ method, path });
    const key = `${method} ${path.split('?')[0]}`;
    const override = overrides[key];
    if (override) return override({ method, path, headers, body: opts.body });

    if (key === 'GET /api/health') return { status: 200, json: { status: 'ok' }, headers: {} };
    if (key === 'GET /api/ready') return { status: 200, json: { status: 'ready' }, headers: {} };
    if (key === 'GET /api/version') return { status: 200, json: { commit: 'abc1234', builtAt: 'x' }, headers: {} };
    if (key === 'GET /trpc/auth.me') {
      if (headers.cookie) return { status: 200, json: [{ result: { data: { userId: 'u1' } } }], headers: {} };
      return { status: 401, json: [{ error: { data: { code: 'UNAUTHORIZED' } } }], headers: {} };
    }
    if (key === 'POST /trpc/auth.login') {
      return { status: 200, json: [{ result: { data: { userId: 'u1', displayName: 'K' } } }], headers: { 'set-cookie': 'lln_session=abc; Path=/; HttpOnly' } };
    }
    if (key === 'POST /trpc/auth.changePassword') {
      const body = opts.body ? (JSON.parse(opts.body) as { '0': { currentPassword: string; newPassword: string } }) : null;
      const input = body ? body['0'] : null;
      if (input && input.currentPassword === 'definitely-not-the-password') return { status: 401, json: [{ error: { data: { code: 'UNAUTHORIZED' } } }], headers: {} };
      if (input && input.newPassword === 'short') return { status: 400, json: [{ error: { data: { code: 'BAD_REQUEST' } } }], headers: {} };
      return { status: 200, json: [{ result: { data: { success: true } } }], headers: {} };
    }
    return { status: 404, json: null, headers: {} };
  };
  return { http, calls };
}

const baseConfig = { baseUrl: 'https://x', username: 'smoke', password: 'pw', expectedCommit: '', engagementId: 'test', rotatePassword: false, tempPassword: '', railwayToken: '', railwayServiceId: '', railwayEnvironmentId: '' };

describe('smokeCore — helpers', () => {
  it('parseTrpcBatch unwraps data and error', () => {
    expect(parseTrpcBatch([{ result: { data: { a: 1 } } }])).toEqual({ data: { a: 1 } });
    expect(parseTrpcBatch([{ error: { message: 'no' } }]).error).toBeTruthy();
    expect(parseTrpcBatch(null).error).toBeTruthy();
  });
  it('extractSessionCookie pulls name=value from set-cookie', () => {
    expect(extractSessionCookie({ 'set-cookie': 'lln_session=abc; Path=/; HttpOnly' })).toBe('lln_session=abc');
    expect(extractSessionCookie({})).toBeNull();
  });
  it('trpcBatchBody wraps under key 0', () => {
    expect(trpcBatchBody({ a: 1 })).toBe('{"0":{"a":1}}');
  });
});

describe('smokeCore — runChecks', () => {
  it('all-green: every required check passes -> exit 0', async () => {
    const { http } = makeFakeHttp();
    const { ok, results } = await runChecks({ http, config: baseConfig });
    expect(ok).toBe(true);
    expect(decideExitCode(results)).toBe(0);
    const byName = Object.fromEntries(results.map((r: { name: string; ok: boolean }) => [r.name, r.ok]));
    expect(byName['health']).toBe(true);
    expect(byName['protected-401-unauth']).toBe(true);
    expect(byName['login']).toBe(true);
    expect(byName['changePassword-enforces']).toBe(true);
  });

  it('RED: a failing health check -> exit 1', async () => {
    const { http } = makeFakeHttp({ 'GET /api/health': () => ({ status: 503, json: { status: 'down' }, headers: {} }) });
    const { ok, results } = await runChecks({ http, config: baseConfig });
    expect(ok).toBe(false);
    expect(decideExitCode(results)).toBe(1);
  });

  it('the unauth check FAILS if a protected endpoint answers 200 without a cookie', async () => {
    const { http } = makeFakeHttp({ 'GET /trpc/auth.me': ({ headers }) => (headers.cookie ? { status: 200, json: [{ result: { data: { userId: 'u1' } } }], headers: {} } : { status: 200, json: [{ result: { data: { userId: 'leak' } } }], headers: {} }) });
    const { results } = await runChecks({ http, config: baseConfig });
    const unauth = results.find((r: { name: string }) => r.name === 'protected-401-unauth');
    expect(unauth.ok).toBe(false);
    expect(decideExitCode(results)).toBe(1);
  });

  it('version-match is required and fails on a commit mismatch', async () => {
    const { http } = makeFakeHttp();
    const { results } = await runChecks({ http, config: { ...baseConfig, expectedCommit: 'deadbeef' } });
    const vm = results.find((r: { name: string }) => r.name === 'version-match');
    expect(vm.required).toBe(true);
    expect(vm.ok).toBe(false);
  });

  it('login/changePassword checks are non-required skips when no creds', async () => {
    const { http } = makeFakeHttp();
    const { ok, results } = await runChecks({ http, config: { ...baseConfig, username: '', password: '' } });
    const login = results.find((r: { name: string }) => r.name === 'login');
    expect(login.required).toBe(false);
    expect(ok).toBe(true);
  });
});

describe('smokeCore — performRollback', () => {
  it('no token -> alert-only with manual instructions', async () => {
    const { http } = makeFakeHttp();
    const rb = await performRollback({ http, config: baseConfig });
    expect(rb.attempted).toBe(false);
    expect(rb.mode).toBe('alert-only');
    expect(rb.instructions).toContain('ROLLBACK STEPS');
  });

  it('token present but service/env unconfigured -> does not attempt', async () => {
    const { http } = makeFakeHttp();
    const rb = await performRollback({ http, config: { ...baseConfig, railwayToken: 'tok' } });
    expect(rb.attempted).toBe(false);
    expect(rb.mode).toBe('token-present-but-unconfigured');
  });

  it('token + targets -> attempts the Railway API rollback', async () => {
    let gqlCalls = 0;
    const http = async (_m: string, path: string) => {
      if (path.includes('graphql')) {
        gqlCalls += 1;
        if (gqlCalls === 1) return { status: 200, json: { data: { deployments: { edges: [{ node: { id: 'cur', status: 'SUCCESS' } }, { node: { id: 'prev', status: 'SUCCESS' } }] } } }, headers: {} };
        return { status: 200, json: { data: { deploymentRollback: true } }, headers: {} };
      }
      return { status: 404, json: null, headers: {} };
    };
    const rb = await performRollback({ http, config: { ...baseConfig, railwayToken: 'tok', railwayServiceId: 'svc', railwayEnvironmentId: 'env' } });
    expect(rb.attempted).toBe(true);
    expect(rb.mode).toBe('auto-rollback');
    expect(rb.rolledBackTo).toBe('prev');
    expect(gqlCalls).toBe(2);
  });
});

describe('smokeCore — rollbackInstructions', () => {
  it('always provides the manual dashboard + CLI + API steps', () => {
    const text = rollbackInstructions(baseConfig);
    expect(text).toContain('Railway dashboard');
    expect(text).toContain('railway redeploy');
    expect(text).toContain('deploymentRollback');
  });
});
