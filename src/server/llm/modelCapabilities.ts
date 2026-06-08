/**
 * GEMINI-BUDGET-CALIBRATION-1 — Increment 2: additive model-capability registry.
 *
 * The single source of truth for per-model reviewer ceilings + capability metadata. Replaces the
 * scattered hardcoded `maxTokens: 16384` (never a global number again) with a per-model lookup.
 *
 * reviewerCeiling is set from the Increment-1 measured demand curves (52k anonymized lease + the
 * synthetic large-provision fixture):
 *   - google:gemini-2.5-pro  -> 32768 : real-lease demand ~10.5k (of which ~58% is invisible
 *       thoughtsTokenCount), and it TRUNCATES on high-output-volume docs at 16384. The raise buys
 *       headroom on the output-bound axis; Gemini only consumes what it needs, so cost rises only
 *       when it would otherwise truncate.
 *   - anthropic:claude-opus-4-5 -> 16384 (HOLD) : never truncated in measurement; a bigger budget
 *       only inflated emitted output ~+49% (16384->32768) with no truncation to prevent.
 *   - openai:gpt-5 -> 16384 (HOLD) : NOT a budget lever — big-doc GPT-5's binding constraint is
 *       LATENCY, not output budget (see timeoutClass 'extended' + REVIEWER-ASYNC-FANOUT-1). Raising
 *       the ceiling does nothing for the failure mode.
 *   - xai:grok-4 -> 16384 (HOLD) : under-produces (used <1.2k of 16384); budget is not its lever.
 *   - lite models + any unmeasured model -> 16384 (the established floor) : no measured justification
 *       to change; a future calibration can raise a specific model from its own demand curve.
 *
 * Wired in Increment 2: reviewerCeiling (consumed by the reviewer dispatch). The remaining fields
 * are forward-looking metadata for later increments (L2 escalation provider-capping; the deferred
 * L3 reasoning-control; the Increment-5 cost breaker) and are NOT enforced here. providerMaxOutputTokens
 * are conservative known limits — confirm against provider docs when L2 actually provider-caps.
 */

export interface ModelCapability {
  /** Conservative known provider hard ceiling for output tokens (metadata; not enforced in Inc-2). */
  providerMaxOutputTokens: number;
  /** The calibrated reviewer output budget for this model (WIRED — consumed by the reviewer dispatch). */
  reviewerCeiling: number;
  /** Whether the model exposes a reasoning/thinking control (OpenAI reasoning_effort / Gemini thinkingBudget). */
  supportsThinkingControl: boolean;
  /** The model's default reasoning posture when unconfigured. */
  defaultThinkingMode: 'none' | 'default' | 'dynamic';
  /** Rough cost tier (for the Increment-5 per-session cost breaker; not enforced here). */
  pricingClass: 'premium' | 'standard' | 'lite';
  /**
   * Latency tier: 'standard' returns within the sync reviewer envelope; 'extended' may exceed it on
   * large reasoning-demand docs and belongs in the async/background lane (REVIEWER-ASYNC-FANOUT-1).
   */
  timeoutClass: 'standard' | 'extended';
}

/** The established floor + safe default for any model without a measured calibration. */
export const DEFAULT_REVIEWER_CEILING = 16384;

/**
 * Per-model capability registry, keyed by the "provider:model" string. Lite entries use the DEFAULT
 * lite model strings (config.ts LITE_REVIEWER_MODELS); an operator env-override to a different model
 * is not registered here and resolves to DEFAULT_REVIEWER_CEILING — the safe floor.
 */
export const MODEL_CAPABILITIES: Readonly<Record<string, ModelCapability>> = {
  'openai:gpt-5': {
    providerMaxOutputTokens: 128000,
    reviewerCeiling: 16384, // HOLD — latency-bound, not budget-bound (see timeoutClass 'extended')
    supportsThinkingControl: true, // reasoning_effort
    defaultThinkingMode: 'default',
    pricingClass: 'premium',
    timeoutClass: 'extended', // big-doc GPT-5 exceeds the sync envelope -> async lane
  },
  'anthropic:claude-opus-4-5': {
    providerMaxOutputTokens: 32000,
    reviewerCeiling: 16384, // HOLD — never truncates; bigger budget only inflates output
    supportsThinkingControl: false, // adapter does not configure extended-thinking; temperature dropped
    defaultThinkingMode: 'default',
    pricingClass: 'premium',
    timeoutClass: 'standard', // ~2.5 min on the 52k lease — in-window
  },
  'google:gemini-2.5-pro': {
    providerMaxOutputTokens: 65536,
    reviewerCeiling: 32768, // RAISED from the measured demand curve (truncates on high-output volume)
    supportsThinkingControl: true, // thinkingBudget
    defaultThinkingMode: 'dynamic',
    pricingClass: 'standard',
    timeoutClass: 'standard',
  },
  'xai:grok-4': {
    providerMaxOutputTokens: 32000,
    reviewerCeiling: 16384, // HOLD — under-produces; budget is not its lever
    supportsThinkingControl: false,
    defaultThinkingMode: 'default',
    pricingClass: 'standard',
    timeoutClass: 'standard',
  },
  // Lite models (default strings; unmeasured — held at the floor).
  'anthropic:claude-sonnet-4-5': {
    providerMaxOutputTokens: 32000,
    reviewerCeiling: 16384,
    supportsThinkingControl: false,
    defaultThinkingMode: 'default',
    pricingClass: 'lite',
    timeoutClass: 'standard',
  },
  'openai:gpt-4.1-mini': {
    providerMaxOutputTokens: 32000,
    reviewerCeiling: 16384,
    supportsThinkingControl: false, // not a reasoning model; accepts temperature
    defaultThinkingMode: 'none',
    pricingClass: 'lite',
    timeoutClass: 'standard',
  },
  'google:gemini-2.5-flash': {
    providerMaxOutputTokens: 65536,
    reviewerCeiling: 16384, // unmeasured — held; raise from its own curve if it truncates in practice
    supportsThinkingControl: true,
    defaultThinkingMode: 'dynamic',
    pricingClass: 'lite',
    timeoutClass: 'standard',
  },
  'xai:grok-3-mini': {
    providerMaxOutputTokens: 32000,
    reviewerCeiling: 16384,
    supportsThinkingControl: true,
    defaultThinkingMode: 'default',
    pricingClass: 'lite',
    timeoutClass: 'standard',
  },
};

/** Look up a model's capability record, or undefined if unregistered. */
export function getModelCapability(modelString: string): ModelCapability | undefined {
  return MODEL_CAPABILITIES[modelString];
}

/**
 * The calibrated reviewer output budget (maxTokens) for a model. Unregistered models — including
 * any operator env-override of a lite model — resolve to DEFAULT_REVIEWER_CEILING (the safe floor),
 * so an unknown model never silently gets an aggressive budget.
 */
export function getReviewerCeiling(modelString: string): number {
  return MODEL_CAPABILITIES[modelString]?.reviewerCeiling ?? DEFAULT_REVIEWER_CEILING;
}
