// @vitest-environment jsdom
/**
 * usePostureQueue render test — CHAT-UI-1 W1 Auto-Act stacking + D1 carve-out (brief §2.6).
 *
 * Exercises the hook through a real component (real useState/useCallback, so a hooks-order bug would
 * surface): posture confirms stack ("N posture confirms waiting"), and a batch-clear leaves the
 * adverse (carve-out) confirm behind for individual handling while recording the cleared ones.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { usePostureQueue } from '../../hooks/usePostureQueue.js';
import type { Posture } from '../../../shared/posture/postureCoherence.js';
import type { PostureConfirmRequest } from '../../../shared/posture/postureQueue.js';
import { buildProvenanceEntry } from '../../../shared/posture/provenance.js';

const INTERNAL: Posture = {
  issuer: { entity: 'the firm', capacity: 'counsel' },
  privilege: true,
  recipient: 'internal_client',
};
const ADVERSE: Posture = {
  issuer: { entity: 'the company', capacity: 'principal' },
  privilege: false,
  recipient: 'adverse',
};

function entryFor(req: PostureConfirmRequest): ReturnType<typeof buildProvenanceEntry> {
  return buildProvenanceEntry({
    act: 'recipient',
    actor: 'kelly',
    sliderPosition: 'Auto-Act',
    triggerSource: 'batch',
    at: '2026-06-11T00:00:00.000Z',
    priorTriple: req.prior,
    nextTriple: req.next,
    acknowledged: req.findings,
  });
}

function Harness(): React.ReactElement {
  const q = usePostureQueue();
  return (
    <div>
      <div data-testid="label">{q.summary.label}</div>
      <div data-testid="counts">{`${q.summary.batchClearable}-${q.summary.individual}-${q.summary.blocked}`}</div>
      <div data-testid="ledger">{q.ledger.length}</div>
      <div data-testid="ids">{q.requests.map((r) => r.id).join(',')}</div>
      <button data-testid="add-internal" onClick={() => q.enqueue({ id: 'a', next: INTERNAL })}>
        internal
      </button>
      <button data-testid="add-adverse" onClick={() => q.enqueue({ id: 'b', next: ADVERSE })}>
        adverse
      </button>
      <button data-testid="clear-batch" onClick={() => q.clearBatchable(entryFor)}>
        clear
      </button>
    </div>
  );
}

afterEach(() => cleanup());

describe('usePostureQueue — Auto-Act stacking + D1 carve-out', () => {
  it('stacks confirms; batch-clear leaves the adverse carve-out confirm for individual handling', () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.click(getByTestId('add-internal'));
    fireEvent.click(getByTestId('add-adverse'));
    expect(getByTestId('label').textContent).toBe('2 posture confirms waiting');
    // 1 batchable, 1 individual (the adverse carve-out), 0 blocked.
    expect(getByTestId('counts').textContent).toBe('1-1-0');

    fireEvent.click(getByTestId('clear-batch'));
    // The internal confirm cleared; the adverse one REMAINS — a carve-out never batch-clears.
    expect(getByTestId('ids').textContent).toBe('b');
    expect(getByTestId('label').textContent).toBe('1 posture confirm waiting');
    expect(getByTestId('ledger').textContent).toBe('1'); // one meaningful accept recorded
  });
});
