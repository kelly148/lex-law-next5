-- =============================================================================
-- MR-CAL-7B Migration — Cumulative Adopt Ledger
-- =============================================================================
-- Additive only: creates the adopt_ledger table. No existing table is altered.
--
-- adopt_ledger: durable record of reviewer suggestions the attorney ADOPTED
--   (verbatim or modified), tracked across regeneration. Separate from
--   locked_decisions (MR-CAL-7A: no auto-coupling).
--   disposition adopted_verbatim|adopted_modified; status active|superseded|
--   resolved|unresolved; statusSource auto|attorney (auto-detection is advisory
--   and never overwrites an attorney-set status, never deletes a row).
--   Unique (reviewSessionId, sourceSuggestionId) = one ledger entry per adopted
--   suggestion per session (mirrors feedback_manual_selections' unique index).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `adopt_ledger` (
  `id`                     CHAR(36)     NOT NULL,
  `userId`                 CHAR(36)     NOT NULL,
  `documentId`             CHAR(36)     NOT NULL,
  `matterId`               CHAR(36)     NOT NULL,
  `sourceSuggestionId`     VARCHAR(64)  NOT NULL,
  `sourceReviewerRole`     VARCHAR(64)  NOT NULL,
  `sourceIterationNumber`  INT          NOT NULL,
  `reviewSessionId`        CHAR(36)     NOT NULL,
  `disposition`            ENUM('adopted_verbatim','adopted_modified') NOT NULL,
  `originalText`           TEXT         NOT NULL,
  `adoptedText`            TEXT         NOT NULL,
  `adoptedIntoVersionId`   CHAR(36)     NOT NULL,
  `producedVersionId`      CHAR(36)     NULL DEFAULT NULL,
  `status`                 ENUM('active','superseded','resolved','unresolved') NOT NULL DEFAULT 'unresolved',
  `statusSource`           ENUM('auto','attorney') NOT NULL DEFAULT 'auto',
  `createdAt`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_adopt_ledger_document` (`documentId`, `status`),
  INDEX `idx_adopt_ledger_user_document` (`userId`, `documentId`),
  UNIQUE INDEX `uniq_adopt_ledger_session_suggestion` (`reviewSessionId`, `sourceSuggestionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
