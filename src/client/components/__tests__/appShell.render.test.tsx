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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// FOLD-NOTIFY-1: the render mock returns this for trpc.notifications.list.useQuery. A test
// mutates it (then restores) to exercise the flag-ON bell + unread badge path.
const notificationsListData: { data: { items: unknown[]; unreadCount: number; unreadMatterIds: string[] } } = {
  data: { items: [], unreadCount: 0, unreadMatterIds: [] },
};
// FOLD-NOTIFY-1 / NOTIFY-SOUND-1: the render mock returns this for trpc.notifications.isEnabled.useQuery.
// soundEnabled is the NOTIFY_SOUND_ENABLED flag (gavel cue).
const notificationsFlagData: { data: { enabled: boolean; soundEnabled?: boolean } } = {
  data: { enabled: false, soundEnabled: false },
};
// NOTIFY-SOUND-1: the render mock returns this for trpc.settings.get.useQuery — AppShell reads
// notificationPreferences.sound (the per-user gavel toggle) from it.
const settingsData: { data: { notificationPreferences: { sound: boolean } } } = {
  data: { notificationPreferences: { sound: true } },
};
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
      // REVIEWER-HEALTH-VIEW-1 (5C): AppShell probes this flag for the Diagnostics nav link.
      reviewerHealth: {
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
      // NOTIFY-SOUND-1: AppShell reads the per-user sound toggle from settings.get.
      settings: {
        get: {
          useQuery: () => {
            React.useRef(null);
            return { ...settingsData, isLoading: false, isError: false, error: null };
          },
        },
      },
    },
  };
});

// NOTIFY-SOUND-1: the gavel cue is a best-effort side effect — mock it so we can assert WHEN it fires.
vi.mock('../../utils/gavelSound.js', () => ({ playGavel: vi.fn() }));

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
import { playGavel } from '../../utils/gavelSound.js';

afterEach(() => {
  cleanup();
});

const renderShell = () =>
  render(
    <MemoryRouter>
      <AppShell><div>Main content</div></AppShell>
    </MemoryRouter>
  );

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

describe('AppShell — Item 2: notifications dropdown + working mark-seen', () => {
  afterEach(() => {
    notificationsFlagData.data = { enabled: false, soundEnabled: false };
    notificationsListData.data = { items: [], unreadCount: 0, unreadMatterIds: [] };
    notificationsDigestData.data = { total: 0, matterReady: 0, deadline: 0, generic: 0, matterCount: 0, summaryLine: '' };
  });

  const ITEMS = [
    { id: '11111111-1111-1111-1111-111111111111', title: 'Review ready', body: null, matterId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', type: 'matter_ready', readAt: null },
    { id: '22222222-2222-2222-2222-222222222222', title: 'Draft ready', body: null, matterId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', type: 'matter_ready', readAt: null },
  ];

  it('the bell is a BUTTON; the panel is closed until clicked, then lists the items + a "mark all as read" control', () => {
    notificationsFlagData.data = { enabled: true, soundEnabled: false };
    notificationsListData.data = { items: ITEMS, unreadCount: 2, unreadMatterIds: [ITEMS[0]!.matterId, ITEMS[1]!.matterId] };
    const { getByTestId, queryByTestId, getAllByTestId } = renderShell();

    const bell = getByTestId('notifications-bell');
    expect(bell.tagName).toBe('BUTTON'); // interactive, not the old inert <div>
    expect(queryByTestId('notifications-panel')).toBeNull(); // closed by default

    fireEvent.click(bell);
    expect(getByTestId('notifications-panel')).toBeTruthy();
    expect(getByTestId('notifications-mark-all')).toBeTruthy();
    expect(getAllByTestId('notification-item')).toHaveLength(2);
    expect(getByTestId('notifications-panel').textContent).toContain('Review ready');
  });

  it('clicking an item and "mark all as read" do not throw (mutations wired)', () => {
    notificationsFlagData.data = { enabled: true, soundEnabled: false };
    notificationsListData.data = { items: ITEMS, unreadCount: 2, unreadMatterIds: [] };
    const { getByTestId, getAllByTestId } = renderShell();
    fireEvent.click(getByTestId('notifications-bell'));
    expect(() => fireEvent.click(getAllByTestId('notification-item')[0]!)).not.toThrow();
    fireEvent.click(getByTestId('notifications-bell')); // reopen (item-click closed it)
    expect(() => fireEvent.click(getByTestId('notifications-mark-all'))).not.toThrow();
  });

  it('the digest banner exposes a "Mark all read" action distinct from Dismiss', () => {
    notificationsFlagData.data = { enabled: true, soundEnabled: false };
    notificationsDigestData.data = { total: 1, matterReady: 1, deadline: 0, generic: 0, matterCount: 1, summaryLine: '1 matter has results' };
    const { getByTestId } = renderShell();
    expect(getByTestId('notify-digest-mark-all')).toBeTruthy();
    expect(() => fireEvent.click(getByTestId('notify-digest-mark-all'))).not.toThrow();
    notificationsDigestData.data = { total: 0, matterReady: 0, deadline: 0, generic: 0, matterCount: 0, summaryLine: '' };
  });
});

describe('AppShell — Item 3: gavel cue on a newly-arrived notification', () => {
  beforeEach(() => {
    vi.mocked(playGavel).mockClear();
  });
  afterEach(() => {
    notificationsFlagData.data = { enabled: false, soundEnabled: false };
    notificationsListData.data = { items: [], unreadCount: 0, unreadMatterIds: [] };
    settingsData.data = { notificationPreferences: { sound: true } };
  });

  const NEW_ITEM = { id: '33333333-3333-3333-3333-333333333333', title: 'Review ready', body: null, matterId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', type: 'matter_ready', readAt: null };

  it('does NOT replay pre-existing unseen notifications on first load (seed only)', () => {
    notificationsFlagData.data = { enabled: true, soundEnabled: true };
    settingsData.data = { notificationPreferences: { sound: true } };
    notificationsListData.data = { items: [NEW_ITEM], unreadCount: 1, unreadMatterIds: [NEW_ITEM.matterId] };
    renderShell();
    expect(vi.mocked(playGavel)).not.toHaveBeenCalled();
  });

  it('plays ONCE when a new unseen notification arrives during the session (flag + toggle ON)', () => {
    notificationsFlagData.data = { enabled: true, soundEnabled: true };
    settingsData.data = { notificationPreferences: { sound: true } };
    notificationsListData.data = { items: [], unreadCount: 0, unreadMatterIds: [] };
    const { rerender } = renderShell();
    expect(vi.mocked(playGavel)).not.toHaveBeenCalled(); // first load seeds, no play
    // a later poll surfaces a freshly-created notice
    notificationsListData.data = { items: [NEW_ITEM], unreadCount: 1, unreadMatterIds: [NEW_ITEM.matterId] };
    rerender(<MemoryRouter><AppShell><div>Main content</div></AppShell></MemoryRouter>);
    expect(vi.mocked(playGavel)).toHaveBeenCalledTimes(1);
    // a later poll returns a FRESH array instance with the SAME item id -> effect re-runs but must NOT
    // replay (dedupe by id).
    notificationsListData.data = { items: [{ ...NEW_ITEM }], unreadCount: 1, unreadMatterIds: [NEW_ITEM.matterId] };
    rerender(<MemoryRouter><AppShell><div>Main content</div></AppShell></MemoryRouter>);
    expect(vi.mocked(playGavel)).toHaveBeenCalledTimes(1);
  });

  it('does NOT play when the NOTIFY_SOUND_ENABLED flag is OFF', () => {
    notificationsFlagData.data = { enabled: true, soundEnabled: false };
    settingsData.data = { notificationPreferences: { sound: true } };
    notificationsListData.data = { items: [], unreadCount: 0, unreadMatterIds: [] };
    const { rerender } = renderShell();
    notificationsListData.data = { items: [NEW_ITEM], unreadCount: 1, unreadMatterIds: [NEW_ITEM.matterId] };
    rerender(<MemoryRouter><AppShell><div>Main content</div></AppShell></MemoryRouter>);
    expect(vi.mocked(playGavel)).not.toHaveBeenCalled();
  });

  it('does NOT play when the per-user sound toggle is OFF', () => {
    notificationsFlagData.data = { enabled: true, soundEnabled: true };
    settingsData.data = { notificationPreferences: { sound: false } };
    notificationsListData.data = { items: [], unreadCount: 0, unreadMatterIds: [] };
    const { rerender } = renderShell();
    notificationsListData.data = { items: [NEW_ITEM], unreadCount: 1, unreadMatterIds: [NEW_ITEM.matterId] };
    rerender(<MemoryRouter><AppShell><div>Main content</div></AppShell></MemoryRouter>);
    expect(vi.mocked(playGavel)).not.toHaveBeenCalled();
  });
});
