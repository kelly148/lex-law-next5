// @vitest-environment jsdom
/**
 * REVIEWER-ASYNC-DISPLAY-1 (Component C, C-4) — late-reopen additivity (condition 7) + the audit
 * snapshot (condition 9) + the incompleteness signal (condition 8).
 *
 * condition 7: a late lane arrival reopens the pane ADDITIVELY — it must never reset, reorder, or
 * re-derive what the attorney has already seen/adopted. The async view is display-only (it does NOT
 * write selections); the actual clobber guard is server-side (assertSessionActive + assertNotComplete
 * in reviewSession.updateSelection, unchanged). Proven here by a re-render that preserves prior content.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, screen } from '@testing-library/react';
import { AsyncLaneReviewView } from '../AsyncLaneReviewView.js';
import {
  buildReviewerLanesContract,
  isTerminalLaneStatus,
  type ReviewerLaneView,
  type ReviewerLaneStatus,
} from '../../../shared/schemas/reviewerLaneState.js';

const repoRoot = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

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

describe('condition 7 — late reopen is strictly additive (no clobber/reorder/re-derive)', () => {
  it('a newly-arrived lane is strictly additive in the header strip (no reset / reorder / re-derive)', () => {
    // ASYNC-LANE-DISPLAY-PARITY-1: the lane HEADER now owns the additive reopen signal (the per-lane strip +
    // honest N-of-M); the arrived suggestions render via the shared SuggestionCard list in ReviewPane (the
    // content-additivity is covered in reviewPaneAsyncParity.render.test.tsx). condition 7 is preserved: a
    // late arrival never resets or reorders what was already shown.
    const partial = buildReviewerLanesContract([lane('claude', 'completed_with_feedback', 1), lane('gpt', 'running')]);
    const { rerender } = render(<AsyncLaneReviewView lanes={partial} />);
    expect(screen.getByTestId('async-lane-header').textContent).toMatch(/1 of 2 reviewers returned/);
    expect(screen.getByTestId('lane-claude').getAttribute('data-status')).toBe('completed_with_feedback');
    expect(screen.getByTestId('lane-gpt').getAttribute('data-status')).toBe('running');

    // gpt's late result arrives — the pane "reopens" with the larger set; claude's lane is UNCHANGED.
    const complete = buildReviewerLanesContract([lane('claude', 'completed_with_feedback', 1), lane('gpt', 'completed_with_feedback', 1)]);
    rerender(<AsyncLaneReviewView lanes={complete} />);
    expect(screen.getByTestId('async-lane-header').textContent).toMatch(/All 2 reviewers returned/);
    expect(screen.getByTestId('lane-claude').getAttribute('data-status')).toBe('completed_with_feedback'); // additive — unchanged
    expect(screen.getByTestId('lane-gpt').getAttribute('data-status')).toBe('completed_with_feedback');
  });

  it('the async view is display-only — it never writes selections (cannot clobber adopt/modify/pass)', () => {
    const src = read('src/client/components/AsyncLaneReviewView.tsx');
    expect(src).not.toMatch(/updateSelection|useMutation/);
  });

  it('the server-side selection clobber guard (assertSessionActive + assertNotComplete) is unchanged', () => {
    const reviewSession = read('src/server/procedures/reviewSession.ts');
    expect(reviewSession).toContain("assertSessionActive(session.state, 'reviewSession.updateSelection');");
    expect(reviewSession).toContain("assertNotComplete(doc.workflowState, 'reviewSession.updateSelection');");
  });
});

describe('condition 9 — audit snapshot at send (malpractice-defense artifact)', () => {
  it('recordSend captures the reviewer-completion snapshot into the audit payload (best-effort)', () => {
    const chatUi = read('src/server/procedures/chatUi.ts');
    expect(chatUi).toContain('kind: \'reviewer_completion_snapshot\'');
    expect(chatUi).toContain('await listReviewerLanesForSession(latest.id, ctx.userId)');
    expect(chatUi).toContain('...(reviewerSnapshot !== null ? { payload: reviewerSnapshot } : {})');
  });
});
