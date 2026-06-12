// @vitest-environment jsdom
/**
 * ChatSurface render test — CHAT-UI-1 W0 scaffold.
 *
 * The conversation surface is gated behind CHAT_UI_1_ENABLED. This is the standing render
 * gate (every UI PR covers its render path in CI): flag OFF (the default) -> the surface is
 * inert and redirects to the matter page (no three-zone shell); flag ON -> the three-zone
 * conversation-dominant skeleton mounts (spine / thread / deliverable) without a hooks or
 * render violation. The mocked useQuery calls a real hook (React.useRef) for #310 fidelity.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mock = vi.hoisted(() => ({ enabled: false, isLoading: false }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      chatUi: {
        isEnabled: {
          useQuery: () => {
            React.useRef(null);
            return { data: { enabled: mock.enabled }, isLoading: mock.isLoading };
          },
        },
        // ChatSurface mounts ProvenanceLedgerPanel (W2) -> usePostureProvenance; stub its calls.
        listProvenance: {
          useQuery: () => {
            React.useRef(null);
            return { data: [], isLoading: false, isError: false };
          },
        },
        recordProvenance: {
          useMutation: () => {
            React.useRef(null);
            return { mutate: () => {}, isPending: false };
          },
        },
        // BA — ChatDeliverable reads the matter's sources.
        listSources: {
          useQuery: () => {
            React.useRef(null);
            return { data: [], isLoading: false, isError: false };
          },
        },
      },
      document: {
        list: {
          useQuery: () => {
            React.useRef(null);
            return { data: [], isLoading: false, isError: false };
          },
        },
      },
      useUtils: () => ({
        chatUi: { listProvenance: { invalidate: () => {} }, listSources: { invalidate: () => {} } },
        client: {
          chatUi: {
            exportProvenance: {
              query: async () => ({ matterId: 'm-1', count: 0, chain: { valid: true, brokenAtSeq: null, reason: null }, entries: [] }),
            },
            setSourceTier: { mutate: async () => ({}) },
          },
        },
      }),
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

import ChatSurface from '../../pages/ChatSurface.js';

const renderAt = () =>
  render(
    <MemoryRouter initialEntries={['/matters/m-1/chat']}>
      <Routes>
        <Route path="/matters/:matterId/chat" element={<ChatSurface />} />
        <Route path="/matters/:matterId" element={<div>MATTER PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );

afterEach(() => cleanup());
beforeEach(() => {
  mock.enabled = false;
  mock.isLoading = false;
});

describe('ChatSurface — CHAT-UI-1 W0', () => {
  it('flag OFF (default): no surface, redirects to the matter page; NO composer', () => {
    const { queryByTestId, getByText } = renderAt();
    expect(queryByTestId('chat-surface')).toBeNull();
    expect(getByText('MATTER PAGE')).toBeTruthy();
    // CHAT-COMPOSER-1: the functional composer is gated by this surface — flag OFF => not mounted.
    expect(queryByTestId('chat-composer')).toBeNull();
  });

  it('flag ON: the three-zone conversation skeleton mounts with the functional composer', () => {
    mock.enabled = true;
    const { getByTestId, getByText } = renderAt();
    expect(getByTestId('chat-surface')).toBeTruthy();
    expect(getByTestId('chat-zone-spine')).toBeTruthy();
    expect(getByTestId('chat-zone-thread')).toBeTruthy();
    expect(getByTestId('chat-zone-deliverable')).toBeTruthy();
    expect(getByText('Conversation')).toBeTruthy();
    // CHAT-COMPOSER-1: the inert W0 placeholder is replaced by the functional composer.
    expect(getByTestId('chat-composer')).toBeTruthy();
    expect(getByTestId('chat-input')).toBeTruthy();
    expect(getByTestId('chat-send')).toBeTruthy();
  });

  it('while the flag is loading: neutral loader, surface not flashed', () => {
    mock.isLoading = true;
    const { queryByTestId, getByText } = renderAt();
    expect(queryByTestId('chat-surface')).toBeNull();
    expect(getByText('Loading…')).toBeTruthy();
  });
});
