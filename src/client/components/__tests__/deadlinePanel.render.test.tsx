// @vitest-environment jsdom
/**
 * FOLD-PM-1 Inc 4 — DeadlinePanel render tests (ci-gotchas #10).
 *
 * Asserts the no-silent-states surfacing (G-C): engine-off state, empty state ("absence is not
 * confirmation"), the unconfirmed treatment + Confirm affordance, the unmissable overdue treatment +
 * satisfy/waive resolve, the coverage chip per state, the permanent in-app-only limitation banner, and a
 * no-blank path across every state. Mocked useQuery calls a real hook (useRef) for #310-faithful counts.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const mock = vi.hoisted(() => ({
  enabled: false,
  list: { deadlines: [] as unknown[], coverage: { state: 'none', total: 0, pendingConfirm: 0, active: 0, overdueUnresolved: 0, satisfied: 0, waived: 0 } },
  isLoading: false,
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      deadline: {
        isEnabled: { useQuery: () => { React.useRef(null); return { data: { enabled: mock.enabled }, isLoading: false }; } },
        listForMatter: { useQuery: () => { React.useRef(null); return { data: mock.list, isLoading: mock.isLoading }; } },
      },
      useUtils: () => ({
        client: { deadline: { confirm: { mutate: vi.fn() }, satisfy: { mutate: vi.fn() }, waive: { mutate: vi.fn() } } },
        deadline: { listForMatter: { invalidate: vi.fn() } },
      }),
    },
  };
});
vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: (fn: unknown) => ({ mutate: fn, isPending: false }),
}));

import DeadlinePanel from '../DeadlinePanel.js';

const MATTER_ID = '11111111-1111-1111-1111-111111111111';
const dl = (over: Record<string, unknown>) => ({
  id: 'd1', userId: 'u', matterId: MATTER_ID, ruleRevisionId: null, family: 'contract_contingency',
  description: 'Financing contingency', anchorType: 'contract_ratification', anchorDate: '2026-06-01',
  anchorSource: 'attorney_entered', anchorBasis: null, anchorDocumentId: null, computedDueDate: '2026-06-22',
  constraints: [], attorneyOverrideDate: null, overrideReason: null, status: 'active',
  confirmedByUserId: null, confirmedAt: null, ruleSnapshot: null, dispositionBasis: null,
  createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', ...over,
});

afterEach(() => cleanup());
beforeEach(() => {
  mock.enabled = false;
  mock.isLoading = false;
  mock.list = { deadlines: [], coverage: { state: 'none', total: 0, pendingConfirm: 0, active: 0, overdueUnresolved: 0, satisfied: 0, waived: 0 } };
});

const open = (getByText: (t: string) => HTMLElement) => fireEvent.click(getByText('Deadlines & ticklers'));

describe('DeadlinePanel — FOLD-PM-1 Inc 4', () => {
  it('engine OFF: shows the off chip + off body + the limitation banner (never blank, never all-clear)', () => {
    mock.enabled = false;
    const { container, getByText, getByTestId } = render(<DeadlinePanel matterId={MATTER_ID} />);
    expect(container.textContent).toContain('engine off');
    open(getByText);
    expect(getByTestId('deadline-engine-off')).toBeTruthy();
    expect(getByTestId('deadline-limitation').textContent).toContain('In-app ticklers only');
  });

  it('enabled + empty: "none created" chip + empty note ("absence is not confirmation")', () => {
    mock.enabled = true;
    const { container, getByText, getByTestId } = render(<DeadlinePanel matterId={MATTER_ID} />);
    expect(container.textContent).toContain('none created');
    open(getByText);
    expect(getByTestId('deadline-empty').textContent).toContain('Absence is not confirmation');
  });

  it('unconfirmed: chip + row treatment + a Confirm affordance (visibility before reliance)', () => {
    mock.enabled = true;
    mock.list = { deadlines: [dl({ status: 'pending_confirm' })], coverage: { state: 'unconfirmed', total: 1, pendingConfirm: 1, active: 0, overdueUnresolved: 0, satisfied: 0, waived: 0 } };
    const { container, getByText, getByTestId } = render(<DeadlinePanel matterId={MATTER_ID} />);
    expect(container.textContent).toContain('1 unconfirmed');
    open(getByText);
    expect(getByTestId('deadline-row').getAttribute('data-status')).toBe('pending_confirm');
    expect(getByTestId('deadline-confirm')).toBeTruthy();
  });

  it('overdue: unmissable chip + note + satisfy/waive resolve form', () => {
    mock.enabled = true;
    mock.list = { deadlines: [dl({ status: 'expired_unresolved' })], coverage: { state: 'overdue_unresolved', total: 1, pendingConfirm: 0, active: 0, overdueUnresolved: 1, satisfied: 0, waived: 0 } };
    const { container, getByText, getByTestId } = render(<DeadlinePanel matterId={MATTER_ID} />);
    expect(getByTestId('coverage-overdue').textContent).toContain('overdue');
    open(getByText);
    expect(getByTestId('deadline-overdue-note')).toBeTruthy();
    fireEvent.click(getByTestId('deadline-satisfy'));
    expect(getByTestId('deadline-resolve-form')).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/blue/);
  });

  it('provisional (unresolved constraint) is flagged on the row', () => {
    mock.enabled = true;
    mock.list = { deadlines: [dl({ status: 'active', constraints: [{ type: 'return_due_date_cap', requires: [], status: 'unresolved' }] })], coverage: { state: 'active', total: 1, pendingConfirm: 0, active: 1, overdueUnresolved: 0, satisfied: 0, waived: 0 } };
    const { getByText, getByTestId } = render(<DeadlinePanel matterId={MATTER_ID} />);
    open(getByText);
    expect(getByTestId('deadline-row').textContent).toContain('provisional');
  });
});
