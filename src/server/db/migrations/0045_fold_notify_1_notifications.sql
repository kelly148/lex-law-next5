-- =============================================================================
-- FOLD-NOTIFY-1 Migration 0045 — in-app notification core (store + read + display)
-- =============================================================================
-- ADDITIVE ONLY. One new table: notifications. NO existing table is altered, dropped,
-- or retyped; every pre-existing row stays valid. TiDB-compatible MySQL syntax: each
-- index is declared INLINE inside CREATE TABLE IF NOT EXISTS (idempotent at the table
-- level) — there is NO `ALTER TABLE ... ADD INDEX IF NOT EXISTS` (TiDB does NOT support
-- IF NOT EXISTS on ADD INDEX inside ALTER TABLE; that broke the 0043 deploy on
-- 2026-06-16). Auto-applies via the pre-deploy runner (additive allowlist); idempotent
-- (CREATE TABLE IF NOT EXISTS). NO DB FOREIGN KEY by codebase convention — owner
-- isolation is enforced in the application layer (ownerScope + immutable userId binding).
-- Read/written ONLY when NOTIFICATIONS_ENABLED is ON (default OFF); apply BEFORE flipping
-- the flag. Default-safe; no new behavior.
--
-- INFORMATIONAL ONLY: a notification NEVER auto-adopts, auto-sends, or makes any decision.
--
-- SCOPE FENCE (FOLD-NOTIFY-1): this is the STORE + READ + DISPLAY tier ONLY. The OUTBOX-
-- EMIT WIRING (producers that create notifications) and the hold/ack notification types are
-- DEFERRED to after EGRESS Inc 3b — no producer is wired now, so the table may legitimately
-- sit empty until producers land.
--
-- notifications: one informational notice for ONE attorney, OPTIONALLY about one matter.
--   userId is the owner; matterId is NULLABLE (a matter-less owner-level notice is valid);
--   type = generic/matter_ready; title/body carry the text (body nullable); readAt is the
--   per-user "seen" marker (NULL = unread). Indexes: (userId, createdAt) for the owner feed
--   + unread count; (userId, matterId) for the per-matter "ready" badge lookup. The leading
--   userId column keeps every index owner-scoped, matching the app-layer ownerScope.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `notifications` (
  `id`         CHAR(36)                          NOT NULL,
  `userId`     CHAR(36)                          NOT NULL,
  `matterId`   CHAR(36)                          NULL DEFAULT NULL,
  `type`       ENUM('generic','matter_ready')    NOT NULL DEFAULT 'generic',
  `title`      VARCHAR(256)                      NOT NULL,
  `body`       TEXT                              NULL DEFAULT NULL,
  `readAt`     TIMESTAMP                         NULL DEFAULT NULL,
  `createdAt`  TIMESTAMP                         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`  TIMESTAMP                         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_notifications_owner` (`userId`, `createdAt`),
  INDEX `idx_notifications_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
</content>
