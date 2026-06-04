-- =============================================================================
-- FOLD-ORCH-1 Migration 0012 — matters.orchestrationLanes (Increment 2b)
-- =============================================================================
-- ADDITIVE ONLY. One additive, nullable JSON column on matters (defaulted NULL, so every
-- existing row stays valid). Auto-applies via the pre-deploy runner (additive allowlist).
--
-- matters.orchestrationLanes — the per-matter reviewer-lane override (Fork C): a JSON object
--   { claude, gpt, gemini, grok } of booleans layered over the global ReviewerEnablement
--   default. NULL = no per-matter override => the matter uses the global default. Set/changed
--   only by an explicit attorney act (matter.setOrchestrationLanes); never silently inferred.
--   The orchestration convergence denominator (N-of-M) is computed over the toggled-on set.
-- -----------------------------------------------------------------------------

ALTER TABLE `matters`
  ADD COLUMN IF NOT EXISTS `orchestrationLanes` JSON NULL DEFAULT NULL;
