-- ULTRABUILD-1 W1 — EXPRESS-AUTO-REVIEW-LOOP-1 durable decision-ledger (E4b) + attorney-approval attestation (E7b).
--
-- THREE ADDITIVE tables that make the Express auto-review supervision record DURABLE (Fable audit Top-5 #2;
-- E4b/E7b are blocking preconditions to Express activation). They replace the in-memory-only E4a ledger
-- (decisionLedger.ts) + E7a predicate (approvalGate.ts):
--   express_loop_run             — append-only snapshot of one completed bounded loop run (the E4b container).
--   express_ledger_entry         — one row per per-suggestion decision; MUTABLE `reverted` (an attorney unwind).
--   express_approval_attestation — append-only, content-hash-bound attorney sign-off (E7b): who / when / which.
--
-- FORK-C (FOLD-L1-1): audit_events remains the SINGLE source of truth for attorney decisions — every
-- per-escalation adopt/reject AND the approval act are ALSO written to audit_events (eventType='disposition';
-- targetType/action are free strings, so NO audit_events enum MODIFY is needed). These tables hold operational
-- STATE + a pointer (approvalEventId / revertedByEventId) to the deciding audit_events row. NO competing
-- decision record. NO existing table altered. NO DB FK (app-layer ownerScope). NO isFinal/sendable column —
-- the ABSENCE of a finality field IS the E7a structural inertness (an Express candidate is never final).
--
-- DORMANT: read/written ONLY when EXPRESS_DURABLE_RECORDS_ENABLED is ON (default OFF) AND the Express loop is
-- enabled (AUTO_REVIEW_LOOP_ENABLED default OFF). Index INLINE (TiDB-safe). Idempotent (CREATE TABLE IF NOT
-- EXISTS). Additive-only.
--
-- NOT on the apply-prod-migrations.mjs auto-apply allowlist — operator-applied out-of-band at deploy
-- (DEPLOY-MIGRATIONS-NOT-AUTOMATIC). The migration MUST land in prod BEFORE EXPRESS_DURABLE_RECORDS_ENABLED flips.

CREATE TABLE IF NOT EXISTS `express_loop_run` (
  `id`                 CHAR(36)     NOT NULL,
  `userId`             CHAR(36)     NOT NULL,
  `matterId`           CHAR(36)     NOT NULL,
  `documentId`         CHAR(36)     NOT NULL,
  `documentVersionId`  CHAR(36)     NOT NULL,
  `reviewerModel`      VARCHAR(128) NOT NULL,
  `rounds`             INT          NOT NULL,
  `converged`          BOOLEAN      NOT NULL,
  `hitCap`             BOOLEAN      NOT NULL,
  `adoptedCount`       INT          NOT NULL,
  `escalationCount`    INT          NOT NULL,
  `candidateText`      MEDIUMTEXT   NOT NULL,
  `redline`            JSON         NOT NULL,
  `roundSummaries`     JSON         NOT NULL,
  `createdAt`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_express_loop_run_user_matter` (`userId`, `matterId`),
  INDEX `idx_express_loop_run_document` (`documentId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `express_ledger_entry` (
  `id`                  CHAR(36)      NOT NULL,
  `runId`               CHAR(36)      NOT NULL,
  `userId`              CHAR(36)      NOT NULL,
  `matterId`            CHAR(36)      NOT NULL,
  `documentId`          CHAR(36)      NOT NULL,
  `ledgerEntryId`       VARCHAR(32)   NOT NULL,
  `round`               INT           NOT NULL,
  `route`               ENUM('auto_adopt','escalate') NOT NULL,
  `riskScore`           INT           NOT NULL,
  `riskBucket`          ENUM('high','medium','low')   NOT NULL,
  `immutabilityForced`  BOOLEAN       NOT NULL,
  `isDeletion`          BOOLEAN       NOT NULL,
  `beforeText`          MEDIUMTEXT    NOT NULL,
  `afterText`           MEDIUMTEXT    NOT NULL,
  `offsetStart`         INT           NOT NULL,
  `offsetEnd`           INT           NOT NULL,
  `locus`               JSON          NOT NULL,
  `classA`              JSON          NULL,
  `inlineEvent`         JSON          NULL,
  `reverted`            BOOLEAN       NOT NULL DEFAULT FALSE,
  `revertedByEventId`   CHAR(36)      NULL,
  `createdAt`           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uniq_express_ledger_entry` (`runId`, `ledgerEntryId`),
  INDEX `idx_express_ledger_entry_run` (`runId`),
  INDEX `idx_express_ledger_entry_user_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `express_approval_attestation` (
  `id`                 CHAR(36)     NOT NULL,
  `runId`              CHAR(36)     NOT NULL,
  `userId`             CHAR(36)     NOT NULL,
  `matterId`           CHAR(36)     NOT NULL,
  `documentId`         CHAR(36)     NOT NULL,
  `documentVersionId`  CHAR(36)     NOT NULL,
  `attorneyUserId`     CHAR(36)     NOT NULL,
  `approved`           BOOLEAN      NOT NULL,
  `decisionsSnapshot`  JSON         NOT NULL,
  `escalationCount`    INT          NOT NULL,
  `contentHash`        VARCHAR(128) NOT NULL,
  `approvalEventId`    CHAR(36)     NOT NULL,
  `createdAt`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_express_attestation_run` (`runId`),
  INDEX `idx_express_attestation_user_matter` (`userId`, `matterId`),
  INDEX `idx_express_attestation_version` (`documentVersionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
