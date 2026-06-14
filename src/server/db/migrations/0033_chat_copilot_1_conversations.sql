-- =====================================================================================
-- CHAT-COPILOT-1 (Inc 1) Migration — chat_conversations / chat_messages / chat_summaries
-- =====================================================================================
-- ADDITIVE ONLY: creates three new tables (CREATE TABLE IF NOT EXISTS). No existing table is
-- altered, dropped, or retyped. Idempotent (safe to re-run on every deploy). Applied via the
-- Rule-18 additive pre-deploy runner (this file is on the allowlist in scripts/apply-prod-migrations.mjs).
-- TiDB-compatible MySQL. Written ONLY when CHAT_COPILOT_ENABLED is ON (default OFF) — flag-OFF never
-- reads or writes these tables, so this is a behavior-preserving merge/deploy.
--
-- STORE-BY-REFERENCE (triad condition, categorical exclusion): chat_messages deliberately has NO
-- column for the compiled master body, the raw assembled context, full source chunks, wire/payoff/
-- account/routing numbers, full SSN/TIN, or ID images. Only references (sourceId + locators), the
-- attorney turn text + model response, posture/audit metadata, and hashes are persistable BY
-- CONSTRUCTION (the column set cannot hold the excluded categories).
--
-- ISOLATION (triad "GPT's bar"): cross-matter isolation is enforced in the application layer
-- (immutable matterId/documentId/capacitySnapshot bindings + ownerScope() on every read + the pure
-- assertConversationContext guard + capacity-bound summaries + the blocking server tests). DB-level
-- FOREIGN KEY constraints are intentionally OMITTED to match this codebase's universal convention
-- (no table declares a DB FK; cross-table cascade is handled in application code, e.g. matterPurge.ts)
-- — the "DB-level FKs where the engine allows" condition resolved to app-layer depth here. FLAGGED for
-- operator morning ratification: if DB FKs are wanted, they are a trivial additive follow-up migration.
--
-- LIFECYCLE from the start (triad Part A condition 1): retention class, deletion (soft, deletedAt),
-- legal-hold, per-turn AND per-conversation doNotPersist / excludeFromGrounding, matter-file export
-- (exportedAt/exportRef), close handling (closedAt), and freeze-on-capacity-divergence columns
-- (frozenAt/freezeReason — populated by Inc 2; added now so Inc 2 needs no new migration).
-- =====================================================================================

CREATE TABLE IF NOT EXISTS `chat_conversations` (
  `id`                    CHAR(36)      NOT NULL,
  `userId`                CHAR(36)      NOT NULL,
  `matterId`              CHAR(36)      NOT NULL,
  `documentId`            CHAR(36)      NULL DEFAULT NULL,
  `documentVersionId`     CHAR(36)      NULL DEFAULT NULL,
  `title`                 VARCHAR(256)  NULL DEFAULT NULL,
  -- capacitySnapshot: { engagementCapacity, electionMarker, titleSignal } captured at conversation
  -- start — the capacity binding for freeze-on-divergence + capacity-bound summaries.
  `capacitySnapshot`      JSON          NOT NULL,
  `retentionClass`        ENUM('active_matter_plus_5y','matter_lifetime','short_30d') NOT NULL DEFAULT 'active_matter_plus_5y',
  `legalHold`             BOOLEAN       NOT NULL DEFAULT FALSE,
  `legalHoldReason`       TEXT          NULL DEFAULT NULL,
  `doNotPersist`          BOOLEAN       NOT NULL DEFAULT FALSE,
  `excludeFromGrounding`  BOOLEAN       NOT NULL DEFAULT FALSE,
  `frozenAt`              TIMESTAMP     NULL DEFAULT NULL,
  `freezeReason`          TEXT          NULL DEFAULT NULL,
  `closedAt`              TIMESTAMP     NULL DEFAULT NULL,
  `exportedAt`            TIMESTAMP     NULL DEFAULT NULL,
  `exportRef`             VARCHAR(255)  NULL DEFAULT NULL,
  `deletedAt`             TIMESTAMP     NULL DEFAULT NULL,
  `createdAt`             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_chat_conversations_matter` (`matterId`, `userId`),
  INDEX `idx_chat_conversations_owner` (`userId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chat_messages` (
  `id`                      CHAR(36)      NOT NULL,
  `userId`                  CHAR(36)      NOT NULL,
  `matterId`                CHAR(36)      NOT NULL,
  `conversationId`          CHAR(36)      NOT NULL,
  `seq`                     INT           NOT NULL,
  `role`                    ENUM('attorney','assistant') NOT NULL,
  -- content: the attorney turn text OR the model response text. NULL on a do-not-persist tombstone
  -- (ordering preserved, content excluded). NEVER the compiled master body or raw assembled context.
  `content`                 MEDIUMTEXT    NULL DEFAULT NULL,
  `contentHash`             VARCHAR(64)   NULL DEFAULT NULL,
  -- masterApplied / masterSource: AUDIT-ONLY (Part A condition 3). NEVER short-circuit the fresh
  -- per-turn gate (Inc 2 recomputes posture from live matter state every turn).
  `masterApplied`           BOOLEAN       NOT NULL DEFAULT FALSE,
  `masterSource`            VARCHAR(64)   NULL DEFAULT NULL,
  `capacitySnapshot`        JSON          NULL DEFAULT NULL,
  -- draftingGateDecisionId: deterministic hash of the resolveDraftingGate decision at turn time
  -- (audit provenance; the gate has no persistent decision table).
  `draftingGateDecisionId`  VARCHAR(128)  NULL DEFAULT NULL,
  -- citations: [{ sourceId, locator }] references ONLY — never copied source chunk text (Inc 3 populates).
  `citations`               JSON          NULL DEFAULT NULL,
  `modelProvider`           VARCHAR(64)   NULL DEFAULT NULL,
  `modelId`                 VARCHAR(64)   NULL DEFAULT NULL,
  `doNotPersist`            BOOLEAN       NOT NULL DEFAULT FALSE,
  `excludeFromGrounding`    BOOLEAN       NOT NULL DEFAULT FALSE,
  `createdAt`               TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_chat_messages_conversation` (`conversationId`, `seq`),
  INDEX `idx_chat_messages_matter` (`matterId`, `userId`),
  UNIQUE INDEX `uniq_chat_message_conversation_seq` (`conversationId`, `seq`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chat_summaries` (
  `id`                CHAR(36)      NOT NULL,
  `userId`            CHAR(36)      NOT NULL,
  `matterId`          CHAR(36)      NOT NULL,
  `conversationId`    CHAR(36)      NOT NULL,
  -- capacitySnapshot + posture: a summary is matter-bound AND capacity-bound + carries STRUCTURED
  -- posture metadata (not just prose) so it is never compressed across a master/non-master boundary
  -- and a law-firm-capacity summary is never fed into a title turn (Inc 2 posture-aware summaries).
  `capacitySnapshot`  JSON          NOT NULL,
  `posture`           JSON          NOT NULL,
  -- coversFromSeq..coversToSeq: the message window this summary condenses. ADDITIVE — raw turns remain
  -- retrievable; the summary is a windowing convenience, expandable on demand.
  `coversFromSeq`     INT           NOT NULL,
  `coversToSeq`       INT           NOT NULL,
  `summaryText`       MEDIUMTEXT    NOT NULL,
  `createdAt`         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_chat_summaries_conversation` (`conversationId`, `coversToSeq`),
  INDEX `idx_chat_summaries_matter` (`matterId`, `userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
