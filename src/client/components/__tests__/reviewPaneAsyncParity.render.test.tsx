// @vitest-environment jsdom
/**
 * ASYNC-LANE-DISPLAY-PARITY-1 — the async reviewer lane reaches display + interaction PARITY with the sync
 * ReviewPane path. Mounts the FULL ActiveSessionView with a NON-NULL data.lanes (the async path) and asserts:
 *   1. arrived suggestions render via the SHARED SuggestionCard — clean (stripEmbeddedCardsJson), NEVER the
 *      raw STRUCTURED_FEEDBACK_CARDS JSON marker (the bug AsyncLaneReviewView used to show);
 *   2. the per-suggestion Accept / Decline / Decline & lock controls are present (the shared card);
 *   3. the regenerate footer is present;
 *   4. the honest N-of-M header + per-lane status strip still render while the run is partial (condition 1);
 *   5. an all-terminal, zero-suggestion run shows the honest "no suggestions" line.
 *
 * As in the #310 guard suites, the mocked tRPC useQuery calls a REAL React hook (useRef) so hook counts
 * behave like production.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
  buildReviewerLanesContract,
  isTerminalLaneStatus,
  type ReviewerLaneView,
  type ReviewerLaneStatus,
} from '../../../shared/schemas/reviewerLaneState.js';

const { SESSION_ID, DOCUMENT_ID, MATTER_ID } = vi.hoisted(() => ({
  SESSION_ID: '11111111-1111-1111-1111-111111111111',
  DOCUMENT_ID: '22222222-2222-2222-2222-222222222222',
  MATTER_ID: '33333333-3333-3333-3333-333333333333',
}));

const RAW_CARDS_MARKER = 'STRUCTURED_FEEDBACK_CARDS';

const baseSession = (over: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  iterationNumber: 2,
  selectedReviewers: ['gpt', 'claude'],
  selections: [],
  globalInstructions: '',
  state: 'active',
  createdAt: '2026-06-05T16:00:00.000Z',
  ...over,
});

// A reviewer body that carries the embedded cards JSON. With nativeCards empty, SuggestionCard renders the
// narrative via stripEmbeddedCardsJson — the attorney must NEVER see the raw STRUCTURED_FEEDBACK_CARDS marker.
const feedbackWithMarker = [
  {
    id: 'f1',
    reviewerRole: 'gpt',
    reviewerTitle: 'GPT-5',
    reviewerModel: 'openai:gpt-5.5',
    iterationNumber: 2,
    suggestions: [
      {
        suggestionId: 's1',
        title: 'Governing law blank',
        body: `NARRATIVE_REVIEWER_MEMO: The governing-law clause is blank.\n${RAW_CARDS_MARKER}\n[{"severity":"major","issue":"blank"}]`,
        severity: 'major',
        nativeCards: [],
      },
    ],
  },
];

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

const mockState = vi.hoisted(() => ({
  reviewSessionGet: { data: undefined as unknown, isLoading: false, isError: false },
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
      settings: { get: { useQuery: q({ reviewerEnablement: { gpt: true, claude: true }, multiReviewerEnabled: true }) } },
      reviewSession: {
        get: {
          useQuery: () => {
            React.useRef(null);
            return { ...mockState.reviewSessionGet, error: null, refetch: () => {} };
          },
        },
        listLockedDecisions: { useQuery: q({ lockedDecisions: [] }) },
        listAdoptLedger: { useQuery: q({ adoptLedger: [] }) },
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

import { ActiveSessionView } from '../ReviewPane.js';

const AV_PROPS = { sessionId: SESSION_ID, documentId: DOCUMENT_ID, onClose: () => {} };

afterEach(() => cleanup());

describe('ASYNC-LANE-DISPLAY-PARITY-1 — async lane reaches parity with the sync path', () => {
  // A PARTIAL async run: gpt returned (1 suggestion, with the embedded-cards body), claude still running.
  const partialLanes = buildReviewerLanesContract([lane('gpt', 'completed_with_feedback', 1), lane('claude', 'running')]);
  beforeEach(() => {
    try { window.localStorage.clear(); } catch { /* ignore */ }
    mockState.reviewSessionGet = {
      data: { session: baseSession(), feedback: feedbackWithMarker, evaluation: null, lanes: partialLanes },
      isLoading: false,
      isError: false,
    };
  });

  it('renders the arrived suggestion via the SHARED SuggestionCard with the CLEAN narrative — never the raw STRUCTURED_FEEDBACK_CARDS JSON', () => {
    const { getByTestId, getByText, container } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(getByTestId('suggestion-card')).toBeTruthy();
    expect(getByText('Governing law blank')).toBeTruthy();
    // stripEmbeddedCardsJson dropped the NARRATIVE label + the raw cards JSON; only the clean prose shows.
    expect(getByText('The governing-law clause is blank.')).toBeTruthy();
    expect(container.innerHTML).not.toContain(RAW_CARDS_MARKER); // the raw marker NEVER reaches the attorney
  });

  it('exposes the per-suggestion controls (Accept / Decline / Decline & lock) wired to the shared card', () => {
    const { getByTestId, getByText } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(getByTestId('accept-into-next-draft')).toBeTruthy();
    expect(getByText('Decline')).toBeTruthy();
    expect(getByText(/Decline & lock/)).toBeTruthy();
  });

  it('exposes the regenerate footer in the async lane', () => {
    const { getByTestId, getByText } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(getByTestId('apply-accepted')).toBeTruthy();
    expect(getByText('Close session')).toBeTruthy();
  });

  it('PRESERVES the honest N-of-M header + per-lane status strip while the run is partial (condition 1)', () => {
    const { getByTestId } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(getByTestId('async-lane-header').textContent).toMatch(/1 of 2 reviewers returned/);
    expect(getByTestId('lane-claude').getAttribute('data-status')).toBe('running');
    expect(getByTestId('lane-gpt').getAttribute('data-status')).toBe('completed_with_feedback');
  });

  it('all terminal but zero suggestions → the honest "no suggestions" line renders', () => {
    const allTerminalNoSuggestions = buildReviewerLanesContract([
      lane('gpt', 'completed_without_feedback', 0),
      lane('claude', 'completed_without_feedback', 0),
    ]);
    mockState.reviewSessionGet = {
      data: { session: baseSession(), feedback: [], evaluation: null, lanes: allTerminalNoSuggestions },
      isLoading: false,
      isError: false,
    };
    const { getByTestId } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(getByTestId('async-lane-no-suggestions')).toBeTruthy();
  });
});
