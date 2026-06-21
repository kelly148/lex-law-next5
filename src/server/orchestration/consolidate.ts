/**
 * Multi-model consolidation + bulk-eligibility engine — FOLD-ORCH-1 (Increment 1).
 *
 * PURE and exhaustively unit-tested — this is the whole safety point of ORCH-1.
 *
 * NAMED DESIGN CONSTRAINT — VA Rule 2.1 independent professional judgment (non-delegable).
 * The threat is gradual erosion of the attorney's own judgment over routine use, not an
 * accidental click. So BULK-ELIGIBILITY is the control, not the confirm gesture:
 *
 *   - Convergence ALONE is never sufficient. Correlated models converge on confident-wrong
 *     answers (the shared-blind-spot case), so agreement is not a safety signal by itself.
 *   - Bulk-confirm is available ONLY for items that are convergent AND genuinely low-risk:
 *       PRECISION / POLISH                  -> bulk-eligible
 *       STRUCTURAL                          -> bulk-eligible ONLY if positively classified as
 *                                              low-risk cleanup (structuralLowRiskCleanup=true);
 *                                              otherwise per-item
 *       SUBSTANTIVE / BLOCKER               -> NEVER bulk-eligible, even with unanimous agreement
 *       divergent (any severity)            -> NEVER bulk-eligible
 *   - Convergence = ACTUAL reviewer overlap (N-of-M of the toggled-on reviewers), counted over
 *     SUCCESSFUL substantive returns. A missing/empty/failed lane is NOT a convergent vote. The
 *     evaluator may label/summarize convergence elsewhere but CANNOT constitute it here.
 *   - FLOOR: no convergence at all unless >= 2 successful substantive reviewer returns. A degraded
 *     run yields FEWER convergent items (pushes toward per-item), never the same bucket over a
 *     smaller accidental sample.
 *
 * No LLM in this engine: bucketing is deterministic over grouped inputs.
 */

import type { OrchestrationGroup } from '../../shared/schemas/orchestration.js';

/** Minimum successful substantive reviewer returns before ANY convergence bucket can exist. */
export const CONVERGENCE_FLOOR = 2;

/**
 * Severity-gated bulk-eligibility (PURE). Low-risk only; STRUCTURAL requires a POSITIVE
 * low-risk-cleanup classification; SUBSTANTIVE/BLOCKER never; unknown severity -> not eligible
 * (conservative). Case-insensitive on the severity label.
 */
export function isBulkEligibleSeverity(severity: string, structuralLowRiskCleanup?: boolean): boolean {
  switch ((severity ?? '').trim().toUpperCase()) {
    case 'PRECISION':
    case 'POLISH':
      return true;
    case 'STRUCTURAL':
      return structuralLowRiskCleanup === true;
    case 'SUBSTANTIVE':
    case 'BLOCKER':
      return false;
    default:
      return false; // unknown/missing severity is never bulk-eligible
  }
}

export type OrchClassification =
  | 'convergent_low_risk' // convergent AND low-risk -> the ONLY bulk-eligible class
  | 'convergent_high_risk' // convergent but substantive/blocker/uncertain-structural -> per-item
  | 'divergent' // reviewers disagree -> per-item, never auto-close
  | 'single_reviewer'; // <2 successful reviewers agreed (incl. evaluator-adopt-with-1-reviewer) -> per-item

export type OrchBucket = 'bulk_eligible' | 'per_item';

export interface ConsolidatedGroup {
  issueId: string;
  severity: string;
  classification: OrchClassification;
  bucket: OrchBucket;
  convergent: boolean;
  bulkEligible: boolean;
  agreedCount: number; // distinct SUCCESSFUL reviewers who raised this issue
  reason: string;
}

export interface ConsolidationInput {
  intendedReviewers: string[]; // the matter's toggled-on reviewer set
  successfulReviewers: string[]; // reviewers that returned a substantive result this run
  // REVIEWER-NO-RETURN-RELABEL-1: reviewers that COMPLETED this run (wrote a feedback row — even an
  // EMPTY one), a superset of successfulReviewers. Used ONLY to split the non-success set into
  // completed-empty ("No suggestions") vs a true non-return ("No return") for honest labeling; it
  // does NOT affect convergence/eligibility (those still count over successfulReviewers). Optional:
  // omitted => completed defaults to the successful set (legacy: completedEmpty empty, noReturn = missing).
  completedReviewers?: string[];
  groups: OrchestrationGroup[];
}

export interface ConsolidationResult {
  groups: ConsolidatedGroup[];
  // `missing` = intended − successful (preserved for back-compat). REVIEWER-NO-RETURN-RELABEL-1
  // partitions it: `completedEmpty` = returned a clean EMPTY result ("No suggestions"); `noReturn` =
  // never returned (errored / timed_out / rate_limited / cancelled — "No return"). The two are
  // disjoint and their union is exactly `missing`.
  denominator: {
    intended: number;
    successful: number;
    missing: string[];
    completedEmpty: string[];
    noReturn: string[];
  };
  convergenceFloorMet: boolean;
  bulkEligibleIssueIds: string[];
}

function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

/**
 * Deterministically classify each grouped issue and compute bulk-eligibility. The grouping
 * (which reviewers raised the same issue, and whether they diverge) is an INPUT — produced
 * upstream (Increment 2) by a mechanism that never lets the evaluator constitute convergence.
 */
export function consolidateReviewerFeedback(input: ConsolidationInput): ConsolidationResult {
  const intended = uniq(input.intendedReviewers);
  const successful = uniq(input.successfulReviewers).filter((r) => intended.includes(r));
  const successfulSet = new Set(successful);
  const missing = intended.filter((r) => !successfulSet.has(r));
  // REVIEWER-NO-RETURN-RELABEL-1: split `missing` into completed-empty vs true non-return for honest
  // labeling. `completed` = reviewers that wrote a feedback row this run (a superset of successful; an
  // EMPTY row is still a completion). Default to the successful set when not supplied (legacy parity).
  const completedSet = new Set(
    uniq([...(input.completedReviewers ?? successful), ...successful]).filter((r) => intended.includes(r)),
  );
  const completedEmpty = intended.filter((r) => completedSet.has(r) && !successfulSet.has(r));
  const noReturn = intended.filter((r) => !completedSet.has(r));
  const convergenceFloorMet = successful.length >= CONVERGENCE_FLOOR;

  const groups: ConsolidatedGroup[] = input.groups.map((g) => {
    // A failed/missing lane is NOT a vote: count only successful reviewers in this group.
    const agreedCount = uniq(g.reviewerMembers).filter((r) => successfulSet.has(r)).length;

    let classification: OrchClassification;
    if (g.divergent) {
      classification = 'divergent';
    } else if (!convergenceFloorMet || agreedCount < CONVERGENCE_FLOOR) {
      classification = 'single_reviewer';
    } else if (isBulkEligibleSeverity(g.severity, g.structuralLowRiskCleanup)) {
      classification = 'convergent_low_risk';
    } else {
      classification = 'convergent_high_risk';
    }

    const convergent = classification === 'convergent_low_risk' || classification === 'convergent_high_risk';
    const bulkEligible = classification === 'convergent_low_risk';
    const bucket: OrchBucket = bulkEligible ? 'bulk_eligible' : 'per_item';

    const reason =
      classification === 'divergent'
        ? 'Reviewers disagree — per-item decision; cannot auto-close.'
        : classification === 'single_reviewer'
          ? `Only ${agreedCount} successful reviewer(s) raised this (floor ${CONVERGENCE_FLOOR}, ${successful.length} returned) — per-item.`
          : classification === 'convergent_high_risk'
            ? `Convergent (${agreedCount} agreed) but ${(g.severity ?? '').toUpperCase() || 'unknown'} severity is never bulk-eligible — per-item.`
            : `Convergent (${agreedCount} agreed) and low-risk — bulk-eligible (acknowledgment required).`;

    return { issueId: g.issueId, severity: g.severity, classification, bucket, convergent, bulkEligible, agreedCount, reason };
  });

  return {
    groups,
    denominator: { intended: intended.length, successful: successful.length, missing, completedEmpty, noReturn },
    convergenceFloorMet,
    bulkEligibleIssueIds: groups.filter((g) => g.bulkEligible).map((g) => g.issueId),
  };
}
