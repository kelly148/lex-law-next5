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
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// FOLD-NOTIFY-1: the render mock returns this for trpc.notifications.list.useQuery. A test
// mutates it (then restores) to exercise the flag-ON bell + unread badge path.
const notificationsListData: { data: { items: unknown[]; unreadCount: number; unreadMatterIds: string[] } } = {
  data: { items: [], unreadCount: 0, unreadMatterIds: [] },
};
// FOLD-NOTIFY-1: the render mock returns this for trpc.notifications.isEnabled.useQuery.
const notificationsFlagData: { data: { enabled: boolean } } = { data: { enabled: false } };
// NOTIFY-SUITE-1 N1: the render mock returns this for trpc.notifications.digest.useQuery (the "while you
// were away" banner). A test mutates it (then restores) to exercise the banner path.
const notificationsDigestData: {
  data: { total: number; matterReady: number; deadline: number; generic: number; matterCount: number; summaryLine: string };
} = { data: { total: 0, matterReady: 0, deadline: 0, generic: 0, matterCount: 0, summaryLine: '' } };

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
      // FOLD-NOTIFY-1: AppShell probes the notifications flag (bell mount) + polls the
      // owner feed for the unread badge. Both stub useRef for #310 render-fidelity.
      notifications: {
        isEnabled: {
          useQuery: () => {
            React.useRef(null);
            return { ...notificationsFlagData, isLoading: false, isError: false, error: null };
          },
        },
        list: {
          useQuery: () => {
            React.useRef(null);
            return { ...notificationsListData, isLoading: false, isError: false, error: null };
          },
        },
        digest: {
          useQuery: () => {
            React.useRef(null);
            return { ...notificationsDigestData, isLoading: false, isError: false, error: null };
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

describe('AppShell — FOLD-NOTIFY-1 bell + unread badge (flag-gated)', () => {
  afterEach(() => {
    // Restore the default-OFF / no-unread state so test order can't bleed.
    notificationsFlagData.data = { enabled: false };
    notificationsListData.data = { items: [], unreadCount: 0, unreadMatterIds: [] };
  });

  it('with NOTIFICATIONS_ENABLED OFF (default), the bell is ABSENT', () => {
    notificationsFlagData.data = { enabled: false };
    const { queryByTestId } = render(
      <MemoryRouter>
        <AppShell>
          <div>Main content</div>
        </AppShell>
      </MemoryRouter>
    );
    expect(queryByTestId('notifications-bell')).toBeNull();
    expect(queryByTestId('notifications-badge')).toBeNull();
  });

  it('with the flag ON, the bell renders; the unread badge shows the count only when > 0', () => {
    notificationsFlagData.data = { enabled: true };
    notificationsListData.data = { items: [], unreadCount: 3, unreadMatterIds: [] };
    const { getByTestId } = render(
      <MemoryRouter>
        <AppShell>
          <div>Main content</div>
        </AppShell>
      </MemoryRouter>
    );
    expect(getByTestId('notifications-bell')).toBeTruthy();
    const badge = getByTestId('notifications-badge');
    expect(badge.textContent).toBe('3');
    expect(badge.getAttribute('aria-label')).toBe('3 unread notifications');
  });

  it('with the flag ON but zero unread, the bell renders WITHOUT the count badge', () => {
    notificationsFlagData.data = { enabled: true };
    notificationsListData.data = { items: [], unreadCount: 0, unreadMatterIds: [] };
    const { getByTestId, queryByTestId } = render(
      <MemoryRouter>
        <AppShell>
          <div>Main content</div>
        </AppShell>
      </MemoryRouter>
    );
    expect(getByTestId('notifications-bell')).toBeTruthy();
    expect(queryByTestId('notifications-badge')).toBeNull();
  });
});

describe('AppShell — NOTIFY-SUITE-1 N1 "while you were away" digest banner', () => {
  afterEach(() => {
    notificationsFlagData.data = { enabled: false };
    notificationsDigestData.data = { total: 0, matterReady: 0, deadline: 0, generic: 0, matterCount: 0, summaryLine: '' };
  });

  it('flag ON + unread -> the digest banner shows the summary; Dismiss hides it for the session', () => {
    notificationsFlagData.data = { enabled: true };
    notificationsDigestData.data = {
      total: 4, matterReady: 3, deadline: 1, generic: 0, matterCount: 3,
      summaryLine: '3 matters have results · 1 deadline approaching',
    };
    const { getByTestId, queryByTestId } = render(
      <MemoryRouter><AppShell><div>Main content</div></AppShell></MemoryRouter>
    );
    const banner = getByTestId('notify-digest');
    expect(banner.textContent).toContain('While you were away');
    expect(banner.textContent).toContain('3 matters have results · 1 deadline approaching');
    fireEvent.click(getByTestId('notify-digest-dismiss'));
    expect(queryByTestId('notify-digest')).toBeNull();
  });

  it('flag ON but nothing unread (total 0) -> NO banner', () => {
    notificationsFlagData.data = { enabled: true };
    notificationsDigestData.data = { total: 0, matterReady: 0, deadline: 0, generic: 0, matterCount: 0, summaryLine: '' };
    const { queryByTestId } = render(
      <MemoryRouter><AppShell><div>Main content</div></AppShell></MemoryRouter>
    );
    expect(queryByTestId('notify-digest')).toBeNull();
  });

  it('flag OFF -> NO banner even with a digest present', () => {
    notificationsFlagData.data = { enabled: false };
    notificationsDigestData.data = { total: 5, matterReady: 5, deadline: 0, generic: 0, matterCount: 5, summaryLine: '5 matters have results' };
    const { queryByTestId } = render(
      <MemoryRouter><AppShell><div>Main content</div></AppShell></MemoryRouter>
    );
    expect(queryByTestId('notify-digest')).toBeNull();
  });
});
