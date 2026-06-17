// @vitest-environment jsdom
/**
 * REVIEW-LOOP-UX-1 / R1 — inline adopt / reject / defer per reviewer suggestion (render gate).
 *
 * Asserts the genuinely-new R1 surfaces:
 *   1. SuggestionCard exposes the adopt / reject / defer affordances (adopt = the existing
 *      "Accept into next draft" → selection→ledger path; reject = the recorded Decline;
 *      defer = the new recorded Defer), plus the existing decline-&-lock.
 *   2. REJECT and DEFER each fire reviewSession.dispositionSuggestion (the existing disposition event).
 *   3. The running adopt-ledger state reflects inline: a ledgered suggestion shows "In adopt ledger"
 *      (reads listAdoptLedger); a recorded reject/defer reflects inline (reads listSuggestionDispositions).
 *   4. The FOLD-ORCH-1 convergent-bucket BULK-adopt requires a scroll-acknowledge: "Confirm group" is
 *      DISABLED on expand and ENABLES only after the member list is scrolled to its end. The
 *      convergent/divergent classification comes from the existing orchestration consolidation.
 *
 * As in the #310 guard suites, the mocked tRPC useQuery calls a REAL React hook (useRef) so hook
 * counts behave like production; useGuardedMutation is mocked to capture which procedure fired.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach, fireEvent } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const { SESSION_ID, DOCUMENT_ID, MATTER_ID } = vi.hoisted(() => ({
  SESSION_ID: '11111111-1111-1111-1111-111111111111',
  DOCUMENT_ID: '22222222-2222-2222-2222-222222222222',
  MATTER_ID: '33333333-3333-3333-3333-333333333333',
}));

// Capture every mutation fired so the tests can assert wiring (dispositionSuggestion vs others).
const mutationCalls = vi.hoisted(() => ({ calls: [] as Array<{ key: string; input: unknown }> }));

const baseSession = (over: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  iterationNumber: 2,
  selectedReviewers: ['claude', 'gpt'],
  selections: [],
  globalInstructions: '',
  state: 'active',
  createdAt: '2026-06-05T16:00:00.000Z',
  ...over,
});

const feedback = [
  {
    id: 'f1',
    reviewerRole: 'claude',
    reviewerTitle: 'Claude',
    reviewerModel: 'anthropic:claude-opus',
    iterationNumber: 2,
    suggestions: [
      { suggestionId: 's1', title: 'Add governing-law clause', body: 'Narrative body.', severity: 'major', nativeCards: [] },
      { suggestionId: 's2', title: 'Tighten indemnity', body: 'Narrative body 2.', severity: 'minor', nativeCards: [] },
    ],
  },
];

const bulkConsolidation = {
  groups: [
    { issueId: 'g1', severity: 'PRECISION', classification: 'convergent_low_risk', bucket: 'bulk_eligible', convergent: true, bulkEligible: true, agreedCount: 2, reason: 'convergent low-risk' },
  ],
  denominator: { intended: 2, successful: 2, missing: [] },
  convergenceFloorMet: true,
  bulkEligibleIssueIds: ['g1'],
  bulkEligibleGroups: [
    {
      issueId: 'g1',
      severity: 'PRECISION',
      agreedCount: 2,
      members: [
        { suggestionId: 's1', reviewerRole: 'claude', position: 'Add the clause' },
        { suggestionId: 's2', reviewerRole: 'gpt', position: 'Add the clause' },
      ],
    },
  ],
  divergentItems: [],
};

const mockState = vi.hoisted(() => ({
  reviewSessionGet: { data: undefined as unknown, isLoading: false, isError: false },
  adoptLedger: { adoptLedger: [] as Array<Record<string, unknown>> },
  dispositions: { dispositions: [] as Array<Record<string, unknown>> },
  consolidation: undefined as unknown,
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  const q = (data: unknown) => () => {
    React.useRef(null);
    return { data, isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  const live = (read: () => unknown) => () => {
    React.useRef(null);
    return { data: read(), isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      useUtils: () => utilsProxy,
      Provider: ({ children }: { children: React.ReactNode }) => children,
      createClient: () => ({}),
      job: { poll: { useQuery: q({ jobs: [] }) } },
      settings: { get: { useQuery: q({ reviewerEnablement: { claude: true, gpt: true }, multiReviewerEnabled: true }) } },
      reviewSession: {
        get: { useQuery: live(() => mockState.reviewSessionGet.data) },
        listLockedDecisions: { useQuery: q({ lockedDecisions: [] }) },
        listAdoptLedger: { useQuery: live(() => mockState.adoptLedger) },
        listSuggestionDispositions: { useQuery: live(() => mockState.dispositions) },
        checkSendability: { useQuery: q(null) },
        getDocumentHistory: { useQuery: q({ feedback: [], sessions: [], selections: [] }) },
      },
      orchestration: { getConsolidation: { useQuery: live(() => mockState.consolidation) } },
      provisionProvenance: { listForDocument: { useQuery: q([]) } },
      document: { get: { useQuery: q({ currentVersionId: 'v1', title: 'POA', matterId: MATTER_ID }) } },
      version: { list: { useQuery: q([{ id: 'v1', versionNumber: 1, content: 'Body', createdAt: '2026-06-07' }]) } },
      matterState: { dashboard: { useQuery: q(undefined) } },
    },
  };
});

// Capture mutation calls; recover which procedure fired from the mutationFn source.
vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: (fn: (input: unknown) => unknown) => ({
    mutate: (input: unknown) => {
      const src = String(fn);
      const key = /dispositionSuggestion/.test(src)
        ? 'dispositionSuggestion'
        : /updateSelection/.test(src)
          ? 'updateSelection'
          : /lockDecision/.test(src)
            ? 'lockDecision'
            : 'other';
      mutationCalls.calls.push({ key, input });
    },
    isPending: false,
    error: null,
  }),
}));

import { ActiveSessionView } from '../ReviewPane.js';
import OrchestrationConsolidationPanel from '../OrchestrationConsolidationPanel.js';

const AV_PROPS = { sessionId: SESSION_ID, documentId: DOCUMENT_ID, onClose: () => {} };

afterEach(() => cleanup());
beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* ignore */ }
  mutationCalls.calls = [];
  mockState.reviewSessionGet = { data: { session: baseSession(), feedback, evaluation: null }, isLoading: false, isError: false };
  mockState.adoptLedger = { adoptLedger: [] };
  mockState.dispositions = { dispositions: [] };
  mockState.consolidation = undefined;
});

describe('REVIEW-LOOP-UX-1 R1 — adopt / reject / defer affordances', () => {
  it('renders adopt (accept), reject (decline), and defer controls plus decline-&-lock per suggestion', () => {
    const { getAllByTestId, getAllByText } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(getAllByTestId('accept-into-next-draft').length).toBeGreaterThan(0);
    expect(getAllByTestId('reject-suggestion').length).toBeGreaterThan(0);
    expect(getAllByTestId('defer-suggestion').length).toBeGreaterThan(0);
    expect(getAllByText(/Decline & lock/).length).toBeGreaterThan(0);
  });

  it('REJECT records a disposition via the existing disposition event (action=reject)', () => {
    const { getAllByTestId } = render(<ActiveSessionView {...AV_PROPS} />);
    fireEvent.click(getAllByTestId('reject-suggestion')[0]!);
    const disp = mutationCalls.calls.find((c) => c.key === 'dispositionSuggestion');
    expect(disp).toBeTruthy();
    expect((disp!.input as { action: string }).action).toBe('reject');
    expect((disp!.input as { suggestionId: string }).suggestionId).toBe('s1');
  });

  it('DEFER records a disposition via the existing disposition event (action=defer)', () => {
    const { getAllByTestId } = render(<ActiveSessionView {...AV_PROPS} />);
    fireEvent.click(getAllByTestId('defer-suggestion')[0]!);
    const disp = mutationCalls.calls.find((c) => c.key === 'dispositionSuggestion');
    expect(disp).toBeTruthy();
    expect((disp!.input as { action: string }).action).toBe('defer');
  });

  it('surfaces the running adopt-ledger state inline (the In-adopt-ledger badge) for a ledgered suggestion', () => {
    mockState.adoptLedger = { adoptLedger: [{ id: 'a1', sourceSuggestionId: 's1', status: 'active', adoptedText: 'x', disposition: 'adopted_verbatim', sourceIterationNumber: 1, statusSource: 'auto' }] };
    const { getByTestId } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(getByTestId('in-ledger-indicator')).toBeTruthy();
  });

  it('reflects a recorded reject/defer disposition inline ("Deferred — recorded")', () => {
    mockState.dispositions = { dispositions: [{ auditEventId: 'e1', suggestionId: 's2', action: 'defer', rationale: null, documentId: DOCUMENT_ID, reviewSessionId: SESSION_ID, createdAt: new Date() }] };
    const { getByText } = render(<ActiveSessionView {...AV_PROPS} />);
    expect(getByText(/Deferred — recorded/)).toBeTruthy();
  });
});

describe('REVIEW-LOOP-UX-1 R1 — convergent bulk-adopt scroll-acknowledge gate (FOLD-ORCH-1)', () => {
  it('Confirm group is disabled on expand and enables only after the member list is scrolled to its end', () => {
    mockState.consolidation = bulkConsolidation;
    const { getByText, getByTestId, queryByTestId } = render(
      <OrchestrationConsolidationPanel reviewSessionId={SESSION_ID} visible={true} />,
    );
    // Open the panel, then expand the convergent group to reveal its members.
    fireEvent.click(getByText('Multi-model orchestration'));
    fireEvent.click(getByText(/reviewers agreed/));

    const members = getByTestId('bulk-group-members-g1');
    // jsdom reports geometry as 0 by default => the "short list => ack-on-mount" path would auto-ack.
    // Force a scrollable geometry so the gate is meaningful, THEN re-scroll to re-evaluate.
    Object.defineProperty(members, 'scrollHeight', { value: 200, configurable: true });
    Object.defineProperty(members, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(members, 'scrollTop', { value: 0, configurable: true });
    fireEvent.scroll(members); // not at bottom yet

    // The Confirm-group act ("✦ Confirm group") is gated until acknowledged.
    const confirm = getByText('Confirm group').closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(queryByTestId('bulk-scroll-ack-hint-g1')).toBeTruthy();

    // Scroll to the bottom => acknowledged => the act enables.
    Object.defineProperty(members, 'scrollTop', { value: 100, configurable: true }); // 100 + 100 >= 200
    fireEvent.scroll(members);
    expect((getByText('Confirm group').closest('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('divergent items are display-only — no bulk affordance is offered for them', () => {
    mockState.consolidation = {
      ...bulkConsolidation,
      bulkEligibleGroups: [],
      bulkEligibleIssueIds: [],
      divergentItems: [
        { issueId: 'd1', severity: 'substantive', summary: 'Reviewers disagree on indemnity', detail: { positions: [{ reviewerRole: 'claude', severity: 'major', position: 'narrow', suggestionId: 's1' }] } },
      ],
    };
    const { getByText, queryByText } = render(
      <OrchestrationConsolidationPanel reviewSessionId={SESSION_ID} visible={true} />,
    );
    fireEvent.click(getByText('Multi-model orchestration'));
    // A divergent disagreement renders, but there is no "Confirm group" bulk act for it.
    expect(getByText(/Reviewer disagreements/)).toBeTruthy();
    expect(queryByText('Confirm group')).toBeNull();
  });
});
