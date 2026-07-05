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

import { getModelCapability } from './modelCapabilities.js';

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
// REVIEWER-MODEL-VALIDATION-FIX-1 (2026-06-15): refreshed off the stale pre-modernization ids
// (openai:gpt-5 / google:gemini-2.5-pro / xai:grok-4) to the current GA ids, so the drafter/evaluator
// whitelist is no longer contradictory with the modernized reviewer tracks. The drafter/evaluator
// default to anthropic:claude-opus-4-5 (kept first so the WhitelistedModel type still covers the default).
export const WHITELISTED_MODELS = [
  'anthropic:claude-opus-4-5', // default for drafter and evaluator (decision #41)
  'anthropic:claude-sonnet-4-5',
  'openai:gpt-5.5',
  'google:gemini-3.1-pro-preview', // PREVIEW-TIER — UNCALIBRATED-until-rerun (W5); perpetually swap-eligible
  'xai:grok-4.3',
] as const;

export type WhitelistedModel = (typeof WHITELISTED_MODELS)[number];

// ============================================================
// Reviewer model identifiers (Ch 22.3a)
// These are the four reviewer adapters implemented in v1.
//
// REVIEWER-MODEL-MODERNIZATION-1 (2026-06-15): the reviewer tracks were modernized to the current GA
// flagship ids (operator-confirmed, verified against provider docs). This is REVIEWER-SCOPED ONLY — the
// drafter (draft_generation), copilot-primary (chat_primary), and lite generation read
// PRIMARY_DRAFTER_MODEL / LITE_GENERATION_MODEL (anthropic by default), NOT these constants, so client-
// facing drafting/copilot models are unaffected. Claude was later modernized too (CLAUDE-LANE-MODERNIZATION-1,
// the claude / claude_lite pins below). NOTE: Google currently has no
// GA Gemini "Pro" — gemini-3.1-pro-preview is the recommended Pro slug (preview-tier; operator-accepted).
// Each id below has a matching entry in modelCapabilities.ts (Gemini keeps its calibrated 32768 ceiling).
// ============================================================
// REVIEWER-MODEL-VALIDATION-FIX-1: the three modernized full-reviewer slugs below are
// OPERATOR-PENDING-PROVIDER-CONFIRMATION — they have MODEL_CAPABILITIES entries (so they pass boot
// validation and resolve a calibrated ceiling) but have NOT been verified against live provider model
// lists. A wrong slug now fails fast at BOOT (validateReviewerModels) instead of at a user's review,
// but code cannot prove a slug is real — the operator must confirm gpt-5.5 / gemini-3.1-pro-preview /
// grok-4.3 against provider docs.
export const REVIEWER_MODELS = {
  // CLAUDE-LANE-MODERNIZATION-1 (2026-07-04): opus-4-5 -> opus-4-8 (operator's current daily-driver
  // Claude). Slug confirmed LIVE against the Anthropic Models API before pinning (GET /v1/models/
  // claude-opus-4-8 -> 200: "Claude Opus 4.8", 1M ctx / 128K out). The adapter sends only
  // {model, max_tokens, system, messages} (no temperature / thinking / prefill) — exactly the request
  // surface opus-4-8 accepts — so no adapter change is needed. G.3: rerun the calibration grid on swap.
  claude: 'anthropic:claude-opus-4-8',
  gpt: 'openai:gpt-5.5', // operator-pending-provider-confirmation
  gemini: 'google:gemini-3.1-pro-preview', // operator-pending-provider-confirmation (PREVIEW-TIER — UNCALIBRATED-until-rerun; see isPreviewTierModel + docs/engagements/ULTRABUILD-1-model-pin-memo.md)
  grok: 'xai:grok-4.3', // operator-pending-provider-confirmation
} as const;

export type ReviewerKey = keyof typeof REVIEWER_MODELS;

/**
 * W5 (ULTRABUILD-1 / audit A-6, Top-5 #5) — is a model id a PREVIEW-tier slug? Preview endpoints are
 * perpetually swap-eligible: a provider can deprecate/replace a `*-preview` slug with NO explicit swap event to
 * trigger the model-swap⇒recalibrate rule, and its reviewer calibration is UNCALIBRATED-until-rerun (the
 * ceiling was carried over unmeasured — see modelCapabilities.ts). Derived from the id string (single source of
 * truth — no second registry to drift) so `google:gemini-3.1-pro-preview` flags true while GA slugs like
 * `google:gemini-3.5-flash` correctly do not. Pure; used by governance/telemetry, not by any routing decision.
 */
export function isPreviewTierModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('-preview');
}

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

// REVIEWER-MODEL-MODERNIZATION-1: lite tier modernized to current GA ids (env overrides preserved).
// claude_lite modernized sonnet-4-5 -> sonnet-5 (CLAUDE-LANE-MODERNIZATION-1, live-confirmed;
// env override preserved). grok-3-mini was RETIRED with no GA Grok "mini", so the lite Grok track reuses
// the fast GA flagship grok-4.3 (deliberate operator choice — the full and lite Grok ids are intentionally
// the same until a distinct GA Grok mini exists).
// REVIEWER-MODEL-VALIDATION-FIX-1 (CR-2): the gpt_lite DEFAULT was 'openai:gpt-5.4-mini', an
// unverified/unavailable slug that 404'd on every GPT-Lite review (confirmed live 2026-06-15). Pinned
// to 'openai:gpt-4.1-mini' — a known-good, already-registered lite id (also the LITE_GENERATION
// default). The LITE_OPENAI_REVIEWER_MODEL env override is PRESERVED, so an operator can still point it
// elsewhere (the prod mitigation set it to openai:gpt-4.1-mini; this makes that the durable default).
// gemini_lite ('gemini-3.5-flash') and grok_lite ('grok-4.3') remain OPERATOR-PENDING-PROVIDER-
// CONFIRMATION — registered (boot-valid) but not verified against live provider docs.
export const LITE_REVIEWER_MODELS = {
  claude_lite: resolveLiteModel('LITE_ANTHROPIC_REVIEWER_MODEL', 'anthropic:claude-sonnet-5'), // CLAUDE-LANE-MODERNIZATION-1: sonnet-4-5 -> sonnet-5 (live-confirmed)
  gpt_lite: resolveLiteModel('LITE_OPENAI_REVIEWER_MODEL', 'openai:gpt-4.1-mini'),
  gemini_lite: resolveLiteModel('LITE_GOOGLE_REVIEWER_MODEL', 'google:gemini-3.5-flash'), // operator-pending-provider-confirmation
  grok_lite: resolveLiteModel('LITE_XAI_REVIEWER_MODEL', 'xai:grok-4.3'), // operator-pending-provider-confirmation
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

  // REVIEWER-MODEL-VALIDATION-FIX-1 (CR-1): validate the reviewer + lite-reviewer ids at boot.
  validateReviewerModels(REVIEWER_MODELS, LITE_REVIEWER_MODELS);
}

/**
 * REVIEWER-MODEL-VALIDATION-FIX-1 (CR-1): assert that every reviewer + lite-reviewer model id is a
 * RECOGNIZED model — i.e. has an entry in MODEL_CAPABILITIES (modelCapabilities.ts is the single
 * source of model truth, already consumed by the reviewer dispatch for the per-model ceiling). The
 * maps passed in are the RESOLVED values: LITE_REVIEWER_MODELS has its env overrides (LITE_*_REVIEWER_
 * MODEL) applied at module load, so this checks the post-override ids. Before this, validateLlmConfig
 * checked ONLY the drafter + evaluator, so a typo'd / retired / unregistered reviewer id deployed
 * clean and failed only at a user's review (e.g. gpt_lite='openai:gpt-5.4-mini' 404'ing every call,
 * 2026-06-15), leaving the session wedged. Now such an id throws LOUDLY at BOOT, naming the offending
 * key + id, before the server accepts connections. (This validates STRUCTURE — that the id is known —
 * not that a provider actually serves the slug; a registered-but-unverified slug, see the operator-
 * pending-provider-confirmation comments above, still requires operator confirmation against provider
 * docs. No secrets are read or logged here.)
 */
export function validateReviewerModels(
  reviewerModels: Record<string, string>,
  liteReviewerModels: Record<string, string>,
): void {
  const entries: Array<[string, string]> = [
    ...Object.entries(reviewerModels),
    ...Object.entries(liteReviewerModels),
  ];
  for (const [key, modelString] of entries) {
    if (!getModelCapability(modelString)) {
      throw new Error(
        `Invalid reviewer model for "${key}": "${modelString}" is not a recognized model id ` +
          `(no MODEL_CAPABILITIES entry in modelCapabilities.ts). Correct the id or its env override, ` +
          `or register the model in modelCapabilities.ts before deploying.`,
      );
    }
  }
}

// ============================================================
// Reviewer-lane latency tuning (REVIEWER-LATENCY-1 Step 2a)
// ============================================================
// Per-role, per-provider request-side speed knobs for the reviewer lane ONLY. Flag-gated
// (REVIEWER_LATENCY_TUNING_ENABLED, default OFF) — when the flag is OFF this resolver returns
// null and the adapters add nothing, so every request stays byte-identical to today.
//
// Scope (Step 2a): jobType 'reviewer_feedback' on the active full GPT reviewer only. The drafter, the
// evaluator, the lite/other reviewer models, and every non-OpenAI provider resolve to null → unchanged.
//
// REVIEWER-MODEL-VALIDATION-FIX-1 (HI-1): the tuned model id is no longer a single hardcoded string
// (which silently no-op'd when REVIEWER-MODEL-MODERNIZATION-1 moved the GPT reviewer gpt-5 -> gpt-5.5,
// reintroducing the latency/timeout risk this tuning was built to prevent). It now tracks
// REVIEWER_MODELS.gpt (the active full GPT reviewer) AND keeps the legacy 'openai:gpt-5' so historical
// gpt-5 jobs still tune. The lite GPT reviewer (gpt-5.4-mini) is intentionally excluded — same scope
// as Step 2a (full GPT reviewer only).
//
// API surface: the OpenAI adapter uses the Chat Completions API (/v1/chat/completions). There,
// reasoning_effort and service_tier are BOTH top-level request fields (NOT the Responses-API
// `reasoning: { effort }` nesting). Values are env-overridable without a code change (a Railway
// env edit + restart) so the effort/tier can be retuned from measurement without a redeploy.

import { isReviewerLatencyTuningEnabled, isGpt5ReasoningCapEnabled } from '../config/featureFlags.js';

export interface ReviewerLatencyTuning {
  /** OpenAI Chat Completions top-level `reasoning_effort` (gpt-5/o-series): minimal|low|medium|high. */
  reasoningEffort?: string;
  /** OpenAI Chat Completions top-level `service_tier`: auto|default|flex|priority. */
  serviceTier?: string;
}

/**
 * The GPT reviewer model strings this tuning targets. Tracks REVIEWER_MODELS.gpt (the active full GPT
 * reviewer — currently openai:gpt-5.5) so a future model modernization carries the tuning with it
 * instead of silently no-op'ing (HI-1), plus the legacy 'openai:gpt-5' for historical jobs. The lite
 * GPT reviewer is deliberately NOT included.
 */
const TUNED_REVIEWER_MODELS = new Set<string>([REVIEWER_MODELS.gpt, 'openai:gpt-5']);

function envOr(envVar: string, fallback: string): string {
  const v = process.env[envVar];
  if (v && v.trim().length > 0) return v.trim();
  return fallback;
}

/**
 * Resolve the reviewer-lane latency tuning for a dispatch, or null when nothing should change.
 * Returns non-null ONLY when: the flag is ON, the job is a reviewer_feedback job, and the model is the
 * active full GPT reviewer (REVIEWER_MODELS.gpt) or the legacy openai:gpt-5. Any other (jobType, model)
 * — including the drafter, the evaluator, the lite GPT reviewer, and every other provider/model —
 * resolves to null, so the caller adds no request params and the request is byte-identical to today.
 * Env overrides: REVIEWER_GPT5_REASONING_EFFORT, REVIEWER_GPT5_SERVICE_TIER.
 */
export function resolveReviewerLatencyTuning(
  jobType: string,
  modelString: string,
): ReviewerLatencyTuning | null {
  if (!isReviewerLatencyTuningEnabled()) return null;
  if (jobType !== 'reviewer_feedback') return null;
  if (!TUNED_REVIEWER_MODELS.has(modelString)) return null;
  return {
    reasoningEffort: envOr('REVIEWER_GPT5_REASONING_EFFORT', 'low'),
    serviceTier: envOr('REVIEWER_GPT5_SERVICE_TIER', 'priority'),
  };
}

/**
 * GPT5-REASONING-CAP-1: a bounded reasoning_effort for the GPT-5 reviewer lane as TRUNCATION insurance,
 * DECOUPLED from REVIEWER_LATENCY_TUNING_ENABLED. Returns { reasoningEffort } ONLY when
 * GPT5_REASONING_CAP_ENABLED is on, for a reviewer_feedback job on the active full GPT reviewer (the SAME
 * TUNED_REVIEWER_MODELS scope as the latency tuning); null otherwise. The caller uses it as a FALLBACK after
 * resolveReviewerLatencyTuning, so when latency tuning already supplies reasoning_effort the cap is inert
 * (no double-set). Env override: GPT5_REASONING_CAP_EFFORT (default "low" — bounds reasoning enough to leave
 * the visible answer room within the 16384 ceiling without gutting review depth).
 */
export function resolveReviewerReasoningCap(
  jobType: string,
  modelString: string,
): { reasoningEffort: string } | null {
  if (!isGpt5ReasoningCapEnabled()) return null;
  if (jobType !== 'reviewer_feedback') return null;
  if (!TUNED_REVIEWER_MODELS.has(modelString)) return null;
  return { reasoningEffort: envOr('GPT5_REASONING_CAP_EFFORT', 'low') };
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
