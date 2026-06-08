/**
 * LLM Provider Interface (Ch 22.1)
 *
 * All four provider adapters implement this interface.
 * Provider-specific quirks are encapsulated inside the provider modules
 * and do not leak to callers.
 *
 * The abstraction is deliberately thin: it exposes the subset v1 uses
 * (chat-style prompting with optional structured output) and lets
 * provider-specific escape hatches be added via providerMetadata when needed.
 */

import type { ZodSchema } from 'zod';

// ============================================================
// Core interface
// ============================================================

export interface LlmGenerateParams {
  systemPrompt: string;
  userPrompt: string;
  /** Optional Zod schema for structured output validation (Ch 22.7) */
  structuredOutputSchema?: ZodSchema;
  maxTokens?: number;
  temperature?: number;
  /** AbortSignal for timeout handling (Ch 22.4) */
  signal: AbortSignal;
}

export interface LlmGenerateResult {
  /** Free-form text for drafter roles; parsed structured object for other roles */
  content: string | ParsedStructuredOutput;
  tokensPrompt: number;
  tokensCompletion: number;
  /**
   * GEMINI-BUDGET-CAL-1 (Increment 1, measurement): provider-reported reasoning/thinking
   * tokens for this call, where the provider exposes them as a separate count. Additive and
   * optional — undefined when the provider does not report a separate reasoning count
   * (Anthropic folds thinking into output_tokens and exposes no split). Token accounting is
   * PER-PROVIDER: for OpenAI/xAI the reasoning count is a SUBSET of tokensCompletion
   * (max_completion_tokens budget); for Gemini thoughtsTokenCount is SEPARATE from
   * candidatesTokenCount (both consume maxOutputTokens). See src/server/llm/tokenAccounting.ts
   * for the normalization that turns these raw counts into a comparable reasoning/output split.
   * This field is measurement-only: no runtime control flow reads it.
   */
  tokensReasoning?: number | undefined;
  /** Provider-specific metadata for debugging/audit */
  providerMetadata: Record<string, unknown>;
}

/** Structured output parsed and validated against the role's Zod schema (Ch 22.7) */
export type ParsedStructuredOutput = Record<string, unknown>;

export interface LlmClient {
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult>;
}

// ============================================================
// Provider identifiers
// ============================================================

export const PROVIDER_IDS = ['anthropic', 'openai', 'google', 'xai'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

// ============================================================
// Error taxonomy (Ch 22.6)
// Maps provider-specific errors to the canonical errorClass values
// stored in jobs.errorClass.
// ============================================================

export type JobErrorClass =
  | 'timeout'
  | 'api_error'
  // MODEL-RELIABILITY-UAT-1: finer-grained transient/auth differentiation. Additive —
  // jobs.errorClass is a varchar(64) (NOT a DB enum) and the telemetry job_failed.errorClass
  // field is a plain string, so adding values needs no migration and no schema change. The
  // only runtime consumers that switch on errorClass compare === 'timeout'; these new values
  // are inert for them and simply make 429 / auth distinguishable in logs and the failure
  // surface. Retry logic (canonicalMutation) treats rate_limited as transient and auth_error
  // as non-retryable.
  | 'rate_limited'
  | 'auth_error'
  | 'parse_error'
  | 'revert_failed'
  | 'other';

/**
 * Map a non-OK HTTP status from a provider response to the canonical errorClass.
 * MODEL-RELIABILITY-UAT-1: shared by all four adapters so 429 (rate limit) and
 * 401/403 (auth) are classified consistently rather than collapsing to api_error.
 *   - 429            → rate_limited (transient; retryable with backoff)
 *   - 401, 403       → auth_error   (NOT transient; never retried)
 *   - everything else→ api_error    (unchanged default, incl. 5xx and other 4xx)
 */
export function httpStatusToErrorClass(status: number): JobErrorClass {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth_error';
  return 'api_error';
}

export class LlmProviderError extends Error {
  public readonly errorClass: JobErrorClass;
  public override readonly cause?: unknown;

  constructor(
    errorClass: JobErrorClass,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmProviderError';
    this.errorClass = errorClass;
    this.cause = cause;
  }
}

/**
 * Classify an error thrown by a provider adapter into the canonical errorClass.
 * Used by the dispatcher to populate jobs.errorClass on failure.
 */
export function classifyProviderError(err: unknown): JobErrorClass {
  if (err instanceof LlmProviderError) return err.errorClass;
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'timeout';
    if (err.message.includes('parse') || err.message.includes('schema')) return 'parse_error';
    // MODEL-RELIABILITY-UAT-1: fallback differentiation for raw (non-LlmProviderError) errors.
    const lower = err.message.toLowerCase();
    if (/\b429\b/.test(err.message) || lower.includes('rate limit') || lower.includes('too many requests')) return 'rate_limited';
    if (/\b401\b/.test(err.message) || /\b403\b/.test(err.message) || lower.includes('unauthorized')) return 'auth_error';
    if (err.message.includes('API') || err.message.includes('HTTP')) return 'api_error';
  }
  return 'other';
}

// ============================================================
// REVIEWER-RETRY-SUPPRESS-1: request-level timeout vs. transient network blip
// ============================================================

/**
 * Undici (Node's global fetch) timeout cause codes. A SLOW response — headers/body/connect not
 * received within undici's internal window — surfaces as a generic `TypeError: fetch failed`
 * whose cause carries one of these codes. This is distinct from a genuinely transient network
 * blip (ECONNRESET, socket hang up) which may legitimately succeed on retry.
 */
const UNDICI_TIMEOUT_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * Detect a request-level TIMEOUT that surfaces as a generic `fetch failed` (undici's internal
 * headers/body/connect timeout), as opposed to a genuinely transient network error. A slow MODEL
 * whose headers/first byte exceed undici's window produces UND_ERR_HEADERS_TIMEOUT /
 * UND_ERR_BODY_TIMEOUT; re-running it at the same budget just times out again, so it must NOT be
 * transient-retried (REVIEWER-RETRY-SUPPRESS-1) — a big-doc GPT-5 review otherwise burns ~3x its
 * multi-minute wall clock on doomed reruns. Walks the error `cause` chain because the adapters
 * wrap the original fetch error as the LlmProviderError's cause (and undici nests its own cause).
 */
export function isUndiciTimeoutError(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 8 && cur != null && typeof cur === 'object'; depth += 1) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && UNDICI_TIMEOUT_CODES.has(code)) return true;
    const message = (cur as { message?: unknown }).message;
    if (typeof message === 'string' && /\b(headers? timeout|body timeout|connect timeout)\b/i.test(message)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
