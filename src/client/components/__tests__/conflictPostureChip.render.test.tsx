// @vitest-environment jsdom
/**
 * CONFLICT-TOGGLE-1 Inc 3 — ConflictPostureChip render test (ci-gotchas #10: render, don't trust tsc).
 *
 * Asserts the per-matter chip + standing non-dismissible banner: absent when the gate is off, ENFORCED shows
 * the chip with NO banner, ADVISORY/SANDBOX show the chip AND the standing banner. Display-only; the mocked
 * useQuery calls a real hook so hook order stays faithful (ci-gotchas #10c).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const mockState = vi.hoisted(() => ({
  enabled: { enabled: true } as { enabled: boolean } | undefined,
  gate: undefined as Record<string, unknown> | undefined,
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      conflictPolicy: {
        isEnabled: {
          useQuery: () => {
            React.useRef(null);
            return { data: mockState.enabled };
          },
        },
        matterGate: {
          useQuery: () => {
            React.useRef(null);
            return { data: mockState.gate };
          },
        },
      },
    },
  };
});

import { ConflictPostureChip } from '../ConflictPostureChip.js';

const MATTER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function gate(posture: string) {
  return { posture, source: 'firm_default', mode: 'enforced', allowed: true, blockingReasons: [], bypassedReasons: [], autoEscalationTriggers: [], clearanceState: 'CLEARED' };
}

afterEach(() => cleanup());
beforeEach(() => {
  mockState.enabled = { enabled: true };
  mockState.gate = gate('ENFORCED');
});

describe('ConflictPostureChip', () => {
  it('renders nothing when the conflict gate is disabled', () => {
    mockState.enabled = { enabled: false };
    const { queryByTestId } = render(<ConflictPostureChip matterId={MATTER} />);
    expect(queryByTestId('conflict-posture')).toBeNull();
  });

  it('ENFORCED: shows the chip, no standing banner', () => {
    mockState.gate = gate('ENFORCED');
    const { getByTestId, queryByTestId } = render(<ConflictPostureChip matterId={MATTER} />);
    expect(getByTestId('conflict-posture-chip').textContent).toContain('ENFORCED');
    expect(queryByTestId('conflict-posture-banner')).toBeNull();
  });

  it('ADVISORY: shows the chip AND the standing non-dismissible banner', () => {
    mockState.gate = gate('ADVISORY');
    const { getByTestId } = render(<ConflictPostureChip matterId={MATTER} />);
    expect(getByTestId('conflict-posture-chip').textContent).toContain('ADVISORY');
    const banner = getByTestId('conflict-posture-banner');
    expect(banner.textContent).toContain('ADVISORY');
    expect(banner.textContent).toContain('a real conflict still blocks');
  });

  it('SANDBOX: shows the chip AND a sandbox/non-client banner', () => {
    mockState.gate = gate('SANDBOX');
    const { getByTestId } = render(<ConflictPostureChip matterId={MATTER} />);
    expect(getByTestId('conflict-posture-chip').textContent).toContain('SANDBOX');
    expect(getByTestId('conflict-posture-banner').textContent).toContain('non-client');
  });
});
