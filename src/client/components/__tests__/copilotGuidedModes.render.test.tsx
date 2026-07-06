// @vitest-environment jsdom
/**
 * CHAT-COPILOT-1 Inc 5 — guided modes + one-click refine (render + pure).
 *
 * Modes COLLECT inputs (not just a prompt swap): selecting a mode shows the input form, and submitting
 * folds the answers into a structured turn AND passes the mode to submitTurn. Refine actions issue a
 * follow-up turn (keeping the mode). Review auto-binds the operative document when the conversation is
 * doc-bound. Still NO promote/send/finalize affordance (Inc 5 adds no such control).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { buildGuidedTurn, type GuidedInputs } from '../CopilotThread.js';

// ── Pure ────────────────────────────────────────────────────────────────────────────────────────────
describe('CHAT-COPILOT-1 Inc 5 — buildGuidedTurn (pure)', () => {
  it('folds the mode + answered inputs into a structured turn (not just the free text)', () => {
    const inputs: GuidedInputs = { audience: 'court', jurisdiction: 'VA', documentRef: 'Trust v3', posture: 'opposing', deliverable: 'memo', clientSendable: false };
    const out = buildGuidedTurn('review', inputs, 'check the indemnity clause');
    expect(out).toContain('[Guided review]');
    expect(out).toContain('Audience: court');
    expect(out).toContain('Jurisdiction: VA');
    expect(out).toContain('Document/version: Trust v3');
    expect(out).toContain('Client-sendable language requested: no');
    expect(out).toContain('check the indemnity clause');
  });
  it('omits blank inputs and records the client-sendable flag', () => {
    const out = buildGuidedTurn('draft', { audience: '', jurisdiction: '', documentRef: '', posture: '', deliverable: '', clientSendable: true }, 'draft a clause');
    expect(out).not.toContain('Audience:');
    expect(out).toContain('Client-sendable language requested: yes');
    expect(out).toContain('draft a clause');
  });
});

// ── Render ──────────────────────────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  conversations: [] as unknown[],
  messages: [] as unknown[],
  submitTurn: vi.fn(async (_input: { conversationId: string; matterId: string; turnText: string; mode?: string }) => ({ response: 'ok', master: { notice: null }, window: { scrubbedMasterTurns: 0 }, citations: [], rejectedCitationCount: 0, grounding: { grounded: false, omittedCount: 0, truncated: false, npiWithheldCount: 0 } })),
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      chatCopilot: {
        isEnabled: { useQuery: () => { React.useRef(null); return { data: { enabled: true }, isLoading: false }; } },
        list: { useQuery: () => { React.useRef(null); return { data: h.conversations, isLoading: false, isError: false }; } },
        messages: { useQuery: () => { React.useRef(null); return { data: h.messages, isLoading: false, isError: false }; } },
        // COPILOT-UPLOAD-1: CopilotThread now renders CopilotAttachments, which reads listAttachments.
        listAttachments: { useQuery: () => { React.useRef(null); return { data: [], isLoading: false, isError: false }; } },
      },
      // CHAT-COPILOT-2-INCB wiring added a flag read in CopilotThread; provide it (panel OFF here).
      chatReviewPanel: { isPanelEnabled: { useQuery: () => { React.useRef(null); return { data: { enabled: false }, isLoading: false }; } } },
      useUtils: () => ({
        chatCopilot: { list: { invalidate: () => {} }, messages: { invalidate: () => {} } },
        client: { chatCopilot: {
          create: { mutate: async () => ({}) },
          submitTurn: { mutate: h.submitTurn },
          setLegalHold: { mutate: async () => ({}) }, setMark: { mutate: async () => ({}) },
          setMessageExcludeFromGrounding: { mutate: async () => ({}) }, redactMessage: { mutate: async () => ({}) },
          exportToMatterFile: { mutate: async () => ({}) }, delete: { mutate: async () => ({}) },
        } },
      }),
    },
  };
});

import CopilotPage from '../../pages/CopilotPage.js';

const conv = { id: 'conv-1', matterId: 'm-1', documentId: null, title: 'Copilot', legalHold: false, doNotPersist: false, excludeFromGrounding: false, frozenAt: null };
const renderAt = () => render(
  <MemoryRouter initialEntries={['/matters/m-1/copilot']}>
    <Routes><Route path="/matters/:matterId/copilot" element={<CopilotPage />} /></Routes>
  </MemoryRouter>,
);

afterEach(() => cleanup());
beforeEach(() => { h.conversations = [conv]; h.messages = []; h.submitTurn.mockClear(); });

describe('CHAT-COPILOT-1 Inc 5 — guided modes + refine (render)', () => {
  it('the mode selector renders Draft/Review/Analyze/Outline; selecting one shows the input form', () => {
    const { getByTestId } = renderAt();
    fireEvent.click(getByTestId('copilot-list-item'));
    for (const m of ['draft', 'review', 'analyze', 'outline']) expect(getByTestId(`copilot-mode-${m}`)).toBeTruthy();
    fireEvent.click(getByTestId('copilot-mode-draft'));
    expect(getByTestId('copilot-guided-form')).toBeTruthy();
    expect(getByTestId('copilot-guided-audience')).toBeTruthy();
  });

  it('a guided turn folds the collected inputs into the text AND passes the mode to submitTurn', () => {
    const { getByTestId } = renderAt();
    fireEvent.click(getByTestId('copilot-list-item'));
    fireEvent.click(getByTestId('copilot-mode-draft'));
    fireEvent.change(getByTestId('copilot-guided-audience'), { target: { value: 'court' } });
    fireEvent.change(getByTestId('copilot-input'), { target: { value: 'draft an indemnity clause' } });
    fireEvent.click(getByTestId('copilot-send'));
    expect(h.submitTurn).toHaveBeenCalledTimes(1);
    const arg = h.submitTurn.mock.calls[0]![0];
    expect(arg.mode).toBe('draft');
    expect(arg.turnText).toContain('[Guided draft]');
    expect(arg.turnText).toContain('Audience: court');
    expect(arg.turnText).toContain('draft an indemnity clause');
  });

  it('Review mode auto-binds the operative document when the conversation is doc-bound', () => {
    h.conversations = [{ ...conv, documentId: 'doc-1' }];
    const { getByTestId } = renderAt();
    fireEvent.click(getByTestId('copilot-list-item'));
    fireEvent.click(getByTestId('copilot-mode-review'));
    expect((getByTestId('copilot-guided-document') as HTMLInputElement).value).toMatch(/operative document/i);
  });

  it('refine actions appear once there are turns and issue a follow-up turn (keeping the mode)', () => {
    h.messages = [{ id: 'msg-1', role: 'assistant', content: 'prior answer', citations: null, doNotPersist: false, excludeFromGrounding: false }];
    const { getByTestId } = renderAt();
    fireEvent.click(getByTestId('copilot-list-item'));
    fireEvent.click(getByTestId('copilot-mode-analyze'));
    expect(getByTestId('copilot-refine')).toBeTruthy();
    fireEvent.click(getByTestId('copilot-refine-shorten'));
    expect(h.submitTurn).toHaveBeenCalledTimes(1);
    const arg = h.submitTurn.mock.calls[0]![0];
    expect(arg.mode).toBe('analyze'); // refine keeps the active mode
    expect(arg.turnText).toMatch(/concise/i); // the shorten instruction
  });
});
