-- ULTRABUILD-1 W3c — deed provenance field (documents.provenance).
--
-- ONE ADDITIVE column on `documents`. Closes the LIVE-9 export-scanner residual: a legacy documentType='deed'
-- produced by the generic LLM before LIVE-9 shipped could not be distinguished from the deterministic agent's
-- output at export. `provenance` records the origin ('agent_assembled' | 'llm_authored'); the export scanner
-- treats only ('deed' AND provenance='agent_assembled') as sanctioned and routes everything else through the
-- fail-closed deed-operative-language scan. Durable + artifact-level (survives versioning) — mirrors the
-- drewOnUnverifiedKb precedent (migration 0009).
--
-- Nullable, no default: NULL = unknown/legacy, which the scanner treats as NON-sanctioned (fail-closed). NO
-- existing table altered beyond this column; NO DB FK; back-compatible (the Zod Wall field is .nullable()
-- .optional() so pre-migration reads still parse).
--
-- NOT on the apply-prod-migrations.mjs auto-apply allowlist — operator-applied out-of-band at deploy
-- (DEPLOY-MIGRATIONS-NOT-AUTOMATIC), sequenced AFTER W1's 0051.
--
-- OPERATOR PRECONDITION (over-block hazard): once the code that tightens the export scanner is live, ANY
-- existing documentType='deed' row with a NULL provenance is treated as non-sanctioned and (because a deed
-- contains operative language) is blocked from export until recreated through the agent — the deliberate
-- LIVE-9 over-block posture. The deed agent is flag-dark and nothing is client-facing, so the blast radius is
-- limited to the operator's own UAT deeds. If any pre-existing 'deed' rows are known-good agent output, a
-- one-time operator backfill is required BEFORE relying on export:
--   UPDATE documents SET provenance='agent_assembled' WHERE documentType='deed' AND provenance IS NULL;
-- (Run ONLY after confirming those rows are all agent-assembled.)

ALTER TABLE `documents`
  ADD COLUMN IF NOT EXISTS `provenance` VARCHAR(32) NULL DEFAULT NULL;
