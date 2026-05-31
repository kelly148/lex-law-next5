/**
 * featureFlags.ts — MR-CAL-5B
 *
 * Product feature flags read from the environment. Every flag DEFAULTS OFF:
 * absence (or any value other than the exact string "true") preserves the
 * established behavior exactly. Mirrors the env-gated accessor pattern used by
 * middleware/authBypass.ts.
 */

/**
 * Multi-reviewer + advisory-evaluator topology (MR-CAL-5B).
 *
 * DEFAULT OFF. When off, the review workflow is single-reviewer per cycle exactly
 * as before (the MR-0G behavior): reviewSession.create rejects more than one
 * selected reviewer with MULTI_REVIEWER_DISABLED, and the UI offers single-select.
 *
 * When MULTI_REVIEWER_ENABLED is exactly "true", the attorney may select multiple
 * reviewers in one cycle. This toggle controls EXPOSURE only; it does NOT by itself
 * complete the evaluator output contract — that is MR-CAL-5C, and until then the
 * evaluator dispatch stays inert (see reviewSession.ts EVALUATOR_OUTPUT_CONTRACT_READY).
 *
 * Extension point (design:MR-CAL-5B option 2 — per-matter granularity, later):
 * add the per-matter override HERE (e.g. accept an optional context and let a
 * per-matter setting override the global default) so call sites need not change.
 */
export function isMultiReviewerEnabled(): boolean {
  return process.env['MULTI_REVIEWER_ENABLED'] === 'true';
}

/**
 * Evaluator dispatch (MR-CAL-5C). DEFAULT OFF.
 *
 * The evaluator output contract — real prompt/schema, parsing the LLM output, and
 * persisting dispositions via insertFeedbackEvaluation — is MR-CAL-5C, not 5B.
 * 5B only enables multi-reviewer SELECTION. This flag keeps the (currently
 * incomplete, telemetry-only) evaluator dispatch disabled so that enabling
 * multi-reviewer never fires a placeholder evaluator LLM call. MR-CAL-5C will
 * complete the contract and flip the default.
 */
export function isEvaluatorEnabled(): boolean {
  return process.env['EVALUATOR_ENABLED'] === 'true';
}

/**
 * Pure predicate: is a selection of `count` reviewers permitted, given whether the
 * multi-reviewer flag is enabled? Selecting more than one reviewer is only allowed
 * when multi-reviewer is enabled. (The lower bound — at least one reviewer — is
 * enforced separately by the create input schema's .min(1).)
 */
export function isReviewerSelectionCountAllowed(
  count: number,
  multiReviewerEnabled: boolean,
): boolean {
  if (count > 1 && !multiReviewerEnabled) return false;
  return true;
}
