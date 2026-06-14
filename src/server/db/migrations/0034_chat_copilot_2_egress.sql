-- =====================================================================================
-- CHAT-COPILOT-2 (Increment A — egress control plane) Migration
--   1. chat_conversations.holdFlag  (G2 external-egress hold)
--   2. chat_egress_events           (G1/G3 append-only egress audit log)
-- =====================================================================================
-- ADDITIVE ONLY: one ADD COLUMN IF NOT EXISTS (TiDB) + one CREATE TABLE IF NOT EXISTS. No existing
-- table is dropped, retyped, or rewritten; no data is mutated. Idempotent (safe to re-run on every
-- deploy). Applied via the Rule-18 additive pre-deploy runner (this file is on the allowlist in
-- scripts/apply-prod-migrations.mjs). TiDB-compatible MySQL. Written/read ONLY when CHAT_COPILOT_ENABLED
-- is ON (default OFF) — flag-OFF never touches these, so this is a behavior-preserving merge/deploy.
--
-- G2 holdFlag: 'none' (default) | 'no_panel' | 'no_external'. 'no_external' blocks BOTH the primary
-- model call AND grounding egress for a conversation (an NDA / own-confidentiality conversation).
--
-- G3 chat_egress_events (append-only audit, the GLBA / incident-detection evidence): every copilot egress
-- DECISION is written here — allowed AND blocked (blocked sends are logged too). STORE-BY-REFERENCE /
-- NO CONTENT by construction: there is deliberately NO column for the prompt/payload, the response, or any
-- NPI value — only metadata + a salted/keyed hash over the MINIMIZED payload (inputBundleHash). Only the
-- dispatch-outcome fields (status / failureReason / completedAt / token counts) are updated once after
-- dispatch; the decision + hash + metadata are immutable. Outlives the matter.
--
-- ISOLATION: app-layer (immutable userId/matterId bindings + ownerScope() on every read). NO DB FK
-- (codebase convention — cross-table cascade handled in app code, e.g. matterPurge.ts).
-- =====================================================================================

ALTER TABLE `chat_conversations`
  ADD COLUMN IF NOT EXISTS `holdFlag`
  ENUM('none','no_panel','no_external') NOT NULL DEFAULT 'none';

CREATE TABLE IF NOT EXISTS `chat_egress_events` (
  `id`                         CHAR(36)      NOT NULL,
  `userId`                     CHAR(36)      NOT NULL,
  `matterId`                   CHAR(36)      NOT NULL,
  -- nullable: a panel/system egress may not be bound to a single conversation/message.
  `conversationId`             CHAR(36)      NULL DEFAULT NULL,
  `messageId`                  CHAR(36)      NULL DEFAULT NULL,
  -- gateDecisionId: deterministic id of the posture/drafting gate decision at egress time (provenance).
  `gateDecisionId`             VARCHAR(128)  NULL DEFAULT NULL,
  `kind`                       ENUM('chat_primary','chat_grounding','chat_panel') NOT NULL,
  `decision`                   ENUM('allowed','blocked') NOT NULL,
  `blockReason`                VARCHAR(128)  NULL DEFAULT NULL,
  `allowlistVersion`           VARCHAR(128)  NULL DEFAULT NULL,
  `authorizationBasis`         ENUM('config_allowlist','panel_confirm') NOT NULL DEFAULT 'config_allowlist',
  `provider`                   VARCHAR(64)   NOT NULL,
  `model`                      VARCHAR(128)  NOT NULL,
  `minimizationApplied`        BOOLEAN       NOT NULL DEFAULT FALSE,
  `minimizationProfile`        VARCHAR(64)   NULL DEFAULT NULL,
  -- JSON arrays of category labels / ids ONLY — NEVER NPI values.
  `npiCategoriesIncluded`      JSON          NULL DEFAULT NULL,
  `npiCategoriesWithheld`      JSON          NULL DEFAULT NULL,
  `holdHonored`                BOOLEAN       NOT NULL DEFAULT FALSE,
  `holdExcludedAttachmentIds`  JSON          NULL DEFAULT NULL,
  -- inputBundleHash: Q1 hash-at-gate — salted/keyed hash over the COPILOT-COMPOSED minimized,
  -- hold-filtered bundle (system + any layered master + grounded context + history + turn). NOT the raw
  -- payload (a low-entropy field is not recoverable from the hash). Does NOT yet cover the platform's
  -- downstream matter-state metadata block (documented A1 follow-up).
  `inputBundleHash`            VARCHAR(128)  NULL DEFAULT NULL,
  `attachmentIds`              JSON          NULL DEFAULT NULL,
  `region`                     VARCHAR(64)   NULL DEFAULT NULL,
  `correlationId`              CHAR(36)      NOT NULL,
  `requestId`                  VARCHAR(128)  NULL DEFAULT NULL,
  `status`                     ENUM('pending','success','failed','blocked','timeout','cancelled') NOT NULL DEFAULT 'pending',
  `failureReason`              VARCHAR(255)  NULL DEFAULT NULL,
  `includedAttachmentCount`    INT           NOT NULL DEFAULT 0,
  `npiWithheldCount`           INT           NOT NULL DEFAULT 0,
  `createdAt`                  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completedAt`                TIMESTAMP     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  -- Supervision queries (Q7): by matter, by provider, by recency.
  INDEX `idx_chat_egress_matter` (`matterId`, `userId`, `createdAt`),
  INDEX `idx_chat_egress_provider` (`provider`, `createdAt`),
  INDEX `idx_chat_egress_conversation` (`conversationId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
