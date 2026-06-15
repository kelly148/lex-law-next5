-- =====================================================================================
-- CHAT-COPILOT-2 (Increment A — A2 attachments) Migration
--   1. chat_attachments        (ephemeral, by-reference chat attachments + G5 OCR quality)
--   2. chat_attachment_party   (Q3 optional party attribution at save-to-matter)
-- =====================================================================================
-- ADDITIVE ONLY: two CREATE TABLE IF NOT EXISTS. No existing table is altered/dropped/retyped; no data
-- mutated. Idempotent. Applied via the Rule-18 additive pre-deploy runner (allowlisted in
-- scripts/apply-prod-migrations.mjs). TiDB-compatible MySQL. Written/read ONLY when CHAT_COPILOT_ENABLED
-- is ON (default OFF) -> flag-OFF never touches these, so behavior-preserving.
--
-- chat_attachments: EPHEMERAL by default (purged at conversation end / immediately on do-not-persist;
-- a `pinned` provenance attachment survives). Store BY-REFERENCE — extracted text + metadata, NOT raw
-- file bytes (storageKey is a placeholder, like matter_materials). textContent follows the OCR HONESTY
-- FLOOR (NULL on low-confidence/failed, so untrustworthy OCR never silently enters context). ocrQuality
-- carries G5 warning labels + confidences ONLY (never field values — no NPI). contentHash (SHA-256 of
-- the bytes) drives the Q3 cross-matter duplicate check. holdFlag is a per-attachment NDA/own-conf hold.
--
-- chat_attachment_party: optional party attribution captured at save-to-matter so role-based intra-matter
-- exclusion (buyer-vs-seller, insured-vs-lender) is enforceable. METADATA only.
--
-- ISOLATION: app-layer (immutable userId/matterId bindings + ownerScope()). NO DB FK (codebase
-- convention). Both tables are matter-scoped -> purged with the matter (matterPurge.ts).
-- =====================================================================================

CREATE TABLE IF NOT EXISTS `chat_attachments` (
  `id`                    CHAR(36)      NOT NULL,
  `userId`                CHAR(36)      NOT NULL,
  `matterId`              CHAR(36)      NOT NULL,
  `conversationId`        CHAR(36)      NOT NULL,
  `filename`              VARCHAR(512)  NULL DEFAULT NULL,
  `mimeType`              VARCHAR(128)  NULL DEFAULT NULL,
  `fileSize`              INT           NULL DEFAULT NULL,
  `storageKey`            VARCHAR(512)  NULL DEFAULT NULL,
  -- contentHash: SHA-256 of the uploaded bytes (cross-matter duplicate detection). NOT NPI.
  `contentHash`           VARCHAR(64)   NULL DEFAULT NULL,
  -- textContent: ephemeral extracted text. NULL below the OCR confidence floor (honesty floor) so
  -- untrustworthy OCR never reaches grounding/context.
  `textContent`           MEDIUMTEXT    NULL DEFAULT NULL,
  `extractionStatus`      ENUM('extracted','partial','failed','not_supported','processing','low_confidence') NOT NULL,
  `extractionError`       TEXT          NULL DEFAULT NULL,
  -- ocrQuality: G5 warning labels + confidences ONLY (never the dangerous-middle field VALUES).
  `ocrQuality`            JSON          NULL DEFAULT NULL,
  `holdFlag`              ENUM('none','no_panel','no_external') NOT NULL DEFAULT 'none',
  -- Q5: attorney accepted the low-confidence/warning RISK ("accepted risk", NOT "the text is correct").
  `acceptedWithWarning`   BOOLEAN       NOT NULL DEFAULT FALSE,
  -- pinned: provenance-pinned (Q6 seam) — SURVIVES the conversation-end purge.
  `pinned`                BOOLEAN       NOT NULL DEFAULT FALSE,
  -- savedMaterialId: set when promoted to a matter_material (save-to-matter is the retention act).
  `savedMaterialId`       CHAR(36)      NULL DEFAULT NULL,
  `seq`                   INT           NOT NULL DEFAULT 0,
  `deletedAt`             TIMESTAMP     NULL DEFAULT NULL,
  `createdAt`             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_chat_attachments_conversation` (`conversationId`, `seq`),
  INDEX `idx_chat_attachments_matter` (`matterId`, `userId`),
  INDEX `idx_chat_attachments_hash` (`userId`, `contentHash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chat_attachment_party` (
  `id`            CHAR(36)      NOT NULL,
  `userId`        CHAR(36)      NOT NULL,
  `matterId`      CHAR(36)      NOT NULL,
  `attachmentId`  CHAR(36)      NOT NULL,
  `partyId`       CHAR(36)      NULL DEFAULT NULL,
  `partyRole`     VARCHAR(64)   NULL DEFAULT NULL,
  `attribution`   ENUM('explicit','inferred') NOT NULL,
  `createdAt`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_chat_attachment_party_attachment` (`attachmentId`),
  INDEX `idx_chat_attachment_party_matter` (`matterId`, `userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
