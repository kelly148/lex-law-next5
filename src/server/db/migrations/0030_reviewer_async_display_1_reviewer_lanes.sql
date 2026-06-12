-- =====================================================================================
-- REVIEWER-ASYNC-DISPLAY-1 (Gate 0, Component C) Migration — reviewer_lanes
-- =====================================================================================
-- Additive only: creates the reviewer_lanes table. No existing table is altered.
--
-- One row per EXPECTED reviewer of an async multi-reviewer review iteration (the immutable
-- expected set, persisted at create BEFORE dispatch). Server-owned per-reviewer terminal status
-- (a DISTINCT vocabulary from job status) plus a Component-C-owned per-reviewer terminal-deadline
-- (defense-in-depth; the lane reaper terminalizes orphans independently of JOB-RECOVERY-1).
--
-- Matter-scoped (purged with the matter via matterPurge.ts). Written ONLY on the async path
-- (REVIEWER_ASYNC_ENABLED, default OFF). Apply to prod TiDB BEFORE flipping REVIEWER_ASYNC_ENABLED.
--
-- Indexes: per-session lookup (the get-side contract), matter scoping (purge), the deadline sweep,
-- and a UNIQUE (reviewSessionId, reviewerRole) — one lane per reviewer per session (latest-wins).
-- =====================================================================================

CREATE TABLE IF NOT EXISTS `reviewer_lanes` (
  `id`                  CHAR(36)      NOT NULL,
  `userId`              CHAR(36)      NOT NULL,
  `matterId`            CHAR(36)      NOT NULL,
  `documentId`          CHAR(36)      NOT NULL,
  `versionId`           CHAR(36)      NOT NULL,
  `reviewSessionId`     CHAR(36)      NOT NULL,
  `iterationNumber`     INT           NOT NULL,
  `reviewerRole`        VARCHAR(64)   NOT NULL,
  `reviewerTitle`       VARCHAR(128)  NOT NULL,
  `jobId`               CHAR(36)      NULL DEFAULT NULL,
  `status`              ENUM('pending','dispatched','running','completed_with_feedback','completed_without_feedback','failed','timed_out','dispatch_failed','orphaned_reaped','canceled') NOT NULL DEFAULT 'pending',
  `suggestionCount`     INT           NULL DEFAULT NULL,
  `feedbackRowId`       CHAR(36)      NULL DEFAULT NULL,
  `failureReason`       TEXT          NULL DEFAULT NULL,
  `terminalDeadlineAt`  TIMESTAMP     NOT NULL,
  `terminalizedAt`      TIMESTAMP     NULL DEFAULT NULL,
  `createdAt`           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_reviewer_lanes_session` (`reviewSessionId`),
  INDEX `idx_reviewer_lanes_matter` (`matterId`, `userId`),
  INDEX `idx_reviewer_lanes_deadline` (`status`, `terminalDeadlineAt`),
  UNIQUE INDEX `uniq_reviewer_lane_session_reviewer` (`reviewSessionId`, `reviewerRole`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
