/**
 * uat_f2_reviewer_concurrent_fanout_1.test.ts — REVIEWER-CONCURRENT-FANOUT-1 (F2)
 *
 * Monster UAT U5/U3 (P1, the headline): the default SYNC reviewSession.create ran reviewers in a sequential
 * for-loop (await each LLM + persist, then start the next), so an N-reviewer panel took ~N x the slowest
 * reviewer and a single flaky reviewer (e.g. Gemini timing out) blocked the whole create (~3 min observed).
 *
 * Fix (no quality change — same models, same prompts): dispatch the reviewers CONCURRENTLY via
 * Promise.allSettled. Each runDeferredCanonicalJob already runs under its own frozen timeoutMs + fresh
 * AbortController, so every reviewer has an independent timeout envelope and one slow/failing reviewer can no
 * longer block the others. create() now returns in ~the slowest single reviewer's time, not the sum, and
 * still degrades to the honest N-of-M. The async/outbox path (flag-gated) and the evaluator fan-in are
 * unchanged.
 *
 * Convention: source audit (per reviewer_async_fanout_1.test.ts — direct invocation of the create closure
 * needs broad tRPC/DB mocking; the dispatch WIRING is pinned here). True wall-clock behavior is an operator
 * live-test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(resolve('src/server/procedures/reviewSession.ts'), 'utf8');

// The SYNC branch (async OFF) — slice from the F2 marker to the evaluator fan-in that follows it.
function syncBranch(): string {
  return src.slice(
    src.indexOf('REVIEWER-CONCURRENT-FANOUT-1'),
    src.indexOf('EVALUATOR PATH'),
  );
}

describe('REVIEWER-CONCURRENT-FANOUT-1 (F2) — concurrent SYNC reviewer fan-out', () => {
  it('dispatches the reviewers CONCURRENTLY via Promise.allSettled (not a serial await-in-loop)', () => {
    const branch = syncBranch();
    expect(branch).toContain('await Promise.allSettled(');
    expect(branch).toContain('reviewers.map((r) => runDeferredCanonicalJob(r.jobId))');
    // the pre-F2 "await one reviewer, THEN start the next" shape is gone
    expect(branch).not.toContain('const result = await runDeferredCanonicalJob(r.jobId);');
  });

  it('registers every reviewer continuation BEFORE the concurrent dispatch', () => {
    const branch = syncBranch();
    const registerIdx = branch.indexOf('registerDeferredContinuation(r.jobId, buildReviewerCanonicalParams(r));');
    const dispatchIdx = branch.indexOf('await Promise.allSettled(');
    expect(registerIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(registerIdx);
  });

  it('isolates a failed reviewer: a rejection is logged and does NOT abort create or the others', () => {
    const branch = syncBranch();
    // allSettled never rejects; a rejected reviewer is handled in the else branch (logged), not rethrown.
    expect(branch).toContain("settled.status === 'fulfilled'");
    expect(branch).toContain('[reviewer-concurrent]');
    expect(branch).not.toContain('throw settled.reason');
  });

  it('counts only completed reviewers into reviewerJobIds (honest N-of-M), in reviewer order', () => {
    const branch = syncBranch();
    expect(branch).toContain("settled.value?.status === 'completed'");
    expect(branch).toContain('reviewerJobIds.push(reviewers[i]!.jobId)');
  });

  it('still records the settled partial reason after ALL reviewers complete', () => {
    const branch = syncBranch();
    expect(branch).toContain('const anyFailed = reviewerJobIds.length < reviewers.length;');
    expect(branch).toContain("setReviewSessionSettled(sessionId, userId, anyFailed ? 'non_response' : null)");
  });

  it('does NOT change models/prompts/timeout — per-reviewer timeoutMs is still frozen at 300_000 (sync)', () => {
    expect(src).toContain('timeoutMs: 300_000');
  });

  it('leaves the async/outbox path (flag-gated) unchanged — still fire-and-forget background dispatch', () => {
    // async branch keeps the non-awaited void run; F2 only touched the sync branch.
    expect(src).toContain('void runDeferredCanonicalJob(r.jobId)');
    expect(src).toContain('const reviewerAsync = isReviewerAsyncEnabled();');
  });

  it('keeps the evaluator fan-in gated + positioned AFTER the awaited fan-out', () => {
    expect(src).toContain('!reviewerAsync && isEvaluatorEnabled() && input.selectedReviewers.length > 1');
    const allSettledIdx = src.indexOf('await Promise.allSettled(');
    const evaluatorIdx = src.indexOf('!reviewerAsync && isEvaluatorEnabled()');
    expect(evaluatorIdx).toBeGreaterThan(allSettledIdx);
  });
});
