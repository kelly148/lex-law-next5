-- CONFLICT-TOGGLE-1 (Increment 2) — per-matter conflicts posture election.
--
-- A single ADDITIVE, APPEND-ONLY table. Each row is one per-matter posture election; the latest row (by
-- userId, matterId, createdAt) is the matter's current elected posture, and the row history IS the tamper-
-- evident audit of every election (mirrors firm_conflict_policy + gate_override). A matter relaxes to
-- ADVISORY only through an explicit, audited INSERT carrying the attorney's attestation reason — never
-- UPDATE/DELETE, never absence (no row = derive the firm default, which is default-safe ENFORCED).
--
-- posture is 'ENFORCED' | 'ADVISORY' in Inc 2 (SANDBOX election lands with its non-convertibility guardrail
-- in Inc 3). NOT the matters table — kept separate so the hot matters row + its Zod Wall are untouched.
-- NO DB FK (app-layer ownerScope). Index INLINE (TiDB-safe). DORMANT: read only when CONFLICT_GATE_ENABLED.
--
-- NOT on the apply-prod-migrations.mjs auto-apply allowlist — operator-applied at deploy (per the build guardrail).

CREATE TABLE IF NOT EXISTS `matter_conflict_posture` (
  `id`               CHAR(36)     NOT NULL,
  `userId`           CHAR(36)     NOT NULL,
  `matterId`         CHAR(36)     NOT NULL,
  `posture`          VARCHAR(16)  NOT NULL,
  `reasonText`       TEXT         NULL DEFAULT NULL,
  `changedByUserId`  CHAR(36)     NOT NULL,
  `createdAt`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_matter_conflict_posture` (`userId`, `matterId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
