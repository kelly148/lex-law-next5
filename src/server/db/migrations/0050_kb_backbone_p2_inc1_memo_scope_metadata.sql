-- =============================================================================
-- KNOWLEDGE-BACKBONE-PHASE2 (I1) Migration 0050 — practice_memos scope-metadata floor
-- =============================================================================
-- ADDITIVE ONLY. Four columns on practice_memos. Auto-applies via the pre-deploy runner
-- (additive allowlist); idempotent (ADD COLUMN IF NOT EXISTS). NO data backfill of NULLs, NO
-- behavior change while KB_BACKBONE_ENABLED is OFF. Lands the minimal-floor scope-metadata fields
-- that are cheap now and impossible to retrofit (KNOWLEDGE-BACKBONE-PHASE2 disposition §6).
--
-- documentType       — VARCHAR(64) NULL. Scope tag: the document type this knowledge applies to. A v1
--                      input to a FUTURE auto-apply scope gate (I3); stored only this increment.
-- riskLevel          — VARCHAR(16) NULL. Scope tag: 'low' | 'medium' | 'high' (validated at the Zod Wall;
--                      stored as varchar, no DB ENUM, to accrete values without a MODIFY-ENUM re-run burden).
-- autoApplyEligible  — BOOLEAN NOT NULL DEFAULT FALSE. The default IS the backfill (no UPDATE statement), so
--                      every existing row is FALSE. Flipped true ONLY for an abstracted + firm-wide (graduated)
--                      entry at the app layer; raw decision-stream entries never auto-apply (disposition D3).
-- conflictsHook      — JSON NULL. Origin-matter conflict metadata captured at graduation (disposition D2);
--                      store-only this increment (no conflicts logic runs in I1).
--
-- NOTE: jurisdiction + practiceArea + originMatterId already exist on practice_memos (the rest of the v1
--   scope-metadata floor + the origin-matter tag) — no migration needed for those.
-- -----------------------------------------------------------------------------

ALTER TABLE `practice_memos`
  ADD COLUMN IF NOT EXISTS `documentType`      VARCHAR(64) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `riskLevel`         VARCHAR(16) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `autoApplyEligible` BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS `conflictsHook`     JSON        NULL DEFAULT NULL;
