-- =============================================================================
-- CONFLICT-GATE-OVERRIDE-1 Migration 0025 — attested per-matter gate-override record
-- =============================================================================
-- ADDITIVE ONLY. One new table: gate_override. No existing table is altered. Auto-applies via the
-- pre-deploy runner (additive allowlist); idempotent (CREATE TABLE IF NOT EXISTS).
--
-- gate_override: an APPEND-ONLY record of an attorney attesting an override of ONE fail-closed drafting
--   precondition (conflicts clearance OR party identity verification) for ONE matter. It does NOT weaken
--   the gate default: the gate stays fail-closed; the override is an explicit, recorded act the gate
--   CONSULTS — never a global toggle. Per-matter AND per-precondition (a separate row + audit ledger entry
--   for conflicts vs identity), so the record shows exactly which control the attorney exercised judgment
--   over. snapshot/snapshotHash capture the precondition STATE at attestation time; a MATERIAL CHANGE (a
--   new party => conflicts re-run; an identity-record change) makes the current state's hash differ, so
--   the override no longer matches and the gate RE-ARMS (no silent carry-forward) — the same
--   "supersedes on change" pattern as sendability_override.contentHash. reasonCode + reasonText record the
--   one-line attorney rationale. IMMUTABLE (no updatedAt); a re-attestation appends a new row.
-- Indexes: (userId, matterId, precondition, createdAt) for the latest-attestation-per-precondition read;
--   (matterId, createdAt) for the matter ledger read. Mirrors the existing append-only tables' index
--   naming conventions.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `gate_override` (
  `id`           CHAR(36)     NOT NULL,
  `userId`       CHAR(36)     NOT NULL,
  `matterId`     CHAR(36)     NOT NULL,
  `precondition` ENUM('conflicts','identity') NOT NULL,
  `snapshot`     JSON         NOT NULL,
  `snapshotHash` VARCHAR(128) NOT NULL,
  `reasonCode`   ENUM('cleared_out_of_band','verified_out_of_band','waived_professional_judgment','testing','other') NOT NULL,
  `reasonText`   TEXT         NULL DEFAULT NULL,
  `createdAt`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- IMMUTABLE (append-only; no updatedAt)
  PRIMARY KEY (`id`),
  INDEX `idx_gate_override_matter` (`userId`, `matterId`, `precondition`, `createdAt`),
  INDEX `idx_gate_override_matter_created` (`matterId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
