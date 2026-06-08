// @vitest-environment jsdom
/**
 * FOLD-PM-1 Inc 4 — UpcomingDeadlines render tests (ci-gotchas #10).
 *
 * The minimal cross-matter next-30-days + integrity surface. Asserts: engine-off line (never blank);
 * health counts; the integrity gap warning (no silent miss); the next-30 list with overdue/unconfirmed
 * tags; empty state; the limitation banner. Mocked useQuery calls a real hook (useRef).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const mock = vi.hoisted(() => ({
  enabled: false,
  upcoming: [] as unknown[],
  integrity: { today: '2026-06-08', dueWithinNDays: 30, missingTicklerDeadlineIds: [] as string[], counts: { active: 0, pendingConfirm: 0, overdueUnresolved: 0, dueNow: 0 } },
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      deadline: {
        isEnabled: { useQuery: () => { React.useRef(null); return { data: { enabled: mock.enabled } }; } },
        upcoming: { useQuery: () => { React.useRef(null); return { data: mock.upcoming }; } },
        integrity: { useQuery: () => { React.useRef(null); return { data: mock.integrity }; } },
      },
    },
  };
});

import UpcomingDeadlines from '../UpcomingDeadlines.js';

const up = (over: Record<string, unknown>) => ({
  deadline: { id: 'd1', description: 'VA SCC annual registration', status: 'active' },
  effectiveDueDate: '2026-06-20', ...over,
});

afterEach(() => cleanup());
beforeEach(() => {
  mock.enabled = false;
  mock.upcoming = [];
  mock.integrity = { today: '2026-06-08', dueWithinNDays: 30, missingTicklerDeadlineIds: [], counts: { active: 0, pendingConfirm: 0, overdueUnresolved: 0, dueNow: 0 } };
});

describe('UpcomingDeadlines — FOLD-PM-1 Inc 4', () => {
  it('engine OFF: renders a quiet off line (never blank, never all-clear)', () => {
    mock.enabled = false;
    const { getByTestId } = render(<UpcomingDeadlines />);
    expect(getByTestId('upcoming-engine-off')).toBeTruthy();
  });

  it('enabled + empty: health counts + empty note + limitation banner', () => {
    mock.enabled = true;
    const { getByTestId } = render(<UpcomingDeadlines />);
    expect(getByTestId('deadline-health')).toBeTruthy();
    expect(getByTestId('upcoming-empty')).toBeTruthy();
    expect(getByTestId('upcoming-limitation').textContent).toContain('In-app only');
  });

  it('integrity gap is surfaced as a warning (no silent miss)', () => {
    mock.enabled = true;
    mock.integrity = { ...mock.integrity, missingTicklerDeadlineIds: ['d9'], counts: { active: 1, pendingConfirm: 0, overdueUnresolved: 0, dueNow: 0 } };
    const { getByTestId } = render(<UpcomingDeadlines />);
    expect(getByTestId('integrity-warning').textContent).toContain('no reminder rows');
  });

  it('lists upcoming items with overdue / unconfirmed tags', () => {
    mock.enabled = true;
    mock.upcoming = [up({ deadline: { id: 'd1', description: 'Overdue thing', status: 'expired_unresolved' } }), up({ deadline: { id: 'd2', description: 'Pending thing', status: 'pending_confirm' }, effectiveDueDate: '2026-06-25' })];
    const { getByTestId } = render(<UpcomingDeadlines />);
    const t = getByTestId('upcoming-list').textContent ?? '';
    expect(t).toContain('Overdue thing');
    expect(t).toContain('overdue');
    expect(t).toContain('unconfirmed');
  });
});
