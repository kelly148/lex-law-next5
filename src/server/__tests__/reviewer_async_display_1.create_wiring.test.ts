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
// EGRESS-CONTROL-PLANE-1 Inc 2 (durable outbox): the reviewer EXECUTION runtime contract
// (txn2Commit/txn2Revert/onRunning/buildLlmParams) moved OUT of reviewSession.ts INTO the reusable
// reviewer-job factory, so the per-reviewer terminalization audits now read the factory.
const reviewerFactory = read('src/server/jobs/reviewerJobFactory.ts');
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
    // EGRESS-CONTROL-PLANE-1 Inc 2 (durable outbox): the lane set is now mapped from the per-reviewer
    // durable-input array (reviewers), built once and shared with the atomic outbox jobs — was the inline
    // `input.selectedReviewers.map((role) => ({`. Still one lane per selected reviewer, async-gated.
    expect(reviewSession).toContain('reviewers.map((r) => ({');
    // stamped with C's own terminal-deadline (condition 4)
    expect(reviewSession).toContain('terminalDeadlineAt: laneDeadlineAt');
    expect(reviewSession).toContain('REVIEWER_LANE_TERMINAL_DEADLINE_MS');
  });
});

describe('C-1 — lanes terminalize from job completion (conditions 3/4/5/10)', () => {
  // EGRESS-CONTROL-PLANE-1 Inc 2 (durable outbox): the reviewer txn2Commit/txn2Revert runtime contract
  // moved OUT of reviewSession.ts INTO reviewerJobFactory.ts (buildReviewerCanonicalParams), reused
  // verbatim by create AND the dispatcher's restart reconstruction. The terminalization audits now read
  // the factory; note the factory's closure parameter is `reviewSessionId` (was the inline `sessionId`).
  it('txn2Commit terminalizes the lane AFTER insertFeedback, with affirmative zero-result', () => {
    // condition 10: the lane id is captured from insertFeedback's return (no terminal without a row)
    expect(reviewerFactory).toContain('const feedbackRowId = await insertFeedback({');
    expect(reviewerFactory).toContain('markReviewerLaneTerminal(reviewSessionId, reviewerRole, userId, {');
    // condition 5: affirmative zero-result vocabulary
    expect(reviewerFactory).toContain("? 'completed_with_feedback' : 'completed_without_feedback'");
    expect(reviewerFactory).toContain('suggestionCount: suggestions.length');
  });
  it('txn2Revert terminalizes the lane failed/timed_out', () => {
    expect(reviewerFactory).toContain("status: errorClass === 'timeout' ? 'timed_out' : 'failed'");
  });
  it('create commits each reviewer job into the atomic outbox and transmits it via the deferred path', () => {
    // EGRESS-CONTROL-PLANE-1 Inc 2 (durable outbox): the old enqueue-failure dispatch_failed lane
    // terminalization and the fork's enqueueCanonicalJobForDispatcher(reviewerParams) are RETIRED. Create
    // now ALWAYS commits the reviewer job row(s) ATOMICALLY in the outbox tx (no external dispatch inside
    // the tx, so an enqueue-failure path no longer exists), then transmits POST-COMMIT via the deferred
    // continuation path. Preserve the original intent — that create durably wires every reviewer's
    // dispatch — by asserting the NEW outbox transmit wiring.
    expect(reviewSession).toContain('await insertJob(buildReviewerJobRow(r), tx);');
    expect(reviewSession).toContain('registerDeferredContinuation(r.jobId, buildReviewerCanonicalParams(r));');
    expect(reviewSession).toContain('runDeferredCanonicalJob(r.jobId)');
  });
});

describe('C-1 — GUARD: every lane write is async-gated (sync writes no lanes)', () => {
  it('the inline (sync) dispatch path runs each reviewer to terminal and writes NO lanes when reviewerAsync is false', () => {
    // EGRESS-CONTROL-PLANE-1 Inc 2 (durable outbox): the sync path no longer forks to
    // executeCanonicalMutation(reviewerParams)/reviewerJobIds.push(reviewerResult.jobId) (RETIRED). It now
    // runs each committed reviewer job to terminal via the SAME deferred path, BLOCKING — preserve the
    // original intent (the sync inline path runs reviewers to terminal in-band) by asserting the new call.
    expect(reviewSession).toContain('const result = await runDeferredCanonicalJob(r.jobId);');
    expect(reviewSession).toContain('reviewerJobIds.push(r.jobId);');
    // GUARD (unchanged intent): the ONLY lane write in create — insertReviewerLanes — sits inside the
    // `if (reviewerAsync)` guard, so the SYNC path writes no lanes (its display path stays byte-for-byte
    // unchanged). The terminal/revert lane writes moved to the factory and are themselves async-gated
    // (`if (isAsync)` there), so no lane write is ever reachable on the sync path.
    const guardIdx = reviewSession.indexOf('if (reviewerAsync) {');
    const laneInsertIdx = reviewSession.indexOf('await insertReviewerLanes(');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(laneInsertIdx).toBeGreaterThan(guardIdx);
    // create itself no longer terminalizes lanes (that moved to the factory) and never dispatch-fails one
    expect(reviewSession).not.toContain('markReviewerLaneTerminal(');
    expect(reviewSession).not.toContain('markReviewerLaneDispatchFailed(');
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
