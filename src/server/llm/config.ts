/**
 * LLM Infrastructure Configuration (Ch 22.3, Ch 22.4)
 *
 * This module centralizes all LLM configuration:
 *   - Model whitelist for drafter and evaluator roles
 *   - PRIMARY_DRAFTER_MODEL and EVALUATOR_MODEL env-var parsing
 *   - LLM_FETCH_TIMEOUT_MS constant
 *   - Provider-to-model routing helpers
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
  'google:gemini-2-5-pro',
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
  gemini: 'google:gemini-2-5-pro',
  grok: 'xai:grok-4',
} as const;

export type ReviewerKey = keyof typeof REVIEWER_MODELS;

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
