// @vitest-environment jsdom
/**
 * REVIEWER-ASYNC-DISPLAY-1 (Component C, C-3) — AsyncLaneReviewView render tests.
 *
 * Mount-without-throw (#310 guard) + the trustworthy-display behavior: the 06-09 repro RENDERS every
 * returned reviewer's substantive suggestions (never a hidden "no suggestions"), N-of-M is honest, the
 * client never invents completion (incomplete banner past the window), and "no suggestions" only when
 * all terminal AND total == 0.
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

describe('AsyncLaneReviewView', () => {
  it('the 06-09 repro RENDERS every returned reviewer\'s suggestions (no hidden content)', () => {
    const lanes = buildReviewerLanesContract([
      lane('claude', 'completed_with_feedback', 10),
      lane('gemini', 'completed_with_feedback', 5),
      lane('gpt', 'completed_with_feedback', 11),
      lane('grok', 'completed_without_feedback', 0),
    ]);
    const feedback = [
      {
        reviewerRole: 'gpt',
        reviewerTitle: 'GPT-5',
        suggestions: Array.from({ length: 11 }, (_, i) => ({ suggestionId: `g${i}`, title: `Issue ${i}`, body: `body ${i}` })),
      },
      { reviewerRole: 'grok', reviewerTitle: 'Grok', suggestions: [] },
    ];
    render(<AsyncLaneReviewView lanes={lanes} feedback={feedback} onClose={() => {}} />);
    // GPT-5's 11 issues are SHOWN — the operator can never conclude "review found nothing"
    expect(screen.getByTestId('suggestions-gpt')).toBeTruthy();
    expect(screen.getByTestId('async-lane-header').textContent).toContain('All 4 reviewers returned');
    expect(screen.queryByTestId('async-lane-no-suggestions')).toBeNull();
  });

  it('partial: honest N-of-M while reviewers are still pending; lane status surfaced', () => {
    const lanes = buildReviewerLanesContract([lane('claude', 'completed_with_feedback', 3), lane('gpt', 'running')]);
    render(
      <AsyncLaneReviewView
        lanes={lanes}
        feedback={[{ reviewerRole: 'claude', reviewerTitle: 'Claude', suggestions: [{ suggestionId: 'c1', body: 'x' }] }]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('async-lane-header').textContent).toMatch(/1 of 2 reviewers returned/);
    expect(screen.getByTestId('lane-gpt').getAttribute('data-status')).toBe('running');
  });

  it('client never invents completion: an incomplete run past the window shows the send-blocked banner', () => {
    vi.useFakeTimers();
    try {
      const lanes = buildReviewerLanesContract([lane('claude', 'completed_with_feedback', 2), lane('gpt', 'running')]);
      render(<AsyncLaneReviewView lanes={lanes} feedback={[]} onClose={() => {}} />);
      expect(screen.queryByTestId('async-lane-incomplete')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(6 * 60 * 1000);
      });
      expect(screen.getByTestId('async-lane-incomplete')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('"no suggestions" ONLY when all terminal AND total == 0', () => {
    const lanes = buildReviewerLanesContract([
      lane('claude', 'completed_without_feedback', 0),
      lane('gpt', 'completed_without_feedback', 0),
    ]);
    render(<AsyncLaneReviewView lanes={lanes} feedback={[]} onClose={() => {}} />);
    expect(screen.getByTestId('async-lane-no-suggestions')).toBeTruthy();
  });

  it('complete_with_failures: a failed lane is shown, not masked by a succeeding sibling', () => {
    const lanes = buildReviewerLanesContract([lane('claude', 'completed_with_feedback', 4), lane('gpt', 'failed')]);
    render(
      <AsyncLaneReviewView
        lanes={lanes}
        feedback={[{ reviewerRole: 'claude', reviewerTitle: 'Claude', suggestions: [{ suggestionId: 'c1', body: 'x' }] }]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('async-lane-header').textContent).toMatch(/did not respond/);
    expect(screen.getByTestId('lane-gpt').getAttribute('data-status')).toBe('failed');
  });
});
