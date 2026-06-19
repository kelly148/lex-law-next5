/**
 * REVIEWER-ASYNC-DISPLAY-1 (Gate 0, Component C, C-3) — the trustworthy async lane HEADER.
 *
 * ASYNC-LANE-DISPLAY-PARITY-1: narrowed to the lane HEADER — the honest N-of-M state (condition 1), the
 * per-lane status strip, and the "incomplete — here is what arrived; sending is blocked pending a recorded
 * attorney override" banner (condition 4). The arrived reviewers' suggestions now render through the SHARED
 * SuggestionCard list in ReviewPane (clean cards via stripEmbeddedCardsJson + native cards, plus
 * Accept/Decline/Decline&lock + regenerate) — replacing the RAW reviewer bodies + zero controls this
 * component used to show.
 *
 * This component stays strictly DISPLAY-ONLY: it performs no selection writes and runs no provider/data
 * mutations (the per-suggestion controls live in the shared SuggestionCard), and the client NEVER invents
 * completion — past an elapsed window with the run still open it surfaces the send-blocked banner rather
 * than a fake terminal. Rendered by ReviewPane's async branch (data.lanes non-null) ABOVE the shared
 * suggestion list + regenerate footer.
 */
import React, { useEffect, useState } from 'react';
import {
  isLaneRerunnable,
  type ReviewerLanesContract,
  type ReviewerLanesAggregate,
  type LaneDisplayState,
} from '../../shared/schemas/reviewerLaneState.js';

/** After this much wall-clock with the run still not all-terminal, the client flags it incomplete. */
const INCOMPLETE_WINDOW_MS = 5 * 60 * 1000;

const STATUS_LABEL: Record<string, string> = {
  pending: 'Queued',
  dispatched: 'Queued',
  running: 'Running…',
  completed_with_feedback: 'Returned',
  completed_without_feedback: 'No suggestions',
  failed: 'Failed',
  timed_out: 'Timed out',
  dispatch_failed: 'Dispatch failed',
  orphaned_reaped: 'No response (recovered)',
  canceled: 'Canceled',
  blocked_by_hold: 'Held (not sent)',
};

const DISPLAY_MESSAGE: Record<LaneDisplayState, (a: ReviewerLanesAggregate) => string> = {
  pending: (a) => `Review in progress — 0 of ${a.expected} reviewers have returned…`,
  partial: (a) => `${a.returned} of ${a.expected} reviewers returned · ${a.pending} still working…`,
  complete: (a) => `All ${a.expected} reviewers returned.`,
  complete_with_failures: (a) =>
    `${a.returned} of ${a.expected} reviewers returned · ${a.failed} did not respond (shown below).`,
  no_suggestions: (a) => `All ${a.expected} reviewers returned — none raised any suggestions.`,
  all_failed: (a) => `No reviewer returned — all ${a.expected} failed.`,
};

export function AsyncLaneReviewView({
  lanes,
  onRerun,
  rerunPendingRole,
}: {
  lanes: ReviewerLanesContract;
  /** REVIEW-LOOP-UX-1 R2: re-run ONE reviewer on the current draft. The PARENT owns the mutation (this
   *  component stays display-only — it only surfaces the affordance + calls back). Omitted => no button. */
  onRerun?: (reviewerRole: string) => void;
  /** The reviewerRole whose re-run is currently in flight (its button is disabled until the poll moves it). */
  rerunPendingRole?: string | null;
}): React.ReactElement {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (lanes.allTerminal) return;
    const start = Date.now();
    const t = setInterval(() => setElapsedMs(Date.now() - start), 5000);
    return () => clearInterval(t);
  }, [lanes.allTerminal]);

  const { aggregate, displayState, allTerminal } = lanes;
  // condition 4: the CLIENT never invents completion. Past the window with the run still open, FLAG it.
  const stalled = !allTerminal && elapsedMs > INCOMPLETE_WINDOW_MS;

  return (
    <div className="px-4 py-3 border-b border-line flex-shrink-0" data-testid="async-lane-review">
      <p className="text-sm font-medium text-ink" data-testid="async-lane-header">
        {DISPLAY_MESSAGE[displayState](aggregate)}
      </p>
      <ul className="mt-2 flex flex-wrap gap-2" data-testid="async-lane-strip">
        {lanes.lanes.map((l) => (
          <li
            key={l.reviewerRole}
            data-testid={`lane-${l.reviewerRole}`}
            data-status={l.status}
            className={`text-xs px-2 py-0.5 rounded border ${l.terminal ? 'border-line text-ink-secondary' : 'border-accent text-accent'}`}
          >
            {l.reviewerTitle}: {STATUS_LABEL[l.status] ?? l.status}
            {l.status === 'completed_with_feedback' && l.suggestionCount != null ? ` (${l.suggestionCount})` : ''}
            {onRerun && isLaneRerunnable(l.status) && (
              <button
                type="button"
                data-testid={`lane-rerun-${l.reviewerRole}`}
                className="ml-1.5 underline hover:no-underline disabled:opacity-50 disabled:no-underline"
                disabled={rerunPendingRole === l.reviewerRole}
                onClick={() => onRerun(l.reviewerRole)}
                aria-label={`Re-run ${l.reviewerTitle}`}
                title="Re-run this reviewer on the current draft"
              >
                {rerunPendingRole === l.reviewerRole ? '↻ Re-running…' : '↻ Re-run'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {stalled && (
        <div
          className="mt-2 text-xs text-accent border border-accent rounded px-2 py-1"
          data-testid="async-lane-incomplete"
        >
          Incomplete — {aggregate.returned} of {aggregate.expected} reviewers have returned; the rest are
          still pending. Here is what arrived. Sending is blocked pending a recorded attorney override.
        </div>
      )}
    </div>
  );
}
