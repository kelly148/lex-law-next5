// @vitest-environment jsdom
/**
 * AppShell render test — the Whereas R1 rebrand gate.
 *
 * R1 rebrands the application shell: the navy rail becomes the light Whereas rail
 * and the "LexLawNext" lockup becomes the serif "Whereas," wordmark (oxblood
 * comma). This is the standing render-test gate (every UI PR covers its render
 * path in CI, post the FOLD-ORCH-1 #310 incident): it mounts the FULL AppShell
 * and asserts the rebranded chrome renders without a hooks/render violation.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// AppShell calls trpc.useUtils() (for the logout mutation). A deep no-op proxy
// satisfies utils.client.auth.logout.mutate / utils.auth.me.invalidate. AppShell now also mounts
// CommandPalette (R2 #8), which calls matter.list.useQuery — stub it (real useRef for #310 fidelity).
vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, {
    get: () => utilsProxy,
    apply: () => undefined,
  });
  return {
    trpc: {
      useUtils: () => utilsProxy,
      matter: {
        list: {
          useQuery: () => {
            React.useRef(null);
            return { data: [], isLoading: false, isError: false, error: null };
          },
        },
      },
      // FOLD-PM-4: AppShell probes the deliverable flag to decide the Overview nav link.
      matterDeliverable: {
        isEnabled: {
          useQuery: () => {
            React.useRef(null);
            return { data: { enabled: false }, isLoading: false, isError: false, error: null };
          },
        },
      },
      // SUPERVISION-VIEW-1: AppShell probes the supervision flag to decide the Supervision nav link.
      supervision: {
        isEnabled: {
          useQuery: () => {
            React.useRef(null);
            return { data: { enabled: false }, isLoading: false, isError: false, error: null };
          },
        },
      },
    },
  };
});

vi.mock('../../hooks/useAuth.js', () => ({
  useAuth: () => ({
    user: { userId: 'u1', displayName: 'Test Attorney', username: 'kelly' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import AppShell from '../AppShell.js';

afterEach(() => {
  cleanup();
});

describe('AppShell — Whereas R1 rebranded shell', () => {
  it('renders the Whereas wordmark and navigation without crashing', () => {
    const { getByText } = render(
      <MemoryRouter>
        <AppShell>
          <div>Main content</div>
        </AppShell>
      </MemoryRouter>
    );

    // The serif wordmark (with the oxblood comma) replaces "LexLawNext".
    expect(getByText(/Whereas/)).toBeTruthy();
    // The nav and the rest of the shell mounted.
    expect(getByText('Matters')).toBeTruthy();
    expect(getByText('Templates')).toBeTruthy();
    expect(getByText('Settings')).toBeTruthy();
    expect(getByText('Sign out')).toBeTruthy();
    expect(getByText('Main content')).toBeTruthy();
    expect(getByText('Test Attorney')).toBeTruthy();
  });
});
