/**
 * EGRESS-CONTROL-PLANE-1 Increment 2 — single-winner job claim (no double transmit).
 *
 * Adversarial-review HIGH finding: markJobRunning must return the conditional UPDATE's OWN affectedRows —
 * the rows THIS statement transitioned queued->running — NOT a post-hoc `SELECT ... WHERE status='running'`.
 * The old SELECT returned 1 to EVERY concurrent caller once any of them flipped the row, so two runners
 * (a create background kick AND the durable dispatcher poll claiming the same committed reviewer job) would
 * BOTH pass the rowsAffected===0 guard in runJob and BOTH call adapter.generate -> a DOUBLE TRANSMIT of
 * confidential reviewer content. This BEHAVIORAL test drives the REAL markJobRunning (the existing claim
 * tests mock it with hand-fed [1, 0] and never exercised the bug) and proves the loser gets 0.
 */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => {
  let affected = 1;
  return {
    setAffected: (n: number) => {
      affected = n;
    },
    db: {
      // The conditional UPDATE: queued->running WHERE status='queued'. mysql2 ResultSetHeader.affectedRows
      // = the rows THIS statement actually changed (1 for the winner, 0 for a loser whose WHERE matched 0).
      update: () => ({ set: () => ({ where: () => Promise.resolve([{ affectedRows: affected }]) }) }),
      // A post-hoc SELECT WOULD find the row in 'running' (length 1) regardless of who flipped it. It is
      // mocked here so that, if markJobRunning ever regresses to returning this SELECT's count, the LOSER
      // test below would wrongly observe 1 and FAIL — guarding the single-winner fix.
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: 'j1' }]) }) }),
      }),
    },
  };
});
vi.mock('../db/connection.js', () => ({ db: h.db }));

import { markJobRunning } from '../db/queries/jobs.js';

describe('EGRESS-CONTROL-PLANE-1 Inc 2 — markJobRunning is a TRUE single-winner claim', () => {
  it('the WINNER (its UPDATE flipped queued->running) gets 1', async () => {
    h.setAffected(1);
    expect(await markJobRunning('j1', 'u1')).toBe(1);
  });

  it('the LOSER (its UPDATE matched 0 rows) gets 0 — even though the row IS now running — so runJob short-circuits BEFORE adapter.generate (no double transmit)', async () => {
    h.setAffected(0);
    expect(await markJobRunning('j1', 'u1')).toBe(0);
  });
});
