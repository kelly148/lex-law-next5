-- =============================================================================
-- FOLD-GOV-1a Migration — Audit-as-Matter-Record (audit_events)
-- =============================================================================
-- Additive only: creates the audit_events table. No existing table is altered.
--
-- audit_events: immutable, append-only, per-matter governance record, DISTINCT
--   from the operational telemetry_events stream. Records what each model said,
--   what was adopted/rejected/locked/sent/withheld, what authority was verified,
--   and what required judgment. The query wrapper exposes insert + read only;
--   there is no updatedAt and no update/delete path (rows are never modified).
--   Retention is permanent (legal matter record).
-- Indexes: (matterId, createdAt) read path; (userId, matterId) owner scope.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audit_events` (
  `id`                  CHAR(36)     NOT NULL,
  `userId`              CHAR(36)     NOT NULL,
  `matterId`            CHAR(36)     NOT NULL,
  `documentId`          CHAR(36)     NULL DEFAULT NULL,
  `eventType`           ENUM('model_output','adopted','rejected','locked','unlocked','sent','withheld','authority_verified','judgment_required') NOT NULL,
  `actor`               ENUM('model','attorney','system') NOT NULL,
  `actorModel`          VARCHAR(64)  NULL DEFAULT NULL,
  `summary`             TEXT         NOT NULL,
  `payload`             JSON         NULL DEFAULT NULL,
  `reviewSessionId`     CHAR(36)     NULL DEFAULT NULL,
  `sourceSuggestionId`  VARCHAR(64)  NULL DEFAULT NULL,
  `versionId`           CHAR(36)     NULL DEFAULT NULL,
  `createdAt`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_audit_events_matter` (`matterId`, `createdAt`),
  INDEX `idx_audit_events_user_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
