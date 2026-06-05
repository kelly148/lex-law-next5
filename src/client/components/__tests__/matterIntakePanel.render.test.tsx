// @vitest-environment jsdom
/**
 * R2-PRE-CONFLICT-1 Inc 3c — MatterIntakePanel render tests (constraint G display + BLOCK #5 confirm UX).
 *
 * Proves, with a real render (per ci-gotchas #10 — tsc alone never renders React):
 *   - an UNCONFIRMED party shows the "unconfirmed — screened, not yet verified" status + a Confirm button;
 *   - a CONFIRMED party shows "confirmed" and NO Confirm button (constraint G: unconfirmed != asserted);
 *   - the constraint-B side-by-side name advisory appears, and the soft mismatch warning shows only when
 *     the party name differs from the matter clientName.
 *
 * The mocked useQuery calls a real React hook (useRef) so hook counts behave like production. vi.mock is
 * hoisted, so the per-test data lives in vi.hoisted(mockState).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const MATTER_ID = '22222222-2222-2222-2222-222222222222';

const mockState = vi.hoisted(() => ({
  parties: [] as unknown[],
  clientName: '' as string,
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  const q = (getData: () => unknown) => () => {
    React.useRef(null);
    return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      useUtils: () => utilsProxy,
      matterIntake: {
        listParties: { useQuery: q(() => mockState.parties) },
        getLatestConflicts: { useQuery: q(() => ({ check: null, hits: [] })) },
        getAnalysis: { useQuery: q(() => null) },
      },
      matter: { get: { useQuery: q(() => ({ clientName: mockState.clientName })) } },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import MatterIntakePanel from '../MatterIntakePanel.js';

const party = (over: Record<string, unknown>): unknown => ({
  id: '33333333-3333-3333-3333-333333333333',
  role: 'client',
  displayName: 'Acme Corp',
  confirmed: false,
  ...over,
});

// The panel is collapsed by default; open it so the party list renders.
const renderOpen = (): HTMLElement => {
  const { container } = render(<MatterIntakePanel matterId={MATTER_ID} />);
  const toggle = container.querySelector('button');
  if (toggle) fireEvent.click(toggle);
  return container;
};

afterEach(() => cleanup());
beforeEach(() => {
  mockState.parties = [];
  mockState.clientName = '';
});

describe('MatterIntakePanel — Inc 3c confirm UX + status (constraint G / BLOCK #5)', () => {
  it('UNCONFIRMED party: shows the screened-not-verified status and a Confirm affordance', () => {
    mockState.parties = [party({ confirmed: false, displayName: 'Acme Corp' })];
    mockState.clientName = 'Acme Corp';
    const container = renderOpen();
    expect(container.textContent).toContain('unconfirmed — screened, not yet verified');
    expect(container.textContent).toContain('Confirm');
    // matching names -> the advisory line shows the names but NOT the mismatch warning
    expect(container.textContent).toContain('Matter client name:');
    expect(container.textContent).not.toContain('differs from the matter client name');
  });

  it('UNCONFIRMED client whose name differs: shows the soft, overridable mismatch advisory', () => {
    mockState.parties = [party({ confirmed: false, displayName: 'Acme Corporation LLC' })];
    mockState.clientName = 'Beta Industries';
    const container = renderOpen();
    expect(container.textContent).toContain('differs from the matter client name');
    expect((container.textContent ?? '').toLowerCase()).toContain('you may override');
  });

  it('CONFIRMED party: shows "confirmed" and NO Confirm button (not treated as un-vouched)', () => {
    mockState.parties = [party({ confirmed: true, displayName: 'Acme Corp' })];
    mockState.clientName = 'Acme Corp';
    const container = renderOpen();
    expect(container.textContent).toContain('confirmed');
    expect(container.textContent).not.toContain('unconfirmed — screened, not yet verified');
    // no Confirm button, and no advisory (confirmed parties don't show it)
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(buttons.some((t) => t.trim() === 'Confirm' || t.includes('Confirm'))).toBe(false);
  });
});
