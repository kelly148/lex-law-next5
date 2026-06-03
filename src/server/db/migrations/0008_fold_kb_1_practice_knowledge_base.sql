-- =============================================================================
-- FOLD-KB-1 Migration — Practice Knowledge Base (Increment 1: data core)
-- =============================================================================
-- ADDITIVE ONLY. Creates two NEW tables. No existing table is altered (the
-- documents drewOnUnverifiedKb provenance flag + the kb_adoptions table land in
-- Increment 2 with the adoption/provenance wiring). Auto-applies via the pre-deploy
-- runner (additive allowlist).
--
-- pa_instruction_profiles — the per-practice-area MASTER PROMPT layer (Fork E). The
--   attorney's own tuned instructions (RE / general / T&E), versioned. A matter's
--   freeform practiceArea maps to a paKey by EXPLICIT attorney confirmation; the active
--   profile auto-loads into analysis/drafting (it is the attorney's own instruction,
--   NOT client work product) with its version captured immutably at job creation (R11).
--
-- practice_memos — the internal PRACTICE-MEMO repository (Fork A/B/C/G). Each memo
--   carries CURRENCY metadata (writtenOn / lawReliedOn / jurisdiction / verification*)
--   and PRIVILEGE/ABSTRACTION metadata. DEFAULTS ARE THE MOST-PRIVATE POSTURE:
--   privilegeTag='client_confidential', abstractionStatus='raw', reuseScope='matter_only',
--   verificationStatus='unverified'. A raw/matter_only memo may surface/invoke ONLY in its
--   origin matter; firm-wide reuse REQUIRES abstraction (an explicit, audited attorney act)
--   AND is enforced by the cross-matter gate. Memos are NEVER auto-injected into model
--   context or outbound work product (surface-not-inject; the friction is the feature).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `pa_instruction_profiles` (
  `id`               CHAR(36)     NOT NULL,
  `userId`           CHAR(36)     NOT NULL,
  `paKey`            VARCHAR(64)  NOT NULL,
  `title`            VARCHAR(256) NOT NULL,
  `body`             MEDIUMTEXT   NOT NULL,
  `version`          VARCHAR(32)  NOT NULL,
  `active`           TINYINT(1)   NOT NULL DEFAULT 0,
  `supersededById`   CHAR(36)     NULL DEFAULT NULL,
  `createdAt`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_pa_instruction_profiles_user` (`userId`),
  INDEX `idx_pa_instruction_profiles_pakey` (`userId`, `paKey`),
  INDEX `idx_pa_instruction_profiles_active` (`userId`, `paKey`, `active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `practice_memos` (
  `id`                          CHAR(36)     NOT NULL,
  `userId`                      CHAR(36)     NOT NULL,
  -- Provenance: matter the memo was derived from. NULL = firm-level (not client-derived).
  `originMatterId`              CHAR(36)     NULL DEFAULT NULL,
  `sourceAnalysisId`            CHAR(36)     NULL DEFAULT NULL,
  `sourceDocumentId`            CHAR(36)     NULL DEFAULT NULL,
  `title`                       VARCHAR(256) NOT NULL,
  `body`                        MEDIUMTEXT   NOT NULL,
  `practiceArea`                VARCHAR(128) NULL DEFAULT NULL,
  `jurisdiction`                VARCHAR(128) NULL DEFAULT NULL,
  -- Structured authorities the memo relied on (array of {jurisdiction, citationOrSource,
  -- sourceType, effectiveDate?, ref?}). REQUIRED at capture for any conclusion memo —
  -- enforced in the query/procedure layer, not the column (an un-sourced conclusion is
  -- uncheckable forever).
  `lawReliedOn`                 JSON         NULL DEFAULT NULL,
  `topicTags`                   JSON         NULL DEFAULT NULL,
  `writtenOn`                   TIMESTAMP    NULL DEFAULT NULL,
  -- Currency (Fork C). verificationStatus is DISCRETE and separate from lastVerifiedAt;
  -- staleness is never computed from age alone.
  `verificationStatus`          VARCHAR(32)  NOT NULL DEFAULT 'unverified',
  `lastVerifiedAt`              TIMESTAMP    NULL DEFAULT NULL,
  `verifiedThroughDate`         TIMESTAMP    NULL DEFAULT NULL,
  `verificationMethod`          VARCHAR(64)  NULL DEFAULT NULL,
  `verificationNote`            TEXT         NULL DEFAULT NULL,
  -- Privilege / abstraction (Fork B/G). Most-private defaults.
  `privilegeTag`                VARCHAR(32)  NOT NULL DEFAULT 'client_confidential',
  `abstractionStatus`           VARCHAR(16)  NOT NULL DEFAULT 'raw',
  `abstractionAttestedByEventId` CHAR(36)    NULL DEFAULT NULL,
  `abstractedAt`                TIMESTAMP    NULL DEFAULT NULL,
  `abstractedBy`                VARCHAR(32)  NULL DEFAULT NULL,
  `reuseScope`                  VARCHAR(16)  NOT NULL DEFAULT 'matter_only',
  -- Owner-only provenance link from an abstracted memo back to its raw origin (for
  -- remediation if a de-identification later proves insufficient). NEVER exposed cross-matter.
  `abstractedFromMemoId`        CHAR(36)     NULL DEFAULT NULL,
  `supersededById`              CHAR(36)     NULL DEFAULT NULL,
  `createdAt`                   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`                   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_practice_memos_user` (`userId`),
  INDEX `idx_practice_memos_origin` (`userId`, `originMatterId`),
  INDEX `idx_practice_memos_pa` (`userId`, `practiceArea`),
  INDEX `idx_practice_memos_reuse` (`userId`, `reuseScope`, `abstractionStatus`),
  INDEX `idx_practice_memos_verification` (`userId`, `verificationStatus`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
