/**
 * LDD version-compare engine — REVIEW-LOOP-UX-1 / R3 (document version history + compare view).
 *
 * PURE + DETERMINISTIC (no LLM, no I/O). Companion to lddCompare.ts: where compareKeyTerms() flags
 * a single draft's key-term VALUE drift, this diffs the curated KEY-TERM DICTIONARY between TWO
 * versions of the same document — which terms were ADDED, REMOVED, had their agreed VALUE CHANGED,
 * or are UNCHANGED from version A (baseline) to version B (compared). Terms are matched by their
 * normalized termLabel (the dictionary's natural key for a document); the agreed value is compared
 * after the same normalization compareKeyTerms uses, so the diff is case-/whitespace-insensitive and
 * idempotent.
 *
 * Conservative + transparent by design: this is a deterministic label/value set-diff, NOT a semantic
 * judgment. It surfaces what changed between two versions for the attorney to review; it never edits
 * a draft and never asserts a version is wrong. The attorney is always the decision-maker.
 */

import { normalizeForCompare } from './lddCompare.js';

export type LddVersionTermChange = 'added' | 'removed' | 'changed' | 'unchanged';

/** Minimal shape this engine needs from a key-term dictionary row (a subset of LddKeyTermRow). */
export interface LddVersionTermInput {
  termLabel: string;
  expectedValue: string;
}

export interface LddVersionTermDiff {
  termLabel: string;
  change: LddVersionTermChange;
  /** Agreed value in version A (baseline); null when the term did not exist in A (added). */
  valueA: string | null;
  /** Agreed value in version B (compared); null when the term no longer exists in B (removed). */
  valueB: string | null;
}

export interface LddVersionCompareResult {
  terms: LddVersionTermDiff[];
  summary: {
    total: number;
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
}

/**
 * Reduce a dictionary to the last-recorded value per normalized term label. Later rows win, so a
 * re-recorded term reflects its most recent agreed value. Preserves the first-seen display label.
 */
function indexByLabel(
  terms: readonly LddVersionTermInput[],
): Map<string, { label: string; value: string }> {
  const byLabel = new Map<string, { label: string; value: string }>();
  for (const t of terms) {
    const key = normalizeForCompare(t.termLabel);
    if (key === '') continue;
    const existing = byLabel.get(key);
    byLabel.set(key, { label: existing?.label ?? t.termLabel, value: t.expectedValue });
  }
  return byLabel;
}

/**
 * Diff the key-term dictionaries of two versions. `termsA` is the baseline (version A), `termsB` the
 * compared (version B). Order: changed/removed/added/unchanged interleave by sorted term label so the
 * output is deterministic regardless of input order.
 */
export function compareKeyTermDictionaries(
  termsA: readonly LddVersionTermInput[],
  termsB: readonly LddVersionTermInput[],
): LddVersionCompareResult {
  const aByLabel = indexByLabel(termsA);
  const bByLabel = indexByLabel(termsB);

  const allKeys = new Set<string>([...aByLabel.keys(), ...bByLabel.keys()]);
  const sortedKeys = [...allKeys].sort();

  const diffs: LddVersionTermDiff[] = sortedKeys.map((key) => {
    const a = aByLabel.get(key) ?? null;
    const b = bByLabel.get(key) ?? null;

    let change: LddVersionTermChange;
    if (a === null && b !== null) {
      change = 'added';
    } else if (a !== null && b === null) {
      change = 'removed';
    } else if (a !== null && b !== null) {
      change = normalizeForCompare(a.value) === normalizeForCompare(b.value) ? 'unchanged' : 'changed';
    } else {
      // Unreachable: a key is in allKeys only if it exists in A or B.
      change = 'unchanged';
    }

    return {
      termLabel: b?.label ?? a?.label ?? key,
      change,
      valueA: a?.value ?? null,
      valueB: b?.value ?? null,
    };
  });

  return {
    terms: diffs,
    summary: {
      total: diffs.length,
      added: diffs.filter((d) => d.change === 'added').length,
      removed: diffs.filter((d) => d.change === 'removed').length,
      changed: diffs.filter((d) => d.change === 'changed').length,
      unchanged: diffs.filter((d) => d.change === 'unchanged').length,
    },
  };
}
