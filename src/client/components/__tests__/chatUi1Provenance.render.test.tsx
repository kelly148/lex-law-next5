// @vitest-environment jsdom
/**
 * CHAT-UI-1 W2c — ProvenanceLedgerPanel + usePostureProvenance (client wiring).
 *
 * Exercises the real hook + panel against a mocked tRPC: the panel ships empty / loading / error /
 * list states and an Export that pulls the verified bundle; the hook's record() persists a confirm
 * through the recordProvenance mutation (the path the live ConsequenceConfirm routes into).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const state = vi.hoisted(() => ({ entries: [] as unknown[], isLoading: false, isError: false }));
const calls = vi.hoisted(() => ({
  record: vi.fn(),
  invalidate: vi.fn(),
  exportQuery: vi.fn(async () => ({ matterId: 'm-1', count: 0, chain: { valid: true, brokenAtSeq: null, reason: null }, entries: [] })),
}));

vi.mock('../../trpc.js', async () => {
  const React2 = await import('react');
  return {
    trpc: {
      chatUi: {
        listProvenance: {
          useQuery: () => {
            React2.useRef(null);
            return { data: state.entries, isLoading: state.isLoading, isError: state.isError };
          },
        },
        recordProvenance: {
          useMutation: () => {
            React2.useRef(null);
            return { mutate: calls.record, isPending: false };
          },
        },
      },
      useUtils: () => ({
        chatUi: { listProvenance: { invalidate: calls.invalidate } },
        client: { chatUi: { exportProvenance: { query: calls.exportQuery } } },
      }),
    },
  };
});

import ProvenanceLedgerPanel from '../ProvenanceLedgerPanel.js';
import { usePostureProvenance } from '../../hooks/usePostureProvenance.js';
import { buildProvenanceEntry } from '../../../shared/posture/provenance.js';
import type { Posture } from '../../../shared/posture/postureCoherence.js';

const ROW = {
  id: 'r1',
  act: 'recipient',
  eventClass: 'meaningful_accept',
  recipient: 'adverse',
  verdictSeverity: 'none',
  actor: 'u1',
  confirmedAt: '2026-06-11T00:00:00.000Z',
};

afterEach(() => cleanup());
beforeEach(() => {
  state.entries = [];
  state.isLoading = false;
  state.isError = false;
  calls.record.mockClear();
  calls.exportQuery.mockClear();
});

describe('ProvenanceLedgerPanel — states + export', () => {
  it('empty: "no recorded decisions" and Export disabled', () => {
    const { getByTestId } = render(<ProvenanceLedgerPanel matterId="m-1" />);
    expect(getByTestId('provenance-empty')).toBeTruthy();
    expect((getByTestId('provenance-export') as HTMLButtonElement).disabled).toBe(true);
  });

  it('loading shows the loader', () => {
    state.isLoading = true;
    const { getByTestId } = render(<ProvenanceLedgerPanel matterId="m-1" />);
    expect(getByTestId('provenance-loading')).toBeTruthy();
  });

  it('error shows the error state', () => {
    state.isError = true;
    const { getByTestId } = render(<ProvenanceLedgerPanel matterId="m-1" />);
    expect(getByTestId('provenance-error')).toBeTruthy();
  });

  it('list renders rows; Export pulls the verified bundle', async () => {
    state.entries = [ROW];
    const { getByTestId, getAllByTestId } = render(<ProvenanceLedgerPanel matterId="m-1" />);
    expect(getAllByTestId('provenance-row')).toHaveLength(1);
    expect(getByTestId('provenance-list').textContent).toContain('adverse');
    const exportBtn = getByTestId('provenance-export') as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(false);
    fireEvent.click(exportBtn);
    await waitFor(() => expect(calls.exportQuery).toHaveBeenCalledWith({ matterId: 'm-1' }));
  });
});

describe('usePostureProvenance — record persists a confirm', () => {
  function Harness(): React.ReactElement {
    const h = usePostureProvenance('m-1');
    const entry = buildProvenanceEntry({
      act: 'recipient',
      actor: 'kelly',
      sliderPosition: 'Auto-Act',
      triggerSource: 'test',
      at: '2026-06-11T00:00:00.000Z',
      nextTriple: { issuer: { entity: 'the company', capacity: 'principal' }, privilege: false, recipient: 'adverse' } as Posture,
      acknowledged: [],
    });
    return (
      <button data-testid="do-record" onClick={() => h.record(entry)}>
        record
      </button>
    );
  }

  it('record() calls the recordProvenance mutation with the matter + entry', () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.click(getByTestId('do-record'));
    expect(calls.record).toHaveBeenCalledTimes(1);
    const arg = calls.record.mock.calls[0][0];
    expect(arg.matterId).toBe('m-1');
    expect(arg.documentId).toBeNull();
    expect(arg.entry.act).toBe('recipient');
    expect(arg.entry.eventClass).toBe('meaningful_accept');
  });
});
