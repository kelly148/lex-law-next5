-- =============================================================================
-- FOLD-L0-1 Migration — Layer-0 Matter Intake & Analysis
-- =============================================================================
-- ADDITIVE ONLY. Adds matters.analysisStatus (orthogonal to phase, default 'none' so
-- every existing row stays valid) and creates four new tables: matter_parties,
-- conflict_checks, conflict_hits, matter_analysis. No existing column is dropped or
-- retyped destructively. Applied OUT-OF-BAND / via the Rule-18 additive pre-deploy runner
-- (this file is on the runner's allowlist). TiDB-compatible MySQL.
--
-- Triad disposition (FOLD-L0-1, PROCEED WITH NAMED CHANGES):
--   Fork D -> matters.analysisStatus (orthogonal; NOT a new phase value).
--   Fork B -> matter_parties (thin/interim; full identity = FOLD-PM-3).
--   Fork A -> conflict_checks + conflict_hits (deterministic; blocker hard-block;
--             required rationale to clear a blocker; role-aware; matchBasis stored).
--   Fork C/F -> matter_analysis (internal work-product; categorically NON-SENDABLE type).
-- -----------------------------------------------------------------------------

ALTER TABLE `matters`
  ADD COLUMN IF NOT EXISTS `analysisStatus` ENUM('none','in_analysis','plan_locked') NOT NULL DEFAULT 'none';

-- -----------------------------------------------------------------------------
-- matter_parties (Fork B — thin/interim): the conflict match key is normalizedName.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `matter_parties` (
  `id`                   CHAR(36)     NOT NULL,
  `userId`               CHAR(36)     NOT NULL,
  `matterId`             CHAR(36)     NOT NULL,
  `role`                 ENUM('client','adverse','related','other') NOT NULL,
  `displayName`          VARCHAR(256) NOT NULL,
  `normalizedName`       VARCHAR(256) NOT NULL,
  `partyType`            ENUM('person','entity','unknown') NOT NULL DEFAULT 'unknown',
  `source`               VARCHAR(64)  NOT NULL DEFAULT 'attorney',
  `aliasOfPartyId`       CHAR(36)     NULL DEFAULT NULL,
  `externalIdentityKey`  VARCHAR(128) NULL DEFAULT NULL,
  `createdAt`            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_matter_parties_matter` (`userId`, `matterId`),
  INDEX `idx_matter_parties_norm` (`userId`, `normalizedName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- conflict_checks (Fork A): one row per check run for a matter.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `conflict_checks` (
  `id`         CHAR(36)  NOT NULL,
  `userId`     CHAR(36)  NOT NULL,
  `matterId`   CHAR(36)  NOT NULL,
  `status`     ENUM('clear','hits_pending','dispositioned') NOT NULL DEFAULT 'clear',
  `runAt`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_conflict_checks_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- conflict_hits (Fork A): blocker = undispositioned hard-block; clearing a blocker
--   REQUIRES a rationale (enforced in the query layer; the RPC-defense record lives in
--   audit_events via dispositionedByEventId).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `conflict_hits` (
  `id`                      CHAR(36)     NOT NULL,
  `userId`                  CHAR(36)     NOT NULL,
  `checkId`                 CHAR(36)     NOT NULL,
  `matterId`                CHAR(36)     NOT NULL,
  `matchedMatterId`         CHAR(36)     NOT NULL,
  `thisPartyId`             CHAR(36)     NULL DEFAULT NULL,
  `matchedPartyId`          CHAR(36)     NULL DEFAULT NULL,
  `matchBasis`              VARCHAR(512) NOT NULL,
  `matchType`               VARCHAR(64)  NOT NULL,
  `severity`                ENUM('blocker','review') NOT NULL,
  `disposition`             ENUM('pending','cleared','screened','declined') NOT NULL DEFAULT 'pending',
  `dispositionRationale`    TEXT         NULL DEFAULT NULL,
  `dispositionedByEventId`  CHAR(36)     NULL DEFAULT NULL,
  `createdAt`               TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`               TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_conflict_hits_check` (`checkId`),
  INDEX `idx_conflict_hits_matter` (`userId`, `matterId`, `disposition`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- matter_analysis (Fork C/F): internal assessment-and-plan; categorically NON-SENDABLE
--   by TYPE (outboundEligible=false, sendabilityRequired=false, sendabilityStatus=
--   'not_applicable'). Plan lock is an explicit attorney act recorded in audit_events.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `matter_analysis` (
  `id`                            CHAR(36)     NOT NULL,
  `userId`                        CHAR(36)     NOT NULL,
  `matterId`                      CHAR(36)     NOT NULL,
  `status`                        ENUM('draft','locked','superseded') NOT NULL DEFAULT 'draft',
  `assessment`                    JSON         NULL DEFAULT NULL,
  `plan`                          JSON         NULL DEFAULT NULL,
  `openQuestions`                 JSON         NULL DEFAULT NULL,
  `recommendedDocuments`          JSON         NULL DEFAULT NULL,
  `conflictCheckId`               CHAR(36)     NULL DEFAULT NULL,
  `conflictsClearedForPlanning`   BOOLEAN      NOT NULL DEFAULT FALSE,
  `modelLane`                     ENUM('single','multi') NOT NULL DEFAULT 'single',
  `generatedByJobId`              CHAR(36)     NULL DEFAULT NULL,
  `lockedByEventId`               CHAR(36)     NULL DEFAULT NULL,
  `lockedAt`                      TIMESTAMP    NULL DEFAULT NULL,
  `lockRationale`                 TEXT         NULL DEFAULT NULL,
  `supersededById`                CHAR(36)     NULL DEFAULT NULL,
  `artifactKind`                  VARCHAR(32)  NOT NULL DEFAULT 'matter_analysis',
  `outboundEligible`              BOOLEAN      NOT NULL DEFAULT FALSE,
  `sendabilityRequired`           BOOLEAN      NOT NULL DEFAULT FALSE,
  `sendabilityStatus`             VARCHAR(32)  NOT NULL DEFAULT 'not_applicable',
  `createdAt`                     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`                     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_matter_analysis_matter` (`userId`, `matterId`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
