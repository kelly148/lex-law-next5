-- =============================================================================
-- FOLD-KB-1 Migration 0009 — KB adoption provenance (Increment 2)
-- =============================================================================
-- ADDITIVE ONLY. One new table + one additive column on documents (defaulted, so every
-- existing row stays valid). Auto-applies via the pre-deploy runner (additive allowlist).
--
-- kb_adoptions — the DURABLE provenance record of pulling a practice memo into a matter /
--   work product (Fork A). Enforced at the ARTIFACT/MATTER level, NOT by tracking memo text
--   through the model (the model paraphrases; text-tracking fails). Each adoption snapshots
--   the memo's currency posture AT ADOPTION so a later send-safety check has a stable record.
--
-- documents.drewOnUnverifiedKb — the durable artifact-level flag (Fork A). Once an
--   unverified memo is adopted into a document it is set TRUE and STAYS true across
--   adoption -> drafting -> versioning (it lives on the document; versions are snapshots).
--   FOLD-SEND-1 reads THIS flag (not memo text) to gate outbound.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `kb_adoptions` (
  `id`                            CHAR(36)    NOT NULL,
  `userId`                        CHAR(36)    NOT NULL,
  -- Target matter the memo was adopted into (always present — adoption is matter-scoped).
  `matterId`                      CHAR(36)    NOT NULL,
  -- Optional work-product the memo was adopted into; when present its drewOnUnverifiedKb flag is set.
  `documentId`                    CHAR(36)    NULL DEFAULT NULL,
  `kbMemoId`                      CHAR(36)    NOT NULL,
  -- Version proxy: practice_memos.updatedAt snapshot at adoption (memos version via updatedAt).
  `kbMemoUpdatedAtAtAdoption`     TIMESTAMP   NULL DEFAULT NULL,
  `verificationStatusAtAdoption`  VARCHAR(32) NOT NULL,
  `lastVerifiedAtAtAdoption`      TIMESTAMP   NULL DEFAULT NULL,
  `kbDerived`                     TINYINT(1)  NOT NULL DEFAULT 1,
  -- FALSE until an attorney verifies the adopted content's currency for outbound use.
  `currencyVerifiedForOutbound`   TINYINT(1)  NOT NULL DEFAULT 0,
  `adoptedByEventId`              CHAR(36)    NULL DEFAULT NULL,
  `createdAt`                     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`                     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_kb_adoptions_user` (`userId`),
  INDEX `idx_kb_adoptions_matter` (`userId`, `matterId`),
  INDEX `idx_kb_adoptions_document` (`userId`, `documentId`),
  INDEX `idx_kb_adoptions_memo` (`userId`, `kbMemoId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `documents`
  ADD COLUMN IF NOT EXISTS `drewOnUnverifiedKb` TINYINT(1) NOT NULL DEFAULT 0;
