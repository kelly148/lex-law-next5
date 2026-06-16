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
import { LlmProviderError, httpStatusToErrorClass, type LlmClient, type LlmGenerateParams, type LlmGenerateResult } from './types.js';
import { llmFetch } from './llmFetch.js';
import { normalizeStructuredOutput } from './structuredOutputNormalize.js';

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
    // GEMINI-BUDGET-CAL-1 (Inc 1, measurement): Gemini 2.5 "thinking" models report reasoning
    // tokens here, SEPARATE from candidatesTokenCount (the emitted output). Both consume the
    // maxOutputTokens budget. Optional — absent when the model emits no thinking tokens.
    thoughtsTokenCount?: number;
  };
}

// Safety categories for legal document use
const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

// ============================================================
// MODEL-RELIABILITY-UAT-1: Gemini structured-output hardening
//
// Diagnosis (adapter smoke, gemini-2.5-pro / gemini-2.5-flash): Gemini is a
// "thinking" model that spends output tokens on internal reasoning before emitting
// content. When reasoning + JSON output exceeds maxOutputTokens, the output truncates.
// The PRIOR adapter surfaced that truncation INCONSISTENTLY:
//   - no text emitted          → api_error "no text content (finishReason MAX_TOKENS)"
//   - partial JSON then cut off → JSON.parse fails "Unterminated string" → parse_error
// The second case is the GEMINI-STRUCTURED-OUTPUT-INVALID-JSON carryforward: truncation
// masquerading as a malformation. It also lacked the fence-strip + object-wrapper
// normalization that the OpenAI/Anthropic/xAI adapters already have, so a fenced or
// single-key-wrapped array (common Gemini deviations) failed Zod even when the content
// was otherwise fine. The helpers below bring Gemini to parity and make truncation a
// single, clear, correctly-classified error.
// ============================================================

/**
 * Strip a whole-response ```json ... ``` code fence. Gemini may fence its JSON despite
 * responseMimeType: application/json. If the response is not a whole-response fence it is
 * returned unchanged. (Mirrors the Anthropic adapter's helper.)
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
 * Normalize a Gemini structured-output value when the expected schema is a bare array. Only used as a
 * FALLBACK after direct validation fails, so object-shaped schemas pass untouched. HI-5b: delegates to
 * the SHARED normalizeStructuredOutput so the Gemini lane now has the SAME recovery as OpenAI/xAI —
 * including the nested-wrapper (Rule 4) and singleton-item (Rule 5) rules it previously lacked. Purely
 * additive: it only recovers shapes that previously fell through to parse_error.
 */
export function normalizeGoogleStructuredOutput(value: unknown): unknown {
  return normalizeStructuredOutput(value);
}

/**
 * Safe structural descriptor for a parsed value — top-level type, key names, value
 * types, array lengths. MUST NOT include document text, feedback body, or keys.
 * (Mirrors the OpenAI/xAI adapters' diagnostic helper.)
 */
export function sanitizeShapeForDiagnostic(value: unknown): Record<string, unknown> {
  if (value === null) return { topLevelType: 'null' };
  if (Array.isArray(value)) return { topLevelType: 'array', length: value.length };
  if (typeof value !== 'object') return { topLevelType: typeof value };
  const obj = value as Record<string, unknown>;
  const keys: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) keys[k] = `array(length=${v.length})`;
    else if (v !== null && typeof v === 'object') keys[k] = 'object';
    else keys[k] = v === null ? 'null' : typeof v;
  }
  return { topLevelType: 'object', keys };
}

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
      response = await llmFetch(apiUrl, {
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
      // MODEL-RELIABILITY-UAT-1: 429 → rate_limited, 401/403 → auth_error, else api_error.
      throw new LlmProviderError(
        httpStatusToErrorClass(response.status),
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
      const finishReason = data.candidates[0]?.finishReason;
      // MODEL-RELIABILITY-UAT-1: truncation guard. A "thinking" Gemini model can emit
      // partial JSON then stop at the token ceiling (finishReason MAX_TOKENS), which
      // JSON.parse would report as a cryptic "Unterminated string" parse_error. Surface
      // truncation as ONE clear, correctly-classified api_error instead — consistent with
      // the no-text MAX_TOKENS branch above and with the OpenAI adapter's finish_reason
      // 'length' guard. Only the two confirmed-problem values are caught; all others fall
      // through to the existing parse path (failing-open default).
      if (finishReason === 'MAX_TOKENS') {
        throw new LlmProviderError(
          'api_error',
          `Google Gemini structured output was truncated (finishReason: MAX_TOKENS) before valid JSON could be produced. ` +
            `This is an output-budget truncation, not a malformed response — raise maxOutputTokens or reduce input size.`,
        );
      }

      // MODEL-RELIABILITY-UAT-1: strip a whole-response code fence before parsing.
      const effectiveText = stripJsonCodeFenceIfWholeResponse(rawText);

      let parsed: unknown;
      try {
        parsed = JSON.parse(effectiveText);
      } catch (err) {
        throw new LlmProviderError(
          'parse_error',
          `Google Gemini response is not valid JSON for structured output (finishReason: ${finishReason ?? 'unknown'}): ${String(err)}`,
          err,
        );
      }

      // MODEL-RELIABILITY-UAT-1: validate the raw parsed value FIRST so object-shaped
      // schemas pass untouched; only fall back to array-unwrap normalization on failure
      // (same ordering as the Anthropic adapter; avoids unwrapping a legit object result).
      const schema = structuredOutputSchema as z.ZodSchema;
      const direct = schema.safeParse(parsed);
      let validated: unknown;
      let usedNormalization: boolean;
      if (direct.success) {
        validated = parsed;
        usedNormalization = false;
      } else {
        const normalized = normalizeGoogleStructuredOutput(parsed);
        const result = schema.safeParse(normalized);
        if (!result.success) {
          const shapeDiag = sanitizeShapeForDiagnostic(normalized);
          throw new LlmProviderError(
            'parse_error',
            `Google Gemini structured output failed Zod validation: ${result.error.message}. Sanitized output shape: ${JSON.stringify(shapeDiag)}`,
            result.error,
          );
        }
        validated = normalized;
        usedNormalization = normalized !== parsed;
      }

      // Return content as a string (consistent with the other adapters). Re-serialize
      // only when normalization actually transformed the value.
      const contentText = usedNormalization ? JSON.stringify(validated) : effectiveText;

      return {
        content: contentText,
        tokensPrompt: data.usageMetadata.promptTokenCount,
        tokensCompletion: data.usageMetadata.candidatesTokenCount,
        tokensReasoning: data.usageMetadata.thoughtsTokenCount,
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
      tokensReasoning: data.usageMetadata.thoughtsTokenCount,
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
