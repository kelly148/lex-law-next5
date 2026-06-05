// @vitest-environment jsdom
/**
 * Whereas R2-1 — review-pane survivability render tests.
 *
 * The review pane (ActiveSessionView) blanked prod twice with React #310. R2-1 gives it
 * designed, legally-legible degrade states instead of blank/bare-text screens. This file is
 * the CI render gate for those states:
 *   - loading            -> a calm "Loading review session…"
 *   - load error         -> retryable notice that names what is intact (Try again / Close)
 *   - session gone        -> "no longer available" notice (Close)
 *   - render crash        -> the pane-level PanelErrorBoundary fallback that names what is intact
 *
 * As in the #310 guard test, the mocked tRPC useQuery calls a REAL React hook (useRef) so hook
 * counts behave like production.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const mockState = vi.hoisted(() => ({
  reviewSessionGet: {
    data: undefined as unknown,
    isLoading: true,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, {
    get: () => utilsProxy,
    apply: () => undefined,
  });
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
            return { ...mockState.reviewSessionGet, error: null };
          },
        },
        listLockedDecisions: { useQuery: q({ lockedDecisions: [] }) },
        listAdoptLedger: { useQuery: q({ adoptLedger: [] }) },
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
import PanelErrorBoundary from '../PanelErrorBoundary.js';

const PROPS = {
  sessionId: '11111111-1111-1111-1111-111111111111',
  documentId: '22222222-2222-2222-2222-222222222222',
  onClose: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  mockState.reviewSessionGet = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
});

describe('ActiveSessionView — R2-1 survivability states', () => {
  it('loading: shows a calm loading notice', () => {
    mockState.reviewSessionGet = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    const { getByText } = render(<ActiveSessionView {...PROPS} />);
    expect(getByText(/Loading review session/)).toBeTruthy();
  });

  it('load error: names what is intact and offers Try again (refetch) + Close', () => {
    const refetch = vi.fn();
    const onClose = vi.fn();
    mockState.reviewSessionGet = { data: undefined, isLoading: false, isError: true, refetch };
    const { getByText } = render(<ActiveSessionView {...PROPS} onClose={onClose} />);

    expect(getByText(/could not be loaded/)).toBeTruthy();
    expect(getByText(/draft and matter record are intact/)).toBeTruthy();

    fireEvent.click(getByText('Try again'));
    expect(refetch).toHaveBeenCalledTimes(1);
    fireEvent.click(getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('session gone: shows the "no longer available" notice with Close', () => {
    const onClose = vi.fn();
    mockState.reviewSessionGet = { data: null, isLoading: false, isError: false, refetch: vi.fn() };
    const { getByText } = render(<ActiveSessionView {...PROPS} onClose={onClose} />);

    expect(getByText(/no longer available/)).toBeTruthy();
    fireEvent.click(getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PanelErrorBoundary variant="pane" — crash fallback', () => {
  function Boom(): never {
    throw new Error('simulated render crash');
  }

  it('degrades a render crash to the designed pane notice that names what is intact', () => {
    // Silence the expected React error-boundary console noise for this case.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onClose = vi.fn();
    const { getByText } = render(
      <PanelErrorBoundary variant="pane" label="Review session" onClose={onClose}>
        <Boom />
      </PanelErrorBoundary>
    );

    expect(getByText(/hit a display problem and was paused/)).toBeTruthy();
    expect(getByText(/draft and the matter record are unaffected/)).toBeTruthy();
    fireEvent.click(getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
