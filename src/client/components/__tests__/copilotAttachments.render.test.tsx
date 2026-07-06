// @vitest-environment jsdom
/**
 * COPILOT-UPLOAD-1 — CopilotAttachments render test (ci-gotchas #10).
 *
 * Proves the three-state attachment chips (extracted / low_confidence / failed), the select-for-this-turn
 * toggle (parent-owned), the failed chip being non-selectable (no text), and the accept-anyway affordance on
 * a low-confidence chip. Mocked trpc — no live calls.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const state = vi.hoisted(() => ({ attachments: [] as unknown[] }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  return {
    trpc: {
      useUtils: () => utilsProxy,
      chatCopilot: {
        listAttachments: { useQuery: () => { React.useRef(null); return { data: state.attachments, isLoading: false, isError: false }; } },
      },
    },
  };
});

import CopilotAttachments from '../CopilotAttachments.js';

const att = (id: string, filename: string, extractionStatus: string, over: Record<string, unknown> = {}): unknown => ({
  id, filename, extractionStatus, acceptedWithWarning: false, pinned: false, savedMaterialId: null, ...over,
});

afterEach(() => { cleanup(); state.attachments = []; });

function renderChips(selected = new Set<string>()) {
  const onToggle = vi.fn();
  const r = render(<CopilotAttachments conversationId="c1" matterId="m1" selectedIds={selected} onToggleSelect={onToggle} />);
  return { ...r, onToggle };
}

describe('CopilotAttachments — three-state chips', () => {
  it('renders one chip per attachment keyed on extractionStatus', () => {
    state.attachments = [att('a1', 'clean.pdf', 'extracted'), att('a2', 'blurry.png', 'low_confidence'), att('a3', 'blank.png', 'failed')];
    const c = renderChips();
    expect(c.getByTestId('copilot-attach-chip-extracted')).toBeTruthy();
    expect(c.getByTestId('copilot-attach-chip-low_confidence')).toBeTruthy();
    expect(c.getByTestId('copilot-attach-chip-failed')).toBeTruthy();
    // low-confidence offers accept-anyway; failed does not (no text)
    expect(c.queryByTestId('copilot-attach-accept')).toBeTruthy();
  });

  it('the failed chip is NOT selectable (no readable text); an extracted chip is', () => {
    state.attachments = [att('a1', 'clean.pdf', 'extracted'), att('a3', 'blank.png', 'failed')];
    const c = renderChips();
    const boxes = c.getAllByTestId('copilot-attach-select') as HTMLInputElement[];
    // extracted first, failed second (map order)
    expect(boxes[0]!.disabled).toBe(false);
    expect(boxes[1]!.disabled).toBe(true);
  });

  it('toggling an extracted chip calls onToggleSelect with its id', () => {
    state.attachments = [att('a1', 'clean.pdf', 'extracted')];
    const c = renderChips();
    fireEvent.click(c.getByTestId('copilot-attach-select'));
    expect(c.onToggle).toHaveBeenCalledWith('a1');
  });

  it('the attach button is present even with no attachments', () => {
    state.attachments = [];
    const c = renderChips();
    expect(c.getByTestId('copilot-attach-btn')).toBeTruthy();
    expect(c.queryByTestId('copilot-attach-chip-extracted')).toBeNull();
  });
});
