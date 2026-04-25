-- =============================================================================
-- Phase 4b Migration — Information Matrix, Structural Outline, Review System
-- =============================================================================
-- Ch 4.7  — feedback, feedback_evaluations, feedback_manual_selections
-- Ch 4.8  — review_sessions (with activeSessionKey GENERATED column, R10)
-- Ch 4.10 — information_requests (with activeMatterKey GENERATED column, R10)
--            information_request_items
-- Ch 4.11 — document_outlines
--
-- D.1.2 Resolution:
--   drizzle-orm 0.30.10 lacks generatedAlwaysAs() API.
--   Generated columns are declared here in raw SQL (MySQL/TiDB GENERATED ALWAYS AS
--   ... STORED syntax). The schema.ts declarations are plain column types used only
--   for TypeScript type inference on reads. Application code MUST NOT write to
--   activeMatterKey or activeSessionKey columns.
--   See DEPENDENCY_DEBT.md for the upgrade path.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ch 4.10 — information_requests
-- activeMatterKey: GENERATED ALWAYS AS (CASE WHEN archivedAt IS NULL THEN matterId ELSE NULL END) STORED
-- Unique index on activeMatterKey enforces at-most-one-active-matrix-per-matter (R10).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `information_requests` (
  `id`              CHAR(36)     NOT NULL,
  `userId`          CHAR(36)     NOT NULL,
  `matterId`        CHAR(36)     NOT NULL,
  `status`          ENUM('draft','exported','receiving_answers','complete') NOT NULL DEFAULT 'draft',
  `archivedAt`      TIMESTAMP    NULL DEFAULT NULL,
  -- D.1.2 GENERATED column — DO NOT write from application code (R10, Ch 4.10)
  `activeMatterKey` CHAR(36)     GENERATED ALWAYS AS (
                      CASE WHEN `archivedAt` IS NULL THEN `matterId` ELSE NULL END
                    ) STORED,
  `createdAt`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_info_requests_matter` (`userId`, `matterId`, `archivedAt`),
  UNIQUE INDEX `uniq_active_matrix_per_matter` (`activeMatterKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
-- -----------------------------------------------------------------------------
-- Ch 4.10 — information_request_items
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `information_request_items` (
  `id`                    CHAR(36)     NOT NULL,
  `informationRequestId`  CHAR(36)     NOT NULL,
  `category`              VARCHAR(64)  NOT NULL,
  `questionText`          TEXT         NOT NULL,
  `answerText`            TEXT         NULL DEFAULT NULL,
  `orderIndex`            INT          NOT NULL,
  `createdAt`             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_info_items_request_order` (`informationRequestId`, `orderIndex`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
-- -----------------------------------------------------------------------------
-- Ch 4.11 — document_outlines
-- One outline per document (enforced at application level via precondition checks).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `document_outlines` (
  `id`                CHAR(36)     NOT NULL,
  `userId`            CHAR(36)     NOT NULL,
  `documentId`        CHAR(36)     NOT NULL,
  `status`            ENUM('draft','approved','skipped') NOT NULL DEFAULT 'draft',
  `sections`          JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  `generatedByJobId`  CHAR(36)     NULL DEFAULT NULL,
  `approvedAt`        TIMESTAMP    NULL DEFAULT NULL,
  `createdAt`         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_outlines_user_document` (`userId`, `documentId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
-- -----------------------------------------------------------------------------
-- Ch 4.7 — feedback
-- One row per reviewer-model invocation per document iteration.
-- suggestions: JSON array of { suggestionId, title, body, severity? }
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `feedback` (
  `id`              CHAR(36)     NOT NULL,
  `userId`          CHAR(36)     NOT NULL,
  `documentId`      CHAR(36)     NOT NULL,
  `versionId`       CHAR(36)     NOT NULL,
  `iterationNumber` INT          NOT NULL,
  `reviewSessionId` CHAR(36)     NULL DEFAULT NULL,
  `jobId`           CHAR(36)     NOT NULL,
  `reviewerRole`    VARCHAR(32)  NOT NULL,
  `reviewerModel`   VARCHAR(64)  NOT NULL,
  `reviewerTitle`   VARCHAR(128) NOT NULL,
  `suggestions`     JSON         NOT NULL,
  `createdAt`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_feedback_user_document_iter` (`userId`, `documentId`, `iterationNumber`),
  INDEX `idx_feedback_session` (`reviewSessionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
-- -----------------------------------------------------------------------------
-- Ch 4.7 — feedback_evaluations
-- Evaluator pass over multiple reviewers' output.
-- dispositions: JSON array of { suggestionId, disposition, synthesisBody? }
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `feedback_evaluations` (
  `id`              CHAR(36)     NOT NULL,
  `userId`          CHAR(36)     NOT NULL,
  `documentId`      CHAR(36)     NOT NULL,
  `iterationNumber` INT          NOT NULL,
  `jobId`           CHAR(36)     NOT NULL,
  `dispositions`    JSON         NOT NULL,
  `createdAt`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_feedback_eval_document_iter` (`documentId`, `iterationNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
-- -----------------------------------------------------------------------------
-- Ch 4.7 — feedback_manual_selections
-- Attorney adoption decisions (R5: positive-selection-only, no declined/dismissed rows).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `feedback_manual_selections` (
  `id`              CHAR(36)     NOT NULL,
  `userId`          CHAR(36)     NOT NULL,
  `documentId`      CHAR(36)     NOT NULL,
  `iterationNumber` INT          NOT NULL,
  `reviewSessionId` CHAR(36)     NOT NULL,
  `suggestionId`    VARCHAR(64)  NOT NULL,
  `attorneyNote`    TEXT         NULL DEFAULT NULL,
  `createdAt`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uniq_manual_selections` (`reviewSessionId`, `suggestionId`),
  INDEX `idx_manual_selections_session` (`reviewSessionId`),
  INDEX `idx_manual_selections_document_iter` (`documentId`, `iterationNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
-- -----------------------------------------------------------------------------
-- Ch 4.8 — review_sessions
-- activeSessionKey: GENERATED ALWAYS AS (CASE WHEN state='active' THEN CONCAT(documentId,'-',LPAD(iterationNumber,10,'0')) ELSE NULL END) STORED
-- Unique index on activeSessionKey enforces at-most-one-active-session-per-(documentId,iterationNumber) (R10).
-- selections: JSON array of { feedbackId: string, note: string | null }
-- selectedReviewers: JSON array of reviewer role identifiers (Zod Wall)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `review_sessions` (
  `id`                  CHAR(36)     NOT NULL,
  `userId`              CHAR(36)     NOT NULL,
  `documentId`          CHAR(36)     NOT NULL,
  `iterationNumber`     INT          NOT NULL,
  `state`               ENUM('active','regenerated','abandoned') NOT NULL DEFAULT 'active',
  `selections`          JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  `selectedReviewers`   JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  `globalInstructions`  TEXT         NOT NULL,
  `lastAutosavedAt`     TIMESTAMP    NULL DEFAULT NULL,
  -- D.1.2 GENERATED column — DO NOT write from application code (R10, Ch 4.8)
  `activeSessionKey`    VARCHAR(64)  GENERATED ALWAYS AS (
                          CASE WHEN `state` = 'active'
                          THEN CONCAT(`documentId`, '-', LPAD(`iterationNumber`, 10, '0'))
                          ELSE NULL END
                        ) STORED,
  `createdAt`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_review_sessions_user_document` (`userId`, `documentId`, `iterationNumber`),
  UNIQUE INDEX `uniq_active_review_session` (`activeSessionKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
