/**
 * MODEL-RELIABILITY-UAT-1 — Fix 1: Gemini structured-output hardening
 *
 * Root cause (adapter smoke): Gemini is a "thinking" model; when reasoning + JSON output
 * exceeds maxOutputTokens it truncates. The prior adapter surfaced that inconsistently —
 * sometimes api_error (no text), sometimes a cryptic parse_error "Unterminated string"
 * (partial JSON). That second case is the GEMINI-STRUCTURED-OUTPUT-INVALID-JSON
 * carryforward: truncation masquerading as malformation. The adapter also lacked the
 * fence-strip + object-wrapper normalization the other three adapters have.
 *
 * These tests reproduce each failure mode and prove the fix:
 *   - truncated partial JSON (finishReason MAX_TOKENS) → ONE clear api_error truncation
 *     (NOT parse_error) — the carryforward signature, now correctly classified.
 *   - fenced JSON array → parses (fence stripped), content returned unfenced.
 *   - single-key object-wrapped array → normalized to the array, validates.
 *   - object-shaped schema → still passes untouched (no spurious unwrap).
 *   - genuinely malformed JSON (finishReason STOP) → still parse_error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { GoogleAdapter } from '../google.js';
import { LlmProviderError } from '../types.js';
import { RawSuggestionsArraySchema } from '../parsers/feedbackParser.js';

const BASE_PARAMS = {
  systemPrompt: 'You are a legal reviewer.',
  userPrompt: 'Review this document.',
  maxTokens: 256,
  temperature: 0.3,
  signal: new AbortController().signal,
};

const USAGE_METADATA = { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 };

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function geminiResponse(text: string, finishReason = 'STOP') {
  return makeOkResponse({
    candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason }],
    usageMetadata: USAGE_METADATA,
  });
}

describe('GoogleAdapter — Gemini hardening (MODEL-RELIABILITY-UAT-1)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    process.env['GOOGLE_API_KEY'] = 'test-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['GOOGLE_API_KEY'];
  });

  // ── Carryforward signature: partial JSON truncated at the token ceiling ──
  it('truncated partial JSON (finishReason MAX_TOKENS) → api_error truncation, NOT parse_error', async () => {
    // A partial array that would JSON.parse-fail with "Unterminated string" pre-fix.
    const partial = '[{"title":"Issue","body":"The clause is amb';
    mockFetch.mockResolvedValueOnce(geminiResponse(partial, 'MAX_TOKENS'));
    const adapter = new GoogleAdapter('gemini-2.5-pro');
    await expect(
      adapter.generate({ ...BASE_PARAMS, structuredOutputSchema: RawSuggestionsArraySchema }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'api_error' &&
        err.message.includes('truncated') &&
        err.message.includes('MAX_TOKENS'),
    );
  });

  // ── Fence-strip: Gemini may wrap JSON in a ```json fence despite JSON mode ──
  it('fenced JSON array parses after fence strip and returns unfenced string content', async () => {
    const arr = [{ title: 'Fix heading', body: 'Inconsistent heading.', severity: 'major' }];
    const fenced = '```json\n' + JSON.stringify(arr) + '\n```';
    mockFetch.mockResolvedValueOnce(geminiResponse(fenced, 'STOP'));
    const adapter = new GoogleAdapter('gemini-2.5-pro');
    const result = await adapter.generate({ ...BASE_PARAMS, structuredOutputSchema: RawSuggestionsArraySchema });
    expect(typeof result.content).toBe('string');
    const parsed = JSON.parse(result.content as string);
    expect(RawSuggestionsArraySchema.safeParse(parsed).success).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  // ── Wrapper-normalize: single-key object wrapping the array ──
  it('single-key object-wrapped array is normalized to the array and validates', async () => {
    const wrapped = { feedback: [{ title: 'T', body: 'B', severity: 'minor' }] };
    mockFetch.mockResolvedValueOnce(geminiResponse(JSON.stringify(wrapped), 'STOP'));
    const adapter = new GoogleAdapter('gemini-2.5-pro');
    const result = await adapter.generate({ ...BASE_PARAMS, structuredOutputSchema: RawSuggestionsArraySchema });
    const parsed = JSON.parse(result.content as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(RawSuggestionsArraySchema.safeParse(parsed).success).toBe(true);
  });

  // ── Regression guard: object-shaped schema must NOT be unwrapped ──
  it('object-shaped schema passes untouched (no spurious array-unwrap)', async () => {
    const objectSchema = z.object({ status: z.literal('ok') });
    mockFetch.mockResolvedValueOnce(geminiResponse(JSON.stringify({ status: 'ok' }), 'STOP'));
    const adapter = new GoogleAdapter('gemini-2.5-pro');
    const result = await adapter.generate({ ...BASE_PARAMS, structuredOutputSchema: objectSchema });
    const parsed = JSON.parse(result.content as string);
    expect(objectSchema.safeParse(parsed).success).toBe(true);
  });

  // ── Genuinely malformed (not truncation) still fails as parse_error ──
  it('genuinely malformed JSON with finishReason STOP still throws parse_error', async () => {
    mockFetch.mockResolvedValueOnce(geminiResponse('not valid json {{{', 'STOP'));
    const adapter = new GoogleAdapter('gemini-2.5-pro');
    await expect(
      adapter.generate({ ...BASE_PARAMS, structuredOutputSchema: RawSuggestionsArraySchema }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof LlmProviderError && err.errorClass === 'parse_error',
    );
  });

  // ── Zod failure carries a sanitized shape diagnostic (no content leak) ──
  it('schema-mismatch parse_error includes a sanitized shape diagnostic', async () => {
    // Valid JSON object that is neither the array nor a known wrapper → Zod fails.
    mockFetch.mockResolvedValueOnce(geminiResponse(JSON.stringify({ unexpected: 'x' }), 'STOP'));
    const adapter = new GoogleAdapter('gemini-2.5-pro');
    await expect(
      adapter.generate({ ...BASE_PARAMS, structuredOutputSchema: RawSuggestionsArraySchema }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'parse_error' &&
        err.message.includes('Sanitized output shape') &&
        err.message.includes('topLevelType'),
    );
  });
});
