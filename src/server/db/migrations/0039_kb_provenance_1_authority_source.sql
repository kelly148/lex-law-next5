-- =============================================================================
-- KB-PROVENANCE-1 Migration 0039 — authority_source registry (MIG2)
-- =============================================================================
-- ADDITIVE ONLY. One new table: authority_source. No existing table is altered. Auto-applies via
-- the pre-deploy runner (additive allowlist); idempotent (CREATE TABLE IF NOT EXISTS). NO DB
-- FOREIGN KEY by codebase convention — owner isolation is app-layer (ownerScope).
--
-- authority_source: a DURABLE firm/jurisdiction-level legal-authority (citation) registry,
--   generalizing the embedded practice_memos.lawReliedOn structure into a first-class row. It is
--   owner/firm-level (userId, NO matterId) so it SURVIVES matter closure and is NOT matter-purged.
--   Do NOT conflate with the matter-scoped `source_authority` artifact-tier table (near-anagram,
--   different purpose). citationText is NOT NULL (a registry row IS its citation). The §2 promotion
--   gate (pinned pinpoint + checker signature for L2) is enforced at the app-layer promotion
--   boundary, NOT as a column constraint. supersedes/superseded-by DEFERRED per Constitution §8.
--   Linked from practice_memos.lawReliedOn[].authoritySourceId (JSON, additive — no migration).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `authority_source` (
  `id`                  CHAR(36)     NOT NULL,
  `userId`              CHAR(36)     NOT NULL,
  `jurisdiction`        VARCHAR(128) NOT NULL,
  `authorityType`       ENUM('statute','regulation','case','constitutional','secondary','other') NOT NULL,
  `citationText`        VARCHAR(512) NOT NULL,
  `pinpoint`            VARCHAR(256) NULL DEFAULT NULL,
  `sourceUrlOrLocation` TEXT         NULL DEFAULT NULL,
  `sourceSnapshotHash`  VARCHAR(128) NULL DEFAULT NULL,
  `effectiveDate`       DATE         NULL DEFAULT NULL,
  `lastCheckedDate`     DATE         NULL DEFAULT NULL,
  `reviewByDate`        DATE         NULL DEFAULT NULL,
  `checkedBy`           VARCHAR(128) NULL DEFAULT NULL,
  `notes`               TEXT         NULL DEFAULT NULL,
  `createdAt`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_authority_source_owner` (`userId`, `jurisdiction`),
  INDEX `idx_authority_source_review` (`userId`, `reviewByDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
