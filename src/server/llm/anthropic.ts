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
 * ERROR TAXONOMY (Ch 22.6):
 *   - AbortError → timeout (handled by dispatcher, not here)
 *   - HTTP 4xx/5xx → api_error
 *   - JSON parse failure → parse_error
 *   - Zod validation failure → parse_error
 *   - Other → other
 */

import { z } from 'zod';
import { LlmProviderError, type LlmClient, type LlmGenerateParams, type LlmGenerateResult } from './types.js';
import { LLM_FETCH_TIMEOUT_MS } from './config.js';

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
      temperature = 0.3,
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
      temperature,
    };

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_API_URL, {
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
      throw new LlmProviderError(
        'api_error',
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch (err) {
        throw new LlmProviderError(
          'parse_error',
          `Anthropic response is not valid JSON for structured output: ${String(err)}`,
          err,
        );
      }

      // Validate against the Zod schema (Ch 22.7)
      const result = (structuredOutputSchema as z.ZodSchema).safeParse(parsed);
      if (!result.success) {
        throw new LlmProviderError(
          'parse_error',
          `Anthropic structured output failed Zod validation: ${result.error.message}`,
          result.error,
        );
      }

      return {
        content: result.data as Record<string, unknown>,
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
