-- TITLE-EXAM-1 (T1) — title-examination data model (spec v2.1 §5).
--
-- THREE ADDITIVE, matter-scoped, flag-dark tables for the attorney-supervised title-examination
-- module (TITLE_EXAM_ENABLED default OFF):
--   title_exam_matter_attribute — per-matter NC-12 NPI posture + §2 DC caveat acknowledgment.
--   title_exam_session          — one row per exam RUN (§4 orchestration container; NC-10 completeness).
--   title_exam_finding          — one row per material finding (§5 data model: NC-8 source basis,
--                                 NC-9 OCR honesty, NC-4 sendability, NC-1/2 reconciliation + escalation,
--                                 NC-7 contamination, adopt-ledger + audit_events decision linkage).
--
-- FORK-C (FOLD-L1-1): audit_events remains the SINGLE source of truth for attorney decisions —
-- title_exam_finding holds operational STATE + a pointer (decisionEventId) to the deciding audit_events
-- row, exactly like express_ledger_entry.revertedByEventId. NO competing decision record. NO existing
-- table altered. NO DB FK (app-layer ownerScope). NO ENUM narrowing.
--
-- DORMANT: read/written ONLY when TITLE_EXAM_ENABLED is ON (default OFF). Flag-off is byte-neutral.
-- Index INLINE (TiDB-safe). Idempotent (CREATE TABLE IF NOT EXISTS). Additive-only.
--
-- NOT on the apply-prod-migrations.mjs auto-apply allowlist — operator-applied OUT-OF-BAND at deploy
-- (DEPLOY-MIGRATIONS-NOT-AUTOMATIC). This migration MUST land in prod BEFORE TITLE_EXAM_ENABLED flips.

CREATE TABLE IF NOT EXISTS `title_exam_matter_attribute` (
  `id`                     CHAR(36)  NOT NULL,
  `userId`                 CHAR(36)  NOT NULL,
  `matterId`               CHAR(36)  NOT NULL,
  `npiPosture`             ENUM('full_upload_approved','partial_redaction','local_only_preprocessing','no_external_call') NOT NULL DEFAULT 'no_external_call',
  `entityHatAtSet`         VARCHAR(64)  NULL,
  `dcCaveatAcknowledgedAt` TIMESTAMP    NULL,
  `createdAt`              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uniq_title_exam_matter_attribute` (`matterId`),
  INDEX `idx_title_exam_matter_attr_user` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `title_exam_session` (
  `id`                   CHAR(36)   NOT NULL,
  `userId`               CHAR(36)   NOT NULL,
  `matterId`             CHAR(36)   NOT NULL,
  `jurisdiction`         VARCHAR(16)  NULL,
  `entityHat`            VARCHAR(64)  NULL,
  `laneMode`             ENUM('two_lane','single_lane') NOT NULL DEFAULT 'two_lane',
  `laneFailureBanner`    TEXT         NULL,
  `completeness`         ENUM('complete','incomplete') NOT NULL DEFAULT 'complete',
  `incompletenessReason` TEXT         NULL,
  `droppedPageCount`     INT        NOT NULL DEFAULT 0,
  `status`               ENUM('intake','examining','reconciling','awaiting_attorney','memo_ready','client_approved','error') NOT NULL DEFAULT 'intake',
  `roundsRun`            INT        NOT NULL DEFAULT 0,
  `converged`            BOOLEAN    NOT NULL DEFAULT FALSE,
  `examinerAModel`       VARCHAR(128) NULL,
  `examinerBModel`       VARCHAR(128) NULL,
  `reconcilerModel`      VARCHAR(128) NULL,
  `lanes`                JSON         NULL,
  `candidateMemoText`    MEDIUMTEXT   NULL,
  `createdAt`            TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`            TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_title_exam_session_user_matter` (`userId`, `matterId`),
  INDEX `idx_title_exam_session_matter_juris` (`matterId`, `jurisdiction`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `title_exam_finding` (
  `id`                    CHAR(36)  NOT NULL,
  `userId`                CHAR(36)  NOT NULL,
  `matterId`              CHAR(36)  NOT NULL,
  `sessionId`             CHAR(36)  NOT NULL,
  `laneOrigin`            ENUM('examiner_a','examiner_b','reconciler','both') NOT NULL,
  `title`                 TEXT       NOT NULL,
  `detail`                MEDIUMTEXT NULL,
  `sourceBasis`           ENUM('instrument','court_record','tax_record','abstractor_stated','ocr_extracted','prior_matter_seed','attorney_instruction','model_inference','externally_verified') NOT NULL,
  `sourceMap`             JSON       NULL,
  `downgraded`            BOOLEAN    NOT NULL DEFAULT FALSE,
  `ocrDerived`            BOOLEAN    NOT NULL DEFAULT FALSE,
  `ocrSourcePagePincite`  VARCHAR(255) NULL,
  `sendability`           ENUM('internal_only','client_facing_ok','client_facing_with_caveat','underwriter_facing_only','do_not_send_without_attorney_rewrite','requires_source_review') NOT NULL,
  `classification`        ENUM('closing_requirement','recording_requirement','disbursement_condition','policy_exception','informational_note','underwriting_escalation','lender_escalation','counsel_referral') NOT NULL,
  `reconClassification`   ENUM('concordant','unique_catch','conflict','housekeeping') NULL,
  `isJudgmentConflict`    BOOLEAN    NOT NULL DEFAULT FALSE,
  `escalationState`       ENUM('none','auto_resolved','escalated','adopted','modified','held') NOT NULL DEFAULT 'none',
  `autoResolvedRationale` TEXT       NULL,
  `laneAPosition`         TEXT       NULL,
  `laneBPosition`         TEXT       NULL,
  `recommendation`        TEXT       NULL,
  `seedSourceMatterId`    VARCHAR(64) NULL,
  `seedContaminationFlag` BOOLEAN    NOT NULL DEFAULT FALSE,
  `importJustification`   TEXT       NULL,
  `importResolved`        BOOLEAN    NOT NULL DEFAULT FALSE,
  `adoptLedgerId`         CHAR(36)   NULL,
  `decisionEventId`       CHAR(36)   NULL,
  `createdAt`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_title_exam_finding_session` (`sessionId`),
  INDEX `idx_title_exam_finding_user_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
