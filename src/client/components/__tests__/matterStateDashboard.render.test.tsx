// @vitest-environment jsdom
/**
 * MATTERSTATE-BADGE-1 — MatterStateDashboard header posture badge label (ci-gotchas #10:
 * render, don't trust tsc).
 *
 * The collapsed header sits under the title "Matter State" and badges safeToSend.posture.
 * Before this fix the pill rendered the bare posture word ("unknown" / "clear"), so an
 * "unknown" sendability posture read as if the matter STATE were unknown. The fix labels
 * the pill "Sendability:" (mirroring the in-panel label), so the value can never be
 * mistaken for the matter state. These tests assert the corrected label across all three
 * postures and confirm no bare-posture pill survives. The mocked useQuery calls a real
 * React hook (React.useRef) so hook counts behave like production (ci-gotchas #10c).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const mockDash = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      useUtils: () => ({
        matterState: { dashboard: { invalidate: () => {} } },
        client: {
          matterState: {
            dispositionItem: { mutate: () => {} },
            recordSend: { mutate: () => {} },
            tierSource: { mutate: () => {} },
          },
        },
      }),
      matterState: {
        dashboard: {
          useQuery: () => {
            React.useRef(null); // real hook — keeps hook order faithful (ci-gotchas #10c)
            return { data: mockDash.data, isLoading: mockDash.data === undefined, isError: false, error: null };
          },
        },
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', async () => {
  const React = await import('react');
  return {
    useGuardedMutation: () => {
      React.useRef(false); // the real hook uses useRef; keep a real hook for faithful counts
      return { mutate: () => {}, isPending: false, error: null };
    },
  };
});

import MatterStateDashboard from '../MatterStateDashboard.js';

const MATTER_ID = '11111111-1111-1111-1111-111111111111';

const dash = (posture: string, openBlockerCount = 0) => ({
  full: { safeToSend: { posture, openBlockerCount } },
});

afterEach(() => cleanup());
beforeEach(() => { mockDash.data = undefined; });

describe('MatterStateDashboard — MATTERSTATE-BADGE-1 posture badge label', () => {
  it('unknown posture: pill reads "Sendability: unknown", never a bare "unknown"', () => {
    mockDash.data = dash('unknown');
    const { getByText, queryByText } = render(<MatterStateDashboard matterId={MATTER_ID} />);
    // the panel title that made a bare "unknown" pill confusing is still present
    expect(getByText('Matter State')).toBeTruthy();
    // labeled pill, with the neutral (gray) posture tint preserved
    const pill = getByText('Sendability: unknown');
    expect(pill).toBeTruthy();
    expect(pill.className).toMatch(/bg-gray-200/);
    // the pre-fix bare-posture pill must not survive
    expect(queryByText('unknown')).toBeNull();
  });

  it('clear posture: pill reads "Sendability: clear" with the green tint preserved', () => {
    mockDash.data = dash('clear');
    const { getByText, queryByText } = render(<MatterStateDashboard matterId={MATTER_ID} />);
    const pill = getByText('Sendability: clear');
    expect(pill.className).toMatch(/bg-green-100/);
    expect(queryByText('clear')).toBeNull();
  });

  it('blocked posture: pill reads "Sendability: N blocker(s)" with the red tint preserved', () => {
    mockDash.data = dash('blocked', 2);
    const { getByText, queryByText } = render(<MatterStateDashboard matterId={MATTER_ID} />);
    const pill = getByText('Sendability: 2 blocker(s)');
    expect(pill.className).toMatch(/bg-red-100/);
    expect(queryByText('2 blocker(s)')).toBeNull();
  });
});
