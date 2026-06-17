// @vitest-environment jsdom
/**
 * FULL review-pane render test — the real crash path (FOLD-ORCH-1 incident).
 *
 * The phase-3 deploy blanked the document review view with React #310. Root cause: ActiveSessionView
 * called `trpc.reviewSession.listLockedDecisions.useQuery` AFTER its `if (isLoading) return` /
 * `if (!data) return` early returns — a conditional hook. When reviewSession.get's isLoading flips
 * true->false (which the orchestration/provenance panels' extra observers made happen on a
 * re-render), the hook count changes and React throws #310, unmounting the whole view.
 *
 * This test mounts the FULL ActiveSessionView (with its sections + the orchestration/provenance
 * panels) through the loading -> loaded transition and asserts it renders without a hooks
 * violation. It FAILS (#310) if any hook is ever placed below an early return again.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Controllable reviewSession.get result, flipped between renders (vi.hoisted so the mock factory
// can see it — factories are hoisted above module-level consts).
const mockState = vi.hoisted(() => ({
  reviewSessionGet: { data: undefined as unknown, isLoading: true },
}));

vi.mock('../../trpc.js', async () => {
  // Import the REAL React so each mocked useQuery calls a REAL hook (useRef). That is essential:
  // if the mocks were plain functions they would NOT count as hooks, and the conditional-hook
  // (#310) violation could never manifest. With a real useRef inside, a useQuery placed below an
  // early return changes the real hook count between renders -> #310, exactly like production.
  const React = await import('react');
  // Deep no-op proxy for trpc.useUtils() — handles utils.client.X.mutate / utils.X.invalidate.
  const utilsProxy: unknown = new Proxy(function () {}, {
    get: () => utilsProxy,
    apply: () => undefined,
  });
  const q = (data: unknown) => () => {
    React.useRef(null);
    return { data, isLoading: false, error: null, refetch: () => {} };
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
      orchestration: { getConsolidation: { useQuery: q(undefined) } },
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

const SESSION_ID = '11111111-1111-1111-1111-111111111111';
const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';

const LOADED = {
  session: {
    id: SESSION_ID,
    iterationNumber: 1,
    selectedReviewers: ['claude', 'gpt'],
    selections: [],
    globalInstructions: '',
    state: 'active',
  },
  feedback: [],
  evaluation: null,
};

afterEach(() => {
  cleanup();
});
beforeEach(() => {
  mockState.reviewSessionGet = { data: undefined, isLoading: true };
});

describe('ActiveSessionView — full render through loading -> loaded (React #310 guard)', () => {
  it('renders the loading state, then the loaded multi-reviewer session, with a stable hook order', () => {
    const props = { sessionId: SESSION_ID, documentId: DOCUMENT_ID, onClose: () => {} };

    const { rerender, getByText } = render(<ActiveSessionView {...props} />);
    // Render 1: isLoading=true -> the loading branch (early return).
    expect(getByText(/Loading review session/)).toBeTruthy();

    // The transition that crashed prod: isLoading flips false with a multi-reviewer session.
    mockState.reviewSessionGet = { data: LOADED, isLoading: false };
    rerender(<ActiveSessionView {...props} />);

    // Must reach the loaded view (Iteration label) — no #310 thrown by the hook-order change.
    expect(getByText(/Iteration 1/)).toBeTruthy();
  });
});
