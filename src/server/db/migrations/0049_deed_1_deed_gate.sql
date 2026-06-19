-- FOLD-DEED-1 (Increment 1 foundation) — per-deed-document recordability GATE state.
--
-- A single ADDITIVE table: one row per deed document holding the attorney-recorded gate STATE (the
-- affirmative-act checklist) as a Zod-validated JSON blob, plus who-last-changed for the Matter-Record audit.
-- The blob keeps the wide affirmative-act field set migration-free (mirrors firm_conflict_policy.policy).
-- documentId is UNIQUE — one gate state per deed document (upsert). The PERMANENT record of each affirmative
-- act is the Matter-Record event in audit_events; this row is the current operational checklist state.
--
-- DORMANT: read/written ONLY when DEED_GATE_ENABLED is ON (default OFF). FAIL-CLOSED + KB-mandatory: with no
-- locality KB seeded, no deed ever reaches "recordable" — by design. NO existing table altered; NO DB FK
-- (app-layer ownerScope). Index INLINE (TiDB-safe). Idempotent.
--
-- NOT on the apply-prod-migrations.mjs auto-apply allowlist — operator-applied at deploy (build guardrail).

CREATE TABLE IF NOT EXISTS `deed_gate` (
  `id`               CHAR(36)  NOT NULL,
  `userId`           CHAR(36)  NOT NULL,
  `matterId`         CHAR(36)  NOT NULL,
  `documentId`       CHAR(36)  NOT NULL,
  `state`            JSON      NOT NULL,
  `changedByUserId`  CHAR(36)  NOT NULL,
  `createdAt`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ux_deed_gate_document` (`documentId`),
  INDEX `idx_deed_gate_matter` (`userId`, `matterId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
