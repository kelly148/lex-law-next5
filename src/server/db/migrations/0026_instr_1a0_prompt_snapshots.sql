-- =============================================================================
-- INSTR-1A0 Migration 0026 — prompt_snapshots (blob-first master-prompt delivery)
-- =============================================================================
-- ADDITIVE ONLY. One new table: prompt_snapshots. No existing table is altered. Auto-applies via
-- the pre-deploy runner (additive allowlist); idempotent (CREATE TABLE IF NOT EXISTS).
--
-- prompt_snapshots: an APPEND-ONLY per-draft-job record of the FULL composed system text actually
--   sent to the provider (BOTH paths — composed master and legacy — flag on or off), plus its
--   SHA-256, the composed asset's logical ID + manifest hash (NULL/'legacy' on the legacy path),
--   the PROMPT_COMPOSITION_ENABLED flag state at dispatch, and model/provider/adapter identifiers.
--   This is the measurement substrate for the INSTRUCTIONS-LEG-1 experiment: every draft's system
--   block is byte-auditable after the fact. Written best-effort at the LLM-dispatch chokepoint
--   AFTER all assembly. IMMUTABLE (no updatedAt); a job never updates its snapshot row.
-- Indexes: (jobId) for the per-job audit read; (userId, createdAt) for the time-ordered review.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `prompt_snapshots` (
  `id`           CHAR(36)     NOT NULL,
  `userId`       CHAR(36)     NOT NULL,
  `jobId`        CHAR(36)     NOT NULL,
  `matterId`     CHAR(36)     NULL DEFAULT NULL,
  `documentId`   CHAR(36)     NULL DEFAULT NULL,
  `jobType`      VARCHAR(64)  NOT NULL,
  `callRole`     VARCHAR(32)  NOT NULL,
  `source`       VARCHAR(64)  NOT NULL,
  `assetId`      VARCHAR(64)  NULL DEFAULT NULL,
  `assetSha256`  CHAR(64)     NULL DEFAULT NULL,
  `systemText`   MEDIUMTEXT   NOT NULL,
  `systemSha256` CHAR(64)     NOT NULL,
  `flagEnabled`  BOOLEAN      NOT NULL,
  `modelString`  VARCHAR(128) NOT NULL,
  `providerId`   VARCHAR(32)  NOT NULL,
  `modelId`      VARCHAR(96)  NOT NULL,
  `adapterId`    VARCHAR(32)  NOT NULL,
  `createdAt`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- IMMUTABLE (append-only; no updatedAt)
  PRIMARY KEY (`id`),
  INDEX `idx_prompt_snapshots_job` (`jobId`),
  INDEX `idx_prompt_snapshots_user_created` (`userId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
