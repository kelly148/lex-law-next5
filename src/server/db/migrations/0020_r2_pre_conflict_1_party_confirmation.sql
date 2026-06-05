-- =============================================================================
-- R2-PRE-CONFLICT-1 Inc 1 — party confirmation lifecycle + conflict-check party snapshot
-- =============================================================================
-- ADDITIVE ONLY. Auto-applies via the pre-deploy runner (additive allowlist). Implements the
-- schema for the triad-dispositioned hybrid conflicts fix (consolidated_disposition_2026-06-05 §3F).
--
-- matter_parties.confirmed (+ confirmedAt / confirmedByUserId): the explicit-attorney-confirmation
--   lifecycle for a party. EXISTING rows are attorney-added, so the column defaults TRUE (already
--   confirmed). Auto-created (source='auto_from_clientName', Inc 2) and migration (source='migration',
--   Inc 5) parties are inserted confirmed=FALSE: screened immediately, but NOT clearance-satisfying
--   until the attorney explicitly confirms identity. NO hard role='client' constraint — co-clients
--   (joint clients in real-estate/title) are legitimate; the gate is enforced in the app layer.
-- conflict_checks.checkedPartyIds: the party-id set a terminal check evaluated (JSON array), so a
--   party change after a clear invalidates it (re-check required) — disposition §3D. Populated in Inc 4.
-- -----------------------------------------------------------------------------

ALTER TABLE `matter_parties`
  ADD COLUMN IF NOT EXISTS `confirmed` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS `confirmedAt` TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `confirmedByUserId` CHAR(36) NULL DEFAULT NULL;

ALTER TABLE `conflict_checks`
  ADD COLUMN IF NOT EXISTS `checkedPartyIds` JSON NULL DEFAULT NULL;
