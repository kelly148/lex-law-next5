/**
 * ASYNC-DRAFT-DISPATCH-1 (F3) — flag accessor + dispatch-wiring source-audit.
 *
 * The behavioral path is the SAME runJob half the synchronous draft path already uses (and that the F2
 * reviewer async tests cover behaviorally) — only the await timing moves. So this locks (a) the flag
 * default-OFF / exact-'true' semantics, and (b) the wiring: each draft mutation branches on the flag,
 * the ON branch enqueues 'queued' + fire-and-forgets runDeferredCanonicalJob (with a .catch) + returns
 * status:'queued', and the OFF branch keeps the byte-for-byte synchronous executeCanonicalMutation path.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isAsyncDraftDispatchEnabled } from '../config/featureFlags.js';

const FLAG = 'ASYNC_DRAFT_DISPATCH_ENABLED';
let saved: string | undefined;
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});
function setFlag(v: string | undefined): void {
  saved ??= process.env[FLAG];
  if (v === undefined) delete process.env[FLAG];
  else process.env[FLAG] = v;
}

describe('ASYNC-DRAFT-DISPATCH-1 — flag accessor (default OFF, exact "true")', () => {
  it('defaults OFF when unset', () => {
    setFlag(undefined);
    expect(isAsyncDraftDispatchEnabled()).toBe(false);
  });
  it('is ON only for the exact string "true"', () => {
    setFlag('true');
    expect(isAsyncDraftDispatchEnabled()).toBe(true);
    for (const v of ['false', 'TRUE', '1', 'yes', '']) {
      setFlag(v);
      expect(isAsyncDraftDispatchEnabled()).toBe(false);
    }
  });
});

const repoRoot = resolve(__dirname, '../../..');
const read = (p: string): string => readFileSync(resolve(repoRoot, p), 'utf8');

describe('ASYNC-DRAFT-DISPATCH-1 — dispatch wiring (source-audit)', () => {
  const docs = read('src/server/procedures/documents4a.ts');
  const generateBlock = docs.slice(docs.indexOf('generateDraft: protectedProcedure'), docs.indexOf('regenerate: protectedProcedure'));
  const regenerateBlock = docs.slice(docs.indexOf('regenerate: protectedProcedure'), docs.indexOf('detach: protectedProcedure'));

  it('the flag is read from ASYNC_DRAFT_DISPATCH_ENABLED', () => {
    const ff = read('src/server/config/featureFlags.ts');
    expect(ff).toContain('export function isAsyncDraftDispatchEnabled()');
    expect(ff).toContain("process.env['ASYNC_DRAFT_DISPATCH_ENABLED'] === 'true'");
  });

  it('generateDraft: flag-ON async branch (enqueue queued + detached run + status queued) AND flag-OFF sync fallback', () => {
    expect(generateBlock).toContain('if (isAsyncDraftDispatchEnabled())');
    expect(generateBlock).toContain('enqueueCanonicalJobForDispatcher(draftParams)');
    expect(generateBlock).toContain('void runDeferredCanonicalJob(jobId).catch('); // fire-and-forget, never unhandled
    expect(generateBlock).toContain("status: 'queued' as const");
    // the synchronous default path remains (R4 chokepoint + byte-for-byte when the flag is off):
    expect(generateBlock).toContain('executeCanonicalMutation(draftParams)');
  });

  it('regenerate: same flag-gated async branch + sync fallback', () => {
    expect(regenerateBlock).toContain('if (isAsyncDraftDispatchEnabled())');
    expect(regenerateBlock).toContain('enqueueCanonicalJobForDispatcher(regenParams)');
    expect(regenerateBlock).toContain('void runDeferredCanonicalJob(jobId).catch(');
    expect(regenerateBlock).toContain("status: 'queued' as const");
    expect(regenerateBlock).toContain('executeCanonicalMutation(regenParams)');
  });
});
