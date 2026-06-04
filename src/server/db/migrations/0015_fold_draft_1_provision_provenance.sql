-- =============================================================================
-- FOLD-DRAFT-1 Migration 0015 — provision_provenance (Increment 1: data core)
-- =============================================================================
-- ADDITIVE ONLY. One new table. Records, per draft SECTION (provision), where that section
-- came from — an operative source, client/source material, an adopted reviewer suggestion, a
-- template, an LOI, attorney-authored, or model-generated text. Version-anchored.
--
-- DEFAULT-SAFE: provenance is recorded + surfaced, NEVER used to auto-justify outbound legal
-- assertions (mirrors the KB private-by-default posture). recordedBy distinguishes an attorney
-- attribution from a system one. No prompt injection, no auto-use in Increment 1.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `provision_provenance` (
  `id`            CHAR(36)     NOT NULL,
  `userId`        CHAR(36)     NOT NULL,
  `matterId`      CHAR(36)     NOT NULL,
  `documentId`    CHAR(36)     NOT NULL,
  `versionId`     CHAR(36)     NOT NULL,
  -- The provision = an outline section; identified by its order index + title for this version.
  `orderIndex`    INT          NOT NULL,
  `sectionTitle`  VARCHAR(256) NOT NULL,
  -- Where the provision came from.
  `originType`    ENUM('operative_source','material','adopted_suggestion','template','attorney_authored','model_generated','loi') NOT NULL,
  `originId`      VARCHAR(64)  NULL DEFAULT NULL, -- the source/material/adoption/template id (NULL for attorney_authored / model_generated)
  `originLabel`   VARCHAR(512) NULL DEFAULT NULL, -- human-readable origin description
  -- Who recorded this provenance: an attorney attribution vs a system one (default-safe).
  `recordedBy`    ENUM('attorney','system') NOT NULL,
  `notes`         TEXT         NULL DEFAULT NULL,
  `createdAt`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_provision_provenance_version` (`versionId`),
  INDEX `idx_provision_provenance_document` (`documentId`),
  INDEX `idx_provision_provenance_user_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
