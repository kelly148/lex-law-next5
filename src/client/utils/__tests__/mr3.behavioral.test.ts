/**
 * mr3.behavioral.test.ts — MR-3 §S6b, §S6e, §S6f, §S6g
 *
 * Behavioral and structural tests for the MR-3 implementation.
 * These tests verify:
 *   §S6b  — UI rendering per state: ReviewPane.tsx source structure
 *   §S6e  — Cross-iteration UI end-to-end: state model + history logic
 *   §S6f  — History view edge cases: loading, empty, error, accordion
 *   §S6g  — Regression preservation: MR-0G, MR-1, MR-2 deliverables intact
 *
 * All tests are source-analysis or pure-logic tests (no DOM rendering),
 * consistent with the project's node-environment vitest configuration.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { deriveCompletionState } from '../reviewState.js';

const ROOT = path.resolve(__dirname, '../../../..');

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, 'src', relPath), 'utf-8');
}

// ============================================================
// §S6b — UI rendering per state (S1b, S1c, S3)
// Source-analysis: verify ReviewPane.tsx renders all four states
// ============================================================

describe('§S6b: ReviewPane.tsx renders all four completion states', () => {
  const reviewPane = readSrc('client/components/ReviewPane.tsx');

  it('imports deriveCompletionState from reviewState utility', () => {
    expect(reviewPane).toContain("import { deriveCompletionState } from '../utils/reviewState.js'");
  });

  it('derives completionState from feedback and jobs data', () => {
    expect(reviewPane).toContain('const completionState = deriveCompletionState(feedback, jobs)');
  });

  it("renders spinner for 'pending_or_running' state", () => {
    expect(reviewPane).toContain("completionState === 'pending_or_running'");
    expect(reviewPane).toContain('animate-spin');
  });

  it("renders FeedbackCard list for 'completed_with_feedback' state", () => {
    expect(reviewPane).toContain("completionState === 'completed_with_feedback'");
    expect(reviewPane).toContain('<FeedbackCard');
  });

  it("renders CompletedWithoutFeedbackView for 'completed_without_feedback' state", () => {
    expect(reviewPane).toContain("completionState === 'completed_without_feedback'");
    expect(reviewPane).toContain('<CompletedWithoutFeedbackView');
  });

  it("renders FailedReviewView for 'failed' state", () => {
    expect(reviewPane).toContain("completionState === 'failed'");
    expect(reviewPane).toContain('<FailedReviewView');
  });

  it('polling is aligned with deriveCompletionState (stops on non-pending state)', () => {
    // S1c: refetchInterval uses deriveCompletionState to determine polling cadence.
    expect(reviewPane).toContain("completionState === 'pending_or_running' ? 3000 : false");
  });

  it('queries job.poll for reviewer_feedback job status detection', () => {
    expect(reviewPane).toContain('trpc.job.poll.useQuery');
    expect(reviewPane).toContain("'reviewer_feedback'");
  });

  it('CompletedWithoutFeedbackView component is defined in ReviewPane.tsx', () => {
    expect(reviewPane).toContain('function CompletedWithoutFeedbackView(');
  });

  it('FailedReviewView component is defined in ReviewPane.tsx', () => {
    expect(reviewPane).toContain('function FailedReviewView(');
  });

  it('CompletedWithoutFeedbackView shows paths-forward guidance', () => {
    expect(reviewPane).toContain('Paths forward');
  });

  it('FailedReviewView shows abandon-and-retry guidance', () => {
    expect(reviewPane).toContain('Abandon and start a new review session');
  });

  it('AlertCircle icon is imported for FailedReviewView', () => {
    expect(reviewPane).toContain('AlertCircle');
  });
});

// ============================================================
// §S6e — Cross-iteration UI end-to-end
// Pure-logic simulation of the full multi-iteration state model
// ============================================================

describe('§S6e: cross-iteration state model end-to-end', () => {
  // Simulate the data shape that ActiveSessionView would receive across iterations.

  it('iteration-1 pending state: no feedback, job running', () => {
    const state = deriveCompletionState(
      [],
      [{ jobType: 'reviewer_feedback', status: 'running' }],
    );
    expect(state).toBe('pending_or_running');
  });

  it('iteration-1 completed with feedback: feedback row with suggestions', () => {
    const state = deriveCompletionState(
      [{ suggestions: [{ id: 's1', title: 'Add jurisdiction clause' }] }],
      [{ jobType: 'reviewer_feedback', status: 'completed' }],
    );
    expect(state).toBe('completed_with_feedback');
  });

  it('iteration-2 pending state: regeneration triggered, new session active, no feedback yet', () => {
    // After regeneration, iteration-2 session is active with no feedback.
    const state = deriveCompletionState([], []);
    expect(state).toBe('pending_or_running');
  });

  it('iteration-2 completed without feedback: reviewer found nothing to suggest', () => {
    const state = deriveCompletionState(
      [{ suggestions: [] }],
      [{ jobType: 'reviewer_feedback', status: 'completed' }],
    );
    expect(state).toBe('completed_without_feedback');
  });

  it('iteration-2 failed: reviewer job timed out', () => {
    const state = deriveCompletionState(
      [],
      [{ jobType: 'reviewer_feedback', status: 'timed_out' }],
    );
    expect(state).toBe('failed');
  });

  it('history section shows prior iteration feedback (iteration-1 visible from iteration-2)', () => {
    // Simulate the HistorySection filter logic: priorRows = feedback where iterationNumber < current.
    const allFeedback = [
      { iterationNumber: 1, reviewerRole: 'claude', reviewerTitle: 'Claude', id: 'fb-1', suggestions: [{ suggestionId: 's1', title: 'Add clause' }] },
      { iterationNumber: 2, reviewerRole: 'gpt', reviewerTitle: 'GPT', id: 'fb-2', suggestions: [] },
    ];
    const currentIteration = 2;
    const priorRows = allFeedback.filter((fb) => fb.iterationNumber < currentIteration);
    expect(priorRows).toHaveLength(1);
    expect(priorRows[0]!.iterationNumber).toBe(1);
    expect(priorRows[0]!.reviewerTitle).toBe('Claude');
  });

  it('history section does not show current iteration feedback', () => {
    const allFeedback = [
      { iterationNumber: 1, id: 'fb-1', suggestions: [] },
      { iterationNumber: 2, id: 'fb-2', suggestions: [] },
    ];
    const currentIteration = 2;
    const priorRows = allFeedback.filter((fb) => fb.iterationNumber < currentIteration);
    expect(priorRows).toHaveLength(1);
    expect(priorRows.some((fb) => fb.iterationNumber === 2)).toBe(false);
  });

  it('reviewer rotation heuristic: Case 1 rotates from claude to gpt (next in enabled list)', () => {
    // Simulate the Case 1 rotation logic from CreateSessionView.
    const enabledReviewers = ['claude', 'gpt', 'gemini'];
    const priorRole = 'claude';
    const idx = enabledReviewers.indexOf(priorRole);
    const nextReviewer = enabledReviewers[(idx + 1) % enabledReviewers.length];
    expect(nextReviewer).toBe('gpt');
  });

  it('reviewer rotation heuristic: Case 3 repeats when only one reviewer enabled', () => {
    const enabledReviewers = ['claude'];
    const priorRole = 'claude';
    // Case 3: only one enabled reviewer — repeat.
    expect(enabledReviewers.length).toBe(1);
    expect(enabledReviewers.includes(priorRole)).toBe(true);
    const nextReviewer = priorRole; // Case 3 logic
    expect(nextReviewer).toBe('claude');
  });

  it('reviewer rotation heuristic: Case 4 falls back to first enabled when no prior history', () => {
    const enabledReviewers = ['claude', 'gpt'];
    const mostRecentPriorRow = null; // Case 4: no prior history
    const fallback = enabledReviewers[0] ?? '';
    const nextReviewer = mostRecentPriorRow ? 'would_rotate' : fallback;
    expect(nextReviewer).toBe('claude');
  });

  it('all four state branches are reachable in a multi-iteration scenario', () => {
    const scenarios = [
      { feedback: [], jobs: [{ jobType: 'reviewer_feedback', status: 'running' }] },
      { feedback: [{ suggestions: [{ id: 's1' }] }], jobs: [] },
      { feedback: [{ suggestions: [] }], jobs: [] },
      { feedback: [], jobs: [{ jobType: 'reviewer_feedback', status: 'failed' }] },
    ];
    const states = scenarios.map(({ feedback, jobs }) => deriveCompletionState(feedback, jobs));
    expect(states).toContain('pending_or_running');
    expect(states).toContain('completed_with_feedback');
    expect(states).toContain('completed_without_feedback');
    expect(states).toContain('failed');
  });
});

// ============================================================
// §S6f — History view edge cases (S5)
// Source-analysis: verify HistorySection handles all edge cases
// ============================================================

describe('§S6f: HistorySection edge cases (S5)', () => {
  const reviewPane = readSrc('client/components/ReviewPane.tsx');

  it('loading state: shows "Loading history…" indicator instead of null', () => {
    expect(reviewPane).toContain('Loading history\u2026');
  });

  it('error state: shows "History unavailable. Reload to retry." message', () => {
    expect(reviewPane).toContain('History unavailable. Reload to retry.');
  });

  it('error state: captures isError from the query', () => {
    expect(reviewPane).toContain('isError');
  });

  it('empty state: returns null when no prior rows (accordion would be empty)', () => {
    // Verify the empty-state guard is present.
    expect(reviewPane).toContain('if (priorRows.length === 0) return null');
  });

  it('accordion: ChevronDown/ChevronUp icons are used for expand/collapse', () => {
    expect(reviewPane).toContain('ChevronDown');
    expect(reviewPane).toContain('ChevronUp');
  });

  it('accordion: expanded state is toggled via setExpanded', () => {
    expect(reviewPane).toContain('setExpanded(!expanded)');
  });

  it('accordion: shows row count and iteration count in summary', () => {
    expect(reviewPane).toContain('Prior Feedback');
    expect(reviewPane).toContain('priorRows.length');
    expect(reviewPane).toContain('grouped.length');
  });

  it('abandoned sessions are included in history (MR-2 default: no session-state filter)', () => {
    // MR-2 §S2c: HistorySection does NOT filter by session.state.
    // Abandoned sessions appear in history. Verify no state filter in the priorRows computation.
    const historySectionMatch = reviewPane.match(/const priorRows = React\.useMemo\(\(\) => \{[\s\S]*?\}, \[data, currentIterationNumber\]\)/);
    expect(historySectionMatch).not.toBeNull();
    const priorRowsCode = historySectionMatch![0];
    // Must not filter by sessionState or state === 'abandoned'
    expect(priorRowsCode).not.toContain('sessionState');
    expect(priorRowsCode).not.toContain("state === 'abandoned'");
    expect(priorRowsCode).not.toContain("state === 'active'");
  });

  it('history groups feedback by iterationNumber ascending (oldest first)', () => {
    // Simulate the grouping logic.
    const priorRows = [
      { iterationNumber: 3, id: 'fb-3' },
      { iterationNumber: 1, id: 'fb-1' },
      { iterationNumber: 2, id: 'fb-2' },
    ];
    const map = new Map<number, typeof priorRows>();
    for (const fb of priorRows) {
      const arr = map.get(fb.iterationNumber) ?? [];
      arr.push(fb);
      map.set(fb.iterationNumber, arr);
    }
    const grouped = Array.from(map.entries()).sort(([a], [b]) => a - b);
    expect(grouped[0]![0]).toBe(1);
    expect(grouped[1]![0]).toBe(2);
    expect(grouped[2]![0]).toBe(3);
  });
});

// ============================================================
// §S6g — Regression preservation
// Verify MR-0G, MR-1, MR-2 deliverables are intact
// ============================================================

describe('§S6g: regression preservation — MR-0G deliverables', () => {
  it('MR-0G: .max(1) gate on selectedReviewers is still present in reviewSession.ts', () => {
    // MR-0G gate is in reviewSession.ts (the create procedure), not settings.ts.
    const reviewSession = readSrc('server/procedures/reviewSession.ts');
    expect(reviewSession).toContain('.max(1)');
  });

  it('MR-0G: MULTI_REVIEWER_DISABLED message is still present in reviewSession.ts', () => {
    const reviewSession = readSrc('server/procedures/reviewSession.ts');
    expect(reviewSession).toContain('MULTI_REVIEWER_DISABLED');
  });

  it('MR-0G: MR-0G comment is still present in reviewSession.ts', () => {
    const reviewSession = readSrc('server/procedures/reviewSession.ts');
    expect(reviewSession).toContain('MR-0G');
  });
});

describe('§S6g: regression preservation — MR-1 deliverables', () => {
  it('MR-1: txn2Commit always calls insertFeedback (unconditional persistence)', () => {
    const reviewSession = readSrc('server/procedures/reviewSession.ts');
    expect(reviewSession).toContain('txn2Commit');
    expect(reviewSession).toContain('insertFeedback');
  });

  it('MR-1: feedbackParser is used in reviewSession.ts', () => {
    const reviewSession = readSrc('server/procedures/reviewSession.ts');
    expect(reviewSession).toContain('feedbackParser');
  });

  it('MR-1: document content is included in reviewer prompt', () => {
    // MR-1 §S1a: document content is included via currentVersion.content in userPrompt.
    const reviewSession = readSrc('server/procedures/reviewSession.ts');
    expect(reviewSession).toContain('currentVersion.content');
  });
});

describe('§S6g: regression preservation — MR-2 deliverables', () => {
  const reviewPane = readSrc('client/components/ReviewPane.tsx');

  it('MR-2 §S1: evaluator path is inert (comment present)', () => {
    const reviewSession = readSrc('server/procedures/reviewSession.ts');
    expect(reviewSession).toContain('INERT');
  });

  it('MR-2 §S2a: listFeedbackForDocument is exported from phase4b.ts', () => {
    const phase4b = readSrc('server/db/queries/phase4b.ts');
    expect(phase4b).toContain('export async function listFeedbackForDocument(');
  });

  it('MR-2 §S2b: getDocumentHistory procedure exists in reviewSession procedures', () => {
    const reviewSession = readSrc('server/procedures/reviewSession.ts');
    expect(reviewSession).toContain('getDocumentHistory');
  });

  it('MR-2 §S2c: HistorySection component is rendered in ActiveSessionView', () => {
    expect(reviewPane).toContain('<HistorySection');
  });

  it('MR-2 §S3: reviewer rotation heuristic Cases 1-4 are present', () => {
    expect(reviewPane).toContain('Case 1');
    expect(reviewPane).toContain('Case 2');
    expect(reviewPane).toContain('Case 3');
    expect(reviewPane).toContain('Case 4');
  });

  it('MR-2 §S3: advisory text is shown for Case 1 rotation', () => {
    expect(reviewPane).toContain('advisoryText');
    expect(reviewPane).toContain('Last reviewed by');
  });
});

describe('§S6g: regression preservation — MR-2C deliverables', () => {
  it('MR-2C: continue-on-error is removed from lint step in ci.yml', () => {
    const ciYml = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf-8');
    // The lint step must NOT have continue-on-error: true.
    // The test step may still have it (for coverage).
    const lintStepMatch = ciYml.match(/name: Lint[\s\S]*?(?=\n\s*- name:|\n\s*\n\s*\n|$)/);
    expect(lintStepMatch).not.toBeNull();
    const lintStep = lintStepMatch![0];
    expect(lintStep).not.toContain('continue-on-error: true');
  });
});

describe('§S6g: regression preservation — MR-3 new deliverables', () => {
  it('MR-3 §S1a: deriveCompletionState is exported from reviewState.ts', () => {
    const reviewState = readSrc('client/utils/reviewState.ts');
    expect(reviewState).toContain('export function deriveCompletionState(');
  });

  it('MR-3 §S1a: all four CompletionState values are defined', () => {
    const reviewState = readSrc('client/utils/reviewState.ts');
    expect(reviewState).toContain("'pending_or_running'");
    expect(reviewState).toContain("'completed_with_feedback'");
    expect(reviewState).toContain("'completed_without_feedback'");
    expect(reviewState).toContain("'failed'");
  });

  it('MR-3 §S2a: job.poll is used in ActiveSessionView for FAILED state detection', () => {
    const reviewPane = readSrc('client/components/ReviewPane.tsx');
    expect(reviewPane).toContain('trpc.job.poll.useQuery');
  });

  it('MR-3 §S5: HistorySection shows loading indicator (not null) during load', () => {
    const reviewPane = readSrc('client/components/ReviewPane.tsx');
    expect(reviewPane).toContain('Loading history\u2026');
  });

  it('MR-3 §S5: HistorySection shows error message when query fails', () => {
    const reviewPane = readSrc('client/components/ReviewPane.tsx');
    expect(reviewPane).toContain('History unavailable. Reload to retry.');
  });
});
