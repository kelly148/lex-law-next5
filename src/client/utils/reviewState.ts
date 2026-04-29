/**
 * reviewState.ts — MR-3 §S1a
 *
 * Pure helper for deriving the UI completion state of a review session's
 * feedback area. Exported as a standalone utility so it can be unit-tested
 * independently of any React component.
 *
 * Four discrete states:
 *
 *   PENDING_OR_RUNNING          — job dispatched, may still be executing;
 *                                  no terminal signal yet.
 *   COMPLETED_WITH_FEEDBACK     — feedback row exists with suggestions.length > 0.
 *   COMPLETED_WITHOUT_FEEDBACK  — feedback row exists with suggestions.length === 0
 *                                  (path (a): MR-1 always inserts a row, even for
 *                                  empty suggestions arrays — P9 verified).
 *   FAILED                      — reviewer job reached a terminal failure status
 *                                  ('failed' | 'timed_out' | 'cancelled') and no
 *                                  feedback row exists for this session+iteration.
 *
 * Source-of-truth rules (§S1a):
 *
 *   COMPLETED_WITH_FEEDBACK:    feedback.length > 0 AND feedback[0].suggestions.length > 0
 *   COMPLETED_WITHOUT_FEEDBACK: feedback.length > 0 AND feedback[0].suggestions.length === 0
 *   FAILED:                     no feedback row AND at least one reviewer_feedback job
 *                                for this document is in a terminal failure status
 *                                ('failed' | 'timed_out' | 'cancelled').
 *   PENDING_OR_RUNNING:         all other cases (session is active, no terminal signal).
 *
 * "Absence of feedback is not failure" — the FAILED state requires an explicit
 * terminal failure job status. Without that signal, the state is PENDING_OR_RUNNING.
 *
 * Ch 35.3 — No business logic in React. This module is the authoritative
 * state-derivation layer; ReviewPane.tsx must not re-derive state inline.
 */

// ============================================================
// Types
// ============================================================

/** The four discrete UI completion states for a review session's feedback area. */
export type CompletionState =
  | 'pending_or_running'
  | 'completed_with_feedback'
  | 'completed_without_feedback'
  | 'failed';

/**
 * Minimal shape of a feedback row as returned by reviewSession.get.
 * Only the fields needed for state derivation are required here.
 */
export interface FeedbackRowLike {
  suggestions: Array<unknown>;
}

/**
 * Minimal shape of a public job as returned by job.poll.
 * Only the fields needed for state derivation are required here.
 */
export interface PublicJobLike {
  jobType: string;
  status: string;
}

// ============================================================
// Terminal failure statuses for reviewer jobs
// ============================================================

/** Job statuses that indicate a terminal failure (not recoverable without user action). */
const TERMINAL_FAILURE_STATUSES = new Set(['failed', 'timed_out', 'cancelled']);

// ============================================================
// deriveCompletionState
// ============================================================

/**
 * Derive the UI completion state for a review session's feedback area.
 *
 * @param feedback   - Array of feedback rows for this session+iteration
 *                     (from reviewSession.get response).
 * @param jobs       - Array of public jobs for this document
 *                     (from job.poll response, filtered to reviewer_feedback type).
 *                     Pass an empty array if job data is not yet loaded.
 * @returns          CompletionState
 *
 * @example
 *   // Completed with suggestions
 *   deriveCompletionState([{ suggestions: [{ ... }] }], [])
 *   // → 'completed_with_feedback'
 *
 *   // Completed with empty suggestions (MR-1 path (a))
 *   deriveCompletionState([{ suggestions: [] }], [])
 *   // → 'completed_without_feedback'
 *
 *   // Failed job, no feedback row
 *   deriveCompletionState([], [{ jobType: 'reviewer_feedback', status: 'failed' }])
 *   // → 'failed'
 *
 *   // Still running
 *   deriveCompletionState([], [{ jobType: 'reviewer_feedback', status: 'running' }])
 *   // → 'pending_or_running'
 *
 *   // No data yet
 *   deriveCompletionState([], [])
 *   // → 'pending_or_running'
 */
export function deriveCompletionState(
  feedback: FeedbackRowLike[],
  jobs: PublicJobLike[],
): CompletionState {
  // ── Step 1: Feedback-row signals (highest priority) ──────────────────────
  // If a feedback row exists, the job completed (txn2Commit ran).
  // MR-1 always inserts a row — even for empty suggestions (P9 verified).
  if (feedback.length > 0) {
    // Use the first feedback row; MR-0G ensures at most one reviewer per session.
    const hasSuggestions = feedback[0]!.suggestions.length > 0;
    return hasSuggestions ? 'completed_with_feedback' : 'completed_without_feedback';
  }

  // ── Step 2: No feedback row — check for terminal failure job status ───────
  // "Absence of feedback is not failure." Only an explicit terminal failure
  // status on a reviewer_feedback job indicates the FAILED state.
  const reviewerJobs = jobs.filter((j) => j.jobType === 'reviewer_feedback');
  const hasTerminalFailure = reviewerJobs.some((j) => TERMINAL_FAILURE_STATUSES.has(j.status));
  if (hasTerminalFailure) {
    return 'failed';
  }

  // ── Step 3: Default — pending or running ─────────────────────────────────
  // No feedback row and no terminal failure signal. The job may be queued,
  // running, or not yet dispatched.
  return 'pending_or_running';
}
