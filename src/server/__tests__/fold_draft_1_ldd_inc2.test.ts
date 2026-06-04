/**
 * FOLD-DRAFT-1 / LDD Increment 2 — compare engine + sourceType/sourceId invariant.
 *
 * Both units are PURE (no DB, no LLM), so they are exercised directly. The tRPC router
 * (record / listForDocument / getComparison) runs live (no test DB) and follows the established
 * owner-checked + audited pattern (mirrors provisionProvenance).
 */

import { describe, it, expect } from 'vitest';
import { compareKeyTerms, normalizeForCompare } from '../draft/lddCompare.js';
import { validateLddKeyTermSource, sourceRequiresId } from '../draft/lddKeyTermRules.js';
import type { LddKeyTermSourceType } from '../../shared/schemas/lddKeyTerm.js';

const term = (id: string, termLabel: string, expectedValue: string) => ({ id, termLabel, expectedValue });

describe('FOLD-DRAFT-1 LDD Inc2 — compareKeyTerms (deterministic, normalized presence)', () => {
  const draft = 'This Agreement shall be governed by the Commonwealth of Virginia. The Purchase Price is $1,200,000.';

  it('marks a present value present (case- and whitespace-insensitive)', () => {
    const r = compareKeyTerms(draft, [term('a', 'Governing Law', 'commonwealth   of  VIRGINIA')]);
    expect(r.terms[0]!.status).toBe('present');
    expect(r.summary).toEqual({ total: 1, present: 1, absent: 0, indeterminate: 0 });
  });

  it('marks an absent value absent (drift/omission flag)', () => {
    const r = compareKeyTerms(draft, [term('a', 'Governing Law', 'State of Maryland')]);
    expect(r.terms[0]!.status).toBe('absent');
    expect(r.summary.absent).toBe(1);
  });

  it('marks a blank expected value indeterminate (nothing to check — never a false present)', () => {
    const r = compareKeyTerms(draft, [term('a', 'Closing Date', '   ')]);
    expect(r.terms[0]!.status).toBe('indeterminate');
    expect(r.summary.indeterminate).toBe(1);
  });

  it('preserves term order and the original (un-normalized) expected value', () => {
    const r = compareKeyTerms(draft, [
      term('a', 'Purchase Price', '$1,200,000'),
      term('b', 'Governing Law', 'Maryland'),
    ]);
    expect(r.terms.map((t) => t.id)).toEqual(['a', 'b']);
    expect(r.terms[0]!.status).toBe('present');
    expect(r.terms[0]!.expectedValue).toBe('$1,200,000');
    expect(r.terms[1]!.status).toBe('absent');
  });

  it('handles an empty dictionary', () => {
    const r = compareKeyTerms(draft, []);
    expect(r.summary).toEqual({ total: 0, present: 0, absent: 0, indeterminate: 0 });
  });

  it('normalizeForCompare is idempotent and collapses whitespace + case', () => {
    const once = normalizeForCompare('  The   QUICK\n brown  ');
    expect(once).toBe('the quick brown');
    expect(normalizeForCompare(once)).toBe(once);
  });
});

describe('FOLD-DRAFT-1 LDD Inc2 — validateLddKeyTermSource (sourceType/sourceId invariant)', () => {
  it('requires a sourceId for source-referencing types', () => {
    for (const sourceType of ['loi', 'operative_source', 'material'] as LddKeyTermSourceType[]) {
      expect(sourceRequiresId(sourceType)).toBe(true);
      expect(validateLddKeyTermSource(sourceType, null).ok).toBe(false);
      expect(validateLddKeyTermSource(sourceType, '   ').ok).toBe(false); // blank treated as absent
      expect(validateLddKeyTermSource(sourceType, 'src-1').ok).toBe(true);
    }
  });

  it('forbids a sourceId for attorney_specified', () => {
    expect(sourceRequiresId('attorney_specified')).toBe(false);
    expect(validateLddKeyTermSource('attorney_specified', null).ok).toBe(true);
    expect(validateLddKeyTermSource('attorney_specified', 'src-1').ok).toBe(false);
  });
});
