-- =============================================================================
-- FOLD-ORCH-1 Migration 0013 — orchestration persistence (Increment 3)
-- =============================================================================
-- ADDITIVE ONLY. Two additive, nullable columns on existing tables (defaulted NULL, so every
-- existing row stays valid). Auto-applies via the pre-deploy runner (additive allowlist).
--
-- adopt_ledger.confirmationMode — the per-item CONFIRMATION MODE (HOW the attorney confirmed an
--   adoption: bulk-acknowledged-low-severity-convergent | individually_adopted | ... |
--   synthesis_adopted | divergent_resolved). NEVER flattened to "adopted". NULL = legacy/pre-ORCH
--   adoption (no recorded mode). Values mirror CONFIRMATION_MODE_VALUES (orchestration.ts).
--
-- open_items.detail — content-preserving JSON payload for a divergent reviewer open item (Fork E):
--   per-reviewer positions (severity + rationale excerpt), optional evaluator synthesis, source
--   session. NULL for all non-orchestration open items.
-- -----------------------------------------------------------------------------

ALTER TABLE `adopt_ledger`
  ADD COLUMN IF NOT EXISTS `confirmationMode` VARCHAR(64) NULL DEFAULT NULL;

ALTER TABLE `open_items`
  ADD COLUMN IF NOT EXISTS `detail` JSON NULL DEFAULT NULL;
