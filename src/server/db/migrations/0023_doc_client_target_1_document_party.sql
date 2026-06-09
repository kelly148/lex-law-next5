-- =============================================================================
-- DOC-CLIENT-TARGET-1 Increment 1 — document_party join table + targeting reservations
-- =============================================================================
-- ADDITIVE ONLY. One new table + two additive nullable columns. Data + reservation spine for
-- multi-client document->party targeting (triad-reconciled: DOC-CLIENT-TARGET-1_consolidated_
-- disposition_2026-06-09.md §3, LOCKED). NO behavior change in this migration: nothing binds a party,
-- nothing reads document_party yet (the drafting flow is Increment 2+). Auto-applies via the pre-deploy
-- runner (additive allowlist); idempotent (CREATE/ADD ... IF NOT EXISTS).
--
-- document_party: binds a document instance to a matter party in a declared ROLE. roleKey is validated
--   at WRITE against the document type's declared roles (src/shared/docTypes/docTypeConfig.ts) — a string,
--   not a DB enum, so a new role needs no migration. NO role_label_snapshot (the label derives from the
--   type's config; provenance is the config-version snapshot at finalize). The disposition's logical key
--   (documentId, partyId, roleKey) is the UNIQUE index; the table keeps the repo's `id` PK convention.
-- documents.sourceDocumentId: RESERVED for `derived` types (cert-of-trust / funding letter inherit their
--   party binding from a source document). Nullable; unused in v1 (the derived flow is fast-follow).
-- matter_parties.deletedAt: soft-delete (mirrors matter_materials, Ch 21.6). A bound party is block-deleted
--   (refused at the app layer) when bound to a finalized document; otherwise removal sets deletedAt. List
--   reads + conflicts screening exclude soft-deleted rows. Null = active.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `document_party` (
  `id`         CHAR(36)    NOT NULL,
  `userId`     CHAR(36)    NOT NULL,
  `matterId`   CHAR(36)    NOT NULL,
  `documentId` CHAR(36)    NOT NULL,
  `partyId`    CHAR(36)    NOT NULL,
  `roleKey`    VARCHAR(64) NOT NULL,
  `sortOrder`  INT         NOT NULL DEFAULT 0,
  `createdBy`  CHAR(36)    NOT NULL,
  `createdAt`  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP, -- IMMUTABLE (no updatedAt)
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_document_party_doc_party_role` (`documentId`, `partyId`, `roleKey`),
  INDEX `idx_document_party_doc` (`userId`, `documentId`),
  INDEX `idx_document_party_party` (`userId`, `partyId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `documents`
  ADD COLUMN IF NOT EXISTS `sourceDocumentId` CHAR(36) NULL DEFAULT NULL;

ALTER TABLE `matter_parties`
  ADD COLUMN IF NOT EXISTS `deletedAt` TIMESTAMP NULL DEFAULT NULL;
