// @vitest-environment jsdom
/**
 * CONFLICT-GATE-OVERRIDE-1 — GateOverridePanel render tests.
 *
 * Proves, with a real render (per ci-gotchas #10 — tsc alone never renders React):
 *   - nothing renders in the happy path (gate cleared, no overrides);
 *   - a persistent "Intake gate overridden" banner renders while an override is active (naming the
 *     precondition + reason);
 *   - an inline "Proceed without clearance" action renders when the gate is ENFORCED and a precondition
 *     is blocking;
 *   - no action is offered when the gate is NOT enforced (overrides are moot).
 *
 * The mocked useQuery calls a real hook (useRef) so hook counts behave like production. vi.mock is hoisted,
 * so the per-test data lives in vi.hoisted(mockState).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const MATTER_ID = '22222222-2222-2222-2222-222222222222';

interface GateData {
  enforced: boolean;
  state: string;
  allowed: boolean;
  blockingPreconditions: string[];
  blockingReasons: string[];
  activeOverrides: Array<{ id: string; precondition: string; reasonCode: string; reasonText: string | null; createdAt: string }>;
}

const mockState = vi.hoisted(() => ({
  gate: null as unknown,
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
      gateOverride: {
        getGate: { useQuery: q(() => mockState.gate) },
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import GateOverridePanel from '../GateOverridePanel.js';

const cleared: GateData = {
  enforced: true,
  state: 'CLEARED',
  allowed: true,
  blockingPreconditions: [],
  blockingReasons: [],
  activeOverrides: [],
};

afterEach(() => cleanup());
beforeEach(() => {
  mockState.gate = cleared;
});

describe('GateOverridePanel — block-point action + persistent banner', () => {
  it('renders nothing in the happy path (gate cleared, no overrides)', () => {
    mockState.gate = cleared;
    const { container } = render(<GateOverridePanel matterId={MATTER_ID} />);
    expect(container.textContent ?? '').toBe('');
  });

  it('shows the persistent "Intake gate overridden" banner while an override is active', () => {
    mockState.gate = {
      enforced: true,
      state: 'NOT_ESTABLISHED',
      allowed: true,
      blockingPreconditions: [],
      blockingReasons: [],
      activeOverrides: [
        {
          id: 'o1',
          precondition: 'conflicts',
          reasonCode: 'cleared_out_of_band',
          reasonText: 'cleared via signed memo',
          createdAt: new Date('2026-06-09T12:00:00Z').toISOString(),
        },
      ],
    } satisfies GateData;
    const { container } = render(<GateOverridePanel matterId={MATTER_ID} />);
    expect(container.textContent).toContain('Intake gate overridden');
    expect(container.textContent).toContain('conflicts clearance');
    expect(container.textContent).toContain('cleared via signed memo');
  });

  it('offers an inline override action when ENFORCED and a precondition is blocking', () => {
    mockState.gate = {
      enforced: true,
      state: 'NOT_ESTABLISHED',
      allowed: false,
      blockingPreconditions: ['identity'],
      blockingReasons: ['unconfirmed_client_party'],
      activeOverrides: [],
    } satisfies GateData;
    const { container } = render(<GateOverridePanel matterId={MATTER_ID} />);
    expect(container.textContent).toContain('Drafting blocked');
    expect(container.textContent).toContain('identity verification');
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(buttons.some((t) => t.includes('Proceed without clearance'))).toBe(true);
  });

  it('offers NO action when the gate is not enforced (override moot)', () => {
    mockState.gate = {
      enforced: false,
      state: 'NOT_ESTABLISHED',
      allowed: false,
      blockingPreconditions: ['conflicts'],
      blockingReasons: ['undispositioned_blocker'],
      activeOverrides: [],
    } satisfies GateData;
    const { container } = render(<GateOverridePanel matterId={MATTER_ID} />);
    expect(container.textContent ?? '').toBe('');
  });
});
