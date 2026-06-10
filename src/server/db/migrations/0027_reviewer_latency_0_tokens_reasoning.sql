-- =============================================================================
-- REVIEWER-LATENCY-1 Step 0 Migration 0027 — jobs.tokensReasoning
-- =============================================================================
-- ADDITIVE ONLY. One additive, nullable column on the existing `jobs` table (defaulted NULL, so
-- every existing row stays valid). Auto-applies via the pre-deploy runner (additive allowlist);
-- idempotent (ADD COLUMN IF NOT EXISTS). No existing column is altered; no request to any provider
-- changes — this is persistence-only.
--
-- jobs.tokensReasoning — the provider-reported reasoning/thinking token count for the job's LLM call,
--   stored AS-REPORTED (no normalization). Per-provider semantics differ and are documented at the
--   write site (queries/jobs.ts markJobCompleted) and schema.ts:
--     - OpenAI : usage.completion_tokens_details.reasoning_tokens — a SUBSET of tokensCompletion
--                (reasoning is counted inside completion_tokens).
--     - Gemini : usageMetadata.thoughtsTokenCount — SEPARATE from tokensCompletion
--                (candidatesTokenCount excludes it).
--     - xAI    : best-effort completion_tokens_details.reasoning_tokens as currently captured.
--     - Anthropic : not captured today -> NULL (no extended-thinking config / request change added).
--   NULL = not reported for this provider/model (the cross-provider default), distinct from 0.
-- -----------------------------------------------------------------------------

ALTER TABLE `jobs`
  ADD COLUMN IF NOT EXISTS `tokensReasoning` INT NULL DEFAULT NULL;
