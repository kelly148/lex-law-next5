// @vitest-environment jsdom
/**
 * REVIEWER-ASYNC-DISPLAY-1 (Component C, C-3) + ASYNC-LANE-DISPLAY-PARITY-1 — AsyncLaneReviewView (the lane
 * HEADER) render tests.
 *
 * After ASYNC-LANE-DISPLAY-PARITY-1 the component is the lane HEADER only: the honest N-of-M state, the
 * per-lane status strip, and the "incomplete — send blocked" banner (the client never invents completion).
 * The arrived reviewers' suggestions now render via the SHARED SuggestionCard list in ReviewPane — the
 * clean-card + controls + regenerate coverage lives in reviewPaneAsyncParity.render.test.tsx.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import { AsyncLaneReviewView } from '../AsyncLaneReviewView.js';
import {
  buildReviewerLanesContract,
  isTerminalLaneStatus,
  type ReviewerLaneView,
  type ReviewerLaneStatus,
} from '../../../shared/schemas/reviewerLaneState.js';

function lane(role: string, status: ReviewerLaneStatus, count: number | null = null): ReviewerLaneView {
  return {
    reviewerRole: role,
    reviewerTitle: role.toUpperCase(),
    status,
    terminal: isTerminalLaneStatus(status),
    suggestionCount: count,
    feedbackRowId: null,
    jobStatus: null,
    failureReason: null,
    dispatchedAt: null,
    terminalizedAt: null,
    updatedAt: '2026-06-11T00:00:00.000Z',
  };
}

afterEach(() => cleanup());

describe('AsyncLaneReviewView (lane header)', () => {
  it('honest N-of-M: all returned → the header states it, with the per-lane strip + counts', () => {
    const lanes = buildReviewerLanesContract([
      lane('claude', 'completed_with_feedback', 10),
      lane('gemini', 'completed_with_feedback', 5),
      lane('gpt', 'completed_with_feedback', 11),
      lane('grok', 'completed_without_feedback', 0),
    ]);
    render(<AsyncLaneReviewView lanes={lanes} />);
    expect(screen.getByTestId('async-lane-header').textContent).toContain('All 4 reviewers returned');
    // the per-lane strip surfaces each reviewer's status + count (gpt returned 11).
    expect(screen.getByTestId('lane-gpt').getAttribute('data-status')).toBe('completed_with_feedback');
    expect(screen.getByTestId('lane-gpt').textContent).toContain('(11)');
  });

  it('partial: honest N-of-M while reviewers are still pending; lane status surfaced', () => {
    const lanes = buildReviewerLanesContract([lane('claude', 'completed_with_feedback', 3), lane('gpt', 'running')]);
    render(<AsyncLaneReviewView lanes={lanes} />);
    expect(screen.getByTestId('async-lane-header').textContent).toMatch(/1 of 2 reviewers returned/);
    expect(screen.getByTestId('lane-gpt').getAttribute('data-status')).toBe('running');
  });

  it('client never invents completion: an incomplete run past the window shows the send-blocked banner', () => {
    vi.useFakeTimers();
    try {
      const lanes = buildReviewerLanesContract([lane('claude', 'completed_with_feedback', 2), lane('gpt', 'running')]);
      render(<AsyncLaneReviewView lanes={lanes} />);
      expect(screen.queryByTestId('async-lane-incomplete')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(6 * 60 * 1000);
      });
      expect(screen.getByTestId('async-lane-incomplete')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('"no suggestions" displayState: the header says all returned with none raised (all terminal AND total == 0)', () => {
    const lanes = buildReviewerLanesContract([
      lane('claude', 'completed_without_feedback', 0),
      lane('gpt', 'completed_without_feedback', 0),
    ]);
    render(<AsyncLaneReviewView lanes={lanes} />);
    expect(screen.getByTestId('async-lane-header').textContent).toMatch(/none raised any suggestions/);
  });

  it('complete_with_failures: a failed lane is shown, not masked by a succeeding sibling', () => {
    const lanes = buildReviewerLanesContract([lane('claude', 'completed_with_feedback', 4), lane('gpt', 'failed')]);
    render(<AsyncLaneReviewView lanes={lanes} />);
    expect(screen.getByTestId('async-lane-header').textContent).toMatch(/did not respond/);
    expect(screen.getByTestId('lane-gpt').getAttribute('data-status')).toBe('failed');
  });
});
