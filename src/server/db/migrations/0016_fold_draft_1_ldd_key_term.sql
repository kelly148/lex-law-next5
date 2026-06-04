-- =============================================================================
-- FOLD-DRAFT-1 / LDD Migration 0016 — ldd_key_term (Increment 1: data core)
-- =============================================================================
-- ADDITIVE ONLY. One new table. The "key-term dictionary" behind the LDD (LOI-vs-draft diff):
-- per draft document+version, the defined/operative terms whose agreed VALUE must stay consistent
-- between the operative source (LOI / engagement letter / material) and the current draft —
-- e.g. "Governing Law" = "Commonwealth of Virginia", "Purchase Price" = "$1,200,000". Version-anchored.
--
-- DEFAULT-SAFE / READ-ONLY: the dictionary is recorded + surfaced and (in a later increment)
-- compared against the draft to FLAG drift; it NEVER edits the draft and never auto-justifies an
-- outbound legal assertion. The attorney remains the decision-maker. recordedBy distinguishes an
-- attorney entry from a system one. No prompt injection, no auto-use in Increment 1.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `ldd_key_term` (
  `id`             CHAR(36)     NOT NULL,
  `userId`         CHAR(36)     NOT NULL,
  `matterId`       CHAR(36)     NOT NULL,
  `documentId`     CHAR(36)     NOT NULL,
  `versionId`      CHAR(36)     NOT NULL,
  -- The defined/operative term whose value must stay consistent (e.g. "Governing Law").
  `termLabel`      VARCHAR(256) NOT NULL,
  -- The agreed value for that term, taken from the operative source / LOI (e.g. "Virginia").
  `expectedValue`  TEXT         NOT NULL,
  -- Where the expected value came from.
  `sourceType`     ENUM('loi','operative_source','material','attorney_specified') NOT NULL,
  `sourceId`       VARCHAR(64)  NULL DEFAULT NULL, -- the LOI/source/material id (NULL for attorney_specified)
  `notes`          TEXT         NULL DEFAULT NULL,
  -- Who recorded this key term: an attorney attribution vs a system one (default-safe).
  `recordedBy`     ENUM('attorney','system') NOT NULL,
  `createdAt`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ldd_key_term_version` (`versionId`),
  INDEX `idx_ldd_key_term_document` (`documentId`),
  INDEX `idx_ldd_key_term_user_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
