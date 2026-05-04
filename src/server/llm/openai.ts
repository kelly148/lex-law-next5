/**
 * OpenAI Provider Adapter (Ch 22.1, Ch 22.3a)
 *
 * Implements the LlmClient interface for OpenAI's GPT models.
 * Used for:
 *   - Reviewer role (gpt reviewer adapter) — openai:gpt-5
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
 * ERROR TAXONOMY (Ch 22.6):
 *   - AbortError → timeout (propagated to dispatcher)
 *   - HTTP 4xx/5xx → api_error
 *   - JSON parse failure → parse_error
 *   - Zod validation failure → parse_error
 *   - Other → other
 */

import { z } from 'zod';
import { LlmProviderError, type LlmClient, type LlmGenerateParams, type LlmGenerateResult } from './types.js';

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
  };
}

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// ============================================================
// MR-LLM-GPT-1: OpenAI structured-output object-wrapper normalization
// ============================================================
/**
 * Normalize the parsed value from an OpenAI json_object response when the
 * expected schema is a bare array (e.g. RawSuggestionsArraySchema).
 *
 * OpenAI's json_object mode requires the model to return a JSON object, so
 * GPT-5 wraps reviewer-feedback arrays in a single-key object such as:
 *   { "feedback": [...] }
 *   { "suggestions": [...] }
 *   { "items": [...] }
 *   { "result": [...] }
 *
 * Normalization rules (identical to MR-LLM-GROK-1 normalizeGrokStructuredOutput):
 *   - If the value is already an array → return as-is (no-op).
 *   - If the value is a plain object with exactly one property whose value is
 *     an array → extract and return that array.
 *   - All other cases → return the value unchanged; Zod validation will fail
 *     with a typed parse_error.
 *
 * This function does NOT weaken the canonical schema. RawSuggestionsArraySchema
 * remains a z.array(...). Normalization happens before Zod validation.
 *
 * @param value - The parsed JSON value from the OpenAI response.
 * @returns The normalized value (array if wrapper was extracted, original otherwise).
 */
export function normalizeOpenAiStructuredOutput(value: unknown): unknown {
  // Direct array — pass through unchanged
  if (Array.isArray(value)) {
    return value;
  }
  // Plain object with exactly one property whose value is an array — extract it
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 1) {
      const inner = (value as Record<string, unknown>)[keys[0]!];
      if (Array.isArray(inner)) {
        return inner;
      }
    }
  }
  // All other cases — return unchanged; Zod will reject with parse_error
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
      throw new LlmProviderError(
        'api_error',
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

      // MR-LLM-GPT-1: normalize object wrapper before Zod validation.
      // OpenAI json_object mode requires GPT to return an object, so GPT-5 wraps
      // reviewer-feedback arrays in a single-key wrapper. Extract the array if
      // present; pass through unchanged otherwise (Zod will reject with parse_error).
      const normalized = normalizeOpenAiStructuredOutput(parsed);

      // Re-serialize if normalization extracted a wrapper, so that content is
      // always a JSON string of the canonical array (consistent with the
      // non-wrapped path and with the xAI adapter after MR-LLM-GROK-1).
      const effectiveRawText = normalized !== parsed
        ? JSON.stringify(normalized)
        : rawText;

      const result = (structuredOutputSchema as z.ZodSchema).safeParse(normalized);
      if (!result.success) {
        throw new LlmProviderError(
          'parse_error',
          `OpenAI structured output failed Zod validation: ${result.error.message}`,
          result.error,
        );
      }

      return {
        content: effectiveRawText,
        tokensPrompt: data.usage.prompt_tokens,
        tokensCompletion: data.usage.completion_tokens,
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
