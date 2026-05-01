/**
 * MR-LLM-1 S3 — Google Adapter Hardening Tests
 *
 * Tests the two-level guards added to src/server/llm/google.ts:
 *   - Test 1: Empty candidates array throws LlmProviderError('api_error')
 *   - Test 2: Undefined/missing candidates throws LlmProviderError('api_error')
 *   - Test 3: Candidate exists but text is missing/empty throws LlmProviderError('api_error')
 *   - Test 4: Happy-path well-formed response returns expected text without throwing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleAdapter } from '../google.js';
import { LlmProviderError } from '../types.js';

const BASE_PARAMS = {
  systemPrompt: 'You are a legal reviewer.',
  userPrompt: 'Review this document.',
  maxTokens: 256,
  temperature: 0.3,
  signal: new AbortController().signal,
};

const USAGE_METADATA = {
  promptTokenCount: 10,
  candidatesTokenCount: 20,
  totalTokenCount: 30,
};

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('GoogleAdapter — candidates and text guards (MR-LLM-1 S3)', () => {
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

  // Test 1: Empty candidates array
  it('throws LlmProviderError api_error when candidates array is empty', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ candidates: [], usageMetadata: USAGE_METADATA }),
    );

    const adapter = new GoogleAdapter('gemini-2.5-pro');
    await expect(adapter.generate(BASE_PARAMS)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'api_error' &&
        err.message.includes('no candidates'),
    );
  });

  // Test 2: Undefined/missing candidates
  it('throws LlmProviderError api_error when candidates is undefined', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ usageMetadata: USAGE_METADATA }),
    );

    const adapter = new GoogleAdapter('gemini-2.5-pro');
    await expect(adapter.generate(BASE_PARAMS)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'api_error' &&
        err.message.includes('no candidates'),
    );
  });

  // Test 3: Candidate exists but text is missing/empty
  it('throws LlmProviderError api_error when candidate has no text content', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({
        candidates: [
          {
            content: { parts: [], role: 'model' },
            finishReason: 'SAFETY',
          },
        ],
        usageMetadata: USAGE_METADATA,
      }),
    );

    const adapter = new GoogleAdapter('gemini-2.5-pro');
    await expect(adapter.generate(BASE_PARAMS)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'api_error' &&
        err.message.includes('no text content') &&
        err.message.includes('SAFETY'),
    );
  });

  // Test 4: Happy path — well-formed response returns expected text
  it('returns expected text content for a well-formed Gemini response', async () => {
    const expectedText = 'This is the reviewer feedback.';
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({
        candidates: [
          {
            content: {
              parts: [{ text: expectedText }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: USAGE_METADATA,
      }),
    );

    const adapter = new GoogleAdapter('gemini-2.5-pro');
    const result = await adapter.generate(BASE_PARAMS);
    expect(result.content).toBe(expectedText);
    expect(result.tokensPrompt).toBe(10);
    expect(result.tokensCompletion).toBe(20);
  });
});

// ============================================================
// MR-LLM-1 S5 — Structured-output return normalization tests
// ============================================================

import { z } from 'zod';
import { RawSuggestionsArraySchema } from '../../llm/parsers/feedbackParser.js';

describe('GoogleAdapter — structured-output returns rawText string (MR-LLM-1 S5)', () => {
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

  function makeGeminiResponse(textContent: string) {
    return makeOkResponse({
      candidates: [
        {
          content: { parts: [{ text: textContent }], role: 'model' },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: USAGE_METADATA,
    });
  }

  // ── T7 — Array schema: content is typeof string, NOT array ──
  it('T7: returns content as string (not array) when structuredOutputSchema is an array schema', async () => {
    const arrayPayload = JSON.stringify([
      { title: 'Fix heading', body: 'The heading is inconsistent.', severity: 'major' },
    ]);
    mockFetch.mockResolvedValueOnce(makeGeminiResponse(arrayPayload));

    const adapter = new GoogleAdapter('gemini-2.5-pro');
    const result = await adapter.generate({
      ...BASE_PARAMS,
      structuredOutputSchema: RawSuggestionsArraySchema,
    });

    expect(typeof result.content).toBe('string');
    expect(Array.isArray(result.content)).toBe(false);
  });

  // ── T8 — Array schema: JSON.parse(content) validates against RawSuggestionsArraySchema ──
  it('T8: JSON.parse(content) validates against RawSuggestionsArraySchema after array-schema call', async () => {
    const arrayPayload = JSON.stringify([
      { title: 'Fix heading', body: 'The heading is inconsistent.', severity: 'major' },
    ]);
    mockFetch.mockResolvedValueOnce(makeGeminiResponse(arrayPayload));

    const adapter = new GoogleAdapter('gemini-2.5-pro');
    const result = await adapter.generate({
      ...BASE_PARAMS,
      structuredOutputSchema: RawSuggestionsArraySchema,
    });

    const parsed = JSON.parse(result.content as string);
    const validation = RawSuggestionsArraySchema.safeParse(parsed);
    expect(validation.success).toBe(true);
  });

  // ── T9 — Array schema: malformed JSON throws LlmProviderError('parse_error') ──
  it('T9: throws LlmProviderError parse_error when response is malformed JSON for array schema', async () => {
    mockFetch.mockResolvedValueOnce(makeGeminiResponse('not valid json {{{'));

    const adapter = new GoogleAdapter('gemini-2.5-pro');
    await expect(
      adapter.generate({
        ...BASE_PARAMS,
        structuredOutputSchema: RawSuggestionsArraySchema,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError && err.errorClass === 'parse_error',
    );
  });

  // ── T10 — Object schema: content is typeof string, NOT object ──
  it('T10: returns content as string (not object) when structuredOutputSchema is an object schema', async () => {
    const objectPayload = JSON.stringify({ status: 'ok' });
    mockFetch.mockResolvedValueOnce(makeGeminiResponse(objectPayload));

    const objectSchema = z.object({ status: z.literal('ok') });
    const adapter = new GoogleAdapter('gemini-2.5-pro');
    const result = await adapter.generate({
      ...BASE_PARAMS,
      structuredOutputSchema: objectSchema,
    });

    expect(typeof result.content).toBe('string');
    expect(typeof result.content !== 'object').toBe(true);
  });

  // ── T11 — Object schema: JSON.parse(content) validates against object schema ──
  it('T11: JSON.parse(content) validates against object schema after object-schema call', async () => {
    const objectPayload = JSON.stringify({ status: 'ok' });
    mockFetch.mockResolvedValueOnce(makeGeminiResponse(objectPayload));

    const objectSchema = z.object({ status: z.literal('ok') });
    const adapter = new GoogleAdapter('gemini-2.5-pro');
    const result = await adapter.generate({
      ...BASE_PARAMS,
      structuredOutputSchema: objectSchema,
    });

    const parsed = JSON.parse(result.content as string);
    const validation = objectSchema.safeParse(parsed);
    expect(validation.success).toBe(true);
  });

  // ── T12 — Object schema: malformed JSON throws LlmProviderError('parse_error') ──
  it('T12: throws LlmProviderError parse_error when response is malformed JSON for object schema', async () => {
    mockFetch.mockResolvedValueOnce(makeGeminiResponse('{ broken json'));

    const objectSchema = z.object({ status: z.literal('ok') });
    const adapter = new GoogleAdapter('gemini-2.5-pro');
    await expect(
      adapter.generate({
        ...BASE_PARAMS,
        structuredOutputSchema: objectSchema,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError && err.errorClass === 'parse_error',
    );
  });
});
