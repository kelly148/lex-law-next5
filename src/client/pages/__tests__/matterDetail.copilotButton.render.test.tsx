// @vitest-environment jsdom
/**
 * MATTER-COPILOT-ENTRYPOINT-1 — render test for the flag-gated "Copilot" button on the matter page.
 *
 * Mirrors the appShell.render.test.tsx pattern (mocked trpc client, each useQuery calls a real
 * React.useRef for #310 fidelity; the heavy MatterDetail sub-panels are stubbed to no-ops so the page
 * mounts in isolation). Asserts the three required cases: flag ON -> the Copilot button renders and links
 * to /matters/<id>/copilot; flag OFF -> absent; loading/undefined -> absent (no render before
 * enabled === true).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The controllable chatCopilot.isEnabled response (set per test). Hoisted so the trpc mock factory sees it.
const flags = vi.hoisted(() => ({ copilot: undefined as { enabled: boolean } | undefined }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const query = (data: unknown) => ({
    useQuery: () => {
      React.useRef(null); // a real hook so a conditional-hook (#310) regression would manifest
      return { data, isLoading: false, isError: false, error: null };
    },
  });
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  return {
    trpc: {
      useUtils: () => utilsProxy,
      matter: {
        get: query({ id: 'm1', title: 'Test Matter', phase: 'intake', archivedAt: null, engagementCapacity: 'law_firm', engagementCapacityElectedAt: null }),
      },
      document: { list: query([]) },
      chatUi: { isEnabled: query({ enabled: false }) },
      chatCopilot: {
        isEnabled: {
          useQuery: () => {
            React.useRef(null);
            return { data: flags.copilot, isLoading: false, isError: false, error: null };
          },
        },
      },
      // DEED-DRAFT-AGENT-1 Inc-1c — the page probes this flag; default OFF so the Gift Deed Draft entry is absent.
      deedDraftAgent: { isEnabled: query({ enabled: false }) },
    },
  };
});

// Stub the heavy matter sub-panels (each makes its own queries) so the page mounts in isolation.
vi.mock('../../components/MaterialsDrawer.js', () => ({ default: () => null }));
vi.mock('../../components/MatterStateDashboard.js', () => ({ default: () => null }));
vi.mock('../../components/MatterRecitalBand.js', () => ({ default: () => null }));
vi.mock('../../components/MatterIntakePanel.js', () => ({ default: () => null }));
vi.mock('../../components/GateOverridePanel.js', () => ({ default: () => null }));
vi.mock('../../components/ClosurePackagePanel.js', () => ({ default: () => null }));
vi.mock('../../components/DeadlinePanel.js', () => ({ default: () => null }));
vi.mock('../../components/MatterRecordLedger.js', () => ({ default: () => null }));
vi.mock('../../components/KnowledgeBasePanel.js', () => ({ default: () => null }));
vi.mock('../../components/CapacityElectionPanel.js', () => ({ default: () => null }));

// Keep MemoryRouter + Link real; only resolve the route param + navigation.
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useParams: () => ({ matterId: 'm1' }),
  useNavigate: () => () => {},
}));

import MatterDetail from '../MatterDetail.js';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/matters/m1']}>
      <MatterDetail />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  flags.copilot = undefined;
});

describe('MATTER-COPILOT-ENTRYPOINT-1 — flag-gated Copilot button', () => {
  it('flag ON: the Copilot button renders and links to /matters/<id>/copilot', () => {
    flags.copilot = { enabled: true };
    const { getByRole, getByText } = renderPage();
    // sanity: the page mounted (the sibling action link is present)
    expect(getByText('Info Request')).toBeTruthy();
    const link = getByRole('link', { name: 'Copilot' });
    expect(link.getAttribute('href')).toBe('/matters/m1/copilot');
  });

  it('flag OFF: the Copilot button is absent', () => {
    flags.copilot = { enabled: false };
    const { queryByText, getByText } = renderPage();
    expect(getByText('Info Request')).toBeTruthy(); // page mounted
    expect(queryByText('Copilot')).toBeNull();
  });

  it('loading / undefined flag: the Copilot button is absent (no render before enabled === true)', () => {
    flags.copilot = undefined;
    const { queryByText, getByText } = renderPage();
    expect(getByText('Info Request')).toBeTruthy(); // page mounted
    expect(queryByText('Copilot')).toBeNull();
  });
});
