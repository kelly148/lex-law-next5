// @vitest-environment jsdom
/**
 * Whereas R2-2 Inc A — review-pane clarity render tests.
 *
 * Inc A surfaces, in the session-info strip:
 *   - the honest N-of-M denominator ("X of N configured reviewers returned substantive feedback"),
 *     reused from the server-computed orchestration consolidation (not re-derived in the client);
 *   - the "review basis" line (the anti-stale safeguard: WHICH draft this review judged + WHEN).
 *
 * Per Kelly's DoD: render tests for all-returned / partial / floor-not-met, plus review basis.
 * Assertions use container.textContent (the denominator spans a <p> with a nested <span>, so a
 * substring getByText would be ambiguous). The mocked useQuery calls a real React hook (useRef)
 * so hook counts behave like production (the #310 guard discipline).
 *
 * vi.mock is hoisted, so everything the factory reads lives in vi.hoisted() (mockState) and the
 * factory uses literal ids — referencing module-level consts from the factory throws at hoist time.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const SESSION_ID = '11111111-1111-1111-1111-111111111111';
const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';

const mockState = vi.hoisted(() => ({
  consolidation: { data: undefined as unknown },
  // A loaded, completed-with-feedback session (one substantive suggestion -> completed_with_feedback),
  // with a createdAt so the review-basis line renders.
  reviewSessionGet: {
    data: {
      session: {
        id: '11111111-1111-1111-1111-111111111111',
        iterationNumber: 2,
        selectedReviewers: ['claude', 'gpt'],
        selections: [],
        globalInstructions: '',
        state: 'active',
        createdAt: '2026-06-05T16:00:00.000Z',
      },
      feedback: [
        {
          id: 'f1',
          reviewerRole: 'claude',
          reviewerTitle: 'Claude',
          reviewerModel: 'anthropic:claude-opus',
          iterationNumber: 2,
          suggestions: [
            { suggestionId: 's1', title: 'A point', body: 'Narrative body.', severity: 'minor', nativeCards: [] },
          ],
        },
      ],
      evaluation: null,
    } as unknown,
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
      settings: { get: { useQuery: q({ reviewerEnablement: {}, multiReviewerEnabled: true }) } },
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
      orchestration: {
        getConsolidation: {
          useQuery: () => {
            React.useRef(null);
            return { data: mockState.consolidation.data, isLoading: false, isError: false, error: null };
          },
        },
      },
      provisionProvenance: { listForDocument: { useQuery: q([]) } },
      document: { get: { useQuery: q({ currentVersionId: null, matterId: '22222222-2222-2222-2222-222222222222' }) } },
      matterState: { dashboard: { useQuery: q(undefined) } },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import { ActiveSessionView } from '../ReviewPane.js';

const PROPS = { sessionId: SESSION_ID, documentId: DOCUMENT_ID, onClose: () => {} };

const consolidation = (
  successful: number,
  intended: number,
  missing: string[],
  convergenceFloorMet: boolean,
) => ({
  denominator: { successful, intended, missing },
  convergenceFloorMet,
  groups: [],
  divergentItems: [],
  bulkEligibleGroups: [],
  bulkEligibleIssueIds: [],
});

afterEach(() => cleanup());
beforeEach(() => {
  mockState.consolidation = { data: undefined };
});

describe('ActiveSessionView — R2-2 Inc A denominator + review basis (now in the status tooltip)', () => {
  // REVIEW-UX-REDESIGN-1: the status line is humanized to "N reviewer(s) responded"; the honest
  // N-of-M denominator, the non-returning reviewers, the convergence-floor note, and the review-basis
  // line all move into the (i) tooltip (title + aria-label). Those live in attribute values, so these
  // assertions read container.innerHTML (which includes attributes), not textContent. The humanized
  // line itself is asserted via textContent. The safety content is preserved — only its surface moved.
  it('all reviewers returned: tooltip shows "2 of 2", no "No return" / floor note; line says "2 reviewers responded"', () => {
    mockState.consolidation = { data: consolidation(2, 2, [], true) };
    const { container } = render(<ActiveSessionView {...PROPS} />);
    expect(container.innerHTML).toMatch(/2 of 2/);
    expect(container.innerHTML).toContain('returned substantive feedback');
    expect(container.innerHTML).not.toContain('No return:');
    expect(container.innerHTML).not.toContain('Fewer than two');
    expect(container.textContent).toContain('2 reviewers responded');
  });

  it('partial return: "1 of 2", names the non-returning reviewer, flags the floor; line says "treat as preliminary"', () => {
    mockState.consolidation = { data: consolidation(1, 2, ['gpt'], false) };
    const { container } = render(<ActiveSessionView {...PROPS} />);
    expect(container.innerHTML).toMatch(/1 of 2/);
    expect(container.innerHTML).toContain('No return: GPT');
    expect(container.innerHTML).toContain('Fewer than two');
    expect(container.textContent).toContain('treat as preliminary');
  });

  it('review basis line names the reviewed iteration (anti-stale safeguard)', () => {
    mockState.consolidation = { data: consolidation(2, 2, [], true) };
    const { container } = render(<ActiveSessionView {...PROPS} />);
    expect(container.innerHTML).toContain('Review basis:');
    expect(container.innerHTML).toMatch(/iteration 2/);
  });
});
