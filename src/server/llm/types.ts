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
  | 'parse_error'
  | 'revert_failed'
  | 'other';

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
    if (err.message.includes('API') || err.message.includes('HTTP')) return 'api_error';
  }
  return 'other';
}
