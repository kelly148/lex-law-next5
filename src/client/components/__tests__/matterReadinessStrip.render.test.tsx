// @vitest-environment jsdom
/**
 * R2 #3 — MatterReadinessStrip render tests (ci-gotchas #10: render, don't trust tsc).
 *
 * Proves the readiness strip renders the right chips from one matterState.dashboard read, in the
 * fixed order (jurisdiction leads), with ADVISORY conflict framing (truthful state, not "enforced")
 * while the flag is OFF, the rolled-up review status (no denominator), and NO blue (R1-CLEANUP-1).
 * The mocked useQuery calls a real React hook (useRef) so hook counts behave like production.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const mockState = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  return {
    trpc: {
      useUtils: () => utilsProxy,
      matterState: {
        dashboard: {
          useQuery: () => {
            React.useRef(null);
            return { data: mockState.data, isLoading: mockState.data === undefined, isError: false, error: null, refetch: () => {} };
          },
        },
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import MatterReadinessStrip from '../MatterReadinessStrip.js';

const MATTER_ID = '11111111-1111-1111-1111-111111111111';

const dash = (over: {
  jurisdiction?: string | null;
  state?: string;
  reasons?: string[];
  sources?: number;
  openItemsOpen?: number;
  openBlockers?: number;
  workflowState?: string | null;
  safeToSend?: boolean;
}) => ({
  full: {
    mode: 'full',
    matter: {},
    counts: {
      sourceAuthorities: over.sources ?? 0,
      openItemsOpen: over.openItemsOpen ?? 0,
      openBlockers: over.openBlockers ?? 0,
    },
    operativeDocument: over.workflowState !== undefined ? { workflowState: over.workflowState } : null,
    safeToSend: over.safeToSend ?? false,
  },
  conflictClearance: { state: over.state ?? 'NOT_ESTABLISHED', reasons: over.reasons ?? ['no_conflict_check'] },
  jurisdiction: over.jurisdiction ?? null,
});

afterEach(() => cleanup());
beforeEach(() => { mockState.data = undefined; });

describe('MatterReadinessStrip — R2 #3 chips', () => {
  it('renders all chips in order with advisory conflict framing (flag OFF) and no blue', () => {
    mockState.data = dash({ jurisdiction: 'VA', state: 'NOT_ESTABLISHED', reasons: ['no_client_party'], sources: 2, openItemsOpen: 3, workflowState: 'drafting', safeToSend: false });
    const { container } = render(<MatterReadinessStrip matterId={MATTER_ID} />);
    const t = container.textContent ?? '';
    expect(t).toContain('VA');
    expect(t).toContain('Conflicts: no client party'); // advisory, names what's missing
    expect(t).not.toMatch(/blocked|enforced/i); // not enforcement framing while flag OFF
    expect(t).toContain('2 sources');
    expect(t).toContain('3 open items');
    expect(t).toContain('Drafting');
    expect(t).toContain('Not ready to send');
    expect(container.innerHTML).not.toMatch(/blue/); // R1-CLEANUP-1: no blue anywhere
  });

  it('cleared + safe-to-send shows the good states', () => {
    mockState.data = dash({ jurisdiction: 'MD', state: 'CLEARED', reasons: [], sources: 1, openItemsOpen: 0, workflowState: 'complete', safeToSend: true });
    const { container } = render(<MatterReadinessStrip matterId={MATTER_ID} />);
    const t = container.textContent ?? '';
    expect(t).toContain('MD');
    expect(t).toContain('Conflicts cleared');
    expect(t).toContain('1 source');
    expect(t).toContain('No open items');
    expect(t).toContain('Complete');
    expect(t).toContain('Safe to send');
  });

  it('blocker count is surfaced distinctly; missing jurisdiction prompts to set it', () => {
    mockState.data = dash({ jurisdiction: null, state: 'BLOCKED', reasons: ['undispositioned_blocker'], openBlockers: 2, workflowState: null, safeToSend: false });
    const { container } = render(<MatterReadinessStrip matterId={MATTER_ID} />);
    const t = container.textContent ?? '';
    expect(t).toContain('Set jurisdiction');
    expect(t).toContain('2 blockers');
    expect(t).toContain('No document');
  });

  it('shows a skeleton (not a crash) before the read resolves', () => {
    mockState.data = undefined;
    const { getByTestId } = render(<MatterReadinessStrip matterId={MATTER_ID} />);
    expect(getByTestId('readiness-strip-loading')).toBeTruthy();
  });
});
