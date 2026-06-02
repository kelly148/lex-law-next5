#!/usr/bin/env node
/**
 * Post-deploy smoke suite — CLI wrapper (FOLD-DEPLOY-VERIFY-1).
 *
 * Runs the smoke checks (smokeCore.mjs) against a deployed environment, prints a
 * GREEN/RED summary, and exits non-zero on any required-check failure. On RED it
 * either auto-rolls-back (only if a RAILWAY_TOKEN is configured) or prints the
 * exact manual rollback steps (alert-only mode). NEVER prints secret values.
 *
 * Usage:
 *   node tools/deploy/smoke.mjs
 *
 * Configuration (environment variables — secrets come from the env, never hardcoded):
 *   SMOKE_BASE_URL          target base URL (default: prod Railway URL)
 *   SMOKE_USERNAME          smoke account username (enables the login + changePassword checks)
 *   SMOKE_PASSWORD          smoke account password
 *   SMOKE_EXPECTED_COMMIT   if set, require /api/version commit to start with this (Pattern-16 "right build")
 *   SMOKE_ENGAGEMENT_ID     engagement id for the GREEN live-verified recommendation (default: deploy)
 *   SMOKE_ROTATE_PASSWORD   "true" to run the OPT-IN rotate-and-restore check — DEDICATED smoke account only
 *   SMOKE_TEMP_PASSWORD     temp password for the rotate check (>=10 chars; required if rotation enabled)
 *   RAILWAY_TOKEN           if present, enables true auto-rollback on RED (else alert-only)
 *   RAILWAY_SERVICE_ID      Railway service id (required for auto-rollback)
 *   RAILWAY_ENVIRONMENT_ID  Railway environment id (required for auto-rollback)
 */

import {
  PROD_BASE_URL_DEFAULT,
  runChecks,
  decideExitCode,
  performRollback,
} from './smokeCore.mjs';

function loadConfig(env) {
  return {
    baseUrl: (env.SMOKE_BASE_URL || PROD_BASE_URL_DEFAULT).replace(/\/+$/, ''),
    username: env.SMOKE_USERNAME || '',
    password: env.SMOKE_PASSWORD || '',
    expectedCommit: env.SMOKE_EXPECTED_COMMIT || '',
    engagementId: env.SMOKE_ENGAGEMENT_ID || 'deploy',
    rotatePassword: env.SMOKE_ROTATE_PASSWORD === 'true',
    tempPassword: env.SMOKE_TEMP_PASSWORD || '',
    railwayToken: env.RAILWAY_TOKEN || env.RAILWAY_API_TOKEN || '',
    railwayServiceId: env.RAILWAY_SERVICE_ID || '',
    railwayEnvironmentId: env.RAILWAY_ENVIRONMENT_ID || '',
  };
}

/** Real HTTP transport over global fetch. Absolute URLs pass through; relative
 *  paths are resolved against baseUrl. Returns {status, json, headers}. */
function makeHttp(baseUrl) {
  return async function http(method, path, { headers = {}, body } = {}) {
    const url = /^https?:\/\//.test(path) ? path : `${baseUrl}${path}`;
    const res = await fetch(url, { method, headers, body, redirect: 'manual' });
    let json = null;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { _raw: text.slice(0, 300) };
    }
    return { status: res.status, json, headers: res.headers };
  };
}

async function main() {
  const config = loadConfig(process.env);
  const log = (line) => console.log(`[smoke] ${line}`);
  log(`target: ${config.baseUrl}`);
  log(`engagement: ${config.engagementId}`);
  if (!(config.username && config.password)) {
    log('NOTE: no SMOKE_USERNAME/SMOKE_PASSWORD — login + changePassword checks will be skipped (configure them to exercise auth).');
  }
  if (config.rotatePassword) {
    log('NOTE: SMOKE_ROTATE_PASSWORD=true — running rotate-and-restore. Ensure SMOKE_USERNAME is a DEDICATED smoke account, NOT your only login.');
  }

  const http = makeHttp(config.baseUrl);
  const { ok, results } = await runChecks({ http, config, log });

  console.log('\n[smoke] ── summary ──');
  for (const r of results) {
    const tag = r.ok ? 'PASS' : r.required ? 'FAIL' : 'WARN';
    console.log(`[smoke]   ${tag}  ${r.name}`);
  }

  if (ok) {
    console.log(`\n[smoke] GREEN — all required checks passed against ${config.baseUrl}.`);
    console.log(`[smoke] ALERT: deploy verified for "${config.engagementId}".`);
    console.log(`[smoke] Pattern-16 sign-off is the operator's: confirm with  operator approve live-verified:${config.engagementId}`);
    process.exit(0);
  }

  console.error(`\n[smoke] RED — one or more required checks FAILED against ${config.baseUrl}.`);
  const rollback = await performRollback({ http, config, log: (l) => console.error(`[smoke] ${l}`) });
  if (rollback.mode === 'auto-rollback') {
    console.error(`[smoke] AUTO-ROLLBACK ${rollback.ok ? 'requested' : 'attempt returned a non-OK response'} (deployment ${rollback.rolledBackTo}).`);
  } else {
    console.error(`[smoke] AUTO-ROLLBACK NOT PERFORMED (mode: ${rollback.mode}).${rollback.note ? ' ' + rollback.note : ''}`);
    console.error('[smoke] No RAILWAY_TOKEN configured for true auto-rollback. Manual rollback:');
  }
  console.error('\n' + rollback.instructions);
  console.error(`\n[smoke] ALERT: deploy FAILED smoke for "${config.engagementId}" — roll back and investigate.`);
  process.exit(1);
}

main().catch((err) => {
  console.error('[smoke] fatal:', err && err.stack ? err.stack : err);
  process.exit(1);
});
