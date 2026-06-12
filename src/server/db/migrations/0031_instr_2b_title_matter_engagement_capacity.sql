-- =============================================================================
-- INSTR-2B-title Migration — matters.engagementCapacity (capacity election)
-- =============================================================================
-- ADDITIVE ONLY. Adds matters.engagementCapacity — the firm capacity this matter is handled in:
-- 'law_firm' (representation; the safe default) vs 'title_settlement_agent' (non-representational
-- settlement-agent / title-decision-maker). Default 'law_firm' so every existing row is the safe
-- default and stays valid. No existing column is dropped or retyped destructively. Idempotent
-- (ADD COLUMN IF NOT EXISTS). Applied OUT-OF-BAND / via the Rule-18 additive pre-deploy runner
-- (this file is on the runner's allowlist in scripts/apply-prod-migrations.mjs). TiDB-compatible MySQL.
--
-- Routing impact (INSTR-2B-title, behind MASTER_LAWFIRM_ENABLED, default OFF): a drafting job on a
-- matter whose engagementCapacity == 'title_settlement_agent' composes master/claude/title; every
-- other value (incl. the 'law_firm' default) keeps the INSTR-2B-core routing (te / lawfirm / legacy).
-- The Title master is reachable ONLY through this affirmative election — never from paKey alone.
-- -----------------------------------------------------------------------------

ALTER TABLE `matters`
  ADD COLUMN IF NOT EXISTS `engagementCapacity` ENUM('law_firm','title_settlement_agent') NOT NULL DEFAULT 'law_firm';
