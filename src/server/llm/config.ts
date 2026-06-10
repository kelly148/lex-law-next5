/**
 * LLM Infrastructure Configuration (Ch 22.3, Ch 22.4)
 *
 * This module centralizes all LLM configuration:
 *   - Model whitelist for drafter and evaluator roles
 *   - PRIMARY_DRAFTER_MODEL and EVALUATOR_MODEL env-var parsing
 *   - LLM_FETCH_TIMEOUT_MS constant
 *   - Provider-to-model routing helpers
 *   - MR-LLM-LITE-1: Lite reviewer model IDs and generation model mode resolution
 *
 * STARTUP VALIDATION:
 *   Setting PRIMARY_DRAFTER_MODEL or EVALUATOR_MODEL to a non-whitelisted
 *   value produces a startup error (Ch 22.3). This is enforced in
 *   validateLlmConfig() called from server/index.ts.
 *
 * MISSING API KEYS:
 *   A missing API key for a provider is NOT a startup error (Ch 22.3 / decision #43).
 *   It becomes a runtime error only if that provider is actually invoked.
 *   This supports deploy scenarios where e.g. Grok's key is not yet configured.
 */

// ============================================================
// Timeout constant (Ch 22.4)
// Every LLM fetch uses AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS).
// The constant lives here and is imported by every call site.
// No call site hardcodes its own timeout.
// ============================================================
const DEFAULT_LLM_FETCH_TIMEOUT_MS = 120_000; // 120 seconds

let _testTimeoutOverride: number | null = null;

/** Override the LLM fetch timeout for tests. Pass null to restore the default. */
export function setTestLlmTimeoutMs(ms: number | null): void {
  _testTimeoutOverride = ms;
}

export function getLlmFetchTimeoutMs(): number {
  return _testTimeoutOverride ?? DEFAULT_LLM_FETCH_TIMEOUT_MS;
}

/** @deprecated Use getLlmFetchTimeoutMs() in new code. Kept for backward compat. */
export const LLM_FETCH_TIMEOUT_MS = DEFAULT_LLM_FETCH_TIMEOUT_MS;

// ============================================================
// Model whitelist (Ch 22.3)
// Adding a new model requires adding the corresponding provider
// capability to the provider module AND updating this list.
// ============================================================
export const WHITELISTED_MODELS = [
  'anthropic:claude-opus-4-5', // default for drafter and evaluator (decision #41)
  'anthropic:claude-sonnet-4-5',
  'openai:gpt-5',
  'google:gemini-2.5-pro',
  'xai:grok-4',
] as const;

export type WhitelistedModel = (typeof WHITELISTED_MODELS)[number];

// ============================================================
// Reviewer model identifiers (Ch 22.3a)
// These are the four reviewer adapters implemented in v1.
// ============================================================
export const REVIEWER_MODELS = {
  claude: 'anthropic:claude-opus-4-5',
  gpt: 'openai:gpt-5',
  gemini: 'google:gemini-2.5-pro',
  grok: 'xai:grok-4',
} as const;

export type ReviewerKey = keyof typeof REVIEWER_MODELS;

// ============================================================
// Lite reviewer model identifiers (MR-LLM-LITE-1)
// Each Lite key maps to the same provider adapter as its full
// counterpart but uses a lighter model ID.
// Env vars allow operator override; safe defaults are provided.
// ============================================================

function resolveLiteModel(envVar: string, defaultModel: string): string {
  const v = process.env[envVar];
  if (v && v.trim().length > 0) return v.trim();
  return defaultModel;
}

export const LITE_REVIEWER_MODELS = {
  claude_lite: resolveLiteModel('LITE_ANTHROPIC_REVIEWER_MODEL', 'anthropic:claude-sonnet-4-5'),
  gpt_lite: resolveLiteModel('LITE_OPENAI_REVIEWER_MODEL', 'openai:gpt-4.1-mini'),
  gemini_lite: resolveLiteModel('LITE_GOOGLE_REVIEWER_MODEL', 'google:gemini-2.5-flash'),
  grok_lite: resolveLiteModel('LITE_XAI_REVIEWER_MODEL', 'xai:grok-3-mini'),
} as const;

export type LiteReviewerKey = keyof typeof LITE_REVIEWER_MODELS;

/** All valid reviewer keys — full and Lite combined. */
export type AnyReviewerKey = ReviewerKey | LiteReviewerKey;

/**
 * Resolve a reviewer key (full or Lite) to its model string.
 * Returns undefined if the key is not recognized.
 */
export function resolveReviewerModel(key: string): string | undefined {
  if (key in REVIEWER_MODELS) return REVIEWER_MODELS[key as ReviewerKey];
  if (key in LITE_REVIEWER_MODELS) return LITE_REVIEWER_MODELS[key as LiteReviewerKey];
  return undefined;
}

// ============================================================
// Reviewer human-readable titles (MR-1 S3c, MR-LLM-LITE-1)
// Server-local mapping; do not import client-side REVIEWER_LABELS.
// ============================================================
export const REVIEWER_TITLES: Record<AnyReviewerKey, string> = {
  claude: 'Claude',
  gpt: 'GPT',
  gemini: 'Gemini',
  grok: 'Grok',
  claude_lite: 'Claude Lite',
  gpt_lite: 'GPT Lite',
  gemini_lite: 'Gemini Lite',
  grok_lite: 'Grok Lite',
} as const;

// ============================================================
// Generation model mode (MR-LLM-LITE-1)
// 'full' uses PRIMARY_DRAFTER_MODEL (unchanged).
// 'lite' uses LITE_GENERATION_MODEL resolved from env.
// ============================================================

export type GenerationModelMode = 'full' | 'lite';

export const LITE_GENERATION_MODEL = resolveLiteModel(
  'LITE_OPENAI_GENERATE_MODEL',
  'openai:gpt-4.1-mini',
);

/**
 * Resolve the generation model string for the given mode.
 * 'full' → PRIMARY_DRAFTER_MODEL (resolved at startup).
 * 'lite' → LITE_GENERATION_MODEL (resolved at startup).
 */
export function resolveGenerationModel(mode: GenerationModelMode, fullModel: string): string {
  if (mode === 'lite') return LITE_GENERATION_MODEL;
  return fullModel;
}

// ============================================================
// Drafter and evaluator model resolution (Ch 22.3)
// Read once at server startup and cached.
// ============================================================

function resolveModel(envVar: string, defaultModel: WhitelistedModel): string {
  const v = process.env[envVar];
  if (v && v.trim().length > 0) return v.trim();
  return defaultModel;
}

export const PRIMARY_DRAFTER_MODEL = resolveModel(
  'PRIMARY_DRAFTER_MODEL',
  'anthropic:claude-opus-4-5',
);

export const EVALUATOR_MODEL = resolveModel(
  'EVALUATOR_MODEL',
  'anthropic:claude-opus-4-5',
);

// ============================================================
// Startup validation
// Called from server/index.ts before accepting connections.
// ============================================================

export function validateLlmConfig(): void {
  const whitelistSet = new Set<string>(WHITELISTED_MODELS);

  if (!whitelistSet.has(PRIMARY_DRAFTER_MODEL)) {
    throw new Error(
      `Invalid PRIMARY_DRAFTER_MODEL="${PRIMARY_DRAFTER_MODEL}". ` +
        `Must be one of: ${WHITELISTED_MODELS.join(', ')}`,
    );
  }

  if (!whitelistSet.has(EVALUATOR_MODEL)) {
    throw new Error(
      `Invalid EVALUATOR_MODEL="${EVALUATOR_MODEL}". ` +
        `Must be one of: ${WHITELISTED_MODELS.join(', ')}`,
    );
  }
}

// ============================================================
// Reviewer-lane latency tuning (REVIEWER-LATENCY-1 Step 2a)
// ============================================================
// Per-role, per-provider request-side speed knobs for the reviewer lane ONLY. Flag-gated
// (REVIEWER_LATENCY_TUNING_ENABLED, default OFF) — when the flag is OFF this resolver returns
// null and the adapters add nothing, so every request stays byte-identical to today.
//
// Scope (Step 2a): jobType 'reviewer_feedback' on openai:gpt-5 only. The drafter, the evaluator,
// the lite/other reviewer models, and every non-OpenAI provider resolve to null → unchanged.
//
// API surface: the OpenAI adapter uses the Chat Completions API (/v1/chat/completions). There,
// reasoning_effort and service_tier are BOTH top-level request fields (NOT the Responses-API
// `reasoning: { effort }` nesting). Values are env-overridable without a code change (a Railway
// env edit + restart) so the effort/tier can be retuned from measurement without a redeploy.

import { isReviewerLatencyTuningEnabled } from '../config/featureFlags.js';

export interface ReviewerLatencyTuning {
  /** OpenAI Chat Completions top-level `reasoning_effort` (gpt-5/o-series): minimal|low|medium|high. */
  reasoningEffort?: string;
  /** OpenAI Chat Completions top-level `service_tier`: auto|default|flex|priority. */
  serviceTier?: string;
}

/** The gpt-5 reviewer model string this tuning targets in Step 2a. */
const TUNED_REVIEWER_MODEL = 'openai:gpt-5';

function envOr(envVar: string, fallback: string): string {
  const v = process.env[envVar];
  if (v && v.trim().length > 0) return v.trim();
  return fallback;
}

/**
 * Resolve the reviewer-lane latency tuning for a dispatch, or null when nothing should change.
 * Returns non-null ONLY when: the flag is ON, the job is a reviewer_feedback job, and the model is
 * openai:gpt-5. Any other (jobType, model) — including the drafter, the evaluator, and every other
 * provider/model — resolves to null, so the caller adds no request params and the request is
 * byte-identical to today. Env overrides: REVIEWER_GPT5_REASONING_EFFORT, REVIEWER_GPT5_SERVICE_TIER.
 */
export function resolveReviewerLatencyTuning(
  jobType: string,
  modelString: string,
): ReviewerLatencyTuning | null {
  if (!isReviewerLatencyTuningEnabled()) return null;
  if (jobType !== 'reviewer_feedback') return null;
  if (modelString !== TUNED_REVIEWER_MODEL) return null;
  return {
    reasoningEffort: envOr('REVIEWER_GPT5_REASONING_EFFORT', 'low'),
    serviceTier: envOr('REVIEWER_GPT5_SERVICE_TIER', 'priority'),
  };
}

// ============================================================
// Model string parsing helpers
// ============================================================

export interface ParsedModelId {
  providerId: string;
  modelId: string;
}

/**
 * Parse a "provider:model" string into its components.
 * e.g. "anthropic:claude-opus-4-5" → { providerId: "anthropic", modelId: "claude-opus-4-5" }
 */
export function parseModelString(modelString: string): ParsedModelId {
  const colonIdx = modelString.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(
      `Invalid model string "${modelString}". Expected format: "provider:model"`,
    );
  }
  return {
    providerId: modelString.slice(0, colonIdx),
    modelId: modelString.slice(colonIdx + 1),
  };
}
