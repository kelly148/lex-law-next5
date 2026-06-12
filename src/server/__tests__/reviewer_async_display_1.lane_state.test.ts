/**
 * REVIEWER-ASYNC-DISPLAY-1 (Component C) — the pure lane-state derivation (the heart of the display).
 *
 * deriveLaneDisplayState replaces the client's deriveCompletionState(feedback, jobs) for async. These
 * are the expanded exit criteria expressed as pure state: the exact 06-09 repro (no false
 * "no suggestions" while a lane has content), adversarial arrival orderings (zero-first,
 * failure-after-success, late-arrival), and the condition-5 empty-vs-pending discipline.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveLaneDisplayState,
  buildReviewerLanesContract,
  isTerminalLaneStatus,
  type ReviewerLaneView,
  type ReviewerLaneStatus,
} from '../../shared/schemas/reviewerLaneState.js';

function lane(role: string, status: ReviewerLaneStatus, suggestionCount: number | null = null): ReviewerLaneView {
  return {
    reviewerRole: role,
    reviewerTitle: role,
    status,
    terminal: isTerminalLaneStatus(status),
    suggestionCount,
    feedbackRowId: null,
    jobStatus: null,
    failureReason: null,
    dispatchedAt: null,
    terminalizedAt: isTerminalLaneStatus(status) ? '2026-06-11T00:00:00.000Z' : null,
    updatedAt: '2026-06-11T00:00:00.000Z',
  };
}

describe('deriveLaneDisplayState — completion discipline (condition 5)', () => {
  it('the exact 06-09 repro renders COMPLETE (not "no suggestions"): Claude=10, Gemini=5, GPT-5=11, Grok=0', () => {
    const lanes = [
      lane('claude', 'completed_with_feedback', 10),
      lane('gemini', 'completed_with_feedback', 5),
      lane('gpt', 'completed_with_feedback', 11),
      lane('grok', 'completed_without_feedback', 0),
    ];
    const r = deriveLaneDisplayState(lanes);
    expect(r.displayState).toBe('complete');
    expect(r.allTerminal).toBe(true);
    expect(r.totalSuggestions).toBe(26);
    expect(r.aggregate).toEqual({ expected: 4, terminal: 4, returned: 4, failed: 0, pending: 4 - 4 });
  });

  it('global "no suggestions" ONLY when ALL terminal AND total == 0', () => {
    const lanes = [lane('claude', 'completed_without_feedback', 0), lane('gpt', 'completed_without_feedback', 0)];
    expect(deriveLaneDisplayState(lanes).displayState).toBe('no_suggestions');
  });

  it('zero-first ordering: a 0-result lane terminal while others still pending is PARTIAL, never "no suggestions"', () => {
    const lanes = [
      lane('grok', 'completed_without_feedback', 0), // arrived first, empty
      lane('gpt', 'pending'),
      lane('claude', 'running'),
    ];
    const r = deriveLaneDisplayState(lanes);
    expect(r.displayState).toBe('partial');
    expect(r.allTerminal).toBe(false);
  });

  it('failure-after-success: one success + one failure (all terminal) -> complete_with_failures', () => {
    const lanes = [lane('claude', 'completed_with_feedback', 3), lane('gpt', 'failed')];
    expect(deriveLaneDisplayState(lanes).displayState).toBe('complete_with_failures');
  });

  it('a failed lane while a sibling still runs is PARTIAL (failure not masked, not yet complete)', () => {
    const lanes = [lane('claude', 'completed_with_feedback', 3), lane('gpt', 'timed_out'), lane('grok', 'running')];
    expect(deriveLaneDisplayState(lanes).displayState).toBe('partial');
  });

  it('all lanes failed (incl. dispatch_failed / orphaned_reaped) -> all_failed', () => {
    const lanes = [lane('claude', 'failed'), lane('gpt', 'dispatch_failed'), lane('grok', 'orphaned_reaped')];
    const r = deriveLaneDisplayState(lanes);
    expect(r.displayState).toBe('all_failed');
    expect(r.aggregate.failed).toBe(3);
    expect(r.aggregate.returned).toBe(0);
  });

  it('nothing terminal yet -> pending', () => {
    expect(deriveLaneDisplayState([lane('claude', 'pending'), lane('gpt', 'dispatched')]).displayState).toBe('pending');
  });

  it('dispatch_failed lane stays in the denominator (never dropped) — operator decision', () => {
    const lanes = [lane('claude', 'completed_with_feedback', 4), lane('gpt', 'dispatch_failed')];
    const r = deriveLaneDisplayState(lanes);
    expect(r.aggregate.expected).toBe(2); // gpt is still counted
    expect(r.aggregate.failed).toBe(1);
    expect(r.displayState).toBe('complete_with_failures');
  });

  it('late-arrival reopen: an orphaned_reaped lane that later flips to completed_with_feedback recomputes to complete', () => {
    // Before the late result: claude done, gpt reaped -> complete_with_failures.
    const before = [lane('claude', 'completed_with_feedback', 2), lane('gpt', 'orphaned_reaped')];
    expect(deriveLaneDisplayState(before).displayState).toBe('complete_with_failures');
    // The late result lands (markReviewerLaneTerminal is unconditional / latest-wins): gpt -> completed_with_feedback.
    const after = [lane('claude', 'completed_with_feedback', 2), lane('gpt', 'completed_with_feedback', 9)];
    const r = deriveLaneDisplayState(after);
    expect(r.displayState).toBe('complete');
    expect(r.totalSuggestions).toBe(11);
  });
});

describe('buildReviewerLanesContract — the incompleteness signal (condition 8)', () => {
  it('incomplete=true while not all terminal', () => {
    const c = buildReviewerLanesContract([lane('claude', 'completed_with_feedback', 1), lane('gpt', 'running')]);
    expect(c.incomplete).toBe(true);
    expect(c.allTerminal).toBe(false);
  });
  it('incomplete=true when all terminal but a lane failed (synthesis over a partial set must not read as consensus)', () => {
    const c = buildReviewerLanesContract([lane('claude', 'completed_with_feedback', 1), lane('gpt', 'failed')]);
    expect(c.incomplete).toBe(true);
    expect(c.allTerminal).toBe(true);
  });
  it('incomplete=false on a clean complete run', () => {
    const c = buildReviewerLanesContract([lane('claude', 'completed_with_feedback', 1), lane('gpt', 'completed_with_feedback', 2)]);
    expect(c.incomplete).toBe(false);
  });
});
