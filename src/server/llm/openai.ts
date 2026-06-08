/**
 * OpenAI Provider Adapter (Ch 22.1, Ch 22.3a)
 *
 * Implements the LlmClient interface for OpenAI's GPT models.
 * Used for:
 *   - Reviewer role (gpt reviewer adapter) — openai:gpt-5
 *   - Lite reviewer role (gpt_lite) — openai:gpt-4.1-mini (MR-LLM-LITE-1)
 *
 * API KEY:
 *   Read from OPENAI_API_KEY at invocation time, not at startup.
 *   Missing key is a runtime error only if this adapter is actually invoked.
 *
 * STRUCTURED OUTPUT:
 *   OpenAI supports JSON mode via response_format: { type: "json_object" }.
 *   When structuredOutputSchema is provided, we enable JSON mode and validate
 *   the response against the Zod schema (Ch 22.7).
 *
 *   NOTE: json_object mode requires GPT to return a JSON *object*, not a bare
 *   array. GPT-5 therefore wraps reviewer-feedback arrays in an object wrapper
 *   such as { "feedback": [...] } or { "suggestions": [...] }. This is the
 *   live-confirmed failure mechanism (MR-LLM-GPT-1): Zod validation against
 *   RawSuggestionsArraySchema (z.array(...)) fails with "Expected array,
 *   received object". normalizeOpenAiStructuredOutput() extracts the array
 *   from an unambiguous single-key wrapper before Zod validation.
 *
 *   MR-LLM-LITE-2: Extended to also extract arrays from multi-key wrappers
 *   when a known wrapper key name (feedback, suggestions, items, result, data)
 *   is present and contains an array. gpt-4.1-mini may return multi-key wrappers
 *   such as { "feedback": [...], "count": 3 }.
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

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAiRequest {
  model: string;
  messages: OpenAiMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  response_format?: { type: 'json_object' | 'text' };
}

interface OpenAiResponse {
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
    // GEMINI-BUDGET-CAL-1 (Inc 1, measurement): GPT-5 / o-series report reasoning tokens here.
    // reasoning_tokens is a SUBSET of completion_tokens (it counts against max_completion_tokens
    // before any JSON is emitted). Optional — absent for non-reasoning models.
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Known wrapper key names used by OpenAI json_object mode when the expected
// schema is a bare array. These are tried in order when the single-key check
// does not match (MR-LLM-LITE-2 extension).
const KNOWN_ARRAY_WRAPPER_KEYS = ['feedback', 'suggestions', 'items', 'result', 'data'] as const;

// MR-LLM-LITE-3: Outer wrapper keys that GPT Lite may use to wrap a nested object
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

// ============================================================
// MR-LLM-GPT-1 / MR-LLM-LITE-2 / MR-LLM-LITE-3: OpenAI structured-output object-wrapper normalization
// ============================================================
/**
 * Normalize the parsed value from an OpenAI json_object response when the
 * expected schema is a bare array (e.g. RawSuggestionsArraySchema).
 *
 * OpenAI's json_object mode requires the model to return a JSON object, so
 * GPT-5 and gpt-4.1-mini wrap reviewer-feedback arrays in an object wrapper.
 *
 * Normalization rules:
 *   1. If the value is already an array → return as-is (no-op).
 *   2. If the value is a plain object with exactly one property whose value is
 *      an array → extract and return that array (unambiguous single-key).
 *   3. If the value is a plain object with multiple properties, and one of the
 *      known wrapper key names (feedback, suggestions, items, result, data)
 *      contains an array → extract and return that array (MR-LLM-LITE-2).
   *   4. MR-LLM-LITE-3: If the value is a plain object and none of the above
 *      rules matched, check for a nested object wrapper: iterate over known
 *      outer wrapper keys (review, output, response, result, data); if the
 *      value at that key is a plain object, check whether it contains exactly
 *      one known inner array key (feedback, suggestions, items, issues) whose
 *      value is an array. If exactly one candidate is found → extract that
 *      array. If multiple competing candidates are found across all outer keys
 *      → pass through unchanged (ambiguous; Zod will reject).
 *   5. MR-LLM-LITE-5: If the normalized result is still a plain object, test
 *      whether [value] validates against RawSuggestionsArraySchema. If yes,
 *      return [value] (singleton feedback item). If no, leave unchanged.
 *   6. All other cases → return the value unchanged; Zod validation will fail
 *      with a typed parse_error.
 *
 * This function does NOT weaken the canonical schema. RawSuggestionsArraySchema
 * remains a z.array(...). Normalization happens before Zod validation.
 *
 * @param value - The parsed JSON value from the OpenAI response.
 * @returns The normalized value (array if wrapper was extracted, original otherwise).
 */
export function normalizeOpenAiStructuredOutput(value: unknown): unknown {
  // Rule 1: Direct array — pass through unchanged
  if (Array.isArray(value)) {
    return value;
  }

  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);

    // Rule 2: Exactly one property whose value is an array — unambiguous extraction
    if (keys.length === 1) {
      const inner = obj[keys[0]!];
      if (Array.isArray(inner)) {
        return inner;
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
    // This handles the live-confirmed case where GPT/Grok Lite returns a single
    // feedback item object instead of an array.
    const singletonCandidate = RawSuggestionsArraySchema.safeParse([obj]);
    if (singletonCandidate.success) {
      return [obj];
    }
    // Rule 5 failed — arbitrary object, leave unchanged; Zod will reject with parse_error
  }

  // Rule 6: All other cases — return unchanged; Zod will reject with parse_error
  return value;
}

export class OpenAiAdapter implements LlmClient {
  constructor(private readonly modelId: string) {}

  async generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new LlmProviderError(
        'api_error',
        'OPENAI_API_KEY is not set. Configure it in your environment to use the OpenAI adapter.',
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

    const messages: OpenAiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    // gpt-5 and o-series models use max_completion_tokens and do not support temperature
    const usesCompletionTokens = this.modelId.startsWith('gpt-5') || this.modelId.startsWith('o1') || this.modelId.startsWith('o3') || this.modelId.startsWith('o4');
    const requestBody: OpenAiRequest = {
      model: this.modelId,
      messages,
      ...(usesCompletionTokens
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens, temperature }),
    };

    if (structuredOutputSchema) {
      requestBody.response_format = { type: 'json_object' };
    }

    let response: Response;
    try {
      response = await fetch(OPENAI_API_URL, {
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
      throw new LlmProviderError('api_error', `OpenAI fetch failed: ${String(err)}`, err);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // MODEL-RELIABILITY-UAT-1: classify 429 → rate_limited, 401/403 → auth_error,
      // else api_error (unchanged), so transient vs auth is distinguishable downstream.
      throw new LlmProviderError(
        httpStatusToErrorClass(response.status),
        `OpenAI API error ${response.status}: ${body}`,
      );
    }

    let data: OpenAiResponse;
    try {
      data = (await response.json()) as OpenAiResponse;
    } catch (err) {
      throw new LlmProviderError('api_error', `Failed to parse OpenAI response JSON: ${String(err)}`, err);
    }

    const rawText = data.choices[0]?.message.content ?? '';

    if (structuredOutputSchema) {
      // Guard A: named-target finish_reason checks (dispatch v2 final §3.2 / AHC-9).
      // Only the two confirmed-problem values are caught; all other finish_reason values
      // (including 'tool_calls' and any unknown future values) pass through to the
      // empty-string guard and the existing JSON.parse block (failing-open default).
      const finishReason = data.choices[0]?.finish_reason;
      if (finishReason === 'content_filter') {
        throw new LlmProviderError(
          'api_error',
          `OpenAI returned finish_reason 'content_filter' (content policy triggered)`,
        );
      }
      if (finishReason === 'length') {
        throw new LlmProviderError(
          'api_error',
          `OpenAI returned finish_reason 'length' (token truncation)`,
        );
      }
      // Guard B: empty content string cannot be valid JSON — throw before JSON.parse
      // to surface a clear api_error rather than a cryptic SyntaxError.
      if (rawText === '') {
        throw new LlmProviderError(
          'api_error',
          'OpenAI structured output returned empty content',
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch (err) {
        throw new LlmProviderError(
          'parse_error',
          `OpenAI response is not valid JSON for structured output: ${String(err)}`,
          err,
        );
      }

      // MR-LLM-GPT-1 / MR-LLM-LITE-2: normalize object wrapper before Zod validation.
      // OpenAI json_object mode requires GPT to return an object, so GPT-5 and
      // gpt-4.1-mini wrap reviewer-feedback arrays in a wrapper. Extract the array if
      // present (single-key or known multi-key wrapper); pass through unchanged otherwise
      // (Zod will reject with parse_error).
      const normalized = normalizeOpenAiStructuredOutput(parsed);

      // Re-serialize if normalization extracted a wrapper, so that content is
      // always a JSON string of the canonical array (consistent with the
      // non-wrapped path and with the xAI adapter after MR-LLM-GROK-1).
      const effectiveRawText = normalized !== parsed
        ? JSON.stringify(normalized)
        : rawText;

      const result = (structuredOutputSchema as z.ZodSchema).safeParse(normalized);
      if (!result.success) {
        // MR-LLM-LITE-4: append sanitized shape diagnostic to parse_error so live
        // failures expose the actual wrapper structure without leaking content.
        const shapeDiag = sanitizeShapeForDiagnostic(normalized);
        throw new LlmProviderError(
          'parse_error',
          `OpenAI structured output failed Zod validation: ${result.error.message}. Sanitized output shape: ${JSON.stringify(shapeDiag)}`,
          result.error,
        );
      }

      return {
        content: effectiveRawText,
        tokensPrompt: data.usage.prompt_tokens,
        tokensCompletion: data.usage.completion_tokens,
        tokensReasoning: data.usage.completion_tokens_details?.reasoning_tokens,
        providerMetadata: {
          provider: 'openai',
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
        provider: 'openai',
        model: data.model,
        finishReason: data.choices[0]?.finish_reason,
        completionId: data.id,
      },
    };
  }
}

export function createOpenAiAdapter(modelId: string): LlmClient {
  return new OpenAiAdapter(modelId);
}
