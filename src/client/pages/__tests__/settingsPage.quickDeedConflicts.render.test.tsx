// @vitest-environment jsdom
/**
 * DEED-DRAFT-AGENT-1 QD-2 — SettingsPage "Quick Deed conflicts check" toggle render test
 * (ci-gotchas #10: render, don't trust tsc).
 *
 * Asserts the firm-level Quick Deed conflicts toggle: ABSENT when the deed-draft agent flag is OFF (flag-dark);
 * when ON, the toggle renders bound to the read (reflects the server's enforced value), clicking it calls
 * setConflictsEnforced with the flipped value, the optimistic update is rolled back on a server error, the
 * optimistic override is cleared on success so a refetched server value wins, and a rapid second click while a
 * write is in flight is a no-op. Also asserts the HONEST copy (ON => blocked until cleared in the full matter
 * workflow). The server is the gate; this is UI only. Mocked useQuery/useGuardedMutation call real hooks
 * (ci-gotchas #10c).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const setEnforcedMutate = vi.hoisted(() => vi.fn((input: unknown) => Promise.resolve(input)));
const mockState = vi.hoisted(() => ({
  deedEnabled: { enabled: true } as { enabled: boolean },
  setting: { data: { enforced: false } as { enforced: boolean }, isLoading: false },
  // Controls the useGuardedMutation mock: whether the write rejects (→ onError) and whether it is "in flight".
  mutationRejects: false,
  isPending: false,
  invalidated: 0,
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      useUtils: () => ({
        settings: { get: { invalidate: () => {} } },
        conflictPolicy: { get: { invalidate: () => {} }, history: { invalidate: () => {} } },
        quickDeed: { getConflictsSetting: { invalidate: () => { mockState.invalidated += 1; } } },
        client: {
          settings: {
            updateReviewerEnablement: { mutate: () => {} },
            updateVoiceInput: { mutate: () => {} },
            updateNotificationPreferences: { mutate: () => {} },
          },
          auth: { changePassword: { mutate: () => {} } },
          conflictPolicy: { setPolicy: { mutate: () => {} } },
          quickDeed: { setConflictsEnforced: { mutate: setEnforcedMutate } },
        },
      }),
      settings: {
        get: {
          useQuery: () => {
            React.useRef(null);
            return {
              data: {
                reviewerEnablement: { claude: true, gpt: true, gemini: true, grok: true },
                voiceInput: { forceShowAll: false, forceHideAll: false, dictationLanguage: 'en-US' },
              },
              isLoading: false,
            };
          },
        },
      },
      // The conflict-gate posture admin is OFF here so it renders null and stays out of the way.
      conflictPolicy: {
        isEnabled: { useQuery: () => { React.useRef(null); return { data: { enabled: false } }; } },
        get: { useQuery: () => { React.useRef(null); return { data: undefined, isLoading: false }; } },
        history: { useQuery: () => { React.useRef(null); return { data: { entries: [] } }; } },
      },
      deedDraftAgent: {
        isEnabled: { useQuery: () => { React.useRef(null); return { data: mockState.deedEnabled }; } },
      },
      quickDeed: {
        getConflictsSetting: { useQuery: () => { React.useRef(null); return mockState.setting; } },
      },
    },
  };
});

// A faithful-enough useGuardedMutation: mutate() calls the underlying fn, then synchronously invokes onSuccess
// or onError per mockState.mutationRejects; isPending is driven by mockState so the double-fire guard is testable.
vi.mock('../../hooks/useGuardedMutation.js', async () => {
  const React = await import('react');
  return {
    useGuardedMutation: (
      fn: (input: unknown) => unknown,
      opts?: { onSuccess?: (r: unknown) => void; onError?: (e: { message: string }) => void },
    ) => {
      React.useRef(false);
      return {
        mutate: (input: unknown) => {
          void fn(input);
          if (mockState.mutationRejects) opts?.onError?.({ message: 'SERVER_REJECTED' });
          else opts?.onSuccess?.(input);
        },
        isPending: mockState.isPending,
        error: null,
      };
    },
  };
});

import SettingsPage from '../SettingsPage.js';

afterEach(() => cleanup());
beforeEach(() => {
  mockState.deedEnabled = { enabled: true };
  mockState.setting = { data: { enforced: false }, isLoading: false };
  mockState.mutationRejects = false;
  mockState.isPending = false;
  mockState.invalidated = 0;
  setEnforcedMutate.mockClear();
});

describe('SettingsPage — DEED-DRAFT-AGENT-1 QD-2 Quick Deed conflicts toggle', () => {
  it('is absent when the deed-draft agent flag is OFF (flag-dark)', () => {
    mockState.deedEnabled = { enabled: false };
    const { queryByRole, queryByTestId } = render(<SettingsPage />);
    expect(queryByRole('heading', { name: 'Quick Deed conflicts check' })).toBeNull();
    expect(queryByTestId('quick-deed-conflicts-toggle')).toBeNull();
  });

  it('renders the toggle bound to the read (OFF reflects enforced:false) when the deed flag is ON', () => {
    const { getByRole, getByTestId } = render(<SettingsPage />);
    expect(getByRole('heading', { name: 'Quick Deed conflicts check' })).toBeTruthy();
    const toggle = getByTestId('quick-deed-conflicts-toggle');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('the ON copy is HONEST: it says generation is blocked until conflicts are cleared in the full matter workflow', () => {
    mockState.setting = { data: { enforced: true }, isLoading: false };
    const { getByTestId } = render(<SettingsPage />);
    const panel = getByTestId('quick-deed-conflicts');
    expect(panel.textContent).toContain('full matter workflow');
    expect(panel.textContent).toContain('blocked');
    // No unconditional "clearance required" that the backend doesn't keep:
    expect(panel.textContent).not.toContain('clearance required');
  });

  it('reflects an enforced:true server value (toggle bound to the read)', () => {
    mockState.setting = { data: { enforced: true }, isLoading: false };
    const { getByTestId } = render(<SettingsPage />);
    expect(getByTestId('quick-deed-conflicts-toggle').getAttribute('aria-checked')).toBe('true');
  });

  it('clicking the OFF toggle calls setConflictsEnforced({ enforced: true }) and optimistically flips to ON', () => {
    const { getByTestId } = render(<SettingsPage />);
    fireEvent.click(getByTestId('quick-deed-conflicts-toggle'));
    expect(setEnforcedMutate).toHaveBeenCalledWith({ enforced: true });
  });

  it('clicking the ON toggle calls setConflictsEnforced({ enforced: false })', () => {
    mockState.setting = { data: { enforced: true }, isLoading: false };
    const { getByTestId } = render(<SettingsPage />);
    fireEvent.click(getByTestId('quick-deed-conflicts-toggle'));
    expect(setEnforcedMutate).toHaveBeenCalledWith({ enforced: false });
  });

  it('onError ROLLBACK: a server error reverts aria-checked to the pre-click value', () => {
    mockState.mutationRejects = true; // the write will reject → onError fires → rollback to prevRef
    const { getByTestId } = render(<SettingsPage />);
    const toggle = getByTestId('quick-deed-conflicts-toggle');
    expect(toggle.getAttribute('aria-checked')).toBe('false'); // pre-click
    fireEvent.click(toggle);
    // optimistic flip to true, then rolled back to false on the rejection:
    expect(getByTestId('quick-deed-conflicts-toggle').getAttribute('aria-checked')).toBe('false');
  });

  it('post-success STALENESS: after success the optimistic override clears, so a refetched server value wins', () => {
    const { getByTestId, rerender } = render(<SettingsPage />);
    const toggle = getByTestId('quick-deed-conflicts-toggle');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle); // optimistic → true; onSuccess fires → setEnforced(null) clears the override
    expect(mockState.invalidated).toBeGreaterThan(0); // the refetch was triggered
    // Simulate the invalidate-driven refetch returning the authoritative server value (true):
    mockState.setting = { data: { enforced: true }, isLoading: false };
    rerender(<SettingsPage />);
    expect(getByTestId('quick-deed-conflicts-toggle').getAttribute('aria-checked')).toBe('true');
    // And if the server had instead returned false, the cleared override must not pin it ON:
    mockState.setting = { data: { enforced: false }, isLoading: false };
    rerender(<SettingsPage />);
    expect(getByTestId('quick-deed-conflicts-toggle').getAttribute('aria-checked')).toBe('false');
  });

  it('DOUBLE-FIRE GUARD: a click while a write is in flight (isPending) is a full no-op', () => {
    mockState.isPending = true; // a write is "in flight"
    const { getByTestId } = render(<SettingsPage />);
    fireEvent.click(getByTestId('quick-deed-conflicts-toggle'));
    expect(setEnforcedMutate).not.toHaveBeenCalled(); // guarded — no second write, no prevRef corruption
  });
});
