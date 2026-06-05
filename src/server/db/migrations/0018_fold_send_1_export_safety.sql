-- =============================================================================
-- FOLD-SEND-1 Migration 0018 — export-safety / outbound-readiness data core (Increment 1)
-- =============================================================================
-- ADDITIVE ONLY. Four new tables + idempotent firm-default seeds. Data core for the deterministic
-- block/warn/pass export-safety gate (triad-reviewed: docs/reviews/FOLD-SEND-1_disposition.md).
-- NO behavior change in this migration: nothing is wired to export; the gate is OFF by default
-- (SENDABILITY_GATE_ENABLED). Seeds use fixed UUIDs + INSERT ... ON DUPLICATE KEY UPDATE so re-runs
-- are a safe no-op (idempotent). Legacy `sendability_*` code name kept; user copy = "export safety".
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `sendability_rule` (
  `id`           CHAR(36)     NOT NULL,
  `userId`       CHAR(36)     NULL DEFAULT NULL, -- NULL = firm default
  `category`     ENUM('wrong_matter_id','stale_baseline','missing_required_signer','open_execution_item','unverified_statute_citation','tone','package_completeness','low_confidence_match','audience_leak') NOT NULL,
  `documentType` VARCHAR(128) NULL DEFAULT NULL, -- NULL = all document types
  `level`        ENUM('block','warn','off') NOT NULL,
  `notes`        TEXT         NULL DEFAULT NULL,
  `createdAt`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_sendability_rule_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `jurisdiction_rule` (
  `id`           CHAR(36)     NOT NULL,
  `userId`       CHAR(36)     NULL DEFAULT NULL, -- NULL = firm default
  `jurisdiction` VARCHAR(16)  NOT NULL,
  `documentType` VARCHAR(128) NOT NULL,
  `requirement`  ENUM('notary','two_witnesses','self_proving_affidavit','signer_capacity_recital') NOT NULL,
  `sourceTag`    VARCHAR(256) NOT NULL,
  `notes`        TEXT         NULL DEFAULT NULL,
  `createdAt`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_jurisdiction_rule_type` (`jurisdiction`, `documentType`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sendability_override` (
  `id`          CHAR(36)     NOT NULL,
  `userId`      CHAR(36)     NOT NULL,
  `matterId`    CHAR(36)     NOT NULL,
  `documentId`  CHAR(36)     NOT NULL,
  `versionId`   CHAR(36)     NOT NULL,
  `contentHash` VARCHAR(128) NOT NULL, -- binds the override to the exact content; new version invalidates it
  `category`    ENUM('wrong_matter_id','stale_baseline','missing_required_signer','open_execution_item','unverified_statute_citation','tone','package_completeness','low_confidence_match','audience_leak') NOT NULL,
  `blockPayload` JSON        NULL DEFAULT NULL, -- full snapshot of the block at override time
  `reasonCode`  ENUM('verified_correct','intentional_choice','will_correct_before_send','not_applicable','other') NOT NULL,
  `reasonText`  TEXT         NULL DEFAULT NULL,
  `createdAt`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- APPEND-ONLY (no updatedAt)
  PRIMARY KEY (`id`),
  INDEX `idx_sendability_override_version` (`versionId`),
  INDEX `idx_sendability_override_user_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sendability_evaluation` (
  `id`               CHAR(36)  NOT NULL,
  `userId`           CHAR(36)  NOT NULL,
  `matterId`         CHAR(36)  NOT NULL,
  `documentId`       CHAR(36)  NOT NULL,
  `versionId`        CHAR(36)  NOT NULL,
  `verdict`          ENUM('block','warn','pass') NOT NULL,
  `blocks`           JSON      NOT NULL,
  `warnings`         JSON      NOT NULL,
  `llmComponentUsed` TINYINT(1) NOT NULL DEFAULT 0, -- advisory LLM warn-layer contributed?
  `degraded`         ENUM('none','partial','error') NOT NULL DEFAULT 'none', -- 'error' = a check could not run (fail-to-warn)
  `durationMs`       INT       NOT NULL DEFAULT 0,
  `enforced`         TINYINT(1) NOT NULL DEFAULT 0, -- false = shadow-mode (flag OFF)
  `createdAt`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, -- APPEND-ONLY
  PRIMARY KEY (`id`),
  INDEX `idx_sendability_eval_version` (`versionId`),
  INDEX `idx_sendability_eval_user_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Idempotent firm-default seeds (userId NULL). Fixed UUIDs -> ON DUPLICATE KEY UPDATE = no-op. ──
-- sendability_rule: v1 BLOCK only wrong_matter_id; everything else WARN (per disposition).
INSERT INTO `sendability_rule` (`id`,`userId`,`category`,`documentType`,`level`) VALUES
  ('5e9d0001-0000-4000-8000-000000000001', NULL, 'wrong_matter_id',             NULL, 'block'),
  ('5e9d0001-0000-4000-8000-000000000002', NULL, 'stale_baseline',              NULL, 'warn'),
  ('5e9d0001-0000-4000-8000-000000000003', NULL, 'missing_required_signer',     NULL, 'warn'),
  ('5e9d0001-0000-4000-8000-000000000004', NULL, 'open_execution_item',         NULL, 'warn'),
  ('5e9d0001-0000-4000-8000-000000000005', NULL, 'unverified_statute_citation', NULL, 'warn'),
  ('5e9d0001-0000-4000-8000-000000000006', NULL, 'tone',                        NULL, 'warn'),
  ('5e9d0001-0000-4000-8000-000000000007', NULL, 'package_completeness',        NULL, 'warn'),
  ('5e9d0001-0000-4000-8000-000000000008', NULL, 'low_confidence_match',        NULL, 'warn'),
  ('5e9d0001-0000-4000-8000-000000000009', NULL, 'audience_leak',               NULL, 'warn')
ON DUPLICATE KEY UPDATE `id` = `id`;

-- jurisdiction_rule: document-type-scoped, source-tagged, in-scope only (Durable_poa). Firm-default
-- starting points the attorney can correct later; the attorney is always final. Settlement/title
-- formalities are intentionally NOT seeded (out of scope; enforced by the code scope guard).
INSERT INTO `jurisdiction_rule` (`id`,`userId`,`jurisdiction`,`documentType`,`requirement`,`sourceTag`) VALUES
  ('5e9d0002-0000-4000-8000-000000000001', NULL, 'VA', 'Durable_poa', 'notary',         'Va. Code Ann. § 64.2-1603 (Uniform Power of Attorney Act — acknowledgment)'),
  ('5e9d0002-0000-4000-8000-000000000002', NULL, 'MD', 'Durable_poa', 'notary',         'Md. Code Ann., Est. & Trusts § 17-110 (POA — notarization)'),
  ('5e9d0002-0000-4000-8000-000000000003', NULL, 'MD', 'Durable_poa', 'two_witnesses',  'Md. Code Ann., Est. & Trusts § 17-110 (POA — two witnesses)')
ON DUPLICATE KEY UPDATE `id` = `id`;
