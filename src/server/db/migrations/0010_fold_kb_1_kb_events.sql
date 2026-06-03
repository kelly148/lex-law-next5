-- =============================================================================
-- FOLD-KB-1 Migration 0010 — kb_events firm-level audit log (Increment 3)
-- =============================================================================
-- ADDITIVE ONLY. One new table. Operator-approved (kb_events vs nullable audit_events):
-- audit_events is the per-MATTER record (matterId NOT NULL); the firm-level KB attorney
-- acts (memo_abstracted, memo_promoted_to_reuse, pa_profile_activated, ...) are matter-less,
-- so they get their OWN owner-scoped, append-only audit trail here — keeping audit_events
-- purely the matter record. Matter-scoped KB acts (memo_adopted_into_matter, memo_created
-- from a matter) stay in audit_events.
--
-- APPEND-ONLY: insert + read only (no updatedAt, no update/delete path).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `kb_events` (
  `id`          CHAR(36)     NOT NULL,
  `userId`      CHAR(36)     NOT NULL,
  -- The KB act (see KB_AUDIT_ACTIONS): memo_abstracted, memo_promoted_to_reuse,
  -- memo_marked_reverified, memo_superseded, pa_profile_activated, pa_profile_loaded_for_job.
  `action`      VARCHAR(48)  NOT NULL,
  `targetType`  VARCHAR(32)  NOT NULL, -- 'practice_memo' | 'pa_instruction_profile'
  `targetId`    CHAR(36)     NOT NULL,
  `summary`     VARCHAR(512) NOT NULL,
  `rationale`   TEXT         NULL DEFAULT NULL,
  `payload`     JSON         NULL DEFAULT NULL,
  `createdAt`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_kb_events_user` (`userId`),
  INDEX `idx_kb_events_target` (`userId`, `targetType`, `targetId`),
  INDEX `idx_kb_events_action` (`userId`, `action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
