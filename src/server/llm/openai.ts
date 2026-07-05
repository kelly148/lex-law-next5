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
import { LlmProviderError, httpStatusToErrorClass, type LlmClient, type LlmGenerateParams, type LlmGenerateResult, type LlmStreamChunk } from './types.js';
import { llmFetch } from './llmFetch.js';
import { sseDataLines } from './sseParse.js';
import { getModelCapability } from './modelCapabilities.js';
import { normalizeStructuredOutput } from './structuredOutputNormalize.js';
import { looksLikeTruncatedJson } from './truncationDetect.js';
import { tryRepairArrayJson } from './tolerantJsonParse.js';

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
  // REVIEWER-LATENCY-1 Step 2a: Chat Completions top-level latency knobs. Set ONLY when the caller
  // supplies them (the flag-gated reviewer lane) — absent on every other request.
  reasoning_effort?: string;
  service_tier?: string;
  /** F3 streaming (DRAFT-STREAMING-1 Inc 3): set on the generateStream path. */
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
}

interface OpenAiResponse {
  id: string;
  object: string;
  model: string;
  // REVIEWER-LATENCY-1 Step 2a: OpenAI echoes the granted service tier here (e.g. 'priority',
  // 'default'). Captured so we can verify priority actually applied vs. silently downgraded.
  service_tier?: string;
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

// HI-5b: the wrapper-key constants + Rules 1-5 now live in the SHARED structuredOutputNormalize module
// (normalizeStructuredOutput), used by all four reviewer adapters. normalizeOpenAiStructuredOutput is
// kept as a thin alias for backward compatibility with existing imports/tests.

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
  return normalizeStructuredOutput(value);
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
      reasoningEffort,
      serviceTier,
      signal,
    } = params;

    const messages: OpenAiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    // ME-9 (REVIEWER-ROBUSTNESS-1): reasoning models (gpt-5 family + o-series) use
    // max_completion_tokens and reject temperature. Drive this from the MODEL_CAPABILITIES registry
    // (the single source of model truth — supportsThinkingControl marks an OpenAI reasoning model)
    // when the id is registered, and fall back to the gpt-5/o-series prefix match for ids NOT in the
    // registry (o1/o3/o4, future ids). Behavior-preserving for every current id; the registry just
    // stops the request shape from drifting away from the capability metadata.
    const capability = getModelCapability(`openai:${this.modelId}`);
    const usesCompletionTokens = capability
      ? capability.supportsThinkingControl
      : (this.modelId.startsWith('gpt-5') || this.modelId.startsWith('o1') || this.modelId.startsWith('o3') || this.modelId.startsWith('o4'));
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

    // REVIEWER-LATENCY-1 Step 2a: flag-gated reviewer-lane speed knobs. These are set on the
    // request ONLY when the caller supplied them — the reviewer dispatch passes them solely when
    // REVIEWER_LATENCY_TUNING_ENABLED is on and config resolves a value (gpt-5 reviewer lane). When
    // absent (the default, and every drafter/other-lane call), the body is byte-identical to before.
    // reasoning_effort is valid only for reasoning models (gpt-5/o-series); guarded accordingly.
    if (reasoningEffort && usesCompletionTokens) {
      requestBody.reasoning_effort = reasoningEffort;
    }
    if (serviceTier) {
      requestBody.service_tier = serviceTier;
    }

    let response: Response;
    try {
      response = await llmFetch(OPENAI_API_URL, {
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

    // REVIEWER-LATENCY-1 Step 2a: when we requested a non-default service tier, log the GRANTED tier
    // OpenAI echoes back, so we can verify 'priority' actually applied (vs. a silent downgrade).
    // Observability only — never affects the job outcome; no telemetry-contract change.
    if (serviceTier) {
      // eslint-disable-next-line no-console
      console.info(
        `[reviewer-latency] openai model=${data.model} requested_service_tier=${serviceTier} ` +
          `granted_service_tier=${data.service_tier ?? 'none'} reasoning_effort=${reasoningEffort ?? 'unset'}`,
      );
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
      let structuralRepair = false;
      try {
        parsed = JSON.parse(rawText);
      } catch (err) {
        // RPR-1: a structural truncation (unterminated string / unclosed brackets) that arrived WITHOUT
        // finish_reason 'length' is retriable, not a terminal parse_error. Checked BEFORE any repair so a
        // real truncation is never silently patched.
        if (looksLikeTruncatedJson(rawText)) {
          throw new LlmProviderError(
            'api_error',
            `OpenAI structured output appears truncated (unbalanced/unterminated JSON, finish_reason ` +
              `${data.choices[0]?.finish_reason ?? 'unknown'}) — an output-budget/stream truncation, not ` +
              `a malformed response. Retriable.`,
            err,
          );
        }
        // RPR-2: minimal, array-gated structural repair (mismatched closer / trailing comma). Accepted
        // only if the repaired value passes Zod below; otherwise fail open to parse_error.
        const repair = tryRepairArrayJson(rawText);
        if (repair) {
          parsed = repair.value;
          structuralRepair = true;
        } else {
          throw new LlmProviderError(
            'parse_error',
            `OpenAI response is not valid JSON for structured output: ${String(err)}`,
            err,
          );
        }
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
      const effectiveRawText = normalized !== parsed || structuralRepair
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
          // REVIEWER-LATENCY-1 Step 2a: granted service tier echo (undefined when not requested).
          serviceTier: data.service_tier,
          // RPR-2: flag when a minimal structural repair was applied, so calibration still sees the
          // provider emitted malformed JSON (absent on the happy path).
          ...(structuralRepair ? { structuralRepair: true } : {}),
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
        // REVIEWER-LATENCY-1 Step 2a: granted service tier echo (undefined when not requested).
        serviceTier: data.service_tier,
      },
    };
  }

  /**
   * F3 token streaming (DRAFT-STREAMING-1 Inc 3) — free-form streaming over the OpenAI Chat Completions
   * API with stream:true + stream_options.include_usage (so usage arrives in the terminal chunk). Mirrors
   * generate()'s request build (reasoning-model token budget, latency knobs) over the SAME llmFetch wrapper
   * (no SDK). Yields text deltas then a terminal `final` shape-identical to generate(). No structured
   * output (the dispatch seam gates streaming off when a schema is present).
   */
  async *generateStream(params: LlmGenerateParams): AsyncIterable<LlmStreamChunk> {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new LlmProviderError('api_error', 'OPENAI_API_KEY is not set. Configure it in your environment to use the OpenAI adapter.');
    }
    const { systemPrompt, userPrompt, maxTokens = 4096, temperature = 0.3, reasoningEffort, serviceTier, signal } = params;
    const messages: OpenAiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    const capability = getModelCapability(`openai:${this.modelId}`);
    const usesCompletionTokens = capability
      ? capability.supportsThinkingControl
      : this.modelId.startsWith('gpt-5') || this.modelId.startsWith('o1') || this.modelId.startsWith('o3') || this.modelId.startsWith('o4');
    const requestBody: OpenAiRequest = {
      model: this.modelId,
      messages,
      ...(usesCompletionTokens ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens, temperature }),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (reasoningEffort && usesCompletionTokens) requestBody.reasoning_effort = reasoningEffort;
    if (serviceTier) requestBody.service_tier = serviceTier;

    let response: Response;
    try {
      response = await llmFetch(OPENAI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) throw err;
      throw new LlmProviderError('api_error', `OpenAI stream fetch failed: ${String(err)}`, err);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new LlmProviderError(httpStatusToErrorClass(response.status), `OpenAI API error ${response.status}: ${body}`);
    }
    if (!response.body) throw new LlmProviderError('api_error', 'OpenAI streaming response had no body to read.');

    let content = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let model = this.modelId;
    let finishReason: string | null = null;
    for await (const payload of sseDataLines(response.body)) {
      if (payload === '[DONE]') break;
      let evt: {
        model?: string;
        choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      };
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.model) model = evt.model;
      const choice = evt.choices?.[0];
      const piece = choice?.delta?.content;
      if (typeof piece === 'string' && piece.length > 0) {
        content += piece;
        yield { kind: 'delta', text: piece };
      }
      if (choice?.finish_reason != null) finishReason = choice.finish_reason;
      if (evt.usage) {
        if (typeof evt.usage.prompt_tokens === 'number') promptTokens = evt.usage.prompt_tokens;
        if (typeof evt.usage.completion_tokens === 'number') completionTokens = evt.usage.completion_tokens;
      }
    }
    yield {
      kind: 'final',
      result: {
        content,
        tokensPrompt: promptTokens,
        tokensCompletion: completionTokens,
        providerMetadata: { provider: 'openai', model, finishReason, streamed: true },
      },
    };
  }
}

export function createOpenAiAdapter(modelId: string): LlmClient {
  return new OpenAiAdapter(modelId);
}
