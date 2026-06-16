-- =====================================================================================
-- EGRESS-CONTROL-PLANE-1 (Increment 1) Migration — egress_events (surface-agnostic ledger)
-- =====================================================================================
-- ADDITIVE ONLY: one CREATE TABLE IF NOT EXISTS. No existing table is dropped, retyped, or rewritten —
-- chat_egress_events is UNTOUCHED (chat keeps writing there byte-for-byte; existing GLBA audit rows are
-- never migrated/rewritten). This is the surface-agnostic egress audit ledger the EGRESS-CONTROL-PLANE
-- introduces: every external-model send of client/matter content writes ONE durable decision row here
-- BEFORE dispatch (allowed OR blocked + reason). Increment 1: the DOCUMENT egress path (sendability pilot)
-- writes here; reviewer/drafter/... onboard in later increments.
--
-- STORE-BY-REFERENCE (privilege / GLBA): metadata + a salted/keyed HASH over the minimized payload only
-- (inputBundleHash) — NEVER the draft text. The ledger must not become a second unprotected repository of
-- privileged content (triad disposition retention contract). Blocked sends are logged too (incident
-- evidence). Outlives the matter in operation; purged WITH the matter only by the operator-gated
-- matterPurge (mirrors chat_egress_events / auditEvents — EVERYDAY_DELETE_PRESERVE).
--
-- Idempotent (safe to re-run on every deploy). Applied via the Rule-18 additive pre-deploy runner (this
-- file is on the allowlist in scripts/apply-prod-migrations.mjs). TiDB-compatible MySQL. NO DB FK
-- (app-layer isolation: immutable userId/matterId bindings + ownerScope() on every read — codebase
-- convention; cross-table cascade handled in app code, matterPurge.ts).
-- =====================================================================================

CREATE TABLE IF NOT EXISTS `egress_events` (
  `id`                CHAR(36)      NOT NULL,
  `userId`            CHAR(36)      NOT NULL,
  `matterId`          CHAR(36)      NOT NULL,
  `surface`           ENUM('chat_copilot','chat_grounding','chat_panel','sendability','reviewer','drafter','evaluator','outline','intake','information_request') NOT NULL,
  `subjectType`       ENUM('conversation','document','document_job','matter') NOT NULL,
  `conversationId`    CHAR(36)      NULL DEFAULT NULL,
  `documentId`        CHAR(36)      NULL DEFAULT NULL,
  `documentVersionId` CHAR(36)      NULL DEFAULT NULL,
  `jobId`             CHAR(36)      NULL DEFAULT NULL,
  `holdScope`         ENUM('conversation','matter','global') NULL DEFAULT NULL,
  `decision`          ENUM('allowed','blocked') NOT NULL,
  `blockReason`       VARCHAR(128)  NULL DEFAULT NULL,
  `provider`          VARCHAR(64)   NOT NULL,
  `model`             VARCHAR(128)  NOT NULL,
  `policyVersion`     VARCHAR(128)  NULL DEFAULT NULL,
  `inputBundleHash`   VARCHAR(128)  NULL DEFAULT NULL,
  `correlationId`     CHAR(36)      NOT NULL,
  `status`            ENUM('pending','success','blocked','failed','timeout','cancelled') NOT NULL DEFAULT 'pending',
  `failureReason`     VARCHAR(255)  NULL DEFAULT NULL,
  `createdAt`         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completedAt`       TIMESTAMP     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  -- Supervision / compliance queries: blocked-egresses-by-matter, by-surface, by-document, by-recency.
  INDEX `idx_egress_events_matter` (`matterId`, `userId`, `createdAt`),
  INDEX `idx_egress_events_surface` (`surface`, `createdAt`),
  INDEX `idx_egress_events_document` (`documentId`, `createdAt`),
  INDEX `idx_egress_events_decision` (`decision`, `matterId`, `userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
