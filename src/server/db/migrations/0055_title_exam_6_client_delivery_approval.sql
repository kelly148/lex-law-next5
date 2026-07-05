-- TITLE-EXAM-1 (T6) — client-delivery approval attestation (spec §7, NC-3).
--
-- ONE ADDITIVE, matter-scoped, flag-dark, APPEND-ONLY table: title_exam_client_delivery_approval — the
-- durable record of one Approve-for-Client-Delivery act. Client-facing artifacts (email / branded report)
-- generate ONLY from the attorney-approved, version-locked memo behind this logged action. Content-hash-bound
-- (memoVersionHash) + supersede-on-change; approvalEventId points to the audit_events approval row (Fork-C:
-- audit_events is the decision source of truth). No updatedAt (append-only, like express_approval_attestation).
--
-- DORMANT unless TITLE_EXAM_ENABLED is ON (default OFF). Flag-off is byte-neutral. Index INLINE (TiDB-safe).
-- Idempotent (CREATE TABLE IF NOT EXISTS). Additive-only. NO existing table altered. NO DB FK.
--
-- NOT on the apply-prod-migrations.mjs auto-apply allowlist — operator-applied OUT-OF-BAND at deploy
-- (DEPLOY-MIGRATIONS-NOT-AUTOMATIC). MUST land in prod BEFORE TITLE_EXAM_ENABLED flips.

CREATE TABLE IF NOT EXISTS `title_exam_client_delivery_approval` (
  `id`               CHAR(36)     NOT NULL,
  `sessionId`        CHAR(36)     NOT NULL,
  `userId`           CHAR(36)     NOT NULL,
  `matterId`         CHAR(36)     NOT NULL,
  `attorneyUserId`   CHAR(36)     NOT NULL,
  `memoVersionHash`  VARCHAR(128) NOT NULL,
  `hat`              VARCHAR(64)  NOT NULL,
  `recipientClass`   VARCHAR(64)  NOT NULL,
  `posture`          VARCHAR(64)  NOT NULL,
  `advicePermitted`  BOOLEAN      NOT NULL,
  `caveats`          JSON         NULL,
  `exclusions`       JSON         NULL,
  `approvalEventId`  CHAR(36)     NOT NULL,
  `createdAt`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_title_exam_approval_session` (`sessionId`),
  INDEX `idx_title_exam_approval_user_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
