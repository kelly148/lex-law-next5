// @vitest-environment jsdom
/**
 * CHAT-COPILOT-1 (Copilot UI) — render test for the matter copilot surface.
 *
 * Standing render gate: flag OFF (default) -> the surface is inert and redirects to the matter page;
 * flag ON -> the conversation list + create + thread + composer mount, the server signals render
 * (master/R4 notice, scrubbed-turn count, citation chips, omitted/truncated/NPI counts), the lifecycle
 * buttons call the right gated procedures, and — the HARD EXCLUSION — there is NO promote/send/finalize/
 * client-ready affordance anywhere. The mocked useQuery calls a real hook (React.useRef) for fidelity.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const h = vi.hoisted(() => ({
  enabled: false,
  isLoading: false,
  conversations: [] as unknown[],
  messages: [] as unknown[],
  submitResult: {} as Record<string, unknown>,
  calls: {
    create: vi.fn(async () => ({ id: 'conv-new', matterId: 'm-1', documentId: null, title: 'Conversation', legalHold: false, doNotPersist: false, excludeFromGrounding: false, frozenAt: null })),
    submitTurn: vi.fn(),
    setLegalHold: vi.fn(async () => ({})),
    setMark: vi.fn(async () => ({})),
    setMessageExcludeFromGrounding: vi.fn(async () => ({})),
    redactMessage: vi.fn(async () => ({})),
    exportToMatterFile: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({ deleted: true })),
  },
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const q = (data: unknown) => ({ useQuery: () => { React.useRef(null); return { data, isLoading: false, isError: false }; } });
  return {
    trpc: {
      chatCopilot: {
        isEnabled: { useQuery: () => { React.useRef(null); return { data: { enabled: h.enabled }, isLoading: h.isLoading }; } },
        list: { useQuery: () => { React.useRef(null); return { data: h.conversations, isLoading: false, isError: false }; } },
        messages: { useQuery: () => { React.useRef(null); return { data: h.messages, isLoading: false, isError: false }; } },
      },
      // CHAT-COPILOT-2-INCB wiring added a flag read in CopilotThread; provide it (panel OFF here).
      chatReviewPanel: { isPanelEnabled: { useQuery: () => { React.useRef(null); return { data: { enabled: false }, isLoading: false }; } } },
      useUtils: () => ({
        chatCopilot: { list: { invalidate: () => {} }, messages: { invalidate: () => {} } },
        client: { chatCopilot: {
          create: { mutate: h.calls.create },
          submitTurn: { mutate: h.calls.submitTurn },
          setLegalHold: { mutate: h.calls.setLegalHold },
          setMark: { mutate: h.calls.setMark },
          setMessageExcludeFromGrounding: { mutate: h.calls.setMessageExcludeFromGrounding },
          redactMessage: { mutate: h.calls.redactMessage },
          exportToMatterFile: { mutate: h.calls.exportToMatterFile },
          delete: { mutate: h.calls.delete },
        } },
      }),
    },
    _q: q,
  };
});

import CopilotPage from '../../pages/CopilotPage.js';

const conv = { id: 'conv-1', matterId: 'm-1', documentId: null, title: 'Smith Trust copilot', legalHold: false, doNotPersist: false, excludeFromGrounding: false, frozenAt: null };

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/matters/m-1/copilot']}>
      <Routes>
        <Route path="/matters/:matterId/copilot" element={<CopilotPage />} />
        <Route path="/matters/:matterId" element={<div>MATTER PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());
beforeEach(() => {
  h.enabled = false; h.isLoading = false; h.conversations = []; h.messages = [];
  h.submitResult = { response: 'ans', master: { notice: 'Internal working draft — attorney verification required.' }, window: { scrubbedMasterTurns: 2 }, citations: [{ sourceId: 'material:y' }], rejectedCitationCount: 1, grounding: { grounded: true, omittedCount: 3, truncated: true, npiWithheldCount: 1 } };
  h.calls.submitTurn.mockImplementation(async () => h.submitResult);
  Object.values(h.calls).forEach((c) => 'mockClear' in c && c.mockClear());
});

describe('CHAT-COPILOT-1 Copilot UI — render gate', () => {
  it('flag OFF (default): no surface, redirects to the matter page', () => {
    const { queryByTestId, getByText } = renderAt();
    expect(queryByTestId('copilot-surface')).toBeNull();
    expect(getByText('MATTER PAGE')).toBeTruthy();
  });

  it('flag ON, no conversations: surface + list + new button + empty state', () => {
    h.enabled = true;
    const { getByTestId } = renderAt();
    expect(getByTestId('copilot-surface')).toBeTruthy();
    expect(getByTestId('copilot-list')).toBeTruthy();
    expect(getByTestId('copilot-new')).toBeTruthy();
    expect(getByTestId('copilot-empty')).toBeTruthy();
  });

  it('flag ON, select a conversation: thread + composer mount, citation chip renders, lifecycle buttons present', () => {
    h.enabled = true;
    h.conversations = [conv];
    h.messages = [
      { id: 'msg-1', role: 'attorney', content: 'what governs?', citations: null, doNotPersist: false, excludeFromGrounding: false },
      { id: 'msg-2', role: 'assistant', content: 'see source', citations: [{ sourceId: 'material:x', locator: 'p1' }], doNotPersist: false, excludeFromGrounding: false },
    ];
    const { getByTestId, getAllByTestId } = renderAt();
    fireEvent.click(getByTestId('copilot-list-item'));
    expect(getByTestId('copilot-thread')).toBeTruthy();
    expect(getByTestId('copilot-input')).toBeTruthy();
    expect(getByTestId('copilot-send')).toBeTruthy();
    expect(getAllByTestId('copilot-message').length).toBe(2);
    expect(getByTestId('copilot-citation')).toBeTruthy(); // persisted reference-only citation chip
    // lifecycle controls wired to the gated procedures
    for (const id of ['copilot-legalhold', 'copilot-donotpersist', 'copilot-exclude-grounding', 'copilot-export', 'copilot-delete']) {
      expect(getByTestId(id)).toBeTruthy();
    }
  });

  it('lifecycle buttons call the right gated procedures', () => {
    h.enabled = true;
    h.conversations = [conv];
    const { getByTestId } = renderAt();
    fireEvent.click(getByTestId('copilot-list-item'));
    fireEvent.click(getByTestId('copilot-legalhold'));
    expect(h.calls.setLegalHold).toHaveBeenCalledWith({ conversationId: 'conv-1', on: true });
    fireEvent.click(getByTestId('copilot-export'));
    expect(h.calls.exportToMatterFile).toHaveBeenCalledWith({ conversationId: 'conv-1' });
    fireEvent.click(getByTestId('copilot-delete'));
    expect(h.calls.delete).toHaveBeenCalledWith({ conversationId: 'conv-1' });
  });

  it('submitting a turn renders the server signals (notice, scrub, grounding, dropped citations) — no silent truncation', async () => {
    h.enabled = true;
    h.conversations = [conv];
    const { getByTestId, findByTestId } = renderAt();
    fireEvent.click(getByTestId('copilot-list-item'));
    fireEvent.change(getByTestId('copilot-input'), { target: { value: 'draft a clause' } });
    fireEvent.click(getByTestId('copilot-send'));
    expect(await findByTestId('copilot-notice')).toBeTruthy(); // R4 internal-working-draft notice
    expect(getByTestId('copilot-scrub')).toBeTruthy(); // windowed/scrubbed-master-turn count
    expect(getByTestId('copilot-grounding')).toBeTruthy(); // omitted/truncated/NPI surfaced
    expect(getByTestId('copilot-rejected-citations')).toBeTruthy(); // hallucinated citations dropped, surfaced
    expect(h.calls.submitTurn).toHaveBeenCalled();
  });

  it('HARD EXCLUSION: no promote/finalize/send-work-product/client-ready AFFORDANCE (interactive control); composer says "Ask"', () => {
    h.enabled = true;
    h.conversations = [conv];
    const { getByTestId, getAllByRole } = renderAt();
    fireEvent.click(getByTestId('copilot-list-item'));
    // Check INTERACTIVE controls only — the disclaimer prose ("nothing here is sent/filed/client-ready")
    // is a reassurance, the opposite of an affordance, and is allowed.
    const buttonLabels = getAllByRole('button').map((b) => (b.textContent ?? '').toLowerCase().trim());
    for (const label of buttonLabels) {
      expect(label).not.toMatch(/promote/);
      expect(label).not.toMatch(/finalize/);
      expect(label).not.toMatch(/client-ready/);
      expect(label).not.toMatch(/^send$/);
      expect(label).not.toMatch(/send to client/);
    }
    // the composer's submit is "Ask" (asks the assistant), never "Send" (work product).
    expect(getByTestId('copilot-send').textContent).toMatch(/ask/i);
  });
});
