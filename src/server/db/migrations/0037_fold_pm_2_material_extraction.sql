-- =============================================================================
-- FOLD-PM-2 Migration 0037 — material_extraction (document-type structured extraction)
-- =============================================================================
-- ADDITIVE ONLY. One new table: material_extraction. No existing table is altered.
-- Auto-applies via the pre-deploy runner (additive allowlist); idempotent
-- (CREATE TABLE IF NOT EXISTS). NO DB FOREIGN KEY by codebase convention — owner +
-- matter isolation is enforced in the application layer (ownerScope). Written/read
-- ONLY when DOCUMENT_EXTRACTION_ENABLED is ON (default OFF); apply BEFORE flipping
-- the flag. Default-safe; no new behavior; no egress.
--
-- material_extraction: one LATEST structured extraction per material, produced by the
--   PURE no-egress document-type parsers (title commitment / deed / survey / settlement
--   statement) over the material's already-extracted text. documentType is the
--   classified type; typeConfidence/overallConfidence are 0-100; lowConfidence flags
--   the honesty floor; fields/warnings are JSON (ExtractedField[] / string[]). The
--   unique index on materialId keeps it one-row-per-material (re-extract overwrites).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `material_extraction` (
  `id`                CHAR(36)     NOT NULL,
  `userId`            CHAR(36)     NOT NULL,
  `matterId`          CHAR(36)     NOT NULL,
  `materialId`        CHAR(36)     NOT NULL,
  `documentType`      ENUM('title_commitment','deed','survey','settlement_statement','unknown') NOT NULL,
  `typeConfidence`    INT          NOT NULL DEFAULT 0,
  `overallConfidence` INT          NOT NULL DEFAULT 0,
  `lowConfidence`     BOOLEAN      NOT NULL DEFAULT TRUE,
  `fields`            JSON         NOT NULL,
  `warnings`          JSON         NOT NULL,
  `createdAt`         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ux_material_extraction_material` (`materialId`),
  INDEX `idx_material_extraction_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
