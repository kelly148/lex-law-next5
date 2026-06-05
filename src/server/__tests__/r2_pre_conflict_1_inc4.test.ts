/**
 * R2-PRE-CONFLICT-1 Inc 4 — check-party snapshot + stale-clear invalidation (constraint D / BLOCK #4).
 *
 * - runConflictCheck snapshots the evaluated party-id set onto conflict_checks.checkedPartyIds.
 * - evaluateConflictClearance adds the 4th CLEARED condition: the latest check must be CURRENT vs the
 *   matter's party set (else NOT_ESTABLISHED 'check_stale_parties_changed'). Adding/removing a party
 *   invalidates a prior clear; CONFIRMING a party does NOT (same id set). A null/legacy snapshot is
 *   fail-closed (stale).
 *
 * The currency comparator is a PURE exported fn -> real behavioral coverage with no test DB. The two
 * wiring points (snapshot on insert; predicate uses the comparator) are source-asserted (repo pattern).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { partyIdSetUnchanged } from '../db/queries/conflicts.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('R2-PRE-CONFLICT-1 Inc 4: partyIdSetUnchanged (PURE currency comparator)', () => {
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';
  const C = '33333333-3333-3333-3333-333333333333';

  it('true when the snapshot equals the current set (order-independent — e.g. after a CONFIRM, ids unchanged)', () => {
    expect(partyIdSetUnchanged([A, B], [B, A])).toBe(true);
    expect(partyIdSetUnchanged([A], [A])).toBe(true);
    expect(partyIdSetUnchanged([], [])).toBe(true);
  });

  it('false when a party was ADDED since the check (current has an id the snapshot lacks)', () => {
    expect(partyIdSetUnchanged([A], [A, B])).toBe(false);
  });

  it('false when a party was REMOVED since the check (snapshot has an id no longer current)', () => {
    expect(partyIdSetUnchanged([A, B], [A])).toBe(false);
  });

  it('false on a different-member set of the same size', () => {
    expect(partyIdSetUnchanged([A, B], [A, C])).toBe(false);
  });

  it('FAIL-CLOSED: a null / undefined / non-array snapshot (pre-Inc-4 check) is NOT current', () => {
    expect(partyIdSetUnchanged(null, [A])).toBe(false);
    expect(partyIdSetUnchanged(undefined, [])).toBe(false);
  });
});

describe('R2-PRE-CONFLICT-1 Inc 4: wiring (snapshot on check; predicate uses the comparator)', () => {
  const conflicts = read('src/server/db/queries/conflicts.ts');

  it('runConflictCheck snapshots the screened party-id set onto checkedPartyIds', () => {
    const fn = conflicts.slice(conflicts.indexOf('export async function runConflictCheck'), conflicts.indexOf('export async function getConflictCheckById'));
    expect(fn).toContain('checkedPartyIds: thisParties.map((p) => p.id)');
  });

  it('evaluateConflictClearance returns the distinct stale reason via the pure comparator', () => {
    const fn = conflicts.slice(conflicts.indexOf('export async function evaluateConflictClearance'), conflicts.indexOf('export async function isConflictCleared'));
    expect(fn).toContain('partyIdSetUnchanged(check.checkedPartyIds, parties.map((p) => p.id))');
    expect(fn).toContain("reasons: ['check_stale_parties_changed']");
  });
});
