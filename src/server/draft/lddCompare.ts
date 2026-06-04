/**
 * LDD compare engine — FOLD-DRAFT-1 / LDD (Increment 2).
 *
 * PURE + DETERMINISTIC (no LLM, no I/O). The heart of the LDD (LOI-vs-draft diff): given the
 * current draft text and the curated key-term dictionary, report — per term — whether that term's
 * agreed VALUE (taken from the LOI / operative source) is PRESENT in the draft or ABSENT.
 *
 * Conservative + transparent by design: this is a normalized substring-presence check, NOT a
 * semantic-equivalence judgment. 'absent' means the agreed value does not appear verbatim
 * (after normalization) in the draft — a DRIFT/OMISSION flag for the attorney to review. It never
 * edits the draft and never asserts the draft is wrong; the attorney is the decision-maker. A
 * blank expected value is reported 'indeterminate' (nothing to check) rather than a false 'present'.
 */

export type LddCompareStatus = 'present' | 'absent' | 'indeterminate';

export interface LddKeyTermInput {
  id: string;
  termLabel: string;
  expectedValue: string;
}

export interface LddTermComparison {
  id: string;
  termLabel: string;
  expectedValue: string;
  status: LddCompareStatus;
}

export interface LddComparisonResult {
  terms: LddTermComparison[];
  summary: {
    total: number;
    present: number;
    absent: number;
    indeterminate: number;
  };
}

/** Lowercase, collapse all whitespace runs to a single space, trim. Idempotent. */
export function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Compare each key term's agreed value against the draft text. Deterministic; order-preserving.
 */
export function compareKeyTerms(draftText: string, terms: readonly LddKeyTermInput[]): LddComparisonResult {
  const normalizedDraft = normalizeForCompare(draftText);

  const compared: LddTermComparison[] = terms.map((t) => {
    const normalizedValue = normalizeForCompare(t.expectedValue);
    let status: LddCompareStatus;
    if (normalizedValue === '') {
      status = 'indeterminate';
    } else if (normalizedDraft.includes(normalizedValue)) {
      status = 'present';
    } else {
      status = 'absent';
    }
    return { id: t.id, termLabel: t.termLabel, expectedValue: t.expectedValue, status };
  });

  return {
    terms: compared,
    summary: {
      total: compared.length,
      present: compared.filter((c) => c.status === 'present').length,
      absent: compared.filter((c) => c.status === 'absent').length,
      indeterminate: compared.filter((c) => c.status === 'indeterminate').length,
    },
  };
}
