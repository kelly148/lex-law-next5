/**
 * REVIEWER-ASYNC-FANOUT-1 — Increment 1
 *
 * Flag-gated async + progressive reviewer fan-out. When REVIEWER_ASYNC_ENABLED, reviewSession.create
 * fires each reviewer in the background (concurrent, not awaited) and returns immediately; otherwise
 * the established inline + sequential path runs unchanged.
 *
 * The create handler is a closure inside executeCanonicalMutation-based dispatch; direct invocation
 * needs broad tRPC/DB mocking. Per the house convention (mr1.llm1_s2 etc.), the dispatch WIRING is
 * pinned by source audit, and the flag accessor is unit-tested directly.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isReviewerAsyncEnabled } from '../config/featureFlags.js';

describe('isReviewerAsyncEnabled — default-OFF env flag', () => {
  const original = process.env['REVIEWER_ASYNC_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['REVIEWER_ASYNC_ENABLED'];
    else process.env['REVIEWER_ASYNC_ENABLED'] = original;
  });

  it('defaults OFF when unset', () => {
    delete process.env['REVIEWER_ASYNC_ENABLED'];
    expect(isReviewerAsyncEnabled()).toBe(false);
  });
  it('is ON only for the exact string "true"', () => {
    process.env['REVIEWER_ASYNC_ENABLED'] = 'true';
    expect(isReviewerAsyncEnabled()).toBe(true);
  });
  it('stays OFF for any other value (1, TRUE, yes, empty)', () => {
    for (const v of ['1', 'TRUE', 'yes', '', 'false']) {
      process.env['REVIEWER_ASYNC_ENABLED'] = v;
      expect(isReviewerAsyncEnabled(), v).toBe(false);
    }
  });
});

describe('reviewSession.create async dispatch wiring (source audit)', () => {
  const src = readFileSync(resolve('src/server/procedures/reviewSession.ts'), 'utf8');

  it('reads the async flag before the reviewer fan-out loop', () => {
    expect(src).toContain('const reviewerAsync = isReviewerAsyncEnabled();');
  });
  // DISPATCHER-COMPLETE-1 D-4: the params are extracted once, then dispatched by mode
  // (durable dispatcher when JOB_DISPATCHER_ENABLED; otherwise the established fire-and-forget /
  // sequential paths, byte-for-byte). Assertions updated for the new wiring; intent preserved.
  it('extracts the reviewer mutation params once, then dispatches by mode', () => {
    expect(src).toContain('const reviewerParams: CanonicalMutationParams = {');
  });
  it('routes async reviewers through the durable dispatcher when JOB_DISPATCHER_ENABLED', () => {
    expect(src).toContain('reviewerAsync && isJobDispatcherEnabled()');
    expect(src).toContain('await enqueueCanonicalJobForDispatcher(reviewerParams);');
  });
  it('launches an un-awaited promise (fire-and-forget) when async is ON and the dispatcher is OFF', () => {
    expect(src).toContain('} else if (reviewerAsync) {');
    expect(src).toContain('const reviewerResultPromise = executeCanonicalMutation(reviewerParams);');
    expect(src).toContain('void reviewerResultPromise.catch(');
  });
  it('preserves the inline + sequential path when async is OFF', () => {
    expect(src).toContain('const reviewerResult = await executeCanonicalMutation(reviewerParams);');
    expect(src).toContain('reviewerJobIds.push(reviewerResult.jobId);');
  });
  it('skips the advisory evaluator in async mode (it needs all reviewer feedback first)', () => {
    expect(src).toContain('!reviewerAsync && isEvaluatorEnabled() && input.selectedReviewers.length > 1');
  });
});
