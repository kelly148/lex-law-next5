// @vitest-environment jsdom
/**
 * ChatReviewPanel render test — CHAT-COPILOT-2-INCB (sub-increment B3).
 *
 * The phase-3 prod incident was a React #310 (hooks-order) crash that blanked a whole view, and CI never
 * caught it because CI type-checks but never RENDERS components. This test mounts the FULL ChatReviewPanel
 * under jsdom with a mocked trpc client (no QueryClient, no network) and asserts:
 *   - it renders without throwing React #310 (every mocked useQuery calls a REAL hook — useRef — so a
 *     conditional-hook violation would actually manifest, per the repo convention);
 *   - the reviewer picker shows GPT / Gemini / Grok and NOT Claude;
 *   - the persistent advisory "nothing is applied" banner renders;
 *   - driving the mocked runReview, the disposition badges render (ADOPT / REJECT / MODIFY-AND-ADOPT);
 *   - the DEGRADED states render distinctly: "No reviewers available" (skipped) and "Not yet synthesized"
 *     (failed dispositioner — primaryDisposition null).
 *
 * Deterministic: the mocked mutations return canned results; no real provider or DB is touched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

// vi.hoisted so the mock factory (hoisted above module-level consts) can see the controllable results.
const mockState = vi.hoisted(() => ({
  // What prepareReview / runReview resolve to. Tests mutate these before driving the flow.
  prepareResult: {
    panelConfirmId: '33333333-3333-3333-3333-333333333333',
    reviewers: ['gpt', 'gemini'],
    transmitting: { includedSources: [{ sourceId: 's1', kind: 'material', label: 'Survey.pdf' }], npiWithheldCount: 2, omittedCount: 1, truncated: false, includedAttachmentCount: 0 },
  } as unknown,
  runResult: {
    runId: 'r1',
    status: 'complete',
    dispositionerStatus: 'success',
    items: [
      { id: 'i1', reviewerModel: 'gpt', suggestion: 'Tighten the indemnity clause.', primaryDisposition: 'adopt', primaryReasoning: 'Sound — clarifies scope.', citationStatus: 'in_bundle', attorneyDecision: 'pending', attorneyOverrideReason: null, laneStatus: 'success' },
      { id: 'i2', reviewerModel: 'gemini', suggestion: 'Reject — the survey is fine.', primaryDisposition: 'reject', primaryReasoning: 'Not a defect.', citationStatus: 'unverified', attorneyDecision: 'pending', attorneyOverrideReason: null, laneStatus: 'success' },
      { id: 'i3', reviewerModel: 'gpt', suggestion: 'Reword and keep.', primaryDisposition: 'modify_and_adopt', primaryReasoning: 'Partial.', citationStatus: null, attorneyDecision: 'pending', attorneyOverrideReason: null, laneStatus: 'success' },
    ],
    rawOutputs: [
      { id: 'raw1', reviewerModel: 'gpt', rawText: '[{"suggestion":"Tighten the indemnity clause."}]', laneStatus: 'success', laneFailureReason: null },
      { id: 'raw2', reviewerModel: 'gemini', rawText: null, laneStatus: 'failed', laneFailureReason: 'timeout' },
    ],
  } as unknown,
}));

vi.mock('../../trpc.js', async () => {
  // Real React so each mocked useQuery calls a REAL hook (useRef) — essential so a conditional-hook
  // (#310) violation could actually manifest, exactly like the production incident.
  const React = await import('react');
  const utilsProxy = {
    client: {
      chatReviewPanel: {
        prepareReview: { mutate: () => Promise.resolve(mockState.prepareResult) },
        runReview: { mutate: () => Promise.resolve(mockState.runResult) },
        recordAttorneyDecision: {
          mutate: (args: { itemId: string; decision: 'accept' | 'override'; overrideReason?: string }) =>
            Promise.resolve({ item: { id: args.itemId, reviewerModel: 'gpt', suggestion: 'x', primaryDisposition: 'adopt', primaryReasoning: null, citationStatus: null, attorneyDecision: args.decision, attorneyOverrideReason: args.overrideReason ?? null, laneStatus: 'success' } }),
        },
      },
    },
  };
  return {
    trpc: {
      useUtils: () => utilsProxy,
      chatReviewPanel: {
        isPanelEnabled: {
          useQuery: () => {
            React.useRef(null);
            return { data: { enabled: true }, isLoading: false, error: null, refetch: () => {} };
          },
        },
      },
    },
  };
});

import ChatReviewPanel from '../ChatReviewPanel.js';

const PROPS = {
  conversation: { id: '11111111-1111-1111-1111-111111111111', matterId: '22222222-2222-2222-2222-222222222222' },
  message: { id: '44444444-4444-4444-4444-444444444444', content: 'The assistant work product under review.' },
  onClose: () => {},
};

afterEach(() => {
  cleanup();
});

describe('ChatReviewPanel — render + flow (React #310 guard)', () => {
  it('renders the picker with GPT/Gemini/Grok and NOT Claude, plus the advisory banner', () => {
    const { getByTestId, getByText, queryByText } = render(<ChatReviewPanel {...PROPS} />);
    // Mounts without #310.
    expect(getByTestId('chat-review-panel')).toBeTruthy();
    // The reviewer picker — GPT / Gemini / Grok present, Claude absent.
    expect(getByTestId('chat-review-pick-gpt')).toBeTruthy();
    expect(getByTestId('chat-review-pick-gemini')).toBeTruthy();
    expect(getByTestId('chat-review-pick-grok')).toBeTruthy();
    expect(queryByText('Claude')).toBeNull();
    // The persistent advisory "nothing is applied" banner.
    expect(getByTestId('chat-review-advisory')).toBeTruthy();
    expect(getByText(/nothing here is applied to your work product/i)).toBeTruthy();
  });

  it('drives pick -> confirm -> review and renders the disposition badges', async () => {
    const { getByTestId, findByTestId, getAllByTestId, getByText } = render(<ChatReviewPanel {...PROPS} />);
    // Pick a reviewer, then prepare.
    fireEvent.click(getByTestId('chat-review-pick-gpt'));
    fireEvent.click(getByTestId('chat-review-prepare'));
    // CONFIRM step renders the transmitting set.
    await findByTestId('chat-review-confirm');
    expect(getByText('Survey.pdf')).toBeTruthy();
    // Confirm & send -> run review.
    fireEvent.click(getByTestId('chat-review-confirm-send'));
    await findByTestId('chat-review-results');
    // The three disposition badges render (ADOPT / REJECT / MODIFY-AND-ADOPT).
    const badges = getAllByTestId('chat-review-disposition').map((el) => el.textContent);
    expect(badges).toContain('ADOPT');
    expect(badges).toContain('REJECT');
    expect(badges).toContain('MODIFY-AND-ADOPT');
    // The unverified citation chip flags (not rejects).
    expect(getByText(/unverified against bundle — verify/)).toBeTruthy();
  });

  it('renders the DEGRADED "No reviewers available" state (dispositionerStatus skipped)', async () => {
    mockState.runResult = { runId: 'r2', status: 'complete', dispositionerStatus: 'skipped', items: [], rawOutputs: [] };
    const { getByTestId, findByTestId, getByText } = render(<ChatReviewPanel {...PROPS} />);
    fireEvent.click(getByTestId('chat-review-pick-gpt'));
    fireEvent.click(getByTestId('chat-review-prepare'));
    await findByTestId('chat-review-confirm');
    fireEvent.click(getByTestId('chat-review-confirm-send'));
    await findByTestId('chat-review-skipped');
    expect(getByText(/No reviewers available/)).toBeTruthy();
  });

  it('renders the DEGRADED "Not yet synthesized" state (dispositioner failed, primaryDisposition null)', async () => {
    mockState.runResult = {
      runId: 'r3',
      status: 'complete',
      dispositionerStatus: 'failed',
      items: [
        { id: 'j1', reviewerModel: 'grok', suggestion: 'Raw critique text.', primaryDisposition: null, primaryReasoning: null, citationStatus: null, attorneyDecision: 'pending', attorneyOverrideReason: null, laneStatus: 'success' },
      ],
      rawOutputs: [{ id: 'raw3', reviewerModel: 'grok', rawText: 'verbatim', laneStatus: 'success', laneFailureReason: null }],
    };
    const { getByTestId, findByTestId, getAllByText } = render(<ChatReviewPanel {...PROPS} />);
    fireEvent.click(getByTestId('chat-review-pick-grok'));
    fireEvent.click(getByTestId('chat-review-prepare'));
    await findByTestId('chat-review-confirm');
    fireEvent.click(getByTestId('chat-review-confirm-send'));
    await findByTestId('chat-review-failed');
    // The item shows "Not yet synthesized" rather than a disposition badge (banner + chip both match).
    expect(getAllByText(/Not yet synthesized/).length).toBeGreaterThan(0);
    expect(getByTestId('chat-review-unsynthesized')).toBeTruthy();
  });
});
