// @vitest-environment jsdom
/**
 * NOTIFY-SUITE-1 N3 — SettingsPage "Notifications" panel render test
 * (ci-gotchas #10: render, don't trust tsc).
 *
 * UI half only. Asserts the panel renders its channel + per-event toggles, that toggling a control calls
 * settings.updateNotificationPreferences with the full mutated blob (optimistic), and that turning the in-app
 * channel off disables the dependent toggles. The server procedure + the persistence query are untouched and
 * NOT exercised here. The mocked useQuery/useGuardedMutation call a real React hook so hook order stays
 * faithful to production (ci-gotchas #10c).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const mockSettings = vi.hoisted(() => ({ data: undefined as unknown }));
const notifMutate = vi.hoisted(() => vi.fn((input: unknown) => Promise.resolve(input)));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      useUtils: () => ({
        settings: { get: { invalidate: () => {} } },
        client: {
          settings: {
            updateReviewerEnablement: { mutate: () => {} },
            updateVoiceInput: { mutate: () => {} },
            updateNotificationPreferences: { mutate: notifMutate },
          },
          auth: { changePassword: { mutate: () => {} } },
        },
      }),
      settings: {
        get: {
          useQuery: () => {
            React.useRef(null); // real hook — keeps hook order faithful (ci-gotchas #10c)
            return { data: mockSettings.data, isLoading: mockSettings.data === undefined };
          },
        },
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', async () => {
  const React = await import('react');
  return {
    useGuardedMutation: (fn: (input: unknown) => unknown) => {
      React.useRef(false);
      return { mutate: (input: unknown) => { void fn(input); }, isPending: false, error: null };
    },
  };
});

import SettingsPage from '../SettingsPage.js';

const NOTIF_DEFAULT = {
  inApp: true,
  tabTitle: false,
  os: false,
  sound: false,
  digest: true,
  events: { reviewComplete: true, reviewFailed: true, regeneration: true, extraction: true, sendability: true, deadline: true },
  mutedMatterIds: [] as string[],
};

const SETTINGS = {
  reviewerEnablement: { claude: true, gpt: true, gemini: true, grok: true },
  voiceInput: { forceShowAll: false, forceHideAll: false, dictationLanguage: 'en-US' },
  notificationPreferences: NOTIF_DEFAULT,
};

afterEach(() => cleanup());
beforeEach(() => {
  mockSettings.data = SETTINGS;
  notifMutate.mockClear();
});

describe('SettingsPage — NOTIFY-SUITE-1 N3 notification preferences panel', () => {
  it('renders the Notifications panel with channel toggles and all six event toggles', () => {
    const { getByRole, getByTestId } = render(<SettingsPage />);
    expect(getByRole('heading', { name: 'Notifications' })).toBeTruthy();
    expect(getByTestId('notif-toggle-inApp')).toBeTruthy();
    expect(getByTestId('notif-toggle-digest')).toBeTruthy();
    expect(getByTestId('notif-toggle-sound')).toBeTruthy();
    for (const ev of ['reviewComplete', 'reviewFailed', 'regeneration', 'extraction', 'sendability', 'deadline']) {
      expect(getByTestId(`notif-event-${ev}`)).toBeTruthy();
    }
  });

  it('toggling the in-app channel off persists the full blob with inApp:false', () => {
    const { getByTestId } = render(<SettingsPage />);
    fireEvent.click(getByTestId('notif-toggle-inApp'));
    expect(notifMutate).toHaveBeenCalledTimes(1);
    expect(notifMutate).toHaveBeenCalledWith({
      notificationPreferences: { ...NOTIF_DEFAULT, inApp: false },
    });
  });

  it('toggling the deadline event off persists events.deadline:false (other events unchanged)', () => {
    const { getByTestId } = render(<SettingsPage />);
    fireEvent.click(getByTestId('notif-event-deadline'));
    expect(notifMutate).toHaveBeenCalledTimes(1);
    expect(notifMutate).toHaveBeenCalledWith({
      notificationPreferences: {
        ...NOTIF_DEFAULT,
        events: { ...NOTIF_DEFAULT.events, deadline: false },
      },
    });
  });

  it('disables the digest, sound, and event toggles while the in-app channel is off', () => {
    mockSettings.data = { ...SETTINGS, notificationPreferences: { ...NOTIF_DEFAULT, inApp: false } };
    const { getByTestId } = render(<SettingsPage />);
    // The master in-app toggle stays live so it can be turned back on.
    expect((getByTestId('notif-toggle-inApp') as HTMLButtonElement).disabled).toBe(false);
    // Everything that depends on the channel is disabled.
    expect((getByTestId('notif-toggle-digest') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('notif-toggle-sound') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('notif-event-deadline') as HTMLButtonElement).disabled).toBe(true);
  });

  it('omits the panel entirely when settings.get returns no notificationPreferences (additive-safe)', () => {
    mockSettings.data = { reviewerEnablement: SETTINGS.reviewerEnablement, voiceInput: SETTINGS.voiceInput };
    const { queryByRole } = render(<SettingsPage />);
    expect(queryByRole('heading', { name: 'Notifications' })).toBeNull();
  });
});
