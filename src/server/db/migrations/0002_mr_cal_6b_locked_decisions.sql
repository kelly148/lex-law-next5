-- =============================================================================
-- MR-CAL-6B Migration — Locked Decisions (document-scoped)
-- =============================================================================
-- Additive only: creates the locked_decisions table. No existing table is
-- altered. Document-level scope in Phase A; the `scope` column is reserved so a
-- future matter-level rollout is additive (no destructive migration).
--
-- locked_decisions: attorney-authored locks a reviewer should respect
--   ("do not re-raise absent a material new fact").
--   origin 'declined' = decline-&-lock; origin 'adopted' = lock-on-adopt.
--   status 'active' -> 'unlocked' (unlock preserves the row for audit).
--   Unique (documentId, sourceSuggestionId) dedupes suggestion-linked locks;
--   NULL sourceSuggestionId rows are not deduped (MySQL/TiDB treat NULLs as
--   distinct in a unique index), which is intended.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `locked_decisions` (
  `id`                     CHAR(36)     NOT NULL,
  `userId`                 CHAR(36)     NOT NULL,
  `documentId`             CHAR(36)     NOT NULL,
  `matterId`               CHAR(36)     NOT NULL,
  `scope`                  ENUM('document') NOT NULL DEFAULT 'document',
  `origin`                 ENUM('declined','adopted') NOT NULL,
  `sourceSuggestionId`     VARCHAR(64)  NULL DEFAULT NULL,
  `sourceIterationNumber`  INT          NULL DEFAULT NULL,
  `reviewSessionId`        CHAR(36)     NULL DEFAULT NULL,
  `summary`                TEXT         NOT NULL,
  `rationale`              TEXT         NULL DEFAULT NULL,
  `status`                 ENUM('active','unlocked') NOT NULL DEFAULT 'active',
  `createdAt`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_locked_decisions_document` (`documentId`, `status`),
  INDEX `idx_locked_decisions_user_document` (`userId`, `documentId`),
  UNIQUE INDEX `uniq_locked_decision_suggestion` (`documentId`, `sourceSuggestionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
