-- =============================================================================
-- FOLD-KB-1 Migration 0011 — matters.paKey (Increment 4)
-- =============================================================================
-- ADDITIVE ONLY. One additive, nullable column on matters (defaulted NULL, so every existing
-- row stays valid). Auto-applies via the pre-deploy runner (additive allowlist).
--
-- matters.paKey — the attorney-CONFIRMED practice-area key (Fork E) that maps a matter's
--   freeform practiceArea to a pa_instruction_profiles paKey. NULL = no confirmed profile =>
--   the LLM-dispatch chokepoint uses the base prompt (never a mismatched PA). Set/changed only
--   by an explicit attorney act (practiceKb.confirmMatterPaKey); never silently inferred.
-- -----------------------------------------------------------------------------

ALTER TABLE `matters`
  ADD COLUMN IF NOT EXISTS `paKey` VARCHAR(64) NULL DEFAULT NULL;
