/**
 * RELAYOUT-1 — deriveVersionStatus / formatVersionLabel unit tests (gate G1).
 *
 * The draft-vs-accepted label is load-bearing legal legibility, and a single version row can
 * satisfy several predicates at once, so the precedence (final > substantive > current(draft) >
 * superseded) is a correctness requirement, not cosmetics.
 */
import { describe, it, expect } from 'vitest';
import { deriveVersionStatus, formatVersionLabel } from '../versionStatus.js';

const doc = (over: Partial<{
  currentVersionId: string | null;
  officialSubstantiveVersionNumber: number | null;
  officialFinalVersionNumber: number | null;
}>) => ({
  currentVersionId: null,
  officialSubstantiveVersionNumber: null,
  officialFinalVersionNumber: null,
  ...over,
});

describe('deriveVersionStatus', () => {
  it('labels the current, unaccepted version as a draft (current)', () => {
    const v = { id: 'v2', versionNumber: 2 };
    const d = doc({ currentVersionId: 'v2' });
    const s = deriveVersionStatus(v, d);
    expect(s.key).toBe('draft');
    expect(s.isCurrent).toBe(true);
    expect(formatVersionLabel(v, d)).toBe('v2 · draft (current)');
  });

  it('labels the accepted-substantive version by versionNumber, even when it is NOT current', () => {
    // current = a newer draft v2; substantive accepted at v1
    const d = doc({ currentVersionId: 'v2', officialSubstantiveVersionNumber: 1 });
    const v1 = deriveVersionStatus({ id: 'v1', versionNumber: 1 }, d);
    expect(v1.key).toBe('substantive');
    expect(v1.isCurrent).toBe(false);
    expect(v1.label).toBe('accepted substantive');
    expect(deriveVersionStatus({ id: 'v2', versionNumber: 2 }, d).key).toBe('draft');
  });

  it('final takes precedence when one row is current AND substantive AND final (accept-unformatted)', () => {
    const d = doc({
      currentVersionId: 'v1',
      officialSubstantiveVersionNumber: 1,
      officialFinalVersionNumber: 1,
    });
    const v1 = { id: 'v1', versionNumber: 1 };
    const s = deriveVersionStatus(v1, d);
    expect(s.key).toBe('final');
    expect(s.isCurrent).toBe(true);
    expect(formatVersionLabel(v1, d)).toBe('v1 · final (current)');
  });

  it('labels a non-current, non-accepted version as superseded', () => {
    const d = doc({ currentVersionId: 'v3', officialSubstantiveVersionNumber: 2 });
    expect(deriveVersionStatus({ id: 'v1', versionNumber: 1 }, d).key).toBe('superseded');
  });

  it('keeps the substantive label (with current) when the accepted version is also current', () => {
    const d = doc({ currentVersionId: 'v1', officialSubstantiveVersionNumber: 1 });
    const v1 = { id: 'v1', versionNumber: 1 };
    const s = deriveVersionStatus(v1, d);
    expect(s.key).toBe('substantive');
    expect(s.isCurrent).toBe(true);
    expect(formatVersionLabel(v1, d)).toBe('v1 · accepted substantive (current)');
  });

  it('does not depend on the counters being populated (the G1 defect class)', () => {
    // Common case: a draft exists, nothing accepted yet (both counters null).
    const d = doc({ currentVersionId: 'v1' });
    const s = deriveVersionStatus({ id: 'v1', versionNumber: 1 }, d);
    expect(s.key).toBe('draft');
    expect(s.isCurrent).toBe(true);
  });
});
