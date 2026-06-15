-- =============================================================================
-- FOLD-PM-4 Migration 0036 — matter_deliverable (ongoing-matters / to-do list)
-- =============================================================================
-- ADDITIVE ONLY. One new table: matter_deliverable. No existing table is altered.
-- Auto-applies via the pre-deploy runner (additive allowlist); idempotent
-- (CREATE TABLE IF NOT EXISTS). NO DB FOREIGN KEY by codebase convention — owner +
-- matter isolation is enforced in the application layer (ownerScope + immutable
-- userId/matterId bindings). Read/written ONLY when MATTER_DELIVERABLE_ENABLED is
-- ON (default OFF); apply BEFORE flipping the flag. Default-safe; no new behavior.
--
-- matter_deliverable: one to-do / deliverable on ONE matter, owned by ONE attorney.
--   title is the deliverable name; status is 'open' (to-do) -> 'done' (completed);
--   dueDate is an optional date-only target (YYYY-MM-DD); notes is optional free text.
--   createdAt/updatedAt are standard timestamps (updatedAt bumps on edit/complete).
-- Indexes: (userId, matterId, status) for the per-matter open-deliverables read;
--   (userId, status) for the cross-matter portfolio (open-count) read. The leading
--   userId column keeps every index owner-scoped, matching the app-layer ownerScope.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `matter_deliverable` (
  `id`        CHAR(36)            NOT NULL,
  `userId`    CHAR(36)            NOT NULL,
  `matterId`  CHAR(36)            NOT NULL,
  `title`     VARCHAR(256)        NOT NULL,
  `status`    ENUM('open','done') NOT NULL DEFAULT 'open',
  `dueDate`   DATE                NULL DEFAULT NULL,
  `notes`     TEXT                NULL DEFAULT NULL,
  `createdAt` TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_matter_deliverable_matter` (`userId`, `matterId`, `status`),
  INDEX `idx_matter_deliverable_owner_status` (`userId`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
