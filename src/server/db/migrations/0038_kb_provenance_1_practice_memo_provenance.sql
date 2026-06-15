-- =============================================================================
-- KB-PROVENANCE-1 Migration 0038 — practice_memos provenance/currency columns (MIG1)
-- =============================================================================
-- ADDITIVE ONLY. Four nullable columns on practice_memos (all DEFAULT NULL, so every existing
-- row stays valid). Auto-applies via the pre-deploy runner (additive allowlist); idempotent
-- (ADD COLUMN IF NOT EXISTS). NO data backfill, NO behavior change. Encodes the
-- WHEREAS_KB_CONSTITUTION §8 do-now provenance/currency fields.
--
-- effectiveDate         — DATE the stated law became effective (memo-level; distinct from the
--                         per-authority effectiveDate inside lawReliedOn JSON).
-- reviewBy              — DATE the memo should be re-checked for currency (recheck-by).
-- authoritySnapshotId   — CHAR(36) link to a pinned authority snapshot/source row (provenance pin).
-- negativeTreatmentFlag — BOOLEAN: the relied-on authority has negative treatment (overruled /
--                         superseded / questioned). NULL = unassessed.
--
-- NOT added: a memo-level `verified_date` — it would duplicate the existing verifiedThroughDate
--   (currency horizon) and lastVerifiedAt (verification act). supersedes_id / superseded_by_id are
--   DEFERRED per Constitution §8 (and practice_memos already carries supersededById). The §2
--   pinned-citation + signature gate is enforced at the app-layer promotion boundary (an additive
--   migration on a populated table cannot add NOT NULL without a forbidden backfill UPDATE).
-- -----------------------------------------------------------------------------

ALTER TABLE `practice_memos`
  ADD COLUMN IF NOT EXISTS `effectiveDate`         DATE        NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `reviewBy`              DATE        NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `authoritySnapshotId`   CHAR(36)    NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `negativeTreatmentFlag` BOOLEAN     NULL DEFAULT NULL;
