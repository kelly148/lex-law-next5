-- CONFLICT-TOGGLE-1 (Increment 1) — firm-scoped conflicts POSTURE policy substrate.
--
-- A single ADDITIVE, APPEND-ONLY table. Each row is one version of a firm's conflicts posture policy;
-- the latest row (by firmOwnerUserId, createdAt) is the current policy, and the full row history IS the
-- tamper-evident, append-only settings-audit (mirrors gate_override's append-only philosophy). The policy
-- becomes LESS protective only through an explicit, audited INSERT — never through UPDATE/DELETE (there are
-- none), absence, reset, or error (the app resolver is default-safe → ENFORCED).
--
-- FIRM-SCOPED, not per-user (disposition item 5): keyed by firmOwnerUserId (the firm's owning attorney).
-- In single-tenant v1 firmOwnerUserId == the acting attorney's userId; the column is firm-shaped so a later
-- multi-user firm never inherits a private per-user kill-switch.
--
-- DORMANT: nothing reads the effective posture to change a gate transition in Increment 1, so applying this
-- is behavior-preserving. No existing table is altered; NO DB FK (isolation is app-layer ownerScope).
-- Index is INLINE in CREATE TABLE (NOT `ALTER TABLE ... ADD INDEX`, which TiDB rejects). Idempotent.
--
-- NOT YET on the apply-prod-migrations.mjs auto-apply allowlist — operator-applied at deploy (per the build
-- guardrail: additive migrations are operator-applied to prod, not in this build).

CREATE TABLE IF NOT EXISTS `firm_conflict_policy` (
  `id`               CHAR(36)  NOT NULL,
  `firmOwnerUserId`  CHAR(36)  NOT NULL,
  `policy`           JSON      NOT NULL,
  `changedByUserId`  CHAR(36)  NOT NULL,
  `reasonText`       TEXT      NULL DEFAULT NULL,
  `createdAt`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_firm_conflict_policy_owner` (`firmOwnerUserId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
