/**
 * REVIEWER-ASYNC-DISPLAY-1 (Gate 0, Component C) — reviewer-lane state contract (SHARED).
 *
 * The server-owned per-reviewer "lane" is the single source of truth for the async multi-reviewer
 * display, replacing the client's deriveCompletionState(feedback, jobs) inference. One lane per
 * EXPECTED reviewer (the immutable expected set, persisted at iteration creation BEFORE dispatch).
 * Every lane reaches a terminal status server-side (condition 4). The client renders + gates polling
 * off this contract and never invents completion (condition 1/4).
 *
 * This module is shared (server writes lanes + builds the contract; client renders off it). It has
 * NO DB/runtime deps — pure types + Zod + a pure derivation.
 */
import { z } from 'zod';

// ── Lane status vocabulary (a DIFFERENT vocabulary than job status) ──
export const REVIEWER_LANE_STATUS_VALUES = [
  // non-terminal
  'pending', // expected, not yet dispatched
  'dispatched', // job enqueued/created
  'running', // job running
  // terminal (condition 4)
  'completed_with_feedback',
  'completed_without_feedback', // affirmative zero-result (condition 5)
  'failed',
  'timed_out',
  'dispatch_failed', // the enqueue itself failed — never dropped from the denominator (operator decision)
  'orphaned_reaped', // C's per-lane deadline reaped it (crash/restart orphan; defense-in-depth)
  'canceled',
  // EGRESS-CONTROL-PLANE-1 Inc 2: the per-reviewer egress gate (Inc 3) blocked this lane under a
  // no_external hold. Terminal, but NOT a FAILURE class — a deliberate withhold, not a reviewer failure.
  'blocked_by_hold',
] as const;
export type ReviewerLaneStatus = (typeof REVIEWER_LANE_STATUS_VALUES)[number];

export const TERMINAL_LANE_STATUSES: ReadonlySet<ReviewerLaneStatus> = new Set([
  'completed_with_feedback',
  'completed_without_feedback',
  'failed',
  'timed_out',
  'dispatch_failed',
  'orphaned_reaped',
  'canceled',
  // EGRESS-CONTROL-PLANE-1 Inc 2: terminal, but NOT a failure (see HOLD_BLOCKED_LANE_STATUSES below).
  'blocked_by_hold',
]);

/** Terminal statuses that represent a FAILURE (no usable feedback from this lane). */
export const FAILURE_LANE_STATUSES: ReadonlySet<ReviewerLaneStatus> = new Set([
  'failed',
  'timed_out',
  'dispatch_failed',
  'orphaned_reaped',
  'canceled',
]);

/**
 * EGRESS-CONTROL-PLANE-1 Inc 2: terminal statuses where the lane was BLOCKED by a no_external hold
 * (Inc 3's per-reviewer egress gate sets it; Inc 2 classifies it). Deliberately DISTINCT from a FAILURE
 * class — a hold-block is an intentional "don't transmit" act, NOT a reviewer that failed to respond.
 */
export const HOLD_BLOCKED_LANE_STATUSES: ReadonlySet<ReviewerLaneStatus> = new Set(['blocked_by_hold']);

/**
 * REVIEW-LOOP-UX-1 R2 (single-reviewer re-run): the terminal lane statuses a re-run is OFFERED for. A re-run
 * reuses the (session,reviewer) job slot, so it is safe ONLY where the lane reached terminal via a path that
 * ALSO left the JOB in a terminal status with NO feedback row — failed / timed_out / canceled (txn2Revert or
 * cancel terminalized the job; no feedback) + blocked_by_hold (the egress gate cancelled the job; no feedback).
 * DELIBERATELY EXCLUDES:
 *   - completed_with_feedback / completed_without_feedback — a re-run discards-and-replaces; never offered
 *     where returned/adopted feedback could be lost.
 *   - orphaned_reaped AND dispatch_failed — the LANE reaper / dispatch-failure terminalize the LANE, but the
 *     JOB is DECOUPLED (the job reaper is a separate, separately-flag-gated sweep). The job may still be
 *     'queued' (a lost continuation -> a re-run would run the STALE frozen prompt against the OLD draft) or
 *     even 'completed' with a feedback row (a lost best-effort lane-terminal write -> a re-run would DUPLICATE
 *     feedback). Their job state is not guaranteed, so they are NOT safely re-runnable here (a future seize-
 *     and-refresh hardening could cover them; out of R2 scope).
 * Non-terminal lanes are never re-runnable.
 */
export const RERUNNABLE_LANE_STATUSES: ReadonlySet<ReviewerLaneStatus> = new Set([
  'failed',
  'timed_out',
  'canceled',
  'blocked_by_hold',
]);

/** True if a single-reviewer re-run may be offered for this (terminal) lane status (REVIEW-LOOP-UX-1 R2). */
export function isLaneRerunnable(status: ReviewerLaneStatus): boolean {
  return RERUNNABLE_LANE_STATUSES.has(status);
}

/**
 * WHY a (terminal) reviewer set is partial — the Inc-2 data foundation for the Inc-3 send gate.
 *   'blocked_by_hold' — a no_external hold blocked >=1 reviewer; Inc 3 requires the recorded one-click
 *     attorney acknowledgment before the review is send-ready (a hold must never be silently overridden).
 *     Takes precedence over a co-occurring non-response.
 *   'non_response'    — >=1 reviewer failed/timed-out/dispatch-failed/orphaned; informational only.
 *   null              — no blocked and no failed lane (clean, or not yet terminal).
 */
export type SessionPartialReason = 'blocked_by_hold' | 'non_response' | null;

export function isTerminalLaneStatus(s: ReviewerLaneStatus): boolean {
  return TERMINAL_LANE_STATUSES.has(s);
}

// ── The DB row (Zod Wall) ──
export const ReviewerLaneRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid(),
  versionId: z.string().uuid(), // condition 6: the document revision under review
  reviewSessionId: z.string().uuid(),
  iterationNumber: z.number().int().nonnegative(),
  reviewerRole: z.string(), // free VARCHAR, like FeedbackRow.reviewerRole (no DB enum)
  reviewerTitle: z.string(),
  jobId: z.string().uuid().nullable(),
  status: z.enum(REVIEWER_LANE_STATUS_VALUES),
  suggestionCount: z.number().int().nonnegative().nullable(),
  feedbackRowId: z.string().uuid().nullable(),
  failureReason: z.string().nullable(),
  terminalDeadlineAt: z.date(),
  terminalizedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ReviewerLaneRow = z.infer<typeof ReviewerLaneRowSchema>;

// ── The client-facing per-reviewer lane view (condition 1 fields) ──
export interface ReviewerLaneView {
  reviewerRole: string;
  reviewerTitle: string;
  status: ReviewerLaneStatus;
  terminal: boolean;
  suggestionCount: number | null;
  feedbackRowId: string | null;
  jobStatus: string | null; // joined from the reviewer job (display only)
  failureReason: string | null;
  dispatchedAt: string | null; // ISO; null until dispatched
  terminalizedAt: string | null; // ISO; null until terminal
  updatedAt: string; // ISO
}

export interface ReviewerLanesAggregate {
  expected: number; // |intended reviewer set| (denominator — never shrinks)
  terminal: number;
  returned: number; // completed_with_feedback + completed_without_feedback
  failed: number; // FAILURE_LANE_STATUSES
  pending: number; // non-terminal
}

/**
 * The server-derived display state for the async pane. The client layers an `incomplete_stalled`
 * overlay on top (its own elapsed-time window) — the server never reports that, because liveness
 * is the lane deadline's job, not the client's (condition 4).
 */
export type LaneDisplayState =
  | 'pending' // nothing terminal yet
  | 'partial' // some terminal, some still pending
  | 'complete' // all terminal, all succeeded, >0 total suggestions
  | 'complete_with_failures' // all terminal, >=1 success AND >=1 failure
  | 'no_suggestions' // all terminal, all succeeded, total suggestions == 0
  | 'all_failed'; // all terminal, every lane failed

export interface ReviewerLanesContract {
  lanes: ReviewerLaneView[]; // per EXPECTED reviewer, deduped to one lane per reviewer
  aggregate: ReviewerLanesAggregate;
  displayState: LaneDisplayState;
  allTerminal: boolean;
  totalSuggestions: number; // across completed_with_feedback lanes
  /** condition 8: the set the (any) consolidation ran over reads honestly off this. */
  incomplete: boolean; // !allTerminal OR aggregate.failed > 0
  /** EGRESS-CONTROL-PLANE-1 Inc 2: WHY the terminal set is partial (hold-block vs non-response), or null
   *  when not partial / not yet terminal. Inc 3's send gate requires an attorney acknowledgment when this
   *  is 'blocked_by_hold'. Surfaced through the EXISTING reviewSession.get path (no new plumbing). */
  partialReason: SessionPartialReason;
}

/**
 * Pure derivation of the display state from the EXPECTED lanes (condition 5). The expected lanes are
 * exactly the lanes whose reviewerRole is in the intended set; unknown/unselected lanes are excluded
 * by the caller (condition 11). `totalSuggestions` sums completed_with_feedback lanes' counts.
 */
export function deriveLaneDisplayState(lanes: ReviewerLaneView[]): {
  displayState: LaneDisplayState;
  aggregate: ReviewerLanesAggregate;
  allTerminal: boolean;
  totalSuggestions: number;
} {
  const expected = lanes.length;
  let terminal = 0;
  let returned = 0;
  let failed = 0;
  let totalSuggestions = 0;
  for (const lane of lanes) {
    if (lane.terminal) terminal += 1;
    if (lane.status === 'completed_with_feedback' || lane.status === 'completed_without_feedback') {
      returned += 1;
      totalSuggestions += lane.suggestionCount ?? 0;
    } else if (FAILURE_LANE_STATUSES.has(lane.status)) {
      failed += 1;
    }
  }
  const pending = expected - terminal;
  const allTerminal = expected > 0 && pending === 0;
  const aggregate: ReviewerLanesAggregate = { expected, terminal, returned, failed, pending };

  let displayState: LaneDisplayState;
  if (!allTerminal) {
    displayState = terminal > 0 ? 'partial' : 'pending';
  } else if (returned === 0) {
    displayState = 'all_failed';
  } else if (failed > 0) {
    displayState = 'complete_with_failures';
  } else if (totalSuggestions === 0) {
    // condition 5: global "no suggestions" ONLY when ALL terminal AND total == 0 (and none failed).
    displayState = 'no_suggestions';
  } else {
    displayState = 'complete';
  }
  return { displayState, aggregate, allTerminal, totalSuggestions };
}

/**
 * EGRESS-CONTROL-PLANE-1 Inc 2: classify WHY a reviewer set is partial (the Inc-2 data foundation for
 * the Inc-3 send gate). Hold-block takes precedence over non-response — a deliberate "don't transmit"
 * must be acknowledged even alongside an unrelated reviewer failure. Pure; null when no blocked/failed lane.
 */
export function deriveSessionPartialReason(lanes: ReviewerLaneView[]): SessionPartialReason {
  let holdBlocked = false;
  let failed = false;
  for (const lane of lanes) {
    if (HOLD_BLOCKED_LANE_STATUSES.has(lane.status)) holdBlocked = true;
    else if (FAILURE_LANE_STATUSES.has(lane.status)) failed = true;
  }
  if (holdBlocked) return 'blocked_by_hold';
  if (failed) return 'non_response';
  return null;
}

/** Build the full contract from the expected lane views (the single read-side surface). */
export function buildReviewerLanesContract(lanes: ReviewerLaneView[]): ReviewerLanesContract {
  const { displayState, aggregate, allTerminal, totalSuggestions } = deriveLaneDisplayState(lanes);
  return {
    lanes,
    aggregate,
    displayState,
    allTerminal,
    totalSuggestions,
    incomplete: !allTerminal || aggregate.failed > 0,
    partialReason: deriveSessionPartialReason(lanes),
  };
}
