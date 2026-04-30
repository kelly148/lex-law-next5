/**
 * Google Gemini Provider Adapter (Ch 22.1, Ch 22.3a)
 *
 * Implements the LlmClient interface for Google's Gemini models.
 * Used for:
 *   - Reviewer role (gemini reviewer adapter) — google:gemini-2-5-pro
 *
 * API KEY:
 *   Read from GOOGLE_API_KEY at invocation time, not at startup.
 *   Missing key is a runtime error only if this adapter is actually invoked.
 *
 * STRUCTURED OUTPUT:
 *   Gemini supports JSON mode via responseMimeType: "application/json".
 *   When structuredOutputSchema is provided, we enable JSON mode and validate
 *   the response against the Zod schema (Ch 22.7).
 *
 * SAFETY SETTINGS:
 *   Legal document review may touch sensitive topics (criminal law, etc.).
 *   We set all safety thresholds to BLOCK_NONE for the legal use case.
 *   This is encapsulated here and does not leak to callers.
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

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    responseMimeType?: string;
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
  }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// Safety categories for legal document use
const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

export class GoogleAdapter implements LlmClient {
  constructor(private readonly modelId: string) {}

  async generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    const apiKey = process.env['GOOGLE_API_KEY'];
    if (!apiKey) {
      throw new LlmProviderError(
        'api_error',
        'GOOGLE_API_KEY is not set. Configure it in your environment to use the Google adapter.',
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

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent?key=${apiKey}`;

    const requestBody: GeminiRequest = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
      safetySettings: SAFETY_SETTINGS,
    };

    if (structuredOutputSchema) {
      requestBody.generationConfig = {
        ...requestBody.generationConfig,
        responseMimeType: 'application/json',
      };
    }

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw err;
      }
      throw new LlmProviderError('api_error', `Google Gemini fetch failed: ${String(err)}`, err);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new LlmProviderError(
        'api_error',
        `Google Gemini API error ${response.status}: ${body}`,
      );
    }

    let data: GeminiResponse;
    try {
      data = (await response.json()) as GeminiResponse;
    } catch (err) {
      throw new LlmProviderError('api_error', `Failed to parse Google Gemini response JSON: ${String(err)}`, err);
    }

    if (!data.candidates || data.candidates.length === 0) {
      throw new LlmProviderError(
        'api_error',
        'Google Gemini returned no candidates (empty or missing candidates array). This may indicate a safety filter block or model unavailability.',
      );
    }
    const candidateText = data.candidates[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      const finishReason = data.candidates[0]?.finishReason ?? 'unknown';
      throw new LlmProviderError(
        'api_error',
        `Google Gemini candidate returned no text content (finishReason: ${finishReason}). This may indicate a safety filter block or incomplete response.`,
      );
    }
    const rawText = candidateText;

    if (structuredOutputSchema) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch (err) {
        throw new LlmProviderError(
          'parse_error',
          `Google Gemini response is not valid JSON for structured output: ${String(err)}`,
          err,
        );
      }

      const result = (structuredOutputSchema as z.ZodSchema).safeParse(parsed);
      if (!result.success) {
        throw new LlmProviderError(
          'parse_error',
          `Google Gemini structured output failed Zod validation: ${result.error.message}`,
          result.error,
        );
      }

      return {
        content: result.data as Record<string, unknown>,
        tokensPrompt: data.usageMetadata.promptTokenCount,
        tokensCompletion: data.usageMetadata.candidatesTokenCount,
        providerMetadata: {
          provider: 'google',
          model: this.modelId,
          finishReason: data.candidates[0]?.finishReason,
        },
      };
    }

    return {
      content: rawText,
      tokensPrompt: data.usageMetadata.promptTokenCount,
      tokensCompletion: data.usageMetadata.candidatesTokenCount,
      providerMetadata: {
        provider: 'google',
        model: this.modelId,
        finishReason: data.candidates[0]?.finishReason,
      },
    };
  }
}

export function createGoogleAdapter(modelId: string): LlmClient {
  return new GoogleAdapter(modelId);
}
