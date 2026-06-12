/**
 * REVIEWER-ASYNC-DISPLAY-1 (Component C, C-2) — server lane contract + deadline sweep (source-audit).
 *
 * reviewSession.get returns the server-owned per-reviewer lane contract (condition 1); the denominator
 * is the immutable expected set (condition 2) and an unexpected reviewer's lane is excluded (condition
 * 11); the contract is null when there are no lanes so the SYNC display stays byte-for-byte (GUARD).
 * Component C owns its own per-lane deadline sweep (condition 4), gated on REVIEWER_ASYNC_ENABLED and
 * independent of JOB_REAPER_ENABLED, with start/stop/test-seam wiring.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');
const reviewSession = read('src/server/procedures/reviewSession.ts');
const dispatcher = read('src/server/jobs/dispatcher.ts');
const laneQueries = read('src/server/db/queries/reviewerLaneState.ts');

describe('C-2 — lane contract on reviewSession.get (condition 1)', () => {
  it('reads lanes and returns the contract additively alongside session/feedback/evaluation', () => {
    expect(reviewSession).toContain('const laneRows = await listReviewerLanesForSession(input.sessionId, userId);');
    expect(reviewSession).toContain('buildReviewerLanesContract(views)');
    expect(reviewSession).toContain('return { session, feedback, evaluation, lanes };');
  });
  it('the denominator is the immutable expected set; lanes is null when none exist (GUARD: sync unchanged)', () => {
    expect(reviewSession).toContain('let lanes: ReviewerLanesContract | null = null;');
    expect(reviewSession).toContain('if (laneRows.length > 0) {');
    expect(reviewSession).toContain('session.selectedReviewers.map((role) => {');
  });
  it('a lane for an unexpected reviewer is excluded from the denominator (condition 11)', () => {
    expect(reviewSession).toContain('excluded from the denominator');
    expect(reviewSession).toContain('expectedRoles.has(row.reviewerRole)');
  });
});

describe('C-2 — Component-C-owned lane deadline sweep (condition 4)', () => {
  it('a dedicated sweep gated on REVIEWER_ASYNC_ENABLED, NOT delegated to the B job-reaper', () => {
    expect(dispatcher).toContain('async function reapStaleLanesSweep()');
    expect(dispatcher).toContain('if (!isReviewerAsyncEnabled()) return;');
    expect(dispatcher).toContain('await reapStaleLanes(new Date(), systemCtx)');
  });
  it('is scheduled in startDispatcher and torn down in stopDispatcher (own timer)', () => {
    expect(dispatcher).toContain('if (isReviewerAsyncEnabled()) {');
    expect(dispatcher).toContain('scheduleLaneReaperSweep();');
    expect(dispatcher).toContain('clearTimeout(_laneReaperTimer);');
    expect(dispatcher).toContain('export async function runLaneReaperOnceForTest()');
  });
  it('the sweep reaps only NON-terminal lanes past their deadline -> orphaned_reaped (idempotent)', () => {
    expect(laneQueries).toContain("status: 'orphaned_reaped'");
    expect(laneQueries).toContain('lt(reviewerLanes.terminalDeadlineAt, staleBefore)');
    expect(laneQueries).toContain('inArray(reviewerLanes.status, NON_TERMINAL_LANE_STATUSES)');
  });
});
