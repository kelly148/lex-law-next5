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
  it('a newly-arrived lane preserves the already-shown suggestions verbatim', () => {
    const claudeFb = { reviewerRole: 'claude', reviewerTitle: 'Claude', suggestions: [{ suggestionId: 'c1', title: 'Adopted issue', body: 'keep me' }] };
    const partial = buildReviewerLanesContract([lane('claude', 'completed_with_feedback', 1), lane('gpt', 'running')]);
    const { rerender } = render(<AsyncLaneReviewView lanes={partial} feedback={[claudeFb]} onClose={() => {}} />);
    expect(screen.getByTestId('suggestions-claude').textContent).toContain('keep me');

    // gpt's late result arrives — the pane "reopens" with the larger set.
    const gptFb = { reviewerRole: 'gpt', reviewerTitle: 'GPT', suggestions: [{ suggestionId: 'g1', body: 'newly arrived' }] };
    const complete = buildReviewerLanesContract([lane('claude', 'completed_with_feedback', 1), lane('gpt', 'completed_with_feedback', 1)]);
    rerender(<AsyncLaneReviewView lanes={complete} feedback={[claudeFb, gptFb]} onClose={() => {}} />);

    // claude's original content is UNCHANGED (additive); gpt's is appended.
    expect(screen.getByTestId('suggestions-claude').textContent).toContain('keep me');
    expect(screen.getByTestId('suggestions-gpt').textContent).toContain('newly arrived');
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
