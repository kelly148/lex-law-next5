/**
 * REVIEW-LOOP-UX-1 / R3 — lddVersionCompare engine.
 *
 * PURE (no DB, no LLM), exercised directly. The version.compare tRPC procedure runs live (no test DB)
 * and follows the established owner-checked read pattern (getDocumentById + getVersionById, both
 * ctx.userId-scoped; both versions pinned to the document), mirroring lddKeyTerm.getComparison.
 */

import { describe, it, expect } from 'vitest';
import { compareKeyTermDictionaries } from '../draft/lddVersionCompare.js';

const term = (termLabel: string, expectedValue: string) => ({ termLabel, expectedValue });

describe('REVIEW-LOOP-UX-1 R3 — compareKeyTermDictionaries (deterministic version-to-version diff)', () => {
  it('flags an added term (present in B, absent in A)', () => {
    const r = compareKeyTermDictionaries([], [term('Closing Date', '2026-07-01')]);
    expect(r.terms[0]!.change).toBe('added');
    expect(r.terms[0]!.valueA).toBeNull();
    expect(r.terms[0]!.valueB).toBe('2026-07-01');
    expect(r.summary).toEqual({ total: 1, added: 1, removed: 0, changed: 0, unchanged: 0 });
  });

  it('flags a removed term (present in A, absent in B)', () => {
    const r = compareKeyTermDictionaries([term('Closing Date', '2026-07-01')], []);
    expect(r.terms[0]!.change).toBe('removed');
    expect(r.terms[0]!.valueA).toBe('2026-07-01');
    expect(r.terms[0]!.valueB).toBeNull();
    expect(r.summary.removed).toBe(1);
  });

  it('flags a value-changed term and carries both values', () => {
    const r = compareKeyTermDictionaries(
      [term('Governing Law', 'Maryland')],
      [term('Governing Law', 'Commonwealth of Virginia')],
    );
    expect(r.terms[0]!.change).toBe('changed');
    expect(r.terms[0]!.valueA).toBe('Maryland');
    expect(r.terms[0]!.valueB).toBe('Commonwealth of Virginia');
    expect(r.summary.changed).toBe(1);
  });

  it('treats a case-/whitespace-only difference as unchanged (same normalization as compareKeyTerms)', () => {
    const r = compareKeyTermDictionaries(
      [term('Governing Law', 'Commonwealth   of  VIRGINIA')],
      [term('Governing Law', 'commonwealth of virginia')],
    );
    expect(r.terms[0]!.change).toBe('unchanged');
    expect(r.summary.unchanged).toBe(1);
  });

  it('matches terms by normalized label and lets the last-recorded value win within a version', () => {
    const r = compareKeyTermDictionaries(
      [term('Purchase Price', '$1,000,000'), term('purchase  price', '$1,200,000')],
      [term('Purchase Price', '$1,200,000')],
    );
    // Both A rows collapse to one label; the later A row ($1,200,000) wins, so it equals B -> unchanged.
    expect(r.summary.total).toBe(1);
    expect(r.terms[0]!.change).toBe('unchanged');
  });

  it('produces a deterministic, label-sorted order regardless of input order', () => {
    const r = compareKeyTermDictionaries(
      [term('Zoning', 'C-2'), term('Acreage', '5')],
      [term('Acreage', '5'), term('Zoning', 'C-2')],
    );
    expect(r.terms.map((t) => t.termLabel)).toEqual(['Acreage', 'Zoning']);
  });

  it('handles two empty dictionaries (nothing to compare)', () => {
    const r = compareKeyTermDictionaries([], []);
    expect(r.summary).toEqual({ total: 0, added: 0, removed: 0, changed: 0, unchanged: 0 });
  });

  it('mixes added / removed / changed / unchanged in one diff', () => {
    const r = compareKeyTermDictionaries(
      [term('Buyer', 'Acme LLC'), term('Seller', 'Beta Inc'), term('Price', '$100')],
      [term('Buyer', 'Acme LLC'), term('Price', '$150'), term('Closing', '2026-08-01')],
    );
    expect(r.summary).toEqual({ total: 4, added: 1, removed: 1, changed: 1, unchanged: 1 });
  });
});
