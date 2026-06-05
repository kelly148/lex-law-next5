-- =============================================================================
-- FOLD-DRAFT-1 / package Migration 0017 — closure_package_item (Increment 1: data core)
-- =============================================================================
-- ADDITIVE ONLY. One new table. The "closing package": per matter, the artifacts
-- (documents / materials / sources) plus checklist items gathered into a named, self-contained
-- bundle for hand-off / closure — each marked required-vs-optional and present / missing /
-- not-applicable. A package = the rows sharing (matterId, packageName).
--
-- DEFAULT-SAFE / ADVISORY: this records + surfaces what the package contains and (in a later
-- increment) computes a completeness check; it NEVER finalizes, sends, or locks anything
-- (sending is FOLD-SEND-1). The attorney is the decision-maker. recordedBy distinguishes an
-- attorney entry from a system one. No prompt injection, no auto-use in Increment 1.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `closure_package_item` (
  `id`            CHAR(36)     NOT NULL,
  `userId`        CHAR(36)     NOT NULL,
  `matterId`      CHAR(36)     NOT NULL,
  -- Groups items into a named package (a package = rows sharing matterId+packageName).
  `packageName`   VARCHAR(256) NOT NULL,
  `itemType`      ENUM('document','material','source','checklist') NOT NULL,
  `refId`         VARCHAR(64)  NULL DEFAULT NULL, -- the document/material/source id (NULL for a checklist item)
  `label`         VARCHAR(512) NOT NULL,
  `requirement`   ENUM('required','optional') NOT NULL,
  `status`        ENUM('present','missing','not_applicable') NOT NULL,
  `notes`         TEXT         NULL DEFAULT NULL,
  -- Who recorded this item: an attorney attribution vs a system one (default-safe).
  `recordedBy`    ENUM('attorney','system') NOT NULL,
  `createdAt`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_closure_package_matter` (`matterId`),
  INDEX `idx_closure_package_user_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
