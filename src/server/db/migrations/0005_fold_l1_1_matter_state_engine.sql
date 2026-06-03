-- =============================================================================
-- FOLD-L1-1 Migration — Layer-1 Matter-State Engine (data model)
-- =============================================================================
-- ADDITIVE ONLY. Creates two new tables (source_authority, open_items) and adds
-- nullable columns + one index to audit_events. NO existing column is dropped or
-- retyped destructively; every pre-existing row stays valid. Applied OUT-OF-BAND
-- to prod TiDB (DEPLOY-MIGRATIONS-NOT-AUTOMATIC); migration 0004 is also pending
-- a prod apply. TiDB-compatible MySQL syntax (IF NOT EXISTS on ADD COLUMN/INDEX).
--
-- Operator disposition (FOLD-L1-1 §4a):
--   Fork A -> source_authority (dedicated table, two axes, explicit attorney tier).
--   Fork B/D -> open_items (persistent registry; matter- AND document-level).
--   Fork C (item 4) -> audit_events carries disposition detail; disposition history
--                      is a READ-PROJECTION over audit_events (no new authoritative table).
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- audit_events: add the 'disposition' event type and the disposition-detail columns.
-- All added columns are NULLable so existing rows remain valid (additive).
-- -----------------------------------------------------------------------------
ALTER TABLE `audit_events`
  MODIFY COLUMN `eventType` ENUM(
    'model_output','adopted','rejected','locked','unlocked','sent','withheld',
    'authority_verified','judgment_required','disposition'
  ) NOT NULL;

ALTER TABLE `audit_events`
  ADD COLUMN IF NOT EXISTS `targetType` VARCHAR(32)  NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `targetId`   VARCHAR(64)  NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `action`     VARCHAR(64)  NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `rationale`  TEXT         NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `scope`      VARCHAR(16)  NULL DEFAULT NULL;

ALTER TABLE `audit_events`
  ADD INDEX IF NOT EXISTS `idx_audit_events_target` (`matterId`, `targetType`, `targetId`);

-- -----------------------------------------------------------------------------
-- source_authority: source-of-truth tier/authority for materials and document
--   artifacts. DEDICATED table (not a matter_materials column). Two axes
--   (authorityOrigin, lifecycle); the tier is an explicit attorney act with a
--   conservative default, never inferred. DISTINCT from contextPriority. Staleness/
--   verification columns are present but carry NO checking behavior (item 8).
-- Indexes: (userId, matterId) owner scope; (matterId, subjectType, subjectId)
--   subject lookup; (matterId, lifecycle) currency rollup.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `source_authority` (
  `id`                  CHAR(36)     NOT NULL,
  `userId`              CHAR(36)     NOT NULL,
  `matterId`            CHAR(36)     NOT NULL,
  `documentId`          CHAR(36)     NULL DEFAULT NULL,
  `subjectType`         ENUM('material','document','version') NOT NULL,
  `subjectId`           CHAR(36)     NOT NULL,
  `authorityOrigin`     ENUM('operative','counterparty','firm','client','model_derived','reference') NOT NULL DEFAULT 'reference',
  `lifecycle`           ENUM('current_draft','operative','superseded') NOT NULL DEFAULT 'operative',
  `designationSource`   ENUM('attorney','system','imported','counterparty','client') NOT NULL DEFAULT 'system',
  `label`               VARCHAR(256) NULL DEFAULT NULL,
  `notes`               TEXT         NULL DEFAULT NULL,
  `verificationStatus`  ENUM('unverified','verified','stale') NOT NULL DEFAULT 'unverified',
  `lastVerifiedAt`      TIMESTAMP    NULL DEFAULT NULL,
  `stalenessReason`     VARCHAR(256) NULL DEFAULT NULL,
  `effectiveFrom`       TIMESTAMP    NULL DEFAULT NULL,
  `supersededAt`        TIMESTAMP    NULL DEFAULT NULL,
  `supersededById`      CHAR(36)     NULL DEFAULT NULL,
  `createdAt`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_source_authority_matter` (`userId`, `matterId`),
  INDEX `idx_source_authority_subject` (`matterId`, `subjectType`, `subjectId`),
  INDEX `idx_source_authority_lifecycle` (`matterId`, `lifecycle`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- open_items: persistent registry of open items / blockers requiring attorney
--   action. Matter-level (documentId NULL) AND document-level. DEFAULT-SAFE:
--   auto-detection may create/refresh (statusSource='auto') but never closes an
--   attorney-opened/confirmed item. Resolution links to the immutable audit_events
--   decision (resolvedByEventId) + rationale.
-- Indexes: (userId, matterId) owner scope; (matterId, status) and (documentId,
--   status) read paths (incl. the safe-to-send open-blocker query).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `open_items` (
  `id`                            CHAR(36)     NOT NULL,
  `userId`                        CHAR(36)     NOT NULL,
  `matterId`                      CHAR(36)     NOT NULL,
  `documentId`                    CHAR(36)     NULL DEFAULT NULL,
  `category`                      VARCHAR(64)  NOT NULL,
  `severity`                      ENUM('blocker','substantive','polish') NOT NULL,
  `summary`                       TEXT         NOT NULL,
  `status`                        ENUM('open','resolved','withdrawn') NOT NULL DEFAULT 'open',
  `statusSource`                  ENUM('auto','attorney') NOT NULL DEFAULT 'auto',
  `origin`                        VARCHAR(64)  NOT NULL,
  `confidence`                    ENUM('low','medium','high') NULL DEFAULT NULL,
  `requiresAttorneyConfirmation`  BOOLEAN      NOT NULL DEFAULT FALSE,
  `sourceSuggestionId`            VARCHAR(64)  NULL DEFAULT NULL,
  `reviewSessionId`               CHAR(36)     NULL DEFAULT NULL,
  `versionId`                     CHAR(36)     NULL DEFAULT NULL,
  `lastSeenAt`                    TIMESTAMP    NULL DEFAULT NULL,
  `resolvedByEventId`             CHAR(36)     NULL DEFAULT NULL,
  `resolutionRationale`           TEXT         NULL DEFAULT NULL,
  `createdAt`                     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`                     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_open_items_matter` (`userId`, `matterId`),
  INDEX `idx_open_items_matter_status` (`matterId`, `status`),
  INDEX `idx_open_items_document_status` (`documentId`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
