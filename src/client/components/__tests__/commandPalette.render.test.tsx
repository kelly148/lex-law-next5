// @vitest-environment jsdom
/**
 * R2 #8 — CommandPalette render tests (ci-gotchas #10).
 *
 * Nav-only speed layer. Asserts: hidden by default; Ctrl/Cmd-K opens it; global nav + jump-to-matter
 * (type-to-filter) + contextual matter entries render; and — structurally — that it exposes NO
 * material-act shortcut (lock / adopt / disposition / send / override), per the deliberate-act thesis.
 * The mocked useQuery calls a real React hook (useRef) for #310-faithful hook counts.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mockState = vi.hoisted(() => ({ data: [] as unknown[] }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      matter: {
        list: {
          useQuery: () => {
            React.useRef(null);
            return { data: mockState.data, isLoading: false, isError: false, error: null };
          },
        },
      },
    },
  };
});

import CommandPalette from '../CommandPalette.js';

const openPalette = (): void => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
  });
};

afterEach(() => cleanup());
beforeEach(() => {
  mockState.data = [];
});

describe('CommandPalette — R2 #8 (nav-only)', () => {
  it('is hidden until Ctrl/Cmd-K, then shows the global nav', () => {
    const { queryByRole, getByRole, getByText } = render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    // Closed by default — no dialog.
    expect(queryByRole('dialog')).toBeNull();

    openPalette();

    expect(getByRole('dialog')).toBeTruthy();
    expect(getByText('Matters')).toBeTruthy();
    expect(getByText('Templates')).toBeTruthy();
    expect(getByText('Upload & Format')).toBeTruthy();
    expect(getByText('Settings')).toBeTruthy();
  });

  it('lists matters (jump-to-matter) and filters by typed query', () => {
    mockState.data = [
      { id: 'm1', title: 'Acme Estate Plan', clientName: 'Acme Corp' },
      { id: 'm2', title: 'Riverside 1031 Exchange', clientName: null },
    ];
    const { getByText, getByLabelText, queryByText, getByRole } = render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    openPalette();

    expect(getByText('Jump to matter')).toBeTruthy();
    expect(getByText('Acme Estate Plan')).toBeTruthy();
    expect(getByText('Riverside 1031 Exchange')).toBeTruthy();

    // Typing narrows the list.
    fireEvent.change(getByLabelText('Command search'), { target: { value: 'acme' } });
    expect(getByText('Acme Estate Plan')).toBeTruthy();
    expect(queryByText('Riverside 1031 Exchange')).toBeNull();
    // Search still mounted (no crash on filtering).
    expect(getByRole('dialog')).toBeTruthy();
  });

  it('shows contextual "This matter" entries when a matter route is active', () => {
    const { getByText } = render(
      <MemoryRouter initialEntries={['/matters/abc-123']}>
        <Routes>
          <Route path="/matters/:matterId" element={<CommandPalette />} />
        </Routes>
      </MemoryRouter>,
    );
    openPalette();

    expect(getByText('This matter')).toBeTruthy();
    expect(getByText('Open matter overview')).toBeTruthy();
    expect(getByText('Information requests')).toBeTruthy();
  });

  it('exposes NO material-act shortcut and no blue', () => {
    mockState.data = [{ id: 'm1', title: 'Acme Estate Plan', clientName: 'Acme Corp' }];
    const { container } = render(
      <MemoryRouter initialEntries={['/matters/abc-123']}>
        <Routes>
          <Route path="/matters/:matterId" element={<CommandPalette />} />
        </Routes>
      </MemoryRouter>,
    );
    openPalette();

    const html = container.innerHTML;
    // The deliberate-act thesis: the palette never shortcuts a material act.
    expect(html).not.toMatch(/lock|adopt|disposition|override|finalize/i);
    expect(html).not.toMatch(/\bsend\b/i);
    expect(html).not.toMatch(/blue/);
  });
});
