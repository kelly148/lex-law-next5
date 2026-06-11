-- =============================================================================
-- CHAT-UI-1 W2 Migration — posture_provenance (durable posture audit ledger)
-- =============================================================================
-- Additive only: creates the posture_provenance table. No existing table is altered.
--
-- Append-only, owner-scoped, per-matter audit ledger for the CHAT-UI-1 posture-confirm
-- discipline (PROVENANCE-LEDGER-1), DISTINCT from audit_events and telemetry_events. One
-- row per meaningful accept or dirty->confirmed transition (eventClass), carrying the full
-- resolved {issuer, privilege, recipient} triple (typed columns), the incoherence verdict,
-- the hard-stop act, actor, slider position, trigger source, and the attorney confirm
-- timestamp (confirmedAt). Tamper-EVIDENT via a per-matter sha256 hash chain
-- (prevHash -> entryHash). The query wrapper exposes insert + read only; there is no
-- update/delete path (rows are never modified). Retention is permanent (legal matter record).
--
-- Entirely behind CHAT_UI_1_ENABLED: no rows are written while the flag is off, and the
-- best-effort recorder no-ops if this table is not yet present on an environment.
-- Indexes: (matterId, seq) ordered chain read; (userId, matterId) owner scope.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `posture_provenance` (
  `id`              CHAR(36)      NOT NULL,
  `userId`          CHAR(36)      NOT NULL,
  `matterId`        CHAR(36)      NOT NULL,
  `documentId`      CHAR(36)      NULL DEFAULT NULL,
  `seq`             INT           NOT NULL,
  `eventClass`      ENUM('meaningful_accept','dirty_confirmed') NOT NULL,
  `act`             ENUM('lock','tier_source','disposition','send','matter_identity','issuer','privilege','recipient') NOT NULL,
  `actor`           VARCHAR(128)  NOT NULL,
  `sliderPosition`  VARCHAR(64)   NOT NULL,
  `triggerSource`   TEXT          NOT NULL,
  `confirmedAt`     VARCHAR(32)   NOT NULL,
  `issuerEntity`    VARCHAR(255)  NULL DEFAULT NULL,
  `issuerCapacity`  ENUM('counsel','principal') NULL DEFAULT NULL,
  `issuerDisplay`   TEXT          NULL DEFAULT NULL,
  `privilege`       ENUM('privileged','not_privileged','undetermined') NULL DEFAULT NULL,
  `recipient`       ENUM('internal_client','co_counsel_agent','neutral_third_party','regulator_court','adverse','public') NULL DEFAULT NULL,
  `priorTriple`     JSON          NULL DEFAULT NULL,
  `verdictSeverity` ENUM('hard','soft','none') NOT NULL,
  `findings`        JSON          NOT NULL,
  `prevHash`        VARCHAR(64)   NOT NULL,
  `entryHash`       VARCHAR(64)   NOT NULL,
  `createdAt`       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_posture_provenance_matter` (`matterId`, `seq`),
  INDEX `idx_posture_provenance_user_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
