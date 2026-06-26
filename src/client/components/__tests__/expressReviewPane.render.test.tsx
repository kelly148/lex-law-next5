// @vitest-environment jsdom
/**
 * ExpressReviewPane render test — EXPRESS-AUTO-REVIEW-LOOP-1 Part B (ci-gotchas #10: render, don't trust tsc).
 *
 * The pane is the flag-dark auto-review CLIENT surface. The PARENT (DocumentDetail) only mounts it when the flag
 * is on, so the pane itself is post-flag. This asserts that running the loop renders the mounted E7a banner
 * (server canApprove), the non-final candidate, the cumulative redline, and the risk-ranked decision ledger —
 * and that a fail-closed blocked result discloses the block and produces no candidate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const runMutate = vi.hoisted(() => vi.fn());

vi.mock('../../trpc.js', () => ({
  trpc: {
    useUtils: () => ({ client: { expressReviewLoop: { run: { mutate: runMutate } } } }),
  },
}));

// useGuardedMutation -> a thin wrapper that calls the fn and drives onSuccess/onError (so the pane's result state
// updates exactly as in the app).
vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: (
    fn: (input: unknown) => unknown,
    opts: { onSuccess?: (r: unknown) => void; onError?: (e: { message: string }) => void },
  ) => ({
    mutate: (input: unknown) => {
      Promise.resolve(fn(input)).then(
        (r) => opts.onSuccess?.(r),
        (e) => opts.onError?.(e as { message: string }),
      );
    },
    isPending: false,
    error: null,
  }),
}));

import ExpressReviewPane from '../ExpressReviewPane.js';

const COMPLETED = {
  status: 'completed' as const,
  isFinal: false as const,
  candidate: 'The amended candidate clause text.',
  rounds: 2,
  converged: true,
  hitCap: false,
  canApprove: false,
  blockingReasons: ['1 escalation(s) require an explicit attorney decision.'],
  roundSummaries: [],
  adopted: [],
  escalations: [
    { id: 'e1-1', round: 1, riskScore: 9, riskBucket: 'high' as const, immutabilityForced: false, beforeText: 'old clause', afterText: 'new clause', offsetStart: 0, offsetEnd: 10, reason: 'governing-law change' },
  ],
  ledger: [
    { id: 'e1-1', round: 1, route: 'escalate' as const, riskScore: 9, riskBucket: 'high' as const, immutabilityForced: false, beforeText: 'old clause', afterText: 'new clause', offsetStart: 0, offsetEnd: 10 },
    { id: 'e1-2', round: 1, route: 'auto_adopt' as const, riskScore: 2, riskBucket: 'low' as const, immutabilityForced: false, beforeText: 'teh', afterText: 'the', offsetStart: 20, offsetEnd: 23 },
  ],
  redline: { unchanged: false, segments: [{ op: 'equal' as const, text: 'The ' }, { op: 'delete' as const, text: 'old ' }, { op: 'insert' as const, text: 'new ' }, { op: 'equal' as const, text: 'clause.' }] },
};

const BLOCKED = { status: 'blocked' as const, reason: 'matter on no-external hold' };

function mount() {
  return render(<ExpressReviewPane matterId="m-1" documentId="d-1" onClose={() => {}} />);
}

beforeEach(() => {
  runMutate.mockReset();
  cleanup();
});

describe('ExpressReviewPane — Part B auto-review surface', () => {
  it('idle: shows the run control and no candidate/banner until run', () => {
    const c = mount();
    expect(c.getByTestId('express-review-pane')).toBeTruthy();
    expect(c.getByTestId('express-run')).toBeTruthy();
    expect(c.queryByTestId('express-candidate-banner')).toBeNull();
    expect(c.queryByTestId('express-ledger')).toBeNull();
  });

  it('completed: mounts the E7a banner (server canApprove=false -> approval blocked), the candidate, redline, and risk-ranked ledger', async () => {
    runMutate.mockResolvedValue(COMPLETED);
    const c = mount();
    fireEvent.click(c.getByTestId('express-run'));

    await waitFor(() => expect(c.queryByTestId('express-candidate-banner')).toBeTruthy());
    // banner is fed the SERVER canApprove (false) -> approval blocked + the escalation listed
    expect(c.getByTestId('express-approve-blocked')).toBeTruthy();
    expect(c.getAllByTestId('express-escalation-item').length).toBe(1);
    // non-final candidate text
    expect(c.getByTestId('express-candidate').textContent).toContain('amended candidate clause');
    // cumulative redline: a delete + an insert segment
    expect(c.getByTestId('express-redline-delete').textContent).toContain('old');
    expect(c.getByTestId('express-redline-insert').textContent).toContain('new');
    // decision ledger: both decisions rendered, risk-ranked (the high-risk escalation first)
    const entries = c.getAllByTestId('express-ledger-entry');
    expect(entries.length).toBe(2);
    expect(entries[0]!.textContent).toContain('escalated'); // highest riskScore first
    expect(c.getByTestId('express-unwind-deferred')).toBeTruthy(); // unwind deferral surfaced
  });

  it('blocked: discloses the fail-closed block and renders no candidate/banner', async () => {
    runMutate.mockResolvedValue(BLOCKED);
    const c = mount();
    fireEvent.click(c.getByTestId('express-run'));

    await waitFor(() => expect(c.queryByTestId('express-blocked')).toBeTruthy());
    expect(c.getByTestId('express-blocked').textContent).toContain('no-external hold');
    expect(c.queryByTestId('express-candidate-banner')).toBeNull();
    expect(c.queryByTestId('express-ledger')).toBeNull();
  });

  it('passes the matterId + documentId through to the run mutation', async () => {
    runMutate.mockResolvedValue(COMPLETED);
    const c = mount();
    fireEvent.click(c.getByTestId('express-run'));
    await waitFor(() => expect(runMutate).toHaveBeenCalledTimes(1));
    expect(runMutate.mock.calls[0]![0]).toEqual({ matterId: 'm-1', documentId: 'd-1' });
  });
});
