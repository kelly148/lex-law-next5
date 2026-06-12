/**
 * REVIEWER-ASYNC-DISPLAY-1 (Gate 0, Component C, C-3) — the trustworthy async multi-reviewer display.
 *
 * Renders OFF the server-owned per-reviewer lane contract (condition 1) — NOT deriveCompletionState.
 * It shows the honest N-of-M state, a per-lane status strip, and EVERY arrived reviewer's substantive
 * suggestions (the 06-09 fix: a returned lane's content is never hidden behind a "no suggestions"
 * screen). The client NEVER invents completion: while the run is still incomplete past an elapsed
 * window it surfaces an "incomplete — here is what arrived; send blocked pending a recorded attorney
 * override" banner (condition 4), rather than a fake terminal.
 *
 * Mounted ONLY when reviewSession.get returns a non-null `lanes` payload (the async path). When the
 * payload is null (REVIEWER_ASYNC_ENABLED OFF) ReviewPane keeps its byte-for-byte sync display (GUARD).
 */
import React, { useEffect, useState } from 'react';
import type {
  ReviewerLanesContract,
  ReviewerLanesAggregate,
  LaneDisplayState,
} from '../../shared/schemas/reviewerLaneState.js';

/** After this much wall-clock with the run still not all-terminal, the client flags it incomplete. */
const INCOMPLETE_WINDOW_MS = 5 * 60 * 1000;

interface FeedbackSuggestionLike {
  suggestionId: string;
  title?: string;
  body: string;
}
interface FeedbackLike {
  reviewerRole: string;
  reviewerTitle: string;
  suggestions: FeedbackSuggestionLike[];
}

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
  feedback,
  onClose,
}: {
  lanes: ReviewerLanesContract;
  feedback: FeedbackLike[];
  onClose: () => void;
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
  const feedbackByRole = new Map(feedback.map((f) => [f.reviewerRole, f]));

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="async-lane-review">
      <div className="px-4 py-3 border-b border-line">
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

      {/* Arrived suggestions, grouped per reviewer. A returned lane's content is ALWAYS shown — the
          06-09 defect (hiding a lane's substantive feedback behind a "no suggestions" screen) cannot recur. */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {lanes.lanes.map((l) => {
          const fb = feedbackByRole.get(l.reviewerRole);
          if (!fb || fb.suggestions.length === 0) return null;
          return (
            <section key={l.reviewerRole} data-testid={`suggestions-${l.reviewerRole}`}>
              <h3 className="text-sm font-medium text-ink mb-1">
                {l.reviewerTitle} · {fb.suggestions.length} suggestion(s)
              </h3>
              <ul className="space-y-2">
                {fb.suggestions.map((s) => (
                  <li key={s.suggestionId} className="text-sm border border-line rounded p-2">
                    {s.title ? <p className="font-medium text-ink">{s.title}</p> : null}
                    <p className="text-ink-secondary whitespace-pre-wrap">{s.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {allTerminal && aggregate.returned > 0 && lanes.totalSuggestions === 0 && (
          <p className="text-sm text-ink-secondary" data-testid="async-lane-no-suggestions">
            No reviewer raised any suggestions.
          </p>
        )}
      </div>

      <div className="px-4 py-3 border-t border-line">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm border border-line text-ink rounded hover:bg-surface"
        >
          Close
        </button>
      </div>
    </div>
  );
}
