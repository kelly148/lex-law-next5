/**
 * mr3.reviewState.test.ts — MR-3 §S6a, §S6c, §S6d
 *
 * Pure-function unit tests for deriveCompletionState.
 * Covers all four states and all edge cases specified in §S6a.
 *
 * §S6a  — State derivation function (S1a)
 * §S6c  — Failed-review handling (S2 / Option β)
 * §S6d  — Empty-feedback differentiation (S3)
 */

import { describe, it, expect } from 'vitest';
import {
  deriveCompletionState,
  type FeedbackRowLike,
  type PublicJobLike,
} from '../reviewState.js';

// ============================================================
// Helpers
// ============================================================

const noFeedback: FeedbackRowLike[] = [];
const noJobs: PublicJobLike[] = [];

function feedbackWithSuggestions(count: number): FeedbackRowLike[] {
  return [{ suggestions: Array.from({ length: count }, (_, i) => ({ id: `s${i}` })) }];
}

function feedbackEmpty(): FeedbackRowLike[] {
  return [{ suggestions: [] }];
}

function job(jobType: string, status: string): PublicJobLike {
  return { jobType, status };
}

// ============================================================
// §S6a — State derivation: all four states
// ============================================================

describe('deriveCompletionState — §S6a', () => {
  // ── PENDING_OR_RUNNING ────────────────────────────────────

  it('returns pending_or_running when no feedback and no jobs', () => {
    expect(deriveCompletionState(noFeedback, noJobs)).toBe('pending_or_running');
  });

  it('returns pending_or_running when no feedback and job is queued', () => {
    expect(deriveCompletionState(noFeedback, [job('reviewer_feedback', 'queued')])).toBe('pending_or_running');
  });

  it('returns pending_or_running when no feedback and job is running', () => {
    expect(deriveCompletionState(noFeedback, [job('reviewer_feedback', 'running')])).toBe('pending_or_running');
  });

  it('returns pending_or_running when no feedback and job is completed (no feedback row yet — race window)', () => {
    // "Absence of feedback is not failure." Completed status without a feedback row
    // is treated as pending (brief race window before txn2Commit inserts the row).
    expect(deriveCompletionState(noFeedback, [job('reviewer_feedback', 'completed')])).toBe('pending_or_running');
  });

  // ── COMPLETED_WITH_FEEDBACK ───────────────────────────────

  it('returns completed_with_feedback when feedback row has suggestions', () => {
    expect(deriveCompletionState(feedbackWithSuggestions(3), noJobs)).toBe('completed_with_feedback');
  });

  it('returns completed_with_feedback when feedback row has 1 suggestion', () => {
    expect(deriveCompletionState(feedbackWithSuggestions(1), noJobs)).toBe('completed_with_feedback');
  });

  it('returns completed_with_feedback even when a failed job also exists (feedback row wins)', () => {
    // Feedback row is the authoritative signal — job status is irrelevant once feedback exists.
    expect(
      deriveCompletionState(feedbackWithSuggestions(2), [job('reviewer_feedback', 'failed')])
    ).toBe('completed_with_feedback');
  });

  // ── COMPLETED_WITHOUT_FEEDBACK (path a) ──────────────────

  it('returns completed_without_feedback when feedback row has empty suggestions (path a)', () => {
    // MR-1 always inserts a feedback row even for empty suggestions (P9 verified).
    expect(deriveCompletionState(feedbackEmpty(), noJobs)).toBe('completed_without_feedback');
  });

  it('returns completed_without_feedback when feedback row has empty suggestions and job is completed', () => {
    expect(
      deriveCompletionState(feedbackEmpty(), [job('reviewer_feedback', 'completed')])
    ).toBe('completed_without_feedback');
  });

  it('returns completed_without_feedback when feedback row has empty suggestions even with failed job (feedback wins)', () => {
    expect(
      deriveCompletionState(feedbackEmpty(), [job('reviewer_feedback', 'failed')])
    ).toBe('completed_without_feedback');
  });

  // ── FAILED ───────────────────────────────────────────────

  it('returns failed when no feedback and reviewer_feedback job is failed', () => {
    expect(deriveCompletionState(noFeedback, [job('reviewer_feedback', 'failed')])).toBe('failed');
  });

  it('returns failed when no feedback and reviewer_feedback job is timed_out', () => {
    expect(deriveCompletionState(noFeedback, [job('reviewer_feedback', 'timed_out')])).toBe('failed');
  });

  it('returns failed when no feedback and reviewer_feedback job is cancelled', () => {
    expect(deriveCompletionState(noFeedback, [job('reviewer_feedback', 'cancelled')])).toBe('failed');
  });

  it('returns failed when multiple jobs exist and at least one reviewer_feedback job is failed', () => {
    expect(
      deriveCompletionState(noFeedback, [
        job('draft_generation', 'completed'),
        job('reviewer_feedback', 'failed'),
      ])
    ).toBe('failed');
  });
});

// ============================================================
// §S6a — Edge cases
// ============================================================

describe('deriveCompletionState — §S6a edge cases', () => {
  it('edge: null jobStatus (no jobs) — returns pending_or_running, not failed', () => {
    // "Absence of feedback is not failure" — no job at all means pending.
    expect(deriveCompletionState(noFeedback, noJobs)).toBe('pending_or_running');
  });

  it('edge: empty feedback array with no job status must NOT be inferred as completed_without_feedback', () => {
    // The empty array [] is "no feedback rows" — not a feedback row with empty suggestions.
    // This must remain pending_or_running.
    expect(deriveCompletionState([], noJobs)).toBe('pending_or_running');
  });

  it('edge: non-reviewer_feedback jobs in terminal failure do NOT trigger failed state', () => {
    // Only reviewer_feedback job type is relevant for this state derivation.
    expect(
      deriveCompletionState(noFeedback, [
        job('draft_generation', 'failed'),
        job('regeneration', 'timed_out'),
      ])
    ).toBe('pending_or_running');
  });

  it('edge: mixed conditions — feedback row present with suggestions takes precedence over failed job', () => {
    // Feedback row is the highest-priority signal.
    expect(
      deriveCompletionState(feedbackWithSuggestions(1), [job('reviewer_feedback', 'failed')])
    ).toBe('completed_with_feedback');
  });

  it('edge: multiple feedback rows — uses first row for suggestion count (MR-0G: at most one reviewer)', () => {
    // With MR-0G in effect, there should be at most one feedback row per session.
    // The helper uses feedback[0] per the documented contract.
    const multipleFeedback: FeedbackRowLike[] = [
      { suggestions: [{ id: 's1' }] },
      { suggestions: [] },
    ];
    expect(deriveCompletionState(multipleFeedback, noJobs)).toBe('completed_with_feedback');
  });

  it('edge: reviewer_feedback job completed but no feedback row yet — pending_or_running (race window)', () => {
    // Brief window between job completion and txn2Commit inserting the feedback row.
    // Must not be treated as completed_without_feedback.
    expect(
      deriveCompletionState(noFeedback, [job('reviewer_feedback', 'completed')])
    ).toBe('pending_or_running');
  });
});

// ============================================================
// §S6c — Failed-review handling (S2 / Option β)
// ============================================================

describe('deriveCompletionState — §S6c failed-review handling', () => {
  it('Option β: derives FAILED from job status alone, no schema migration required', () => {
    // Option β: use existing job.poll endpoint to detect terminal failure.
    // No reviewerJobId column on review_sessions needed.
    const jobs: PublicJobLike[] = [
      { jobType: 'reviewer_feedback', status: 'failed' },
    ];
    expect(deriveCompletionState([], jobs)).toBe('failed');
  });

  it('Option β: timed_out is a terminal failure status', () => {
    expect(deriveCompletionState([], [{ jobType: 'reviewer_feedback', status: 'timed_out' }])).toBe('failed');
  });

  it('Option β: cancelled is a terminal failure status', () => {
    expect(deriveCompletionState([], [{ jobType: 'reviewer_feedback', status: 'cancelled' }])).toBe('failed');
  });

  it('Option β: queued and running are NOT terminal failure statuses', () => {
    expect(deriveCompletionState([], [{ jobType: 'reviewer_feedback', status: 'queued' }])).toBe('pending_or_running');
    expect(deriveCompletionState([], [{ jobType: 'reviewer_feedback', status: 'running' }])).toBe('pending_or_running');
  });
});

// ============================================================
// §S6d — Empty-feedback differentiation (S3)
// ============================================================

describe('deriveCompletionState — §S6d empty-feedback differentiation', () => {
  it('distinguishes empty-suggestions feedback from no-feedback (pending)', () => {
    const pending = deriveCompletionState([], []);
    const emptyFeedback = deriveCompletionState([{ suggestions: [] }], []);
    expect(pending).toBe('pending_or_running');
    expect(emptyFeedback).toBe('completed_without_feedback');
    expect(pending).not.toBe(emptyFeedback);
  });

  it('distinguishes empty-suggestions feedback from with-feedback', () => {
    const withFeedback = deriveCompletionState([{ suggestions: [{ id: 's1' }] }], []);
    const emptyFeedback = deriveCompletionState([{ suggestions: [] }], []);
    expect(withFeedback).toBe('completed_with_feedback');
    expect(emptyFeedback).toBe('completed_without_feedback');
    expect(withFeedback).not.toBe(emptyFeedback);
  });

  it('all four states are mutually exclusive for canonical inputs', () => {
    const states = [
      deriveCompletionState([], []),                                                          // pending
      deriveCompletionState([{ suggestions: [{ id: 's1' }] }], []),                          // with_feedback
      deriveCompletionState([{ suggestions: [] }], []),                                       // without_feedback
      deriveCompletionState([], [{ jobType: 'reviewer_feedback', status: 'failed' }]),        // failed
    ];
    const unique = new Set(states);
    expect(unique.size).toBe(4);
  });
});
