// @vitest-environment jsdom
/**
 * CHAT-UI-1 BA-1 — the 'tier_source' act executes the real backend mutation on a PASSED confirm.
 *
 * Proves (no test DB -> at the call seam): (a) a passed confirm invokes chatUi.setSourceTier with the
 * chosen tier on the bound source; (b) cancel invokes NO mutation; (c) provenance still records; (d)
 * a hard-stop undo re-tiers back to the captured prior tier. The real DB write is deploy-time-verified.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const SOURCE = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  userId: 'u', matterId: 'm-1', subjectType: 'material', subjectId: 'mat-1',
  authorityOrigin: 'reference', lifecycle: 'operative', designationSource: 'system',
  documentId: null, label: 'Contract A', notes: null, createdAt: '2026-06-11T00:00:00.000Z', updatedAt: '2026-06-11T00:00:00.000Z',
};

const calls = vi.hoisted(() => ({ record: vi.fn(), tier: vi.fn(async (_a: unknown) => ({})), invalidate: vi.fn() }));

vi.mock('../../trpc.js', async () => {
  const React2 = await import('react');
  return {
    trpc: {
      chatUi: {
        listProvenance: { useQuery: () => { React2.useRef(null); return { data: [], isLoading: false, isError: false }; } },
        recordProvenance: { useMutation: () => { React2.useRef(null); return { mutate: calls.record, isPending: false }; } },
        listSources: { useQuery: () => { React2.useRef(null); return { data: [SOURCE], isLoading: false, isError: false }; } },
      },
      useUtils: () => ({
        chatUi: { listProvenance: { invalidate: calls.invalidate }, listSources: { invalidate: calls.invalidate } },
        client: { chatUi: { setSourceTier: { mutate: calls.tier }, exportProvenance: { query: async () => ({ matterId: 'm-1', count: 0, chain: { valid: true, brokenAtSeq: null, reason: null }, entries: [] }) } } },
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
beforeEach(() => { calls.record.mockClear(); calls.tier.mockClear(); });

const selectSource = (getByTestId: (id: string) => HTMLElement) => {
  fireEvent.change(getByTestId('tier-source-select'), { target: { value: SOURCE.id } });
  fireEvent.change(getByTestId('tier-origin-select'), { target: { value: 'firm' } });
};

describe('BA-1 tier — passed confirm runs the audited re-tier', () => {
  it('confirm -> setSourceTier called with the chosen tier; provenance recorded', async () => {
    const { getByTestId } = renderIt();
    selectSource(getByTestId);
    fireEvent.click(getByTestId('act-tier'));
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    fireEvent.click(getByTestId('confirm-accept'));
    await waitFor(() => expect(calls.tier).toHaveBeenCalledTimes(1));
    expect(calls.tier).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: SOURCE.id, matterId: 'm-1', authorityOrigin: 'firm', lifecycle: 'operative' }),
    );
    expect(calls.record.mock.calls[0]![0].entry.act).toBe('tier_source');
  });

  it('cancel -> NO backend mutation (no partial write)', () => {
    const { getByTestId } = renderIt();
    selectSource(getByTestId);
    fireEvent.click(getByTestId('act-tier'));
    fireEvent.click(getByTestId('confirm-cancel'));
    expect(calls.tier).not.toHaveBeenCalled();
    expect(calls.record).not.toHaveBeenCalled();
  });

  it('a hard-stop undo re-tiers back to the captured prior tier', async () => {
    const { getByTestId } = renderIt();
    selectSource(getByTestId);
    fireEvent.click(getByTestId('act-tier'));
    fireEvent.click(getByTestId('confirm-accept'));
    await waitFor(() => expect(calls.tier).toHaveBeenCalledTimes(1));
    calls.tier.mockClear();
    // Undo -> confirm -> compensating re-tier back to prior (reference/operative).
    fireEvent.click(getByTestId('act-tier-undo'));
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    fireEvent.click(getByTestId('confirm-accept'));
    await waitFor(() => expect(calls.tier).toHaveBeenCalledTimes(1));
    expect(calls.tier).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: SOURCE.id, authorityOrigin: 'reference', lifecycle: 'operative', rationale: 'undo' }),
    );
  });
});
