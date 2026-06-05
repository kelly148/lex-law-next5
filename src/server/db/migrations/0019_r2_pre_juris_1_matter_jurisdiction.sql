-- =============================================================================
-- R2-PRE-JURIS-1 Migration 0019 — matters.jurisdiction
-- =============================================================================
-- ADDITIVE ONLY. One additive, nullable VARCHAR column on matters (defaulted NULL, so every
-- existing row stays valid). Auto-applies via the pre-deploy runner (additive allowlist).
--
-- matters.jurisdiction — the matter's GOVERNING jurisdiction (e.g. 'VA' | 'MD'; the attorney is
--   dual-licensed). NULL = unset. Set only by an explicit attorney act (matter.create /
--   matter.updateMetadata); never inferred. The Whereas R2 #3 readiness strip surfaces it as a
--   first-class chip that LEADS the strip (it conditions conflicts / source-authority currency /
--   sendability reads beside it). Stored as a free VARCHAR (not an enum) so future jurisdictions
--   never trip the Zod Wall; the UI constrains the choices.
-- -----------------------------------------------------------------------------

ALTER TABLE `matters`
  ADD COLUMN IF NOT EXISTS `jurisdiction` VARCHAR(16) NULL DEFAULT NULL;
