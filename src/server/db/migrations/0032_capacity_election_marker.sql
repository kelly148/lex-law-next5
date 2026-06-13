-- =============================================================================
-- CAPACITY-ELECTION-UX Migration — matters.engagementCapacityElectedAt (election marker)
-- =============================================================================
-- ADDITIVE ONLY. Adds matters.engagementCapacityElectedAt — a nullable timestamp recording that an
-- AFFIRMATIVE engagement-capacity election was made for this matter. NULL = never affirmatively
-- elected (the safe, "unelected" state). This is the Option-A data-layer marker that distinguishes
-- "the attorney elected law_firm representation" from "the column defaulted to law_firm and nobody
-- chose anything" — the residual the existing engagementCapacity NOT NULL DEFAULT 'law_firm' column
-- cannot represent on its own.
--
-- The EXISTING engagementCapacity column (0031) is left completely untouched — not dropped, not
-- retyped, not re-defaulted. This file only ADDS a sibling marker. Idempotent (ADD COLUMN IF NOT
-- EXISTS). NO BACKFILL: existing rows keep engagementCapacity with engagementCapacityElectedAt = NULL,
-- so they are treated as unelected -> neutral until an attorney re-elects (a backfill would re-open
-- the residual for those rows). Applied via the Rule-18 additive pre-deploy runner (this file is on
-- the allowlist in scripts/apply-prod-migrations.mjs). TiDB-compatible MySQL.
--
-- Routing impact (CAPACITY-ELECTION-UX R3, behind the existing MASTER_* flags, all default OFF): the
-- representational law_firm seat must additionally carry a non-NULL marker before a master composes
-- for drafting / chat / outline. An unelected law_firm matter (marker NULL) -> legacy. Title routing
-- (engagementCapacity == 'title_settlement_agent') is unchanged. No new env var.
-- -----------------------------------------------------------------------------

ALTER TABLE `matters`
  ADD COLUMN IF NOT EXISTS `engagementCapacityElectedAt` TIMESTAMP NULL DEFAULT NULL;
