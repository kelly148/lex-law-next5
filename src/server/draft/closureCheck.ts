/**
 * Closure completeness engine — FOLD-DRAFT-1 / package (Increment 2).
 *
 * PURE + DETERMINISTIC (no LLM, no I/O). Given the items of one closing package, compute an
 * ADVISORY completeness summary: is every REQUIRED item in hand? A required item counts as a
 * blocker only when its status is 'missing' (a 'not_applicable' required item is treated as
 * resolved by the attorney; 'present' is in hand). Optional items never block.
 *
 * ADVISORY ONLY: this reports what is missing for the attorney to act on. It never finalizes,
 * sends, or locks the package — the attorney is the decision-maker (the hard send gate is
 * FOLD-SEND-1).
 */

export type ClosureItemRequirement = 'required' | 'optional';
export type ClosureItemStatus = 'present' | 'missing' | 'not_applicable';

export interface ClosureItemInput {
  id: string;
  label: string;
  requirement: ClosureItemRequirement;
  status: ClosureItemStatus;
}

export interface ClosureCheckResult {
  total: number;
  requiredTotal: number;
  requiredPresent: number;
  requiredMissing: number;
  /** True when no REQUIRED item is still 'missing'. Advisory; never auto-finalizes. */
  complete: boolean;
  /** Labels of the required items still missing (the attorney's to-do for closure). */
  missingLabels: string[];
}

/**
 * Compute the advisory completeness summary for one package's items. Order-stable for missingLabels.
 */
export function computeClosure(items: readonly ClosureItemInput[]): ClosureCheckResult {
  const required = items.filter((i) => i.requirement === 'required');
  const requiredPresent = required.filter((i) => i.status === 'present').length;
  const missing = required.filter((i) => i.status === 'missing');

  return {
    total: items.length,
    requiredTotal: required.length,
    requiredPresent,
    requiredMissing: missing.length,
    complete: missing.length === 0,
    missingLabels: missing.map((i) => i.label),
  };
}
