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

  // EGRESS-CONTROL-PLANE-1 Inc 2 (durable outbox) SUPERSEDED the original three-way fork (inline /
  // dispatcher / fire-and-forget). create now commits session + lanes + ALL reviewer jobs(queued, with
  // reconstruction input) ATOMICALLY, then transmits post-commit via the reusable factory through the
  // SAME deferred runner; the fragile fire-and-forget path is RETIRED. Assertions updated to the new
  // wiring; the async-vs-sync intent is preserved.
  it('reads the async flag before the reviewer fan-out', () => {
    expect(src).toContain('const reviewerAsync = isReviewerAsyncEnabled();');
  });
  it('builds per-reviewer durable input (frozen prompt + reconstruction params) for the outbox', () => {
    expect(src).toContain('const reviewers: ReviewerDurableInput[] = input.selectedReviewers.map((reviewerRole) => {');
    expect(src).toContain('jobId: uuidv4(),');
  });
  it('commits the outbox atomically (session + lanes + jobs in one transaction)', () => {
    expect(src).toContain('await db.transaction(async (tx) => {');
    expect(src).toContain('await insertJob(buildReviewerJobRow(r), tx);');
  });
  it('async transmit registers the continuation + kicks a background deferred run (durable; no fire-and-forget)', () => {
    expect(src).toContain('registerDeferredContinuation(r.jobId, buildReviewerCanonicalParams(r));');
    expect(src).toContain('void runDeferredCanonicalJob(r.jobId)');
    expect(src).not.toContain('const reviewerResultPromise = executeCanonicalMutation(reviewerParams);');
  });
  it('preserves the inline + sequential SYNC path (awaited deferred run) when async is OFF', () => {
    expect(src).toContain('const result = await runDeferredCanonicalJob(r.jobId);');
    expect(src).toContain('reviewerJobIds.push(r.jobId);');
  });
  it('skips the advisory evaluator in async mode (it needs all reviewer feedback first)', () => {
    expect(src).toContain('!reviewerAsync && isEvaluatorEnabled() && input.selectedReviewers.length > 1');
  });
});
