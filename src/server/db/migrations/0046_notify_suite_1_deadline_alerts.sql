-- =============================================================================
-- NOTIFY-SUITE-1 Migration 0046 — N2 deadline/tickler alerts (additive)
-- =============================================================================
-- ADDITIVE ONLY. No existing column is dropped or retyped destructively; every
-- pre-existing row stays valid. TiDB-compatible MySQL syntax:
--   - ADD COLUMN IF NOT EXISTS is supported (used in 0043) — idempotent.
--   - A trailing ENUM value via MODIFY COLUMN appends only (existing rows valid;
--     idempotent — re-running sets the same ENUM); matches 0043 (reviewer_lanes /
--     audit_events) — neither table has a generated column, so MODIFY is safe.
--   - Indexes use the STANDALONE `CREATE INDEX IF NOT EXISTS ... ON ...` form, NOT
--     `ALTER TABLE ... ADD INDEX IF NOT EXISTS` (TiDB does NOT support IF NOT EXISTS
--     on ADD INDEX inside ALTER TABLE — that broke the 0043 deploy on 2026-06-16).
-- Auto-applies via the pre-deploy runner (additive allowlist). Read/written only when
-- DEADLINE_ENGINE_ENABLED + NOTIFICATIONS_ENABLED are ON (both default OFF); apply
-- BEFORE flipping the flags. Default-safe; no new behavior until the producer runs.
--
-- INFORMATIONAL ONLY: a deadline alert NEVER auto-creates/auto-files anything.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- notifications.type: add the 'deadline' value (NOTIFY-SUITE-1 N2). Drives the per-
-- matter "deadline approaching" badge (distinct from 'matter_ready'). Trailing append
-- only — 'generic' / 'matter_ready' are unchanged and remain valid. NOTE: the single
-- source of truth for this enum is NOTIFICATION_TYPE_VALUES in
-- src/shared/schemas/notifications.ts (schema.ts imports it) — keep them in lockstep.
-- -----------------------------------------------------------------------------
ALTER TABLE `notifications`
  MODIFY COLUMN `type` ENUM('generic','matter_ready','deadline') NOT NULL DEFAULT 'generic';

-- -----------------------------------------------------------------------------
-- tickler.notifiedAt: a per-tickler "alerted-at" cursor so N2 emits each lead-time
-- reminder at most ONCE (no duplicate spam). NULL = not yet alerted; a timestamp = the
-- N2 producer has emitted the in-app notification for this tickler lead. Additive +
-- nullable; the deadline engine's ack/snooze state (keyed to leadDays) is untouched.
-- -----------------------------------------------------------------------------
ALTER TABLE `tickler`
  ADD COLUMN IF NOT EXISTS `notifiedAt` TIMESTAMP NULL DEFAULT NULL;

-- The N2 producer's hot read is "owner's ticklers not yet alerted, due within the
-- window" (WHERE userId = ? AND notifiedAt IS NULL AND fireAt <= ?). The leading userId
-- keeps the index owner-scoped (matching the app-layer ownerScope).
CREATE INDEX IF NOT EXISTS `idx_tickler_user_notified` ON `tickler` (`userId`, `notifiedAt`);
