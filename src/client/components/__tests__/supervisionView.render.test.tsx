// @vitest-environment jsdom
/**
 * SupervisionView render test — SUPERVISION-VIEW-1.
 *
 * Mounts the flag-gated read-only supervision page with a mocked trpc layer and
 * asserts: (1) when enabled, the filters + aggregate cards + event rows render
 * without a hooks/render violation; (2) the empty state; (3) when the flag is OFF,
 * the surface does not render (redirects).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockState = vi.hoisted(() => ({
  enabled: true,
  result: null as unknown,
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const q = (getData: () => unknown) => () => {
    React.useRef(null);
    return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      useUtils: () => ({}),
      matter: { list: { useQuery: q(() => []) } },
      supervision: {
        isEnabled: { useQuery: q(() => ({ enabled: mockState.enabled })) },
        query: { useQuery: q(() => mockState.result) },
      },
    },
  };
});

import SupervisionView from '../../pages/SupervisionView.js';

function renderPage(): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <SupervisionView />
    </MemoryRouter>,
  );
  return container;
}

const SAMPLE_RESULT = {
  total: 1,
  aggregates: {
    total: 1,
    allowedCount: 1,
    blockedCount: 0,
    includedAttachmentTotal: 2,
    npiWithheldTotal: 1,
    byProvider: [{ provider: 'anthropic', count: 1 }],
    byKind: [{ kind: 'chat_primary', count: 1 }],
  },
  events: [
    {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      userId: '11111111-1111-1111-1111-111111111111',
      matterId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      provider: 'anthropic',
      model: 'claude-x',
      kind: 'chat_primary',
      decision: 'allowed',
      status: 'success',
      blockReason: null,
      includedAttachmentCount: 2,
      npiWithheldCount: 1,
      createdAt: new Date('2026-06-14T12:00:00.000Z'),
      completedAt: null,
    },
  ],
};

afterEach(() => {
  cleanup();
  mockState.enabled = true;
  mockState.result = null;
});

describe('SupervisionView — SUPERVISION-VIEW-1', () => {
  it('renders filters, aggregates, and event rows when enabled', () => {
    mockState.enabled = true;
    mockState.result = SAMPLE_RESULT;
    const c = renderPage();
    expect(c.querySelector('[data-testid="supervision-view"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="supervision-filters"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="supervision-aggregates"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="supervision-row"]')).toBeTruthy();
    expect(c.textContent).toContain('anthropic');
  });

  it('renders the empty state when there are no events', () => {
    mockState.enabled = true;
    mockState.result = { total: 0, aggregates: { total: 0, allowedCount: 0, blockedCount: 0, includedAttachmentTotal: 0, npiWithheldTotal: 0, byProvider: [], byKind: [] }, events: [] };
    const c = renderPage();
    expect(c.querySelector('[data-testid="supervision-empty"]')).toBeTruthy();
  });

  it('does not render the surface when the flag is OFF (redirects)', () => {
    mockState.enabled = false;
    const c = renderPage();
    expect(c.querySelector('[data-testid="supervision-view"]')).toBeNull();
  });
});
