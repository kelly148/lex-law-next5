/**
 * xAI Grok Provider Adapter (Ch 22.1, Ch 22.3a)
 *
 * Implements the LlmClient interface for xAI's Grok models.
 * Used for:
 *   - Reviewer role (grok reviewer adapter) — xai:grok-4
 *
 * API KEY:
 *   Read from XAI_API_KEY at invocation time, not at startup.
 *   Missing key is a runtime error only if this adapter is actually invoked.
 *
 * NOTE ON ENABLEMENT (decision #43):
 *   Grok is disabled by default at first-run seed (Ch 22.2a).
 *   The adapter is fully implemented and can be activated immediately
 *   by toggling reviewer enablement in Settings — no code change required.
 *   Per Kelly's note: Grok's quality has fluctuated; she wants to re-enable
 *   it when Grok 5 ships without waiting on a deploy.
 *
 * API COMPATIBILITY:
 *   xAI's API is OpenAI-compatible (same endpoint shape, same auth pattern).
 *   We use the xAI base URL with the same request/response types as the
 *   OpenAI adapter, but with xAI's API key and base URL.
 *
 * STRUCTURED OUTPUT:
 *   xAI supports JSON mode via response_format: { type: "json_object" }.
 *   When structuredOutputSchema is provided, we enable JSON mode and validate
 *   the response against the Zod schema (Ch 22.7).
 *
 *   MR-LLM-GROK-1: Grok may return a JSON object wrapper around the expected
 *   array (e.g. { "feedback": [...] }) rather than a bare array. The adapter
 *   normalizes known single-array-property wrappers before Zod validation so
 *   the canonical reviewer-feedback schema is preserved without weakening.
 *
 * ERROR TAXONOMY (Ch 22.6):
 *   - AbortError → timeout (propagated to dispatcher)
 *   - HTTP 4xx/5xx → api_error
 *   - JSON parse failure → parse_error
 *   - Zod validation failure → parse_error
 *   - Other → other
 */

import { z } from 'zod';
import { LlmProviderError, httpStatusToErrorClass, type LlmClient, type LlmGenerateParams, type LlmGenerateResult } from './types.js';
import { RawSuggestionsArraySchema } from './parsers/feedbackParser.js';

// xAI uses OpenAI-compatible API shape
interface XaiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface XaiRequest {
  model: string;
  messages: XaiMessage[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: 'json_object' | 'text' };
}

interface XaiResponse {
  id: string;
  object: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null };
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    // GEMINI-BUDGET-CAL-1 (Inc 1, measurement): xAI is OpenAI-compatible; reasoning models may
    // report reasoning tokens here (a SUBSET of completion_tokens). Best-effort/optional — xAI's
    // public reasoning-token reporting is less explicit than OpenAI's, so this is recorded where
    // present and treated as unavailable (null) otherwise.
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

const XAI_API_URL = 'https://api.x.ai/v1/chat/completions';

// Known wrapper key names used by Grok json_object mode when the expected
// schema is a bare array. Tried in order when the single-key check does not
// match (MR-LLM-LITE-2 extension for grok-3-mini multi-key wrappers).
const KNOWN_ARRAY_WRAPPER_KEYS = ['feedback', 'suggestions', 'items', 'result', 'data'] as const;

// MR-LLM-LITE-3: Outer wrapper keys that Grok Lite may use to wrap a nested object
// containing the actual array (e.g. { "review": { "feedback": [...] } }).
const KNOWN_OUTER_WRAPPER_KEYS = ['review', 'output', 'response', 'result', 'data'] as const;

// MR-LLM-LITE-3: Inner array keys expected inside a nested object wrapper.
const KNOWN_INNER_ARRAY_KEYS = ['feedback', 'suggestions', 'items', 'issues'] as const;

/**
 * MR-LLM-LITE-3: Return a safe diagnostic shape descriptor for a parsed value.
 * MUST NOT include document text, feedback body text, user content, or API keys.
 * Returns only structural metadata: top-level type, key names, value types,
 * and array lengths.
 */
export function sanitizeShapeForDiagnostic(value: unknown): Record<string, unknown> {
  if (value === null) return { topLevelType: 'null' };
  if (Array.isArray(value)) return { topLevelType: 'array', length: value.length };
  if (typeof value !== 'object') return { topLevelType: typeof value };

  const obj = value as Record<string, unknown>;
  const keys: Record<string, string> = {};
  const nestedKeys: Record<string, Record<string, string>> = {};

  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      keys[k] = `array(length=${v.length})`;
    } else if (v !== null && typeof v === 'object') {
      keys[k] = 'object';
      const inner = v as Record<string, unknown>;
      const innerShape: Record<string, string> = {};
      for (const [ik, iv] of Object.entries(inner)) {
        if (Array.isArray(iv)) {
          innerShape[ik] = `array(length=${iv.length})`;
        } else {
          innerShape[ik] = iv === null ? 'null' : typeof iv;
        }
      }
      nestedKeys[k] = innerShape;
    } else {
      keys[k] = v === null ? 'null' : typeof v;
    }
  }

  return { topLevelType: 'object', keys, nestedKeys };
}

/**
 * MR-LLM-GROK-1 / MR-LLM-LITE-2 / MR-LLM-LITE-3: Normalize a Grok structured-output value before Zod validation.
 *
 * Grok with json_object mode may return an object wrapper around the expected
 * array, such as { "feedback": [...] } or { "suggestions": [...] }.
 * grok-3-mini (Lite) may return multi-key wrappers such as { "feedback": [...], "count": 3 }.
 *
 * Rules:
 *   1. If parsed is already an array → return it unchanged.
 *   2. If parsed is a plain object with exactly one property that is an array
 *      → return that array (unambiguous single-array-property extraction).
 *   3. If parsed is a plain object with multiple properties, and one of the
 *      known wrapper key names (feedback, suggestions, items, result, data)
 *      contains an array → return that array (MR-LLM-LITE-2).
   *   4. MR-LLM-LITE-3: If the value is a plain object and none of the above
 *      rules matched, check for a nested object wrapper: iterate over known
 *      outer wrapper keys (review, output, response, result, data); if the
 *      value at that key is a plain object, check whether it contains exactly
 *      one known inner array key (feedback, suggestions, items, issues) whose
 *      value is an array. If exactly one candidate is found → extract that
 *      array. If multiple competing candidates are found across all outer keys
 *      → pass through unchanged (ambiguous; Zod will reject).
 *   5. MR-LLM-LITE-5: If the normalized result is still a plain object, test
 *      whether [parsed] validates against RawSuggestionsArraySchema. If yes,
 *      return [parsed] (singleton feedback item). If no, leave unchanged.
 *   6. Otherwise → return the value unchanged (Zod validation will fail with
 *      a diagnostic error if the shape is wrong).
 *
 * This normalization preserves the canonical schema contract: the canonical
 * reviewer-feedback schema still expects an array; we are normalizing the
 * provider output before validation, not weakening the schema.
 */
export function normalizeGrokStructuredOutput(parsed: unknown): unknown {
  // Rule 1: Direct array
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed)
  ) {
    const obj = parsed as Record<string, unknown>;
    const keys = Object.keys(obj);

    // Rule 2: Exactly one property whose value is an array
    if (keys.length === 1) {
      const value = obj[keys[0]!];
      if (Array.isArray(value)) {
        return value;
      }
    }

    // Rule 3: Multi-key object — try known wrapper key names in priority order
    for (const knownKey of KNOWN_ARRAY_WRAPPER_KEYS) {
      if (knownKey in obj && Array.isArray(obj[knownKey])) {
        return obj[knownKey];
      }
    }

    // Rule 4 (MR-LLM-LITE-3): Nested object wrapper — e.g. { "review": { "feedback": [...] } }
    // Collect all unambiguous nested array candidates across known outer keys.
    const nestedCandidates: unknown[] = [];
    for (const outerKey of KNOWN_OUTER_WRAPPER_KEYS) {
      if (!(outerKey in obj)) continue;
      const outerVal = obj[outerKey];
      if (outerVal === null || typeof outerVal !== 'object' || Array.isArray(outerVal)) continue;
      const innerObj = outerVal as Record<string, unknown>;
      for (const innerKey of KNOWN_INNER_ARRAY_KEYS) {
        if (innerKey in innerObj && Array.isArray(innerObj[innerKey])) {
          nestedCandidates.push(innerObj[innerKey]);
        }
      }
    }
    if (nestedCandidates.length === 1) {
      // Exactly one unambiguous nested array found — extract it
      return nestedCandidates[0];
    }
    // If nestedCandidates.length > 1 → ambiguous; fall through to Rule 5

    // Rule 5 (MR-LLM-LITE-5): Singleton feedback item — test whether [obj] validates
    // against the canonical reviewer-feedback array schema. If yes, return [obj].
    // This handles the live-confirmed case where Grok Lite returns a single
    // feedback item object instead of an array.
    const singletonCandidate = RawSuggestionsArraySchema.safeParse([obj]);
    if (singletonCandidate.success) {
      return [obj];
    }
    // Rule 5 failed — arbitrary object, leave unchanged; Zod will reject with parse_error
  }
  // Rule 6: All other cases
  return parsed;
}

export class XaiAdapter implements LlmClient {
  constructor(private readonly modelId: string) {}

  async generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    const apiKey = process.env['XAI_API_KEY'];
    if (!apiKey) {
      throw new LlmProviderError(
        'api_error',
        'XAI_API_KEY is not set. Configure it in your environment to use the xAI adapter.',
      );
    }

    const {
      systemPrompt,
      userPrompt,
      structuredOutputSchema,
      maxTokens = 4096,
      temperature = 0.3,
      signal,
    } = params;

    const messages: XaiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const requestBody: XaiRequest = {
      model: this.modelId,
      messages,
      max_tokens: maxTokens,
      temperature,
    };

    if (structuredOutputSchema) {
      requestBody.response_format = { type: 'json_object' };
    }

    let response: Response;
    try {
      response = await fetch(XAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw err;
      }
      throw new LlmProviderError('api_error', `xAI Grok fetch failed: ${String(err)}`, err);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // MODEL-RELIABILITY-UAT-1: 429 → rate_limited, 401/403 → auth_error, else api_error.
      throw new LlmProviderError(
        httpStatusToErrorClass(response.status),
        `xAI Grok API error ${response.status}: ${body}`,
      );
    }

    let data: XaiResponse;
    try {
      data = (await response.json()) as XaiResponse;
    } catch (err) {
      throw new LlmProviderError('api_error', `Failed to parse xAI Grok response JSON: ${String(err)}`, err);
    }

    const rawText = data.choices[0]?.message.content ?? '';

    if (structuredOutputSchema) {
      // GEMINI-BUDGET-CAL-1 (Inc 1): truncation guard. xAI Grok is OpenAI-compatible and
      // signals an output-budget truncation with finish_reason 'length'; the partial JSON
      // would otherwise reach JSON.parse below and surface as a cryptic parse_error, where
      // neither the transient-retry nor the future L2 escalation (which key on the truncation
      // error class) can act. Classify it as a single, correct api_error (truncation) BEFORE
      // parse — parity with the OpenAI and Gemini adapters.
      const finishReason = data.choices[0]?.finish_reason;
      if (finishReason === 'length') {
        throw new LlmProviderError(
          'api_error',
          `xAI Grok returned finish_reason 'length' (token truncation) before valid JSON could be produced. ` +
            `This is an output-budget truncation, not a malformed response — raise max_tokens or reduce input size.`,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch (err) {
        throw new LlmProviderError(
          'parse_error',
          `xAI Grok response is not valid JSON for structured output: ${String(err)}`,
          err,
        );
      }

      // MR-LLM-GROK-1: normalize object wrapper before Zod validation.
      // Grok may return { "feedback": [...] } instead of a bare array.
      const normalized = normalizeGrokStructuredOutput(parsed);

      const result = (structuredOutputSchema as z.ZodSchema).safeParse(normalized);
      if (!result.success) {
        // MR-LLM-LITE-4: append sanitized shape diagnostic to parse_error so live
        // failures expose the actual wrapper structure without leaking content.
        const shapeDiag = sanitizeShapeForDiagnostic(normalized);
        throw new LlmProviderError(
          'parse_error',
          `xAI Grok structured output failed Zod validation: ${result.error.message}. Sanitized output shape: ${JSON.stringify(shapeDiag)}`,
          result.error,
        );
      }

      // Return rawText (the original JSON string) consistent with OpenAI/Google adapters.
      // txn2Commit in reviewSession.ts handles string output via parseFeedbackOutput.
      // If normalization extracted an array from a wrapper, re-serialize so downstream
      // parseFeedbackOutput receives valid JSON array text.
      const contentText = Array.isArray(normalized) && !Array.isArray(parsed)
        ? JSON.stringify(normalized)
        : rawText;

      return {
        content: contentText,
        tokensPrompt: data.usage.prompt_tokens,
        tokensCompletion: data.usage.completion_tokens,
        tokensReasoning: data.usage.completion_tokens_details?.reasoning_tokens,
        providerMetadata: {
          provider: 'xai',
          model: data.model,
          finishReason: data.choices[0]?.finish_reason,
          completionId: data.id,
        },
      };
    }

    return {
      content: rawText,
      tokensPrompt: data.usage.prompt_tokens,
      tokensCompletion: data.usage.completion_tokens,
      tokensReasoning: data.usage.completion_tokens_details?.reasoning_tokens,
      providerMetadata: {
        provider: 'xai',
        model: data.model,
        finishReason: data.choices[0]?.finish_reason,
        completionId: data.id,
      },
    };
  }
}

export function createXaiAdapter(modelId: string): LlmClient {
  return new XaiAdapter(modelId);
}
