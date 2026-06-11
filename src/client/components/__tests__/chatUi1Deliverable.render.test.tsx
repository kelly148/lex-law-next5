// @vitest-environment jsdom
/**
 * CHAT-UI-1 (live wiring) WIRE-2 — the deliverable posture strip + acts, END-TO-END.
 *
 * Drives ChatDeliverable inside the real ConsequenceProvider against a mocked tRPC. Proves the issuer
 * scenario fires live ("firm style / no branding" silent; "from the owners" -> recorded full-triple
 * confirm), a cosmetic toggle is silent, a posture change confirms + applies, and the send egress
 * coherence check blocks a send to an adverse party with privilege undetermined.
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
import ChatDeliverable from '../ChatDeliverable.js';

const renderDeliverable = () =>
  render(
    <ConsequenceProvider matterId="m-1" actor="u1">
      <ChatDeliverable />
    </ConsequenceProvider>,
  );

afterEach(() => cleanup());
beforeEach(() => calls.record.mockClear());

describe('ChatDeliverable — the issuer scenario, END-TO-END on the live surface', () => {
  it('"firm style, no branding, from the owners": cosmetics apply silently; the issuer change surfaces a recorded full-triple confirm', async () => {
    const { getByTestId } = renderDeliverable();
    fireEvent.change(getByTestId('formatting-input'), {
      target: { value: 'firm style, no branding, from the owners' },
    });
    fireEvent.click(getByTestId('formatting-apply'));

    // Cosmetics applied SILENTLY (no confirm was needed for them).
    expect(getByTestId('dt-cosmetic').textContent).toContain('firm');
    expect(getByTestId('dt-cosmetic').textContent).toContain('branding: off');

    // "from the owners" surfaced a confirm with the FULL triple; the issuer row is flagged changed.
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    expect(getByTestId('confirm-triple')).toBeTruthy();
    expect(getByTestId('triple-issuer').getAttribute('data-changed')).toBe('true');
    expect(getByTestId('triple-issuer').textContent).toContain('as a party');

    // Confirm -> durable provenance recorded (act=issuer) + posture applied.
    fireEvent.click(getByTestId('confirm-accept'));
    expect(calls.record).toHaveBeenCalledTimes(1);
    const entry = calls.record.mock.calls[0][0].entry;
    expect(entry.act).toBe('issuer');
    expect(entry.nextTriple.issuer.entity).toBe('the owners');
    await waitFor(() => expect(getByTestId('dt-issuer').textContent).toContain('the owners'));
  });
});

describe('ChatDeliverable — cosmetic / posture / send', () => {
  it('a cosmetic styling toggle applies silently (no confirm, no record)', () => {
    const { getByTestId, queryByTestId } = renderDeliverable();
    fireEvent.click(getByTestId('ctl-cosmetic-firmstyle'));
    expect(getByTestId('dt-cosmetic').textContent).toContain('firm');
    expect(queryByTestId('confirm-overlay')).toBeNull();
    expect(calls.record).not.toHaveBeenCalled();
  });

  it('changing recipient surfaces a confirm and applies on confirm', async () => {
    const { getByTestId } = renderDeliverable();
    fireEvent.click(getByTestId('ctl-recipient-adverse'));
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    fireEvent.click(getByTestId('confirm-accept'));
    await waitFor(() => expect(getByTestId('dt-recipient').textContent).toContain('adverse'));
    expect(calls.record.mock.calls[0][0].entry.act).toBe('recipient');
  });

  it('the send egress check blocks a send to an adverse party with privilege undetermined', async () => {
    const { getByTestId } = renderDeliverable();
    // recipient -> adverse (a carve-out interrupt; confirmable here — privilege still undetermined, not at egress).
    fireEvent.click(getByTestId('ctl-recipient-adverse'));
    fireEvent.click(getByTestId('confirm-accept'));
    await waitFor(() => expect(getByTestId('dt-recipient').textContent).toContain('adverse'));
    // send -> the egress coherence check on {counsel, undetermined, adverse} HARD-blocks.
    fireEvent.click(getByTestId('act-send'));
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    expect(getByTestId('confirm-hard')).toBeTruthy();
    expect((getByTestId('confirm-accept') as HTMLButtonElement).disabled).toBe(true);
  });
});
