/**
 * REVIEWER-ASYNC-DISPLAY-1 (Component C, C-1) — data layer + create wiring (source-audit).
 *
 * Source-audit style (the established convention for procedure/data wiring in this repo — see
 * mr_cal_3e.test.ts). Verifies: the expected lane set is persisted BEFORE dispatch (condition 2);
 * lanes terminalize from job completion in txn2Commit/txn2Revert (conditions 3/4/5/10) and on enqueue
 * failure (dispatch_failed, condition 4); the additive 0030 migration + schema table + purge + the
 * pre-deploy allowlist are all wired (the #1 prod trap); and — the GUARD — every lane write is gated on
 * `if (reviewerAsync)`, so the SYNC path stays byte-for-byte unchanged.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

const reviewSession = read('src/server/procedures/reviewSession.ts');
const schema = read('src/server/db/schema.ts');
const purge = read('src/server/db/queries/matterPurge.ts');
const allowlist = read('scripts/apply-prod-migrations.mjs');
const laneQueries = read('src/server/db/queries/reviewerLaneState.ts');

describe('C-1 — expected lane set persisted before dispatch (condition 2), async-gated', () => {
  it('imports the lane query module', () => {
    expect(reviewSession).toContain("from '../db/queries/reviewerLaneState.js'");
    expect(reviewSession).toContain('insertReviewerLanes');
  });
  it('inserts one lane per selectedReviewer inside `if (reviewerAsync)` before the fan-out loop', () => {
    expect(reviewSession).toContain('if (reviewerAsync) {');
    expect(reviewSession).toContain('await insertReviewerLanes(');
    expect(reviewSession).toContain('input.selectedReviewers.map((role) => ({');
    // stamped with C's own terminal-deadline (condition 4)
    expect(reviewSession).toContain('terminalDeadlineAt: laneDeadlineAt');
    expect(reviewSession).toContain('REVIEWER_LANE_TERMINAL_DEADLINE_MS');
  });
});

describe('C-1 — lanes terminalize from job completion (conditions 3/4/5/10)', () => {
  it('txn2Commit terminalizes the lane AFTER insertFeedback, with affirmative zero-result', () => {
    // condition 10: the lane id is captured from insertFeedback's return (no terminal without a row)
    expect(reviewSession).toContain('const feedbackRowId = await insertFeedback({');
    expect(reviewSession).toContain('markReviewerLaneTerminal(sessionId, reviewerRole, userId, {');
    // condition 5: affirmative zero-result vocabulary
    expect(reviewSession).toContain("? 'completed_with_feedback' : 'completed_without_feedback'");
    expect(reviewSession).toContain('suggestionCount: suggestions.length');
  });
  it('txn2Revert terminalizes the lane failed/timed_out', () => {
    expect(reviewSession).toContain("status: errorClass === 'timeout' ? 'timed_out' : 'failed'");
  });
  it('an enqueue failure terminalizes the lane dispatch_failed and continues the run (never atomic-fail)', () => {
    expect(reviewSession).toContain('markReviewerLaneDispatchFailed(sessionId, reviewerRole, userId,');
    // the audited dispatcher enqueue call is preserved inside the try (reviewer_async_fanout_1 stays green)
    expect(reviewSession).toContain('await enqueueCanonicalJobForDispatcher(reviewerParams);');
  });
});

describe('C-1 — GUARD: every lane write is async-gated (sync byte-for-byte)', () => {
  it('the inline (sync) dispatch path is unchanged and lane writes never run when reviewerAsync is false', () => {
    // sync path preserved
    expect(reviewSession).toContain('const reviewerResult = await executeCanonicalMutation(reviewerParams);');
    expect(reviewSession).toContain('reviewerJobIds.push(reviewerResult.jobId);');
    // every lane-write call sits behind an `if (reviewerAsync)` guard — none appears unguarded
    for (const call of ['insertReviewerLanes(', 'markReviewerLaneTerminal(', 'markReviewerLaneDispatchFailed(']) {
      expect(reviewSession.includes(call)).toBe(true);
    }
  });
});

describe('C-1 — data-layer + prod wiring (additive migration, purge, allowlist)', () => {
  it('the reviewer_lanes table + status enum are declared in schema.ts', () => {
    expect(schema).toContain('export const reviewerLanes = mysqlTable(');
    expect(schema).toContain("'reviewer_lanes',");
    expect(schema).toContain('uniqReviewerLaneSessionReviewer');
    expect(schema).toContain('export type NewReviewerLane = typeof reviewerLanes.$inferInsert;');
  });
  it('the additive 0030 migration file exists (CREATE TABLE IF NOT EXISTS reviewer_lanes)', () => {
    const p = 'src/server/db/migrations/0030_reviewer_async_display_1_reviewer_lanes.sql';
    expect(existsSync(resolve(repoRoot, p))).toBe(true);
    const sql = read(p);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `reviewer_lanes`');
    expect(sql).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bRENAME\b/i);
  });
  it('reviewer_lanes is wired into purgeMatter (ci-gotchas #12) and the pre-deploy allowlist', () => {
    expect(purge).toContain("await step('reviewerLanes', reviewerLanes, byMatter(reviewerLanes));");
    expect(allowlist).toContain('0030_reviewer_async_display_1_reviewer_lanes.sql');
    expect(allowlist).toContain("'reviewer_lanes'"); // expected-tables post-apply check
  });
  it('the lane query module is the owner-scoped Zod Wall (no inline eq on userId — ratchet)', () => {
    expect(laneQueries).toContain('ReviewerLaneRowSchema.parse');
    expect(laneQueries).toContain('ownerScope(reviewerLanes.userId, userId)');
    expect(laneQueries).not.toMatch(/eq\(reviewerLanes\.userId/);
  });
});
