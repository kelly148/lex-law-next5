// @vitest-environment jsdom
/**
 * SESSION-UNSTICK-1 — ReviewerHealthView manual abandon (ci-gotchas #10: render, don't trust tsc).
 *
 * Proves the Diagnostics stuck-session control: a per-session "Abandon session" button appears ONLY for a
 * server-flagged possibly-stuck session (isPossiblyStuck), and clicking it (after confirm) calls the
 * existing owner-scoped reviewSession.abandon with that session's id. No bulk auto-reap.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const abandonSpy = vi.hoisted(() => vi.fn((_i: unknown) => Promise.resolve({})));

const SNAP = {
  windowHours: 720,
  reviewerJobs: { total: 0, byStatus: {} },
  perLane: {},
  stuckSessionCount: 1,
  generatedAt: '2026-07-05T00:00:00.000Z',
  activeSessions: [
    { id: 'sess-stuck', documentId: 'doc-1', lifecyclePhase: 'active', createdAt: '2026-07-05T00:00:00.000Z', ageMinutes: 42, isPossiblyStuck: true },
    { id: 'sess-young', documentId: 'doc-2', lifecyclePhase: 'active', createdAt: '2026-07-05T00:00:00.000Z', ageMinutes: 2, isPossiblyStuck: false },
  ],
};

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  const q = (getData: () => unknown) => ({
    useQuery: () => { React.useRef(null); return { data: getData(), isLoading: false, isError: false, error: null }; },
  });
  return {
    trpc: {
      useUtils: () => utilsProxy,
      reviewerHealth: {
        isEnabled: q(() => ({ enabled: true })),
        snapshot: q(() => SNAP),
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: (fn: (i: unknown) => unknown) => ({
    mutate: (input: unknown) => { void fn; abandonSpy(input); },
    isPending: false,
    error: null,
  }),
}));

import ReviewerHealthView from '../ReviewerHealthView.js';

function renderView() {
  return render(<MemoryRouter><ReviewerHealthView /></MemoryRouter>);
}

beforeEach(() => { abandonSpy.mockClear(); window.confirm = () => true; });
afterEach(() => cleanup());

describe('ReviewerHealthView — SESSION-UNSTICK-1 manual abandon', () => {
  it('shows an Abandon button only for a possibly-stuck session', () => {
    const c = renderView();
    expect(c.getAllByTestId('rh-active-session').length).toBe(2);
    // exactly one abandon button (the stuck session)
    expect(c.getAllByTestId('rh-abandon-session').length).toBe(1);
  });

  it('clicking Abandon (after confirm) calls reviewSession.abandon with the stuck session id', () => {
    const c = renderView();
    fireEvent.click(c.getByTestId('rh-abandon-session'));
    expect(abandonSpy).toHaveBeenCalledTimes(1);
    expect((abandonSpy.mock.calls[0]![0] as { sessionId: string }).sessionId).toBe('sess-stuck');
  });

  it('does not abandon when the operator cancels the confirm', () => {
    window.confirm = () => false;
    const c = renderView();
    fireEvent.click(c.getByTestId('rh-abandon-session'));
    expect(abandonSpy).not.toHaveBeenCalled();
  });
});
