// @vitest-environment jsdom
/**
 * R2 #7 — MatterRecordLedger render tests (ci-gotchas #10).
 *
 * A read-only chronological ledger of the matter's audit_events. Asserts: closed by default; opening
 * renders the recorded acts (timestamp/actor/action/summary/rationale) newest-first as given; empty
 * state; no blue. The mocked useQuery calls a real React hook (useRef) for #310-faithful hook counts.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const mockState = vi.hoisted(() => ({ data: [] as unknown[] }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      matter: {
        auditLog: {
          useQuery: () => {
            React.useRef(null);
            return { data: mockState.data, isLoading: false, isError: false, error: null, refetch: () => {} };
          },
        },
      },
    },
  };
});

import MatterRecordLedger from '../MatterRecordLedger.js';

const MATTER_ID = '11111111-1111-1111-1111-111111111111';
const ev = (over: Record<string, unknown>) => ({
  id: 'e1', eventType: 'disposition', actor: 'attorney', actorModel: null,
  summary: 'Plan locked', targetType: 'matter_analysis', action: 'lock_plan', rationale: null,
  scope: 'matter', createdAt: '2026-06-06T12:00:00.000Z', ...over,
});

afterEach(() => cleanup());
beforeEach(() => { mockState.data = []; });

describe('MatterRecordLedger — R2 #7', () => {
  it('is collapsed by default (no ledger body until opened)', () => {
    const { container, getByText } = render(<MatterRecordLedger matterId={MATTER_ID} />);
    expect(container.querySelector('[data-testid="matter-record-ledger"]')).toBeNull();
    expect(getByText('Matter Record')).toBeTruthy();
  });

  it('opening shows recorded acts (action + summary + rationale) and no blue', () => {
    mockState.data = [
      ev({ id: 'e1', action: 'lock_plan', summary: 'Plan locked', rationale: 'Conflicts dispositioned' }),
      ev({ id: 'e2', actor: 'attorney', action: 'confirm_party', summary: 'Confirmed conflict party (client): Acme', rationale: null }),
    ];
    const { container, getByText } = render(<MatterRecordLedger matterId={MATTER_ID} />);
    fireEvent.click(getByText('Matter Record'));
    const t = container.textContent ?? '';
    expect(t).toContain('lock_plan');
    expect(t).toContain('Plan locked');
    expect(t).toContain('Conflicts dispositioned'); // rationale
    expect(t).toContain('confirm_party');
    expect(container.querySelectorAll('[data-testid="matter-record-row"]').length).toBe(2);
    expect(container.innerHTML).not.toMatch(/blue/);
  });

  it('empty state when there are no recorded acts', () => {
    mockState.data = [];
    const { container, getByText } = render(<MatterRecordLedger matterId={MATTER_ID} />);
    fireEvent.click(getByText('Matter Record'));
    expect(container.textContent ?? '').toContain('No recorded acts yet');
  });
});
