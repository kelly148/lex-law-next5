// @vitest-environment jsdom
/**
 * FOLD-PM-1 Inc 4 + 4b — DeadlinePanel render tests (ci-gotchas #10).
 *
 * Asserts the no-silent-states surfacing (G-C): engine-off, empty ("absence is not confirmation"),
 * unconfirmed treatment + Confirm, unmissable overdue + satisfy/waive, the coverage chip per state, the
 * permanent in-app-only limitation banner, no-blank/no-blue — PLUS Inc-4b affordances: expand -> per-tickler
 * ack/snooze, attorney override, and recompute propose-and-confirm. Mocked useQuery calls a real hook.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mock = vi.hoisted(() => ({
  enabled: false,
  list: { deadlines: [] as unknown[], coverage: { state: 'none', total: 0, pendingConfirm: 0, active: 0, overdueUnresolved: 0, satisfied: 0, waived: 0 } },
  isLoading: false,
  ticklers: [] as unknown[],
  proposal: { currentDueDate: '2026-06-22', proposedDueDate: '2026-07-22', deltaDays: 30 },
}));
const calls = vi.hoisted(() => ({ ack: vi.fn(), override: vi.fn(), confirmRecompute: vi.fn(), propose: vi.fn() }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      deadline: {
        isEnabled: { useQuery: () => { React.useRef(null); return { data: { enabled: mock.enabled }, isLoading: false }; } },
        listForMatter: { useQuery: () => { React.useRef(null); return { data: mock.list, isLoading: mock.isLoading }; } },
        getDeadline: { useQuery: () => { React.useRef(null); return { data: { deadline: {}, ticklers: mock.ticklers }, isLoading: false, refetch: () => {} }; } },
      },
      useUtils: () => ({
        client: { deadline: {
          confirm: { mutate: vi.fn() }, satisfy: { mutate: vi.fn() }, waive: { mutate: vi.fn() },
          override: { mutate: calls.override }, confirmRecompute: { mutate: calls.confirmRecompute },
          acknowledgeTickler: { mutate: calls.ack }, snoozeTickler: { mutate: vi.fn() },
          proposeRecompute: { query: (...a: unknown[]) => { calls.propose(...a); return Promise.resolve(mock.proposal); } },
        } },
        deadline: { listForMatter: { invalidate: vi.fn() } },
      }),
    },
  };
});
vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: (fn: (i: unknown) => unknown, opts?: { onSuccess?: () => void }) => ({
    mutate: (i: unknown) => { void Promise.resolve(fn(i)).then(() => opts?.onSuccess?.()); },
    isPending: false,
  }),
}));

import DeadlinePanel from '../DeadlinePanel.js';

const MATTER_ID = '11111111-1111-1111-1111-111111111111';
const dl = (over: Record<string, unknown>) => ({
  id: 'd1', userId: 'u', matterId: MATTER_ID, ruleRevisionId: 'r1', family: 'contract_contingency',
  description: 'Financing contingency', anchorType: 'contract_ratification', anchorDate: '2026-06-01',
  anchorSource: 'attorney_entered', anchorBasis: null, anchorDocumentId: null, computedDueDate: '2026-06-22',
  constraints: [], attorneyOverrideDate: null, overrideReason: null, status: 'active',
  confirmedByUserId: null, confirmedAt: null, ruleSnapshot: null, dispositionBasis: null,
  createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', ...over,
});

afterEach(() => cleanup());
beforeEach(() => {
  mock.enabled = false; mock.isLoading = false; mock.ticklers = [];
  mock.list = { deadlines: [], coverage: { state: 'none', total: 0, pendingConfirm: 0, active: 0, overdueUnresolved: 0, satisfied: 0, waived: 0 } };
  calls.ack.mockClear(); calls.override.mockClear(); calls.confirmRecompute.mockClear(); calls.propose.mockClear();
});

const open = (getByText: (t: string) => HTMLElement) => fireEvent.click(getByText('Deadlines & ticklers'));

describe('DeadlinePanel — Inc 4 surfacing', () => {
  it('engine OFF: off chip + off body + limitation banner', () => {
    const { container, getByText, getByTestId } = render(<DeadlinePanel matterId={MATTER_ID} />);
    expect(container.textContent).toContain('engine off');
    open(getByText);
    expect(getByTestId('deadline-engine-off')).toBeTruthy();
    expect(getByTestId('deadline-limitation').textContent).toContain('In-app ticklers only');
  });

  it('enabled + empty: "none created" + "absence is not confirmation"', () => {
    mock.enabled = true;
    const { container, getByText, getByTestId } = render(<DeadlinePanel matterId={MATTER_ID} />);
    expect(container.textContent).toContain('none created');
    open(getByText);
    expect(getByTestId('deadline-empty').textContent).toContain('Absence is not confirmation');
  });

  it('unconfirmed: chip + row treatment + Confirm affordance', () => {
    mock.enabled = true;
    mock.list = { deadlines: [dl({ status: 'pending_confirm' })], coverage: { state: 'unconfirmed', total: 1, pendingConfirm: 1, active: 0, overdueUnresolved: 0, satisfied: 0, waived: 0 } };
    const { container, getByText, getByTestId } = render(<DeadlinePanel matterId={MATTER_ID} />);
    expect(container.textContent).toContain('1 unconfirmed');
    open(getByText);
    expect(getByTestId('deadline-row').getAttribute('data-status')).toBe('pending_confirm');
    expect(getByTestId('deadline-confirm')).toBeTruthy();
  });

  it('overdue: unmissable chip + note + satisfy resolve form; no blue', () => {
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

  it('provisional (unresolved constraint) flagged on the row', () => {
    mock.enabled = true;
    mock.list = { deadlines: [dl({ constraints: [{ type: 'return_due_date_cap', requires: [], status: 'unresolved' }] })], coverage: { state: 'active', total: 1, pendingConfirm: 0, active: 1, overdueUnresolved: 0, satisfied: 0, waived: 0 } };
    const { getByText, getByTestId } = render(<DeadlinePanel matterId={MATTER_ID} />);
    open(getByText);
    expect(getByTestId('deadline-row').textContent).toContain('provisional');
  });
});

describe('DeadlinePanel — Inc 4b affordances', () => {
  const activeCoverage = { state: 'active', total: 1, pendingConfirm: 0, active: 1, overdueUnresolved: 0, satisfied: 0, waived: 0 };

  it('expand shows ticklers; Ack fires acknowledgeTickler', () => {
    mock.enabled = true;
    mock.list = { deadlines: [dl({})], coverage: activeCoverage };
    mock.ticklers = [{ id: 'tk1', leadDays: 7, fireAt: '2026-06-15', acknowledgedAt: null, snoozedUntil: null }];
    const { getByText, getByTestId } = render(<DeadlinePanel matterId={MATTER_ID} />);
    open(getByText);
    fireEvent.click(getByTestId('deadline-expand'));
    expect(getByTestId('tickler-row').textContent).toContain('T-7');
    fireEvent.click(getByTestId('tickler-ack'));
    expect(calls.ack).toHaveBeenCalledWith({ ticklerId: 'tk1' });
  });

  it('an acknowledged tickler shows "acknowledged" (no Ack button)', () => {
    mock.enabled = true;
    mock.list = { deadlines: [dl({})], coverage: activeCoverage };
    mock.ticklers = [{ id: 'tk1', leadDays: 7, fireAt: '2026-06-15', acknowledgedAt: '2026-06-10T00:00:00Z', snoozedUntil: null }];
    const { getByText, getByTestId, queryByTestId } = render(<DeadlinePanel matterId={MATTER_ID} />);
    open(getByText);
    fireEvent.click(getByTestId('deadline-expand'));
    expect(getByTestId('tickler-row').textContent).toContain('acknowledged');
    expect(queryByTestId('tickler-ack')).toBeNull();
  });

  it('override: form -> mutate with date + reason', () => {
    mock.enabled = true;
    mock.list = { deadlines: [dl({})], coverage: activeCoverage };
    const { getByText, getByTestId } = render(<DeadlinePanel matterId={MATTER_ID} />);
    open(getByText);
    fireEvent.click(getByTestId('deadline-override-toggle'));
    fireEvent.change(getByTestId('deadline-override-form').querySelector('input[type=date]')!, { target: { value: '2026-09-01' } });
    fireEvent.change(getByTestId('deadline-override-form').querySelector('input:not([type=date])')!, { target: { value: 'client request' } });
    fireEvent.click(getByTestId('deadline-override-submit'));
    expect(calls.override).toHaveBeenCalledWith({ id: 'd1', overrideDate: '2026-09-01', reason: 'client request' });
  });

  it('recompute is propose-and-confirm: preview then a separate confirm', async () => {
    mock.enabled = true;
    mock.list = { deadlines: [dl({})], coverage: activeCoverage };
    const { getByText, getByTestId } = render(<DeadlinePanel matterId={MATTER_ID} />);
    open(getByText);
    fireEvent.click(getByTestId('deadline-recompute-toggle'));
    fireEvent.click(getByTestId('deadline-recompute-propose'));
    expect(calls.propose).toHaveBeenCalled();
    await waitFor(() => expect(getByTestId('deadline-recompute-proposal').textContent).toContain('proposed 2026-07-22'));
    fireEvent.click(getByTestId('deadline-recompute-confirm'));
    expect(calls.confirmRecompute).toHaveBeenCalledWith({ id: 'd1', newAnchorDate: '2026-06-01' });
  });
});
