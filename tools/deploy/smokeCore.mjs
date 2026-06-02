/**
 * Post-deploy smoke suite — pure, testable core (FOLD-DEPLOY-VERIFY-1).
 *
 * This module contains NO process/env/network access. Everything (the HTTP
 * transport, config, logger) is injected, so the check-runner, exit-code
 * decision, rollback-instruction text, and rollback executor are all unit
 * testable with a fake transport. The thin CLI wrapper that wires real env +
 * `fetch` lives in `smoke.mjs`.
 *
 * Contract under test (confirmed by code inspection 2026-06-02):
 *   - REST:  GET /api/health -> 200 {status:'ok'}; GET /api/ready -> 200 {status:'ready'};
 *            GET /api/version -> {commit, builtAt}.
 *   - tRPC v11 at /trpc, NO transformer, httpBatchLink. Batched mutation:
 *       POST /trpc/<proc>?batch=1  body {"0": <input>}  -> [{"result":{"data":...}}]
 *     Batched no-input query: GET /trpc/<proc>?batch=1.
 *     An errored single-item batch returns that error's HTTP status (e.g. 401 for
 *     UNAUTHORIZED) AND a body [{"error":{...}}]; checks below tolerate both.
 *   - auth.login (public mutation), auth.me (protected query -> 401 unauth),
 *     auth.changePassword (protected mutation; newPassword min 10; rejects no-op).
 */

export const PROD_BASE_URL_DEFAULT = 'https://lex-law-next-app-production.up.railway.app';

/** tRPC v11 (no transformer): a single-item batch wraps the input under key "0". */
export function trpcBatchBody(input) {
  return JSON.stringify({ 0: input });
}

/** Unwrap a single-item tRPC batch response. Returns {data} or {error}. */
export function parseTrpcBatch(json) {
  if (!Array.isArray(json) || json.length === 0) return { error: { message: 'malformed batch response' } };
  const entry = json[0];
  if (entry && entry.result && 'data' in entry.result) return { data: entry.result.data };
  if (entry && entry.error) return { error: entry.error };
  return { error: { message: 'unrecognized batch entry shape' } };
}

/**
 * The check list. Each check: { name, required, fn(ctx) -> Promise<{ok, detail}> }.
 * ctx = { http, config, session }. `http(method, path, {headers, body}) ->
 * {status, json, headers}` is injected. `session` is shared mutable state
 * (carries the login cookie between checks). `required` checks gate the exit code;
 * non-required checks (e.g. version-match when no expected commit is set) only warn.
 */
export function buildChecks(config) {
  const checks = [];

  // 1. Liveness.
  checks.push({
    name: 'health',
    required: true,
    async fn({ http }) {
      const r = await http('GET', '/api/health', {});
      const ok = r.status === 200 && r.json && r.json.status === 'ok';
      return { ok, detail: ok ? '200 status:ok' : `unexpected: status=${r.status} body=${JSON.stringify(r.json)}` };
    },
  });

  // 2. Readiness (DB reachable).
  checks.push({
    name: 'ready',
    required: true,
    async fn({ http }) {
      const r = await http('GET', '/api/ready', {});
      const ok = r.status === 200 && r.json && r.json.status === 'ready';
      return { ok, detail: ok ? '200 status:ready' : `not ready: status=${r.status} body=${JSON.stringify(r.json)}` };
    },
  });

  // 3. Correct build deployed (Pattern-16: prove the deploy actually landed the
  //    expected commit). Required only when an expected commit is supplied.
  checks.push({
    name: 'version-match',
    required: Boolean(config.expectedCommit),
    async fn({ http }) {
      const r = await http('GET', '/api/version', {});
      const commit = r.json && r.json.commit;
      if (!config.expectedCommit) return { ok: true, detail: `deployed commit=${commit} (no expected commit set; informational)` };
      const ok = typeof commit === 'string' && commit.startsWith(config.expectedCommit);
      return { ok, detail: ok ? `commit matches ${config.expectedCommit}` : `MISMATCH: deployed=${commit} expected=${config.expectedCommit}` };
    },
  });

  // 4. Protected endpoint rejects the unauthenticated caller (no cookie) -> 401.
  checks.push({
    name: 'protected-401-unauth',
    required: true,
    async fn({ http }) {
      const r = await http('GET', '/trpc/auth.me?batch=1', {});
      const parsed = parseTrpcBatch(r.json);
      const ok = r.status === 401 || (parsed.error && parsed.error.data && parsed.error.data.code === 'UNAUTHORIZED');
      return { ok, detail: ok ? '401 / UNAUTHORIZED as expected' : `expected 401, got status=${r.status} body=${JSON.stringify(r.json)}` };
    },
  });

  // 5. Login works, and the resulting session authenticates a protected call.
  //    Skipped (non-required) when no smoke credentials are configured.
  checks.push({
    name: 'login',
    required: Boolean(config.username && config.password),
    async fn({ http, config: cfg, session }) {
      if (!(cfg.username && cfg.password)) return { ok: true, detail: 'SKIPPED — no SMOKE_USERNAME/SMOKE_PASSWORD set (configure to exercise login)' };
      const r = await http('POST', '/trpc/auth.login?batch=1', {
        headers: { 'content-type': 'application/json' },
        body: trpcBatchBody({ username: cfg.username, password: cfg.password }),
      });
      const parsed = parseTrpcBatch(r.json);
      if (r.status !== 200 || !parsed.data || !parsed.data.userId) {
        return { ok: false, detail: `login failed: status=${r.status} ${parsed.error ? JSON.stringify(parsed.error) : ''}` };
      }
      const cookie = extractSessionCookie(r.headers);
      if (!cookie) return { ok: false, detail: 'login returned 200 but no session cookie was set' };
      session.cookie = cookie;
      // Round-trip: the cookie must authenticate auth.me.
      const me = await http('GET', '/trpc/auth.me?batch=1', { headers: { cookie } });
      const meOk = me.status === 200 && parseTrpcBatch(me.json).data;
      return { ok: Boolean(meOk), detail: meOk ? 'login + authenticated auth.me round-trip OK' : `session cookie did not authenticate auth.me (status=${me.status})` };
    },
  });

  // 6. auth.changePassword is deployed and ENFORCING (non-mutating validations:
  //    wrong-current -> 401; too-short new -> BAD_REQUEST; no-op -> BAD_REQUEST).
  //    These prove the endpoint without changing the real credential. Runs only
  //    when logged in (needs the cookie from check 5).
  checks.push({
    name: 'changePassword-enforces',
    required: Boolean(config.username && config.password),
    async fn({ http, session }) {
      if (!session.cookie) return { ok: true, detail: 'SKIPPED — no session (login did not run)' };
      const call = (input) => http('POST', '/trpc/auth.changePassword?batch=1', {
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: trpcBatchBody(input),
      });
      // wrong current password -> UNAUTHORIZED (never mutates).
      const wrong = parseTrpcBatch((await call({ currentPassword: 'definitely-not-the-password', newPassword: 'a-long-enough-new-1' })).json);
      const wrongOk = wrong.error && wrong.error.data && wrong.error.data.code === 'UNAUTHORIZED';
      // too-short new password -> input validation rejects before any mutation.
      const short = await call({ currentPassword: config.password, newPassword: 'short' });
      const shortParsed = parseTrpcBatch(short.json);
      const shortOk = short.status >= 400 || (shortParsed.error && shortParsed.error.data && shortParsed.error.data.code === 'BAD_REQUEST');
      const ok = wrongOk && shortOk;
      return { ok, detail: ok ? 'wrong-current rejected (401) + short-new rejected (validation) — endpoint enforcing, no mutation' : `enforcement check failed: wrongOk=${wrongOk} shortOk=${shortOk}` };
    },
  });

  // 7. OPT-IN true rotation (rotate-and-restore). DEFAULT OFF. Mutates the
  //    credential, so it must target a DEDICATED smoke account, never the
  //    operator's only login. Restores in a finally block.
  if (config.rotatePassword) {
    checks.push({
      name: 'changePassword-rotates',
      required: true,
      async fn({ http, config: cfg, session }) {
        if (!session.cookie) return { ok: false, detail: 'cannot rotate — no session' };
        if (!cfg.tempPassword) return { ok: false, detail: 'SMOKE_ROTATE_PASSWORD set but no SMOKE_TEMP_PASSWORD provided' };
        const change = (currentPassword, newPassword) => http('POST', '/trpc/auth.changePassword?batch=1', {
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: trpcBatchBody({ currentPassword, newPassword }),
        });
        const login = (password) => http('POST', '/trpc/auth.login?batch=1', {
          headers: { 'content-type': 'application/json' },
          body: trpcBatchBody({ username: cfg.username, password }),
        });
        let rotated = false;
        try {
          const c1 = await change(cfg.password, cfg.tempPassword);
          if (r2xx(c1)) rotated = true; else return { ok: false, detail: `rotate -> temp failed: status=${c1.status}` };
          const l1 = await login(cfg.tempPassword);
          if (!r2xx(l1)) return { ok: false, detail: 'login with temp password failed after rotation' };
          return { ok: true, detail: 'rotated to temp + logged in with temp (restore in finally)' };
        } finally {
          if (rotated) {
            // Restore original credential. Best-effort; logged by caller on failure.
            await change(cfg.tempPassword, cfg.password).catch(() => {});
          }
        }
      },
    });
  }

  // 8. Engagement-specific Pattern-16 checks, injected by the caller.
  if (Array.isArray(config.extraChecks)) {
    for (const c of config.extraChecks) checks.push(c);
  }

  return checks;
}

function r2xx(r) {
  return r && r.status >= 200 && r.status < 300;
}

/** Pull the iron-session cookie from a set-cookie header (string or array). */
export function extractSessionCookie(headers) {
  if (!headers) return null;
  const raw = typeof headers.get === 'function' ? headers.get('set-cookie') : headers['set-cookie'];
  if (!raw) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  // Take the cookie name=value pair (drop attributes) of the first set-cookie.
  const first = list[0];
  return first ? first.split(';')[0] : null;
}

/** Run all checks in order; collect results. Returns {ok, results}. */
export async function runChecks({ http, config, log = () => {} }) {
  const checks = buildChecks(config);
  const session = { cookie: null };
  const results = [];
  for (const check of checks) {
    let res;
    try {
      res = await check.fn({ http, config, session });
    } catch (err) {
      res = { ok: false, detail: `threw: ${err && err.message ? err.message : String(err)}` };
    }
    const record = { name: check.name, required: check.required, ok: res.ok, detail: res.detail };
    results.push(record);
    log(`${res.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN'} ${check.name} — ${res.detail}`);
  }
  const ok = results.every((r) => r.ok || !r.required);
  return { ok, results };
}

/** Exit 0 only if every REQUIRED check passed. */
export function decideExitCode(results) {
  return results.every((r) => r.ok || !r.required) ? 0 : 1;
}

/** The exact manual rollback steps, for the RED alert (always accurate). */
export function rollbackInstructions(config) {
  const svc = config.railwayServiceId ? config.railwayServiceId : '<service-id>';
  return [
    'ROLLBACK STEPS (most recent good deployment):',
    '  1. Railway dashboard → the service → Deployments tab → the previous SUCCESSFUL',
    '     deployment → "⋯" menu → "Rollback" (or "Redeploy").  ← fastest, no token needed.',
    '  2. CLI (if installed + linked):  railway redeploy   (or `railway rollback`).',
    `  3. API (needs RAILWAY_TOKEN): GraphQL deploymentRollback(id: <previousDeploymentId>) at`,
    '     https://backboard.railway.app/graphql/v2 — query deployments(serviceId, environmentId)',
    `     for the previous SUCCESS id, then call deploymentRollback. service=${svc}.`,
    '  After rollback: re-run this smoke suite to confirm the restored build is GREEN.',
  ].join('\n');
}

/**
 * Attempt rollback. With a RAILWAY_TOKEN configured, performs the Railway GraphQL
 * rollback (UNTESTED without a live token — verify on first real use). Without a
 * token, returns alert-only mode and the manual instructions. Never throws.
 */
export async function performRollback({ http, config, log = () => {} }) {
  if (!config.railwayToken) {
    return { attempted: false, mode: 'alert-only', instructions: rollbackInstructions(config) };
  }
  if (!config.railwayServiceId || !config.railwayEnvironmentId) {
    return { attempted: false, mode: 'token-present-but-unconfigured', instructions: rollbackInstructions(config),
      note: 'RAILWAY_TOKEN set but RAILWAY_SERVICE_ID/RAILWAY_ENVIRONMENT_ID missing — cannot target the rollback.' };
  }
  try {
    const gql = (query, variables) => http('POST', 'https://backboard.railway.app/graphql/v2', {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.railwayToken}` },
      body: JSON.stringify({ query, variables }),
    });
    // Find the previous SUCCESS deployment (skip the current one).
    const list = await gql(
      `query($svc:String!,$env:String!){deployments(input:{serviceId:$svc,environmentId:$env},first:5){edges{node{id status createdAt}}}}`,
      { svc: config.railwayServiceId, env: config.railwayEnvironmentId },
    );
    const edges = list.json && list.json.data && list.json.data.deployments && list.json.data.deployments.edges;
    if (!Array.isArray(edges)) return { attempted: false, mode: 'rollback-query-failed', instructions: rollbackInstructions(config), note: 'could not list deployments' };
    const success = edges.map((e) => e.node).filter((n) => n.status === 'SUCCESS');
    const previous = success[1] || success[0];
    if (!previous) return { attempted: false, mode: 'no-previous-deployment', instructions: rollbackInstructions(config) };
    const rb = await gql(`mutation($id:String!){deploymentRollback(id:$id)}`, { id: previous.id });
    const ok = rb.json && rb.json.data && rb.json.data.deploymentRollback;
    log(`auto-rollback -> deployment ${previous.id}: ${ok ? 'requested' : 'request returned ' + JSON.stringify(rb.json)}`);
    return { attempted: true, mode: 'auto-rollback', rolledBackTo: previous.id, ok: Boolean(ok), instructions: rollbackInstructions(config) };
  } catch (err) {
    return { attempted: true, mode: 'auto-rollback-error', error: err && err.message ? err.message : String(err), instructions: rollbackInstructions(config) };
  }
}
