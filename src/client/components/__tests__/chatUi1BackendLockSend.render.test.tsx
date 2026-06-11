// @vitest-environment jsdom
/**
 * CHAT-UI-1 BA-2 (lock) + BA-3 (send) — the acts execute their real backend mutation on a PASSED
 * confirm, bound to a real document. Proves: lock -> lockDeliverable (+ undo -> unlockDeliverable);
 * send -> recordSend (internal 'sent' disposition, NO egress); a HARD-blocked send writes NOTHING;
 * cancel writes nothing; provenance still records.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const calls = vi.hoisted(() => ({
  DOC: { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', title: 'Draft POA' },
  record: vi.fn(),
  lock: vi.fn(async (_a: unknown) => ({ lockedDecisionId: 'lock-1' })),
  unlock: vi.fn(async (_a: unknown) => ({ ok: true })),
  send: vi.fn(async (_a: unknown) => ({ eventId: 'e1', decision: 'sent' })),
  invalidate: vi.fn(),
}));
const DOC = calls.DOC;

vi.mock('../../trpc.js', async () => {
  const React2 = await import('react');
  const q = (data: unknown) => ({ useQuery: () => { React2.useRef(null); return { data, isLoading: false, isError: false }; } });
  return {
    trpc: {
      chatUi: {
        listProvenance: q([]),
        recordProvenance: { useMutation: () => { React2.useRef(null); return { mutate: calls.record, isPending: false }; } },
        listSources: q([]),
      },
      document: { list: q([calls.DOC]) },
      useUtils: () => ({
        chatUi: { listProvenance: { invalidate: calls.invalidate }, listSources: { invalidate: calls.invalidate } },
        client: {
          chatUi: {
            lockDeliverable: { mutate: calls.lock },
            unlockDeliverable: { mutate: calls.unlock },
            recordSend: { mutate: calls.send },
            setSourceTier: { mutate: async () => ({}) },
            exportProvenance: { query: async () => ({ matterId: 'm-1', count: 0, chain: { valid: true, brokenAtSeq: null, reason: null }, entries: [] }) },
          },
        },
      }),
    },
  };
});

import { ConsequenceProvider } from '../ConsequenceProvider.js';
import ChatDeliverable from '../ChatDeliverable.js';

const renderIt = () =>
  render(
    <ConsequenceProvider matterId="m-1" actor="u1">
      <ChatDeliverable matterId="m-1" />
    </ConsequenceProvider>,
  );

afterEach(() => cleanup());
beforeEach(() => { calls.record.mockClear(); calls.lock.mockClear(); calls.unlock.mockClear(); calls.send.mockClear(); });

const bindDoc = (getByTestId: (id: string) => HTMLElement) => fireEvent.change(getByTestId('doc-select'), { target: { value: DOC.id } });

describe('BA-2 lock', () => {
  it('confirm -> lockDeliverable on the bound document; provenance records; undo -> unlockDeliverable', async () => {
    const { getByTestId } = renderIt();
    bindDoc(getByTestId);
    fireEvent.click(getByTestId('act-lock'));
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    fireEvent.click(getByTestId('confirm-accept'));
    await waitFor(() => expect(calls.lock).toHaveBeenCalledTimes(1));
    expect(calls.lock).toHaveBeenCalledWith(expect.objectContaining({ matterId: 'm-1', documentId: DOC.id }));
    expect(calls.record.mock.calls[0]![0].entry.act).toBe('lock');
    // Undo the lock -> unlockDeliverable.
    fireEvent.click(getByTestId('act-lock-undo'));
    fireEvent.click(getByTestId('confirm-accept'));
    await waitFor(() => expect(calls.unlock).toHaveBeenCalledTimes(1));
    expect(calls.unlock).toHaveBeenCalledWith(expect.objectContaining({ matterId: 'm-1', lockedDecisionId: 'lock-1' }));
  });

  it('cancel -> NO lock mutation', () => {
    const { getByTestId } = renderIt();
    bindDoc(getByTestId);
    fireEvent.click(getByTestId('act-lock'));
    fireEvent.click(getByTestId('confirm-cancel'));
    expect(calls.lock).not.toHaveBeenCalled();
  });
});

describe('BA-3 send (internal disposition, no egress)', () => {
  it('confirm -> recordSend with an internal "sent" disposition on the bound document', async () => {
    const { getByTestId } = renderIt();
    bindDoc(getByTestId);
    fireEvent.click(getByTestId('act-send'));
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    fireEvent.click(getByTestId('confirm-accept'));
    await waitFor(() => expect(calls.send).toHaveBeenCalledTimes(1));
    expect(calls.send).toHaveBeenCalledWith(expect.objectContaining({ matterId: 'm-1', documentId: DOC.id, decision: 'sent' }));
  });

  it('a HARD-blocked send (adverse recipient + undetermined privilege at egress) writes NOTHING', async () => {
    const { getByTestId } = renderIt();
    bindDoc(getByTestId);
    // recipient -> adverse (carve-out interrupt; confirmable — privilege undetermined, not at egress).
    fireEvent.click(getByTestId('ctl-recipient-adverse'));
    fireEvent.click(getByTestId('confirm-accept'));
    await waitFor(() => expect(getByTestId('dt-recipient').textContent).toContain('adverse'));
    // send -> egress HARD -> confirm blocked -> NO recordSend, no partial write.
    fireEvent.click(getByTestId('act-send'));
    expect(getByTestId('confirm-hard')).toBeTruthy();
    expect((getByTestId('confirm-accept') as HTMLButtonElement).disabled).toBe(true);
    expect(calls.send).not.toHaveBeenCalled();
  });
});
