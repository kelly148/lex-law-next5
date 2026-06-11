// @vitest-environment jsdom
/**
 * CHAT-UI-1 (live wiring) WIRE-3 — context integrity END-TO-END.
 *
 * Drives ContextIntegrityPanel inside the real ConsequenceProvider against a mocked tRPC:
 *  - matter-identity ingestion confirms before binding; an unambiguous same-matter re-ingest does NOT
 *    over-prompt; an ambiguous resolution always confirms;
 *  - a cosmetic undo is silent; a hard-stop undo confirms + records a {type:'undo'} reversal;
 *  - acting on a drifted preview is caught and re-confirmed against the CURRENT triple (privilege left
 *    "on" while recipient moved to adverse -> HARD on re-confirm).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const calls = vi.hoisted(() => ({ record: vi.fn(), invalidate: vi.fn(), exportQuery: vi.fn(async () => ({ matterId: 'm-1', count: 0, chain: { valid: true, brokenAtSeq: null, reason: null }, entries: [] })) }));

vi.mock('../../trpc.js', async () => {
  const React2 = await import('react');
  return {
    trpc: {
      chatUi: {
        listProvenance: { useQuery: () => { React2.useRef(null); return { data: [], isLoading: false, isError: false }; } },
        recordProvenance: { useMutation: () => { React2.useRef(null); return { mutate: calls.record, isPending: false }; } },
      },
      useUtils: () => ({
        chatUi: { listProvenance: { invalidate: calls.invalidate } },
        client: { chatUi: { exportProvenance: { query: calls.exportQuery } } },
      }),
    },
  };
});

import { ConsequenceProvider } from '../ConsequenceProvider.js';
import ContextIntegrityPanel from '../ContextIntegrityPanel.js';

const renderPanel = () =>
  render(
    <ConsequenceProvider matterId="m-1" actor="u1">
      <ContextIntegrityPanel />
    </ConsequenceProvider>,
  );

afterEach(() => cleanup());
beforeEach(() => calls.record.mockClear());

describe('matter-identity ingestion confirm', () => {
  it('a resolved matter surfaces a confirm before binding; confirm records + binds', async () => {
    const { getByTestId } = renderPanel();
    fireEvent.click(getByTestId('ci-ingest-a'));
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    expect(getByTestId('confirm-subject').textContent).toContain('Matter A');
    fireEvent.click(getByTestId('confirm-accept'));
    expect(calls.record.mock.calls[0][0].entry.act).toBe('matter_identity');
    expect(calls.record.mock.calls[0][0].entry.subject.type).toBe('matter');
    await waitFor(() => expect(getByTestId('ci-bound').textContent).toContain('A'));
  });

  it('an unambiguous same-matter re-ingest does NOT over-prompt', async () => {
    const { getByTestId, queryByTestId } = renderPanel();
    fireEvent.click(getByTestId('ci-ingest-a'));
    fireEvent.click(getByTestId('confirm-accept'));
    await waitFor(() => expect(getByTestId('ci-bound').textContent).toContain('A'));
    calls.record.mockClear();
    fireEvent.click(getByTestId('ci-reingest-a'));
    expect(queryByTestId('confirm-overlay')).toBeNull();
    expect(calls.record).not.toHaveBeenCalled();
    expect(getByTestId('ci-bound').textContent).toContain('A');
  });

  it('an ambiguous resolution always confirms', () => {
    const { getByTestId } = renderPanel();
    fireEvent.click(getByTestId('ci-ingest-ambiguous'));
    expect(getByTestId('confirm-overlay')).toBeTruthy();
  });
});

describe('undo-by-band, live', () => {
  it('a cosmetic undo is silent (no confirm, no record)', () => {
    const { getByTestId, queryByTestId } = renderPanel();
    fireEvent.click(getByTestId('ci-undo-cosmetic'));
    expect(queryByTestId('confirm-overlay')).toBeNull();
    expect(calls.record).not.toHaveBeenCalled();
    expect(getByTestId('ci-undolog').textContent).toContain('silent');
  });

  it('a hard-stop undo confirms and records a {type:"undo"} reversal', async () => {
    const { getByTestId } = renderPanel();
    fireEvent.click(getByTestId('ci-undo-hardstop'));
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    fireEvent.click(getByTestId('confirm-accept'));
    const entry = calls.record.mock.calls[0][0].entry;
    expect(entry.act).toBe('lock');
    expect(entry.subject.type).toBe('undo');
    await waitFor(() => expect(getByTestId('ci-undolog').textContent).toContain('lock reversed'));
  });
});

describe('stale-preview guard, live', () => {
  it('acting on a drifted preview is caught + re-confirmed against current (privilege unchanged, recipient moved -> HARD)', async () => {
    const { getByTestId } = renderPanel();
    fireEvent.click(getByTestId('ci-act-stale'));
    expect(getByTestId('ci-stale-result').textContent).toContain('stale=true blocked=true');
    // The re-confirm binds to the CURRENT (drifted) triple and surfaces the HARD it created.
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    expect(getByTestId('confirm-hard')).toBeTruthy();
    expect((getByTestId('confirm-accept') as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(getByTestId('hard-priv-to-adverse')).toBeTruthy());
  });
});
