-- =============================================================================
-- FOLD-L1-4 Migration — Reusable-artifact registry (MM-8a) + cross-matter gate (MM-8b)
-- =============================================================================
-- ADDITIVE ONLY. Creates the reusable_artifacts table. No existing table is altered.
-- Applied OUT-OF-BAND to prod TiDB (DEPLOY-MIGRATIONS-NOT-AUTOMATIC; migrations 0004
-- and 0005 are also pending a prod apply).
--
-- reusable_artifacts: templates / clauses / memos / snippets reusable across matters
--   UNDER a contamination gate. ANTI-CONTAMINATION:
--     - originMatterId = where it came from (NULL = firm-level, not client-derived).
--     - reusableScope DEFAULTS to 'matter_only' — an artifact derived from one matter
--       may NOT be invoked in another unless the attorney explicitly widens it to
--       'cross_matter'; even then the gate service requires an explicit per-use opt-in
--       and fail-visibly audits the cross-matter invocation.
--   The scope is an explicit attorney act with a conservative default — never inferred.
-- Indexes: (userId) owner scope; (userId, originMatterId) origin lookup; (userId, kind).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reusable_artifacts` (
  `id`                 CHAR(36)     NOT NULL,
  `userId`             CHAR(36)     NOT NULL,
  `originMatterId`     CHAR(36)     NULL DEFAULT NULL,
  `sourceDocumentId`   CHAR(36)     NULL DEFAULT NULL,
  `kind`               ENUM('template','clause','memo','snippet') NOT NULL,
  `title`              VARCHAR(256) NOT NULL,
  `body`               MEDIUMTEXT   NOT NULL,
  `reusableScope`      ENUM('matter_only','cross_matter') NOT NULL DEFAULT 'matter_only',
  `createdAt`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_reusable_artifacts_user` (`userId`),
  INDEX `idx_reusable_artifacts_origin` (`userId`, `originMatterId`),
  INDEX `idx_reusable_artifacts_kind` (`userId`, `kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
