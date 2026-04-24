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
 * ERROR TAXONOMY (Ch 22.6):
 *   - AbortError → timeout (propagated to dispatcher)
 *   - HTTP 4xx/5xx → api_error
 *   - JSON parse failure → parse_error
 *   - Zod validation failure → parse_error
 *   - Other → other
 */

import { z } from 'zod';
import { LlmProviderError, type LlmClient, type LlmGenerateParams, type LlmGenerateResult } from './types.js';

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
  };
}

const XAI_API_URL = 'https://api.x.ai/v1/chat/completions';

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
      throw new LlmProviderError(
        'api_error',
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

      const result = (structuredOutputSchema as z.ZodSchema).safeParse(parsed);
      if (!result.success) {
        throw new LlmProviderError(
          'parse_error',
          `xAI Grok structured output failed Zod validation: ${result.error.message}`,
          result.error,
        );
      }

      return {
        content: result.data as Record<string, unknown>,
        tokensPrompt: data.usage.prompt_tokens,
        tokensCompletion: data.usage.completion_tokens,
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
