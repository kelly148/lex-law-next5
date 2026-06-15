// @vitest-environment jsdom
/**
 * MattersOverview render test — FOLD-PM-4.
 *
 * Mounts the flag-gated overview page with a mocked trpc layer (isEnabled +
 * portfolio) and asserts: (1) when enabled, the matter cards + open deliverables +
 * inline add form render without a hooks/render violation; (2) the empty state;
 * (3) when the flag is OFF, the surface does not render (redirects).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockState = vi.hoisted(() => ({
  enabled: true,
  portfolio: [] as unknown[],
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, {
    get: () => utilsProxy,
    apply: () => undefined,
  });
  const q = (getData: () => unknown) => () => {
    React.useRef(null);
    return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      useUtils: () => utilsProxy,
      matterDeliverable: {
        isEnabled: { useQuery: q(() => ({ enabled: mockState.enabled })) },
        portfolio: { useQuery: q(() => mockState.portfolio) },
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import MattersOverview from '../../pages/MattersOverview.js';

function renderPage(): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <MattersOverview />
    </MemoryRouter>,
  );
  return container;
}

afterEach(() => {
  cleanup();
  mockState.enabled = true;
  mockState.portfolio = [];
});

describe('MattersOverview — FOLD-PM-4', () => {
  it('renders matter cards with open deliverables and the inline add form when enabled', () => {
    mockState.enabled = true;
    mockState.portfolio = [
      {
        matterId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        title: 'Smith Purchase',
        clientName: 'Smith',
        practiceArea: 'RE',
        phase: 'drafting',
        openCount: 1,
        doneCount: 0,
        deliverables: [
          { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', title: 'Order title commitment', status: 'open', dueDate: '2026-07-01', notes: null },
        ],
      },
    ];

    const c = renderPage();
    expect(c.querySelector('[data-testid="matters-overview"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="matter-card"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="deliverable-row"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="open-count"]')?.textContent).toContain('1 open');
    expect(c.querySelector('[data-testid="add-deliverable-form"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="add-button"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="complete-button"]')).toBeTruthy();
    expect(c.textContent).toContain('Order title commitment');
  });

  it('renders the empty state when the attorney has no matters', () => {
    mockState.enabled = true;
    mockState.portfolio = [];
    const c = renderPage();
    expect(c.querySelector('[data-testid="overview-empty"]')).toBeTruthy();
  });

  it('does not render the surface when the flag is OFF (redirects)', () => {
    mockState.enabled = false;
    const c = renderPage();
    expect(c.querySelector('[data-testid="matters-overview"]')).toBeNull();
  });
});
