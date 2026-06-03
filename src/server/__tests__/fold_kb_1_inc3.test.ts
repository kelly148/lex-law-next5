/**
 * FOLD-KB-1 Increment 3 — memo lifecycle (kb_events audit) + retention policy.
 *
 *   A. isPromotableToReuse — PURE promote-gate (abstraction required, Fork B).
 *   B. memoSurvivesMatterDeletion / partitionMemosForMatterDeletion — retention policy
 *      (operator decision #1): abstracted memos survive; raw delete with the origin matter.
 *   C. KbEventRowSchema — the firm-level audit row parses.
 */

import { describe, it, expect } from 'vitest';
import { isPromotableToReuse } from '../practiceKb/gate.js';
import { memoSurvivesMatterDeletion, partitionMemosForMatterDeletion } from '../practiceKb/retention.js';
import { KbEventRowSchema } from '../../shared/schemas/practiceKb.js';

describe('FOLD-KB-1 Inc3 — promote gate', () => {
  it('only an abstracted memo is promotable to firm-wide reuse', () => {
    expect(isPromotableToReuse({ abstractionStatus: 'abstracted' })).toBe(true);
    expect(isPromotableToReuse({ abstractionStatus: 'raw' })).toBe(false);
  });
});

describe('FOLD-KB-1 Inc3 — retention policy (decision #1)', () => {
  it('abstracted memos survive origin-matter deletion; raw do not', () => {
    expect(memoSurvivesMatterDeletion({ abstractionStatus: 'abstracted' })).toBe(true);
    expect(memoSurvivesMatterDeletion({ abstractionStatus: 'raw' })).toBe(false);
  });

  it('partitions a matter\'s memos into retain (abstracted) and delete (raw)', () => {
    const memos = [
      { id: 'a', abstractionStatus: 'abstracted' as const },
      { id: 'b', abstractionStatus: 'raw' as const },
      { id: 'c', abstractionStatus: 'abstracted' as const },
    ];
    const { retain, delete: del } = partitionMemosForMatterDeletion(memos);
    expect(retain.map((m) => m.id)).toEqual(['a', 'c']);
    expect(del.map((m) => m.id)).toEqual(['b']);
  });
});

describe('FOLD-KB-1 Inc3 — KbEventRowSchema', () => {
  it('parses a firm-level audit row', () => {
    const row = {
      id: '00000000-0000-0000-0000-0000000000e1',
      userId: '00000000-0000-0000-0000-0000000000d4',
      action: 'memo_promoted_to_reuse',
      targetType: 'practice_memo',
      targetId: '00000000-0000-0000-0000-0000000000f0',
      summary: 'Promoted abstracted memo to firm-wide reuse',
      rationale: null,
      payload: null,
      createdAt: new Date(),
    };
    expect(KbEventRowSchema.parse(row).action).toBe('memo_promoted_to_reuse');
  });
});
