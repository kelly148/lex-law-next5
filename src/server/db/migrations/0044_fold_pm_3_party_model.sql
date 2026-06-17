-- =============================================================================
-- FOLD-PM-3 Migration 0044 — party / entity / contact data model (within-matter)
-- =============================================================================
-- ADDITIVE ONLY. Two new tables: matter_entity, matter_entity_contact. NO existing
-- table is altered, dropped, or retyped; every pre-existing row stays valid. TiDB-
-- compatible MySQL syntax: each index is declared INLINE inside CREATE TABLE IF NOT
-- EXISTS (idempotent at the table level) — there is NO `ALTER TABLE ... ADD INDEX IF
-- NOT EXISTS` (TiDB does NOT support IF NOT EXISTS on ADD INDEX inside ALTER TABLE;
-- that broke the 0043 deploy on 2026-06-16). Auto-applies via the pre-deploy runner
-- (additive allowlist); idempotent (CREATE TABLE IF NOT EXISTS). NO DB FOREIGN KEY by
-- codebase convention — owner + matter isolation is enforced in the application layer
-- (ownerScope + immutable userId/matterId bindings). Read/written ONLY when
-- PARTY_MODEL_ENABLED is ON (default OFF); apply BEFORE flipping the flag.
-- Default-safe; no new behavior.
--
-- RELATIONSHIP TO EXISTING MODEL: this does NOT replace or alter matter_parties (the
-- thin conflicts party, FOLD-L0-1 Fork B). A matter_entity is a RICHER record that may
-- OPTIONALLY reference a matter_parties row WITHIN THE SAME MATTER via `partyRef`
-- (nullable; a same-matter soft link, NOT a DB FK). matter_entity_contact rows hang off
-- a matter_entity (one entity, many contact points).
--
-- SCOPE FENCE (FOLD-PM-3): WITHIN-MATTER only. `externalIdentityKey` is a stable,
-- owner-scoped, OPAQUE grouping string DEFINED so a FUTURE cross-matter identity
-- resolver CAN group entities later — NO cross-matter read/match/join is written now.
--
-- matter_entity: one richer party/entity record on ONE matter, owned by ONE attorney.
--   entityKind = person/organization/trust/government/unknown (default 'unknown');
--   displayName is what the attorney sees, normalizedName is the within-matter match
--   key; legalName/partyRef/externalIdentityKey/notes are optional; deletedAt soft-
--   deletes (NULL = active). Indexes: (userId, matterId) for the within-matter list;
--   (userId, matterId, normalizedName) for the within-matter name lookup.
-- matter_entity_contact: one contact point (email/phone/address/other) on ONE
--   matter_entity. label/isPrimary are advisory; value holds the contact value;
--   deletedAt soft-deletes. Indexes: (userId, entityId) for an entity's contacts;
--   (userId, matterId) for a matter-wide sweep. The leading userId column keeps every
--   index owner-scoped, matching the app-layer ownerScope.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `matter_entity` (
  `id`                   CHAR(36)                                                       NOT NULL,
  `userId`               CHAR(36)                                                       NOT NULL,
  `matterId`             CHAR(36)                                                       NOT NULL,
  `entityKind`           ENUM('person','organization','trust','government','unknown')   NOT NULL DEFAULT 'unknown',
  `displayName`          VARCHAR(256)                                                   NOT NULL,
  `normalizedName`       VARCHAR(256)                                                   NOT NULL,
  `legalName`            VARCHAR(256)                                                   NULL DEFAULT NULL,
  `partyRef`             CHAR(36)                                                       NULL DEFAULT NULL,
  `externalIdentityKey`  VARCHAR(128)                                                   NULL DEFAULT NULL,
  `notes`                TEXT                                                           NULL DEFAULT NULL,
  `deletedAt`            TIMESTAMP                                                      NULL DEFAULT NULL,
  `createdAt`            TIMESTAMP                                                      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`            TIMESTAMP                                                      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_matter_entity_matter` (`userId`, `matterId`),
  INDEX `idx_matter_entity_norm` (`userId`, `matterId`, `normalizedName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `matter_entity_contact` (
  `id`           CHAR(36)                                NOT NULL,
  `userId`       CHAR(36)                                NOT NULL,
  `matterId`     CHAR(36)                                NOT NULL,
  `entityId`     CHAR(36)                                NOT NULL,
  `contactType`  ENUM('email','phone','address','other') NOT NULL,
  `label`        VARCHAR(128)                            NULL DEFAULT NULL,
  `value`        VARCHAR(1024)                           NOT NULL,
  `isPrimary`    BOOLEAN                                 NOT NULL DEFAULT FALSE,
  `deletedAt`    TIMESTAMP                               NULL DEFAULT NULL,
  `createdAt`    TIMESTAMP                               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`    TIMESTAMP                               NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_matter_entity_contact_entity` (`userId`, `entityId`),
  INDEX `idx_matter_entity_contact_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
