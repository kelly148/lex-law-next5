// @vitest-environment jsdom
/**
 * CONFLICT-TOGGLE-1 Inc 3 — SettingsPage "Conflict clearance enforcement" panel render test
 * (ci-gotchas #10: render, don't trust tsc).
 *
 * Asserts the firm-policy anti-silent-off surface: absent when the gate is off; when on, the mandated label,
 * the relaxation flow gated behind a typed "ADVISORY" confirmation + a required reason (calls setPolicy with
 * ADVISORY only when both are satisfied), the force-on lock, and the advisory "relaxed" state + restore. The
 * server is the gate; this is UI only. Mocked useQuery/useGuardedMutation call real hooks (ci-gotchas #10c).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const setPolicyMutate = vi.hoisted(() => vi.fn((input: unknown) => Promise.resolve(input)));
const mockState = vi.hoisted(() => ({
  enabled: { enabled: true } as { enabled: boolean },
  policy: {
    data: {
      policy: { schemaVersion: 1, transactionalPosture: 'ENFORCED' },
      source: 'default',
      forceOn: false,
      effectiveByCapacity: { law_firm: 'ENFORCED', title_settlement_agent: 'ENFORCED' },
    } as Record<string, unknown>,
    isLoading: false,
  },
  history: { data: { entries: [] as Array<{ createdAt: Date }> } },
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      useUtils: () => ({
        settings: { get: { invalidate: () => {} } },
        conflictPolicy: { get: { invalidate: () => {} }, history: { invalidate: () => {} } },
        client: {
          settings: {
            updateReviewerEnablement: { mutate: () => {} },
            updateVoiceInput: { mutate: () => {} },
            updateNotificationPreferences: { mutate: () => {} },
          },
          auth: { changePassword: { mutate: () => {} } },
          conflictPolicy: { setPolicy: { mutate: setPolicyMutate } },
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
                notificationPreferences: {
                  inApp: true, tabTitle: false, os: false, sound: false, digest: true,
                  events: { reviewComplete: true, reviewFailed: true, regeneration: true, extraction: true, sendability: true, deadline: true },
                  mutedMatterIds: [],
                },
              },
              isLoading: false,
            };
          },
        },
      },
      conflictPolicy: {
        isEnabled: { useQuery: () => { React.useRef(null); return { data: mockState.enabled }; } },
        get: { useQuery: () => { React.useRef(null); return mockState.policy; } },
        history: { useQuery: () => { React.useRef(null); return mockState.history; } },
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

function setPolicy(transactionalPosture: 'ENFORCED' | 'ADVISORY', over: Partial<{ forceOn: boolean; effLaw: string; effTxn: string; entries: Array<{ createdAt: Date }> }> = {}) {
  mockState.policy.data = {
    policy: { schemaVersion: 1, transactionalPosture },
    source: 'persisted',
    forceOn: over.forceOn ?? false,
    effectiveByCapacity: { law_firm: over.effLaw ?? 'ENFORCED', title_settlement_agent: over.effTxn ?? transactionalPosture },
  };
  mockState.history.data = { entries: over.entries ?? [] };
}

afterEach(() => cleanup());
beforeEach(() => {
  mockState.enabled = { enabled: true };
  setPolicy('ENFORCED');
  setPolicyMutate.mockClear();
});

describe('SettingsPage — CONFLICT-TOGGLE-1 Inc 3 conflict-enforcement panel', () => {
  it('is absent when the conflict gate is disabled', () => {
    mockState.enabled = { enabled: false };
    const { queryByRole } = render(<SettingsPage />);
    expect(queryByRole('heading', { name: 'Conflict clearance enforcement' })).toBeNull();
  });

  it('renders the mandated label + the relax control when enabled and ENFORCED', () => {
    const { getByRole, getByTestId } = render(<SettingsPage />);
    expect(getByRole('heading', { name: 'Conflict clearance enforcement' })).toBeTruthy();
    expect(getByTestId('conflict-transactional-effective').textContent).toBe('ENFORCED');
    expect(getByTestId('conflict-begin-relax')).toBeTruthy();
  });

  it('relaxation requires typing ADVISORY and a reason; only then does it call setPolicy with ADVISORY', () => {
    const { getByTestId } = render(<SettingsPage />);
    fireEvent.click(getByTestId('conflict-begin-relax'));
    const confirmBtn = getByTestId('conflict-confirm-relax') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true); // nothing typed yet

    fireEvent.change(getByTestId('conflict-confirm-input'), { target: { value: 'ADVISORY' } });
    expect((getByTestId('conflict-confirm-relax') as HTMLButtonElement).disabled).toBe(true); // reason still missing

    fireEvent.change(getByTestId('conflict-reason-input'), { target: { value: 'deed scrivener desk only' } });
    expect((getByTestId('conflict-confirm-relax') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(getByTestId('conflict-confirm-relax'));
    expect(setPolicyMutate).toHaveBeenCalledWith({
      policy: { schemaVersion: 1, transactionalPosture: 'ADVISORY' },
      reasonText: 'deed scrivener desk only',
    });
  });

  it('force-on shows the lock and offers NO relax control', () => {
    setPolicy('ENFORCED', { forceOn: true, effTxn: 'ENFORCED' });
    const { getByTestId, queryByTestId } = render(<SettingsPage />);
    expect(getByTestId('conflict-forceon-lock')).toBeTruthy();
    expect(queryByTestId('conflict-begin-relax')).toBeNull();
  });

  it('ADVISORY shows the standing relaxed banner + a restore control that tightens to ENFORCED', () => {
    setPolicy('ADVISORY', { effTxn: 'ADVISORY', entries: [{ createdAt: new Date('2026-06-19T00:00:00Z') }] });
    const { getByTestId } = render(<SettingsPage />);
    expect(getByTestId('conflict-relaxed-banner').textContent).toContain('ADVISORY');
    fireEvent.click(getByTestId('conflict-restore-enforced'));
    expect(setPolicyMutate).toHaveBeenCalledWith({ policy: { schemaVersion: 1, transactionalPosture: 'ENFORCED' } });
  });
});
