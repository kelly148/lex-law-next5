-- D3-SIGNOFF (source-anchored deed sign-off), A.1 Inc 1 — deed_signoff record.
--
-- ONE ADDITIVE table: the append-only source-extracted-facts sign-off record at deed export (NC-D3-6). One row
-- per sign-off act; content-hash-bound + supersede-on-version (a new version/content requires a fresh sign-off),
-- mirroring gate_override / sendability_override. The JSON columns carry comparator RESULTS + value HASHES + the
-- displayed-comparison snapshot — NOT model-composed operative text (NC-1). No existing table altered; NO DB FK
-- (app-layer ownerScope). Index INLINE (TiDB-safe). Idempotent.
--
-- DORMANT: written ONLY when D3_SIGNOFF_MODE is 'observe' or 'enforce' (default OFF). The comparator (Inc 2),
-- the export-route OBSERVE wiring (Inc 3), and the UI (Inc 4) build on this. ENFORCE (default-block) requires a
-- named operator activation event (NC-D3-7); D3 is NOT complete until ENFORCE is on in prod.
--
-- NOT on the apply-prod-migrations.mjs auto-apply allowlist — operator-applied out-of-band at deploy
-- (DEPLOY-MIGRATIONS-NOT-AUTOMATIC).

CREATE TABLE IF NOT EXISTS `deed_signoff` (
  `id`                    CHAR(36)     NOT NULL,
  `userId`                CHAR(36)     NOT NULL,
  `matterId`              CHAR(36)     NOT NULL,
  `documentId`            CHAR(36)     NOT NULL,
  `documentVersionId`     CHAR(36)     NOT NULL,
  `gateMode`              ENUM('observe','enforce')       NOT NULL,
  `verdict`               ENUM('pass','blocked','overridden') NOT NULL,
  `comparatorPassed`      BOOLEAN      NOT NULL,
  `comparatorVersion`     VARCHAR(32)  NOT NULL,
  `assembledContentHash`  VARCHAR(128) NOT NULL,
  `sourceFactsHash`       VARCHAR(128) NOT NULL,
  `forkProvenance`        VARCHAR(32)  NOT NULL,
  `attestations`          JSON         NOT NULL,
  `comparison`            JSON         NOT NULL,
  `override`              JSON         NULL,
  `attorneyUserId`        CHAR(36)     NOT NULL,
  `createdAt`             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_deed_signoff_user_matter` (`userId`, `matterId`),
  INDEX `idx_deed_signoff_version` (`documentVersionId`),
  INDEX `idx_deed_signoff_document` (`documentId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
