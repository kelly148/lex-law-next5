// @vitest-environment jsdom
/**
 * CHAT-UI-1 (live wiring) WIRE-1 — confirm-orchestration integration.
 *
 * Drives requestConfirm through the real ConsequenceProvider + AutonomySlider against a mocked tRPC,
 * proving the slider/queue/carve-out behavior + durable provenance end-to-end: Propose-and-Confirm
 * interrupts (confirm -> durable record); Auto-Act queues batchable posture ("N waiting" -> clear ->
 * record); the BROAD carve-out (adverse) interrupts individually even in Auto-Act; a HARD incoherence
 * blocks; and a non-posture act (send) always interrupts.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

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

import { ConsequenceProvider, useConsequence, type ConfirmRequest } from '../ConsequenceProvider.js';
import AutonomySlider from '../AutonomySlider.js';
import type { Posture } from '../../../shared/posture/postureCoherence.js';

const COUNSEL = { entity: 'the firm', capacity: 'counsel' as const };
const PRINCIPAL = { entity: 'the company', capacity: 'principal' as const };
const INTERNAL: Posture = { issuer: { ...COUNSEL }, privilege: true, recipient: 'internal_client' };
const ADVERSE_NONPRIV: Posture = { issuer: { ...PRINCIPAL }, privilege: false, recipient: 'adverse' };
const PRIV_ADVERSE: Posture = { issuer: { ...COUNSEL }, privilege: true, recipient: 'adverse' };

function Inner(): React.ReactElement {
  const { requestConfirm } = useConsequence();
  const [outcome, setOutcome] = React.useState('');
  const fire = (req: ConfirmRequest): void => {
    void requestConfirm(req).then((o) => setOutcome(`confirmed=${o.confirmed} queued=${o.queued}`));
  };
  return (
    <div>
      <AutonomySlider />
      <div data-testid="outcome">{outcome}</div>
      <button data-testid="req-internal" onClick={() => fire({ act: 'recipient', title: 'Confirm recipient', posture: { next: INTERNAL }, triggerSource: 't' })}>internal</button>
      <button data-testid="req-adverse" onClick={() => fire({ act: 'recipient', title: 'Confirm recipient', posture: { next: ADVERSE_NONPRIV }, triggerSource: 't' })}>adverse</button>
      <button data-testid="req-hard" onClick={() => fire({ act: 'recipient', title: 'Confirm recipient', posture: { next: PRIV_ADVERSE }, triggerSource: 't' })}>hard</button>
      <button data-testid="req-send" onClick={() => fire({ act: 'send', title: 'Confirm send', subject: { type: 'send', id: null, label: null, detail: null }, triggerSource: 't' })}>send</button>
    </div>
  );
}

const renderHarness = () =>
  render(
    <ConsequenceProvider matterId="m-1" actor="u1">
      <Inner />
    </ConsequenceProvider>,
  );

afterEach(() => cleanup());
beforeEach(() => {
  calls.record.mockClear();
});

describe('ConsequenceProvider — slider/queue/carve-out orchestration', () => {
  it('Propose-and-Confirm (default): a posture change interrupts; confirm writes durable provenance', async () => {
    const { getByTestId, queryByTestId } = renderHarness();
    fireEvent.click(getByTestId('req-internal'));
    // Interrupt -> overlay.
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    fireEvent.click(getByTestId('confirm-accept'));
    expect(queryByTestId('confirm-overlay')).toBeNull();
    expect(calls.record).toHaveBeenCalledTimes(1);
    const arg = calls.record.mock.calls[0][0];
    expect(arg.matterId).toBe('m-1');
    expect(arg.entry.act).toBe('recipient');
    expect(arg.entry.eventClass).toBe('meaningful_accept');
    await waitFor(() => expect(getByTestId('outcome').textContent).toBe('confirmed=true queued=false'));
  });

  it('Auto-Act: a batchable posture change queues ("N waiting"); Clear all records it', async () => {
    const { getByTestId, queryByTestId } = renderHarness();
    fireEvent.click(getByTestId('slider-autoact'));
    fireEvent.click(getByTestId('req-internal'));
    // No interrupt; queued.
    expect(queryByTestId('confirm-overlay')).toBeNull();
    expect(getByTestId('posture-queue-bar').textContent).toContain('1 posture confirm waiting');
    await waitFor(() => expect(getByTestId('outcome').textContent).toBe('confirmed=true queued=true'));
    // Batch clear records the dirty->confirmed transition.
    fireEvent.click(getByTestId('queue-clear-all'));
    expect(queryByTestId('posture-queue-bar')).toBeNull();
    expect(calls.record).toHaveBeenCalledTimes(1);
    expect(calls.record.mock.calls[0][0].entry.eventClass).toBe('dirty_confirmed');
  });

  it('Auto-Act: the BROAD carve-out (adverse) interrupts individually, never queues', () => {
    const { getByTestId, queryByTestId } = renderHarness();
    fireEvent.click(getByTestId('slider-autoact'));
    fireEvent.click(getByTestId('req-adverse'));
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    expect(queryByTestId('posture-queue-bar')).toBeNull();
  });

  it('a HARD incoherence (privileged x adverse) interrupts and blocks the confirm', () => {
    const { getByTestId } = renderHarness();
    fireEvent.click(getByTestId('req-hard'));
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    expect(getByTestId('confirm-hard')).toBeTruthy();
    expect((getByTestId('confirm-accept') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Auto-Act: a non-posture hard-stop act (send) always interrupts', () => {
    const { getByTestId, queryByTestId } = renderHarness();
    fireEvent.click(getByTestId('slider-autoact'));
    fireEvent.click(getByTestId('req-send'));
    expect(getByTestId('confirm-overlay')).toBeTruthy();
    expect(queryByTestId('posture-queue-bar')).toBeNull();
  });
});
