-- =====================================================================================
-- CHAT-COPILOT-2 (Increment B — multi-model review panel) Migration
--   1. chat_review_runs         (one on-demand panel review of a chat work product)
--   2. chat_review_raw_outputs  (verbatim raw reviewer output, BY-REFERENCE)
--   3. chat_review_items        (itemized reviewer suggestion + PRIMARY disposition; 1:1)
-- =====================================================================================
-- ADDITIVE ONLY: three CREATE TABLE IF NOT EXISTS. No existing table is dropped, retyped, or rewritten;
-- no data is mutated. Idempotent (safe to re-run on every deploy). Applied via the Rule-18 additive
-- pre-deploy runner (this file is on the allowlist in scripts/apply-prod-migrations.mjs). TiDB-compatible
-- MySQL. Written/read ONLY when CHAT_REVIEW_PANEL_ENABLED is ON (default OFF) — flag-OFF never touches
-- these, so this is a behavior-preserving merge/deploy. Activation ALSO requires adding the panel
-- providers (gpt/gemini/grok) to GROUNDED_CHAT_PROVIDERS (the fail-closed egress allowlist).
--
-- WORK-PRODUCT: these tables purge WITH the matter (handled in app code, matterPurge.ts cascade — NOT in
-- EVERYDAY_DELETE_PRESERVE). The egress AUDIT of each panel send lives separately in chat_egress_events
-- (the permanent, preserved GLBA record).
--
-- ISOLATION: app-layer (immutable userId/matterId bindings + ownerScope() on every read). NO DB FK
-- (codebase convention — cross-table cascade handled in app code).
-- =====================================================================================

CREATE TABLE IF NOT EXISTS `chat_review_runs` (
  `id` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `matterId` CHAR(36) NOT NULL,
  `conversationId` CHAR(36) NOT NULL,
  `messageId` CHAR(36) NULL,
  `workProductHash` VARCHAR(128) NOT NULL,
  `bundleHash` VARCHAR(128) NOT NULL,
  `reviewerModels` JSON NOT NULL,
  `status` ENUM('prepared','running','complete','failed') NOT NULL DEFAULT 'prepared',
  `dispositionerStatus` ENUM('pending','success','failed','skipped') NOT NULL DEFAULT 'pending',
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_chat_review_runs_conversation` (`conversationId`, `createdAt`),
  INDEX `idx_chat_review_runs_matter` (`matterId`, `userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `chat_review_raw_outputs` (
  `id` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `matterId` CHAR(36) NOT NULL,
  `runId` CHAR(36) NOT NULL,
  `reviewerModel` VARCHAR(64) NOT NULL,
  `rawText` MEDIUMTEXT NULL,
  `laneStatus` ENUM('pending','success','failed','blocked','timeout') NOT NULL DEFAULT 'pending',
  `laneFailureReason` VARCHAR(255) NULL,
  `egressEventId` CHAR(36) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_chat_review_raw_run` (`runId`),
  INDEX `idx_chat_review_raw_matter` (`matterId`, `userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `chat_review_items` (
  `id` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `matterId` CHAR(36) NOT NULL,
  `runId` CHAR(36) NOT NULL,
  `reviewerModel` VARCHAR(64) NOT NULL,
  `rawOutputRef` CHAR(36) NULL,
  `suggestionHash` VARCHAR(128) NOT NULL,
  `suggestion` MEDIUMTEXT NOT NULL,
  `primaryDisposition` ENUM('adopt','reject','modify_and_adopt') NULL,
  `primaryReasoning` MEDIUMTEXT NULL,
  `citationStatus` ENUM('in_bundle','unverified') NULL,
  `attorneyDecision` ENUM('pending','accept','override') NOT NULL DEFAULT 'pending',
  `attorneyOverrideReason` TEXT NULL,
  `laneStatus` ENUM('pending','success','failed','blocked','timeout') NOT NULL DEFAULT 'success',
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_chat_review_items_run` (`runId`),
  INDEX `idx_chat_review_items_matter` (`matterId`, `userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
