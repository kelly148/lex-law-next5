/**
 * Per-matter reviewer-lane resolution — FOLD-ORCH-1 (Increment 2b, Fork C).
 *
 * PURE. Resolves the EFFECTIVE reviewer set for a matter by layering the per-matter override
 * (matters.orchestrationLanes) over the global ReviewerEnablement default, and derives the
 * orchestration convergence denominator (the toggled-on reviewer roles, the "M" in N-of-M).
 *
 * NULL per-matter override => fall back to the global default (existing matters are unaffected).
 * No DB, no LLM here: this is a deterministic projection consumed by the orchestration dispatch
 * (Inc3 "run orchestration") to populate ConsolidationInput.intendedReviewers.
 */

import type { ReviewerEnablement, MatterOrchestrationLanes } from '../../shared/schemas/matters.js';

/** The reviewer lane keys, in canonical order. Same keys as ReviewerEnablement. */
export const REVIEWER_LANE_KEYS = ['claude', 'gpt', 'gemini', 'grok'] as const;
export type ReviewerLaneKey = (typeof REVIEWER_LANE_KEYS)[number];

/**
 * The effective reviewer enablement for a matter: the per-matter override when present, else the
 * global default. A null/absent override is NOT a partial merge — it means "no override," so the
 * global default applies wholesale.
 */
export function resolveReviewerLanes(params: {
  matterLanes?: MatterOrchestrationLanes | null | undefined;
  globalEnablement: ReviewerEnablement;
}): ReviewerEnablement {
  return params.matterLanes ?? params.globalEnablement;
}

/** The toggled-on reviewer roles (the N-of-M denominator), in canonical order. */
export function intendedReviewersFromEnablement(enablement: ReviewerEnablement): string[] {
  return REVIEWER_LANE_KEYS.filter((k) => enablement[k] === true);
}

/**
 * Convenience: the matter's toggled-on reviewer set — resolve the per-matter override over the
 * global default, then project to the enabled roles. This is exactly what the orchestration
 * dispatch passes as ConsolidationInput.intendedReviewers.
 */
export function intendedReviewersForMatter(params: {
  matterLanes?: MatterOrchestrationLanes | null | undefined;
  globalEnablement: ReviewerEnablement;
}): string[] {
  return intendedReviewersFromEnablement(resolveReviewerLanes(params));
}
