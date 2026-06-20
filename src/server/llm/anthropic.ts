/**
 * Anthropic Provider Adapter (Ch 22.1, Ch 22.3a)
 *
 * Implements the LlmClient interface for Anthropic's Claude models.
 * Used for:
 *   - Drafter-family roles (draft_generation, regeneration, formatting,
 *     data_extraction, outline_generation, information_request_generation)
 *     via PRIMARY_DRAFTER_MODEL=anthropic:claude-opus-4-5
 *   - Evaluator role via EVALUATOR_MODEL=anthropic:claude-opus-4-5
 *   - Reviewer role (claude reviewer adapter)
 *   - Lite reviewer role (claude_lite) — anthropic:claude-sonnet-4-5 (MR-LLM-LITE-1)
 *
 * API KEY:
 *   Read from ANTHROPIC_API_KEY at invocation time, not at startup.
 *   Missing key is a runtime error only if this adapter is actually invoked.
 *   This supports deploy scenarios where the key is not yet configured (Ch 22.3).
 *
 * STRUCTURED OUTPUT:
 *   Anthropic does not have a native structured-output mode equivalent to
 *   OpenAI's JSON schema mode. We use a prompt-engineering approach:
 *   when structuredOutputSchema is provided, we append a JSON-format
 *   instruction to the system prompt and parse the response.
 *   The parsed output is validated against the Zod schema (Ch 22.7).
 *
 *   MR-LLM-LITE-2: claude-sonnet-4-5 may return fenced JSON (```json ... ```)
 *   despite the system prompt instruction. stripJsonCodeFenceIfWholeResponse()
 *   strips the fence before JSON.parse. Also adds object-wrapper normalization
 *   via normalizeAnthropicStructuredOutput() and aligns content return to
 *   string (consistent with OpenAI/Google/xAI adapters).
 *
 * ERROR TAXONOMY (Ch 22.6):
 *   - AbortError → timeout (handled by dispatcher, not here)
 *   - HTTP 4xx/5xx → api_error
 *   - JSON parse failure → parse_error
 *   - Zod validation failure → parse_error
 *   - Other → other
 */

import { z } from 'zod';
import { LlmProviderError, httpStatusToErrorClass, type LlmClient, type LlmGenerateParams, type LlmGenerateResult, type LlmStreamChunk } from './types.js';
import { llmFetch } from './llmFetch.js';
import { LLM_FETCH_TIMEOUT_MS } from './config.js';
import { normalizeStructuredOutput } from './structuredOutputNormalize.js';

// Anthropic Messages API types (minimal — we only use what v1 needs)
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  temperature?: number;
  /** F3 streaming (DRAFT-STREAMING-1): set true on the generateStream path for SSE delivery. */
  stream?: boolean;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';


// ============================================================
// MR-LLM-LITE-2: Anthropic structured-output helpers
// ============================================================

/**
 * Strip a JSON code fence if the entire response is wrapped in one.
 *
 * claude-sonnet-4-5 may return:
 *   ```json
 *   [...]
 *   ```
 * despite the system prompt instruction to return only raw JSON.
 * If the response is not a whole-response fence, it is returned unchanged.
 */
export function stripJsonCodeFenceIfWholeResponse(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch && fenceMatch[1] !== undefined) {
    return fenceMatch[1].trim();
  }
  return text;
}

/**
 * Normalize the parsed value from an Anthropic structured-output response when the expected schema is
 * a bare array. HI-5b: delegates to the SHARED normalizeStructuredOutput so the Anthropic lane now has
 * the SAME recovery as OpenAI/xAI — including the nested-wrapper (Rule 4) and singleton-item (Rule 5)
 * rules it previously lacked (Claude was prone to those un-recovered shapes). Purely additive: it only
 * recovers shapes that previously fell through to parse_error; a value the schema already accepts is
 * unchanged.
 */
export function normalizeAnthropicStructuredOutput(value: unknown): unknown {
  return normalizeStructuredOutput(value);
}

export class AnthropicAdapter implements LlmClient {
  constructor(private readonly modelId: string) {}

  async generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new LlmProviderError(
        'api_error',
        'ANTHROPIC_API_KEY is not set. Configure it in your environment to use the Anthropic adapter.',
      );
    }

    const {
      systemPrompt,
      userPrompt,
      structuredOutputSchema,
      maxTokens = 4096,
      // temperature is intentionally not destructured: claude-opus-4-7 and other
      // extended-thinking Claude models reject the temperature parameter with
      // HTTP 400 "temperature is deprecated for this model". The Anthropic API
      // applies its own default when temperature is absent. (MR-FINALIZE-ANTHROPIC-1)
      signal,
    } = params;

    // When structured output is requested, append JSON format instruction
    const effectiveSystemPrompt = structuredOutputSchema
      ? `${systemPrompt}\n\nRespond ONLY with valid JSON matching the required schema. Do not include any text outside the JSON object.`
      : systemPrompt;

    const requestBody: AnthropicRequest = {
      model: this.modelId,
      max_tokens: maxTokens,
      system: effectiveSystemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    };

    let response: Response;
    try {
      response = await llmFetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (err) {
      // AbortError from signal — let it propagate; dispatcher handles timeout classification
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw err;
      }
      throw new LlmProviderError('api_error', `Anthropic fetch failed: ${String(err)}`, err);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // MODEL-RELIABILITY-UAT-1: 429 → rate_limited, 401/403 → auth_error, else api_error.
      throw new LlmProviderError(
        httpStatusToErrorClass(response.status),
        `Anthropic API error ${response.status}: ${body}`,
      );
    }

    let data: AnthropicResponse;
    try {
      data = (await response.json()) as AnthropicResponse;
    } catch (err) {
      throw new LlmProviderError('api_error', `Failed to parse Anthropic response JSON: ${String(err)}`, err);
    }

    const rawText = data.content[0]?.text ?? '';

    if (structuredOutputSchema) {
      // GEMINI-BUDGET-CAL-1 (Inc 1): truncation guard, for parity with the OpenAI
      // (finish_reason 'length') and Gemini (finishReason 'MAX_TOKENS') adapters. Anthropic
      // signals an output-budget truncation with stop_reason 'max_tokens'; the partial JSON
      // that follows would otherwise reach JSON.parse below and surface as a cryptic
      // parse_error, where neither the transient-retry nor the future L2 escalation (which key
      // on the truncation error class) can act on it. Classify it as a single, correct
      // api_error (truncation) BEFORE parse — the same invariant the MODEL-RELIABILITY-UAT-1
      // Gemini fix established, extended to Claude.
      if (data.stop_reason === 'max_tokens') {
        throw new LlmProviderError(
          'api_error',
          `Anthropic structured output was truncated (stop_reason: max_tokens) before valid JSON could be produced. ` +
            `This is an output-budget truncation, not a malformed response — raise max_tokens or reduce input size.`,
        );
      }

      // MR-LLM-LITE-2: claude-sonnet-4-5 may return fenced JSON. Strip fence first.
      const effectiveText = stripJsonCodeFenceIfWholeResponse(rawText);

      let parsed: unknown;
      try {
        parsed = JSON.parse(effectiveText);
      } catch (err) {
        throw new LlmProviderError(
          'parse_error',
          `Anthropic response is not valid JSON for structured output: ${String(err)}`,
          err,
        );
      }

      // MR-CAL-5D: validate the parsed value against the target schema FIRST, and only
      // fall back to array-unwrap normalization if that direct validation fails.
      //
      // normalizeAnthropicStructuredOutput was written for the reviewer use case, where
      // the schema is a BARE ARRAY and the model wraps it in a single-key object. But its
      // single-key-unwrap rule also unwraps a legitimately object-shaped result such as the
      // evaluator's { dispositions: [...] } into the bare array [...], which then fails the
      // evaluator's object-shaped EvaluatorOutputSchema (parse_error -> job fails -> nothing
      // persisted -> evaluation=null). Validating the raw parsed value first lets object
      // schemas pass untouched; the array-unwrap path remains as a fallback for the reviewer
      // schemas it was built for.
      const schema = structuredOutputSchema as z.ZodSchema;
      const direct = schema.safeParse(parsed);

      let validated: unknown;
      let usedNormalization: boolean;
      if (direct.success) {
        validated = parsed;
        usedNormalization = false;
      } else {
        const normalized = normalizeAnthropicStructuredOutput(parsed);
        const result = schema.safeParse(normalized);
        if (!result.success) {
          throw new LlmProviderError(
            'parse_error',
            `Anthropic structured output failed Zod validation: ${result.error.message}`,
            result.error,
          );
        }
        validated = normalized;
        usedNormalization = normalized !== parsed;
      }

      // MR-LLM-LITE-2: return content as string (consistent with OpenAI/Google/xAI).
      // Re-serialize only if normalization actually transformed the value.
      const contentText = usedNormalization
        ? JSON.stringify(validated)
        : effectiveText;

      return {
        content: contentText,
        tokensPrompt: data.usage.input_tokens,
        tokensCompletion: data.usage.output_tokens,
        providerMetadata: {
          provider: 'anthropic',
          model: data.model,
          stopReason: data.stop_reason,
          messageId: data.id,
        },
      };
    }

    return {
      content: rawText,
      tokensPrompt: data.usage.input_tokens,
      tokensCompletion: data.usage.output_tokens,
      providerMetadata: {
        provider: 'anthropic',
        model: data.model,
        stopReason: data.stop_reason,
        messageId: data.id,
      },
    };
  }

  /**
   * F3 token streaming (DRAFT-STREAMING-1) — optional delivery overlay for free-form (non-structured)
   * generations (drafts/regenerations). Mirrors generate()'s auth + error handling but uses the Anthropic
   * Messages API with `stream: true`, over the SAME llmFetch wrapper (NO provider SDK — the architecture
   * guard forbids raw SDK imports). Yields incremental text deltas, then exactly one terminal `final`
   * chunk whose LlmGenerateResult is shape-identical to generate()'s non-structured return (so persistence
   * is unchanged). Structured output is NOT supported here (the dispatch seam gates streaming off when a
   * structuredOutputSchema is present); callers must not request it on the stream path.
   */
  async *generateStream(params: LlmGenerateParams): AsyncIterable<LlmStreamChunk> {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new LlmProviderError(
        'api_error',
        'ANTHROPIC_API_KEY is not set. Configure it in your environment to use the Anthropic adapter.',
      );
    }

    const { systemPrompt, userPrompt, maxTokens = 4096, signal } = params;
    const requestBody: AnthropicRequest = {
      model: this.modelId,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      stream: true,
    };

    let response: Response;
    try {
      response = await llmFetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (err) {
      // AbortError/TimeoutError from the signal — propagate verbatim so the dispatcher classifies
      // timeout vs. cancel; everything else is an api_error (same as generate()).
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw err;
      }
      throw new LlmProviderError('api_error', `Anthropic stream fetch failed: ${String(err)}`, err);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new LlmProviderError(
        httpStatusToErrorClass(response.status),
        `Anthropic API error ${response.status}: ${body}`,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new LlmProviderError('api_error', 'Anthropic streaming response had no body to read.');
    }

    const decoder = new TextDecoder();
    let buffered = '';
    let accumulated = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;
    let messageId = '';
    let model = this.modelId;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        // Anthropic streams Server-Sent Events: `event: <type>\n` then `data: <json>\n`, blank-line
        // separated. We only need the `data:` payloads (each carries its own `type`). Split on newlines;
        // keep the trailing partial line in `buffered`.
        let nl: number;
        while ((nl = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, nl).replace(/\r$/, '');
          buffered = buffered.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload.length === 0) continue;
          let evt: {
            type?: string;
            message?: { id?: string; model?: string; usage?: { input_tokens?: number; output_tokens?: number } };
            delta?: { type?: string; text?: string; stop_reason?: string | null };
            usage?: { output_tokens?: number };
            error?: unknown;
          };
          try {
            evt = JSON.parse(payload);
          } catch {
            // Tolerate a non-JSON keepalive/comment line rather than failing the whole stream.
            continue;
          }
          switch (evt.type) {
            case 'message_start':
              inputTokens = evt.message?.usage?.input_tokens ?? inputTokens;
              outputTokens = evt.message?.usage?.output_tokens ?? outputTokens;
              messageId = evt.message?.id ?? messageId;
              model = evt.message?.model ?? model;
              break;
            case 'content_block_delta':
              if (evt.delta?.type === 'text_delta' && typeof evt.delta.text === 'string') {
                accumulated += evt.delta.text;
                yield { kind: 'delta', text: evt.delta.text };
              }
              break;
            case 'message_delta':
              // output_tokens here is the running total for the message; stop_reason arrives with it.
              if (typeof evt.usage?.output_tokens === 'number') outputTokens = evt.usage.output_tokens;
              if (evt.delta?.stop_reason != null) stopReason = evt.delta.stop_reason;
              break;
            case 'error':
              throw new LlmProviderError('api_error', `Anthropic stream error: ${JSON.stringify(evt.error ?? evt)}`);
            default:
              // ping / content_block_start / content_block_stop / message_stop — nothing to accumulate.
              break;
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* reader already released on normal completion */
      }
    }

    yield {
      kind: 'final',
      result: {
        content: accumulated,
        tokensPrompt: inputTokens,
        tokensCompletion: outputTokens,
        providerMetadata: {
          provider: 'anthropic',
          model,
          stopReason,
          messageId,
          streamed: true,
        },
      },
    };
  }
}

/**
 * Factory: create an AnthropicAdapter for the given model ID.
 * API key is read at invocation time (not here) — missing key is a runtime error
 * only when generate() is called, not when the adapter is constructed.
 */
export function createAnthropicAdapter(modelId: string): LlmClient {
  return new AnthropicAdapter(modelId);
}

// Suppress unused import warning — LLM_FETCH_TIMEOUT_MS is used by the dispatcher
// but referenced here to ensure this module imports config correctly.
void LLM_FETCH_TIMEOUT_MS;
