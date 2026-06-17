// @vitest-environment jsdom
/**
 * REVIEW-UX-REDESIGN-1 — render gate for the redesigned review session.
 *
 * Covers the genuinely-new surfaces that the older suites don't:
 *   1. The per-suggestion SuggestionCard — severity chip, serif title, Issue/Recommend/Revision rows,
 *      the prominent "Attorney decision required" signal, and the THREE decision controls
 *      (Accept into next draft / Decline / Decline & lock). No green anywhere.
 *   2. The apply footer — dynamic label ("Generate revised draft (new iteration)" at 0 accepted;
 *      "Apply N accepted edit(s) → new draft" when accepted) + "Close session".
 *   3. The on-demand reference-tool overlay (a header icon opens a floating ReviewToolOverlay).
 *   4. The resizable + two-level-collapsible document pane (expanded -> rail -> hidden -> show),
 *      asserting the G6-protected review slot is never disturbed.
 *
 * As in the #310 guard suites, the mocked tRPC useQuery calls a REAL React hook (useRef) so hook
 * counts behave like production.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

// Hoisted alongside the vi.mock factory so MATTER_ID is initialized before the hoisted factory runs
// (a plain top-level const would be in its temporal dead zone — TDZ — when the factory executes).
const { SESSION_ID, DOCUMENT_ID, MATTER_ID } = vi.hoisted(() => ({
  SESSION_ID: '11111111-1111-1111-1111-111111111111',
  DOCUMENT_ID: '22222222-2222-2222-2222-222222222222',
  MATTER_ID: '33333333-3333-3333-3333-333333333333',
}));

const baseSession = (over: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  iterationNumber: 2,
  selectedReviewers: ['claude'],
  selections: [],
  globalInstructions: '',
  state: 'active',
  createdAt: '2026-06-05T16:00:00.000Z',
  ...over,
});

const feedbackWithCard = [
  {
    id: 'f1',
    reviewerRole: 'claude',
    reviewerTitle: 'Claude',
    reviewerModel: 'anthropic:claude-opus',
    iterationNumber: 2,
    suggestions: [
      {
        suggestionId: 's1',
        title: 'Governing law state left blank',
        body: 'Narrative body.',
        severity: 'major',
        nativeCards: [
          {
            severity: 'major',
            requires_attorney_decision: true,
            critique_type: 'precision',
            audience_affected: ['principal'],
            issue: 'The governing-law clause is blank.',
            recommendation: 'Insert the chosen state.',
            suggested_revision: 'governed by the laws of the Commonwealth of Virginia.',
          },
        ],
      },
    ],
  },
];

const mockState = vi.hoisted(() => ({
  reviewSessionGet: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
  },
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  const q = (data: unknown) => () => {
    React.useRef(null);
    return { data, isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      useUtils: () => utilsProxy,
      Provider: ({ children }: { children: React.ReactNode }) => children,
      createClient: () => ({}),
      job: { poll: { useQuery: q({ jobs: [] }) } },
      settings: { get: { useQuery: q({ reviewerEnablement: { claude: true }, multiReviewerEnabled: false }) } },
      reviewSession: {
        get: {
          useQuery: () => {
            React.useRef(null);
            return { ...mockState.reviewSessionGet, error: null, refetch: () => {} };
          },
        },
        listLockedDecisions: { useQuery: q({ lockedDecisions: [] }) },
        listAdoptLedger: { useQuery: q({ adoptLedger: [] }) },
        listSuggestionDispositions: { useQuery: q({ dispositions: [] }) },
        checkSendability: { useQuery: q(null) },
        getDocumentHistory: { useQuery: q({ feedback: [], sessions: [], selections: [] }) },
      },
      orchestration: { getConsolidation: { useQuery: q(undefined) } },
      provisionProvenance: { listForDocument: { useQuery: q([]) } },
      document: { get: { useQuery: q({ currentVersionId: 'v1', title: 'POA', matterId: MATTER_ID }) } },
      version: { list: { useQuery: q([{ id: 'v1', versionNumber: 1, content: 'Body', createdAt: '2026-06-07' }]) } },
      matterState: { dashboard: { useQuery: q(undefined) } },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import ReviewPane, { ActiveSessionView } from '../ReviewPane.js';

const AV_PROPS = { sessionId: SESSION_ID, documentId: DOCUMENT_ID, onClose: () => {} };

afterEach(() => cleanup());
beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* ignore */ }
  mockState.reviewSessionGet = { data: { session: baseSession(), feedback: feedbackWithCard, evaluation: null }, isLoading: false, isError: false };
});

describe('REVIEW-UX-REDESIGN-1 — SuggestionCard + three decision states', () => {
  it('renders a per-suggestion card with the structured rows + the attorney-decision signal', () => {
    const { getByTestId, getByText } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(getByTestId('suggestion-card')).toBeTruthy();
    expect(getByText('Governing law state left blank')).toBeTruthy();
    expect(getByText(/Attorney decision required/)).toBeTruthy();
    expect(getByText('Issue')).toBeTruthy();
    expect(getByText('Recommend')).toBeTruthy();
    expect(getByText('Revision')).toBeTruthy();
  });

  it('offers all three decision controls (Accept into next draft / Decline / Decline & lock)', () => {
    const { getByTestId, getByText } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(getByTestId('accept-into-next-draft')).toBeTruthy();
    expect(getByText('Decline')).toBeTruthy();
    expect(getByText(/Decline & lock/)).toBeTruthy();
  });

  it('uses no green anywhere in the rendered review pane', () => {
    const { container } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(container.innerHTML).not.toMatch(/bg-success|text-success|bg-green|text-green/);
  });
});

describe('REVIEW-UX-REDESIGN-1 — apply footer', () => {
  it('at 0 accepted the apply button stays useful with the new-iteration label + Close session', () => {
    const { getByText } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(getByText('Generate revised draft (new iteration)')).toBeTruthy();
    expect(getByText('Close session')).toBeTruthy();
  });

  it('with an accepted suggestion the apply button reads "Apply N accepted edit → new draft"', () => {
    mockState.reviewSessionGet = {
      data: { session: baseSession({ selections: [{ suggestionId: 's1', note: null }] }), feedback: feedbackWithCard, evaluation: null },
      isLoading: false,
      isError: false,
    };
    const { getByText } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(getByText('Apply 1 accepted edit → new draft')).toBeTruthy();
    expect(getByText(/Accepted for next draft/)).toBeTruthy();
  });
});

describe('REVIEW-UX-REDESIGN-1 — on-demand reference-tool overlay', () => {
  it('a header icon opens a floating overlay (zero docked width)', () => {
    const { getByLabelText, queryByTestId, getAllByLabelText } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(queryByTestId('review-tool-overlay')).toBeNull();
    fireEvent.click(getByLabelText('Provision provenance'));
    expect(queryByTestId('review-tool-overlay')).toBeTruthy();
    // The overlay closes via its labelled control.
    fireEvent.click(getAllByLabelText('Close')[0]!);
    expect(queryByTestId('review-tool-overlay')).toBeNull();
  });
});

describe('REVIEW-UX-REDESIGN-1 — resizable + collapsible document pane (two-state: show ↔ hide)', () => {
  function wideMatchMedia() {
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches: true, media: '', onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
    });
  }

  it('expanded by default: doc pane + drag handle; Hide document -> hidden -> Show document restores (slot never remounts)', () => {
    wideMatchMedia();
    const { getByTestId, queryByTestId, getByLabelText } = render(
      <ReviewPane documentId={DOCUMENT_ID} iterationNumber={1} onClose={() => {}} />,
    );
    // expanded: the resizable doc pane + a drag handle, the stable review slot, no restore button.
    const slot = getByTestId('review-slot');
    expect(queryByTestId('review-doc-pane-wrap')).toBeTruthy();
    expect(queryByTestId('review-doc-resize')).toBeTruthy();
    expect(queryByTestId('review-show-document')).toBeNull();

    // REVIEW-UX-REDESIGN-1-FIX: a SINGLE "Hide document" control (the redundant rail level was removed) —
    // the doc pane + handle unmount and the top-left "Show document" restore appears.
    fireEvent.click(getByLabelText('Hide document'));
    expect(queryByTestId('review-doc-pane-wrap')).toBeNull();
    expect(queryByTestId('review-doc-resize')).toBeNull();
    expect(queryByTestId('review-show-document')).toBeTruthy();
    // the review slot was never remounted by the collapse (G6).
    expect(getByTestId('review-slot')).toBe(slot);

    // restore via the top-left "Show document".
    fireEvent.click(getByTestId('review-show-document'));
    expect(queryByTestId('review-doc-pane-wrap')).toBeTruthy();
    expect(queryByTestId('review-show-document')).toBeNull();
    expect(getByTestId('review-slot')).toBe(slot);
  });
});
