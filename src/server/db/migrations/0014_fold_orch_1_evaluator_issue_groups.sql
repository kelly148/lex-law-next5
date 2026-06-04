-- =============================================================================
-- FOLD-ORCH-1 Migration 0014 — feedback_evaluations.issueGroups (Increment 3b)
-- =============================================================================
-- ADDITIVE ONLY. One additive, nullable JSON column on feedback_evaluations (defaulted NULL, so
-- every existing row stays valid). Auto-applies via the pre-deploy runner (additive allowlist).
--
-- feedback_evaluations.issueGroups — the evaluator's advisory cross-reviewer issue grouping
--   (EvaluatorOutput.issueGroups, Inc2a) captured from the SAME evaluator call that produced
--   `dispositions`. It is the GROUPING SOURCE for orchestration consolidation; it can only come
--   from the (one-time) evaluator LLM call, so it must be persisted to be used at read time.
--   NULL = the evaluator emitted no grouping (degrades to all-per-item). Advisory; the
--   deterministic engine re-derives convergence from the real successful reviewers.
-- -----------------------------------------------------------------------------

ALTER TABLE `feedback_evaluations`
  ADD COLUMN IF NOT EXISTS `issueGroups` JSON NULL DEFAULT NULL;
