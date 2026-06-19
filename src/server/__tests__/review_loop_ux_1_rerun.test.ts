/**
 * REVIEW-LOOP-UX-1 R2 — single-reviewer re-run: the re-runnable-lane predicate.
 *
 * Both the server (reviewSession.rerunReviewer guard + resetReviewerLaneForRerun's inArray guard) and the
 * client (AsyncLaneReviewView's button) gate the re-run on isLaneRerunnable. Re-run is OFFERED only for
 * no-usable-feedback terminal lanes — the FAILURE class (failed/timed_out/dispatch_failed/orphaned_reaped/
 * canceled) + blocked_by_hold — so nothing returned/adopted is discarded. It is NEVER offered for a
 * completed_with_feedback lane (its feedback may be adopted), a completed_without_feedback lane, or a
 * still-in-flight (non-terminal) lane.
 */
import { describe, it, expect } from 'vitest';
import {
  isLaneRerunnable,
  RERUNNABLE_LANE_STATUSES,
  REVIEWER_LANE_STATUS_VALUES,
  TERMINAL_LANE_STATUSES,
  FAILURE_LANE_STATUSES,
  type ReviewerLaneStatus,
} from '../../shared/schemas/reviewerLaneState.js';

describe('REVIEW-LOOP-UX-1 R2 — isLaneRerunnable / RERUNNABLE_LANE_STATUSES', () => {
  it('re-runnable = ONLY statuses whose job is guaranteed terminal with no feedback row', () => {
    // failed/timed_out/canceled (txn2Revert or cancel terminalized the job) + blocked_by_hold (egress gate
    // cancelled the job). Each has a terminal job and no feedback -> safe to reuse the slot.
    const expected: ReviewerLaneStatus[] = ['failed', 'timed_out', 'canceled', 'blocked_by_hold'];
    for (const s of expected) expect(isLaneRerunnable(s)).toBe(true);
    expect(RERUNNABLE_LANE_STATUSES.size).toBe(expected.length);
  });

  it('NOT re-runnable: completed_with_feedback / completed_without_feedback (no returned feedback is discarded)', () => {
    expect(isLaneRerunnable('completed_with_feedback')).toBe(false);
    expect(isLaneRerunnable('completed_without_feedback')).toBe(false);
  });

  it('NOT re-runnable: orphaned_reaped / dispatch_failed — terminal LANE but DECOUPLED, unknown JOB state', () => {
    // The lane reaper / dispatch-failure terminalize the LANE but not the JOB: it may still be queued (a
    // re-run would run the STALE prompt vs the OLD draft) or completed-with-feedback (duplicate feedback).
    // Excluded for safety even though both ARE in the FAILURE class.
    expect(isLaneRerunnable('orphaned_reaped')).toBe(false);
    expect(isLaneRerunnable('dispatch_failed')).toBe(false);
  });

  it('NOT re-runnable: any non-terminal lane (a re-run only applies to a settled lane)', () => {
    for (const s of ['pending', 'dispatched', 'running'] as const) {
      expect(isLaneRerunnable(s)).toBe(false);
    }
  });

  it('every re-runnable status is TERMINAL', () => {
    for (const s of RERUNNABLE_LANE_STATUSES) expect(TERMINAL_LANE_STATUSES.has(s)).toBe(true);
  });

  it('re-runnable ⊆ (FAILURE class ∪ {blocked_by_hold}); blocked_by_hold is NOT a failure; reaped/dispatch_failed are excluded', () => {
    for (const s of RERUNNABLE_LANE_STATUSES) {
      expect(FAILURE_LANE_STATUSES.has(s) || s === 'blocked_by_hold').toBe(true);
    }
    expect(RERUNNABLE_LANE_STATUSES.has('blocked_by_hold')).toBe(true);
    expect(FAILURE_LANE_STATUSES.has('blocked_by_hold')).toBe(false);
    // job-state-uncertain failure statuses are deliberately NOT re-runnable
    expect(FAILURE_LANE_STATUSES.has('orphaned_reaped')).toBe(true);
    expect(RERUNNABLE_LANE_STATUSES.has('orphaned_reaped')).toBe(false);
    expect(RERUNNABLE_LANE_STATUSES.has('dispatch_failed')).toBe(false);
  });

  it('classifies every status in the vocabulary (no status is unhandled)', () => {
    for (const s of REVIEWER_LANE_STATUS_VALUES) {
      expect(typeof isLaneRerunnable(s)).toBe('boolean');
    }
  });
});
