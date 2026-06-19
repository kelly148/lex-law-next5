// @vitest-environment jsdom
/**
 * FOLD-AUTH-CHANGEPW — SettingsPage "Change Password" form render test
 * (ci-gotchas #10: render, don't trust tsc).
 *
 * UI half only. Asserts the change-password section renders its three password
 * fields and submit control, stays available even when settings.get returns no
 * data, blocks submit on a confirmation mismatch, and calls auth.changePassword
 * with the entered credentials when the inputs are valid. The server procedure
 * (auth.changePassword) is untouched and is NOT exercised here. The mocked
 * useQuery/useGuardedMutation call a real React hook so hook order stays faithful
 * to production (ci-gotchas #10c).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const mockSettings = vi.hoisted(() => ({ data: undefined as unknown }));
const changePasswordMutate = vi.hoisted(() => vi.fn((input: unknown) => Promise.resolve(input)));

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
          },
          auth: { changePassword: { mutate: changePasswordMutate } },
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
      // CONFLICT-TOGGLE-1 Inc 3: the ConflictEnforcementSection self-gates on this — OFF here, so it renders null.
      conflictPolicy: {
        isEnabled: {
          useQuery: () => {
            React.useRef(null);
            return { data: { enabled: false } };
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
      React.useRef(false); // the real hook uses useRef; keep a real hook for faithful counts
      return { mutate: (input: unknown) => { void fn(input); }, isPending: false, error: null };
    },
  };
});

import SettingsPage from '../SettingsPage.js';

const SETTINGS = {
  reviewerEnablement: { claude: true, gpt: true, gemini: true, grok: true },
  voiceInput: { forceShowAll: false, forceHideAll: false, dictationLanguage: 'en-US' },
};

afterEach(() => cleanup());
beforeEach(() => {
  mockSettings.data = SETTINGS;
  changePasswordMutate.mockClear();
});

describe('SettingsPage — FOLD-AUTH-CHANGEPW change-password form', () => {
  it('renders the Change Password section with three password fields and a submit button', () => {
    const { getByRole, getByLabelText } = render(<SettingsPage />);
    expect(getByRole('heading', { name: 'Change Password' })).toBeTruthy();
    const current = getByLabelText('Current Password') as HTMLInputElement;
    const next = getByLabelText('New Password') as HTMLInputElement;
    const confirm = getByLabelText('Confirm New Password') as HTMLInputElement;
    expect(current.type).toBe('password');
    expect(next.type).toBe('password');
    expect(confirm.type).toBe('password');
    expect(getByRole('button', { name: 'Update Password' })).toBeTruthy();
  });

  it('remains available even when settings.get returns no data', () => {
    mockSettings.data = null;
    const { getByRole } = render(<SettingsPage />);
    expect(getByRole('heading', { name: 'Change Password' })).toBeTruthy();
    expect(getByRole('button', { name: 'Update Password' })).toBeTruthy();
  });

  it('blocks submit and shows an error when the confirmation does not match', () => {
    const { getByRole, getByLabelText, getByText } = render(<SettingsPage />);
    fireEvent.change(getByLabelText('Current Password'), { target: { value: 'oldpassword1' } });
    fireEvent.change(getByLabelText('New Password'), { target: { value: 'brandnewpass1' } });
    fireEvent.change(getByLabelText('Confirm New Password'), { target: { value: 'different12345' } });
    fireEvent.click(getByRole('button', { name: 'Update Password' }));
    expect(changePasswordMutate).not.toHaveBeenCalled();
    expect(getByText(/do not match/i)).toBeTruthy();
  });

  it('blocks submit when the new password equals the current password', () => {
    const { getByRole, getByLabelText, getByText } = render(<SettingsPage />);
    fireEvent.change(getByLabelText('Current Password'), { target: { value: 'samepassword1' } });
    fireEvent.change(getByLabelText('New Password'), { target: { value: 'samepassword1' } });
    fireEvent.change(getByLabelText('Confirm New Password'), { target: { value: 'samepassword1' } });
    fireEvent.click(getByRole('button', { name: 'Update Password' }));
    expect(changePasswordMutate).not.toHaveBeenCalled();
    expect(getByText(/must differ/i)).toBeTruthy();
  });

  it('calls auth.changePassword with the entered credentials when the inputs are valid', () => {
    const { getByRole, getByLabelText } = render(<SettingsPage />);
    fireEvent.change(getByLabelText('Current Password'), { target: { value: 'oldpassword1' } });
    fireEvent.change(getByLabelText('New Password'), { target: { value: 'brandnewpass1' } });
    fireEvent.change(getByLabelText('Confirm New Password'), { target: { value: 'brandnewpass1' } });
    fireEvent.click(getByRole('button', { name: 'Update Password' }));
    expect(changePasswordMutate).toHaveBeenCalledWith({
      currentPassword: 'oldpassword1',
      newPassword: 'brandnewpass1',
    });
  });
});
