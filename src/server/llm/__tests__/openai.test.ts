/**
 * openai.test.ts — MR-LLM-1 S2
 *
 * Unit tests for OpenAI adapter request-body shape.
 * Tests 2, 3, 4 of the MR-LLM-1 S2 test suite.
 *
 * All tests mock globalThis.fetch and assert the constructed
 * request body without making live API calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { OpenAiAdapter } from '../openai.js';

// Minimal valid OpenAI Chat Completions response shape
function makeFetchResponse(content: string) {
  const body = JSON.stringify({
    id: 'chatcmpl-test',
    model: 'gpt-5',
    choices: [
      {
        message: { role: 'assistant', content },
        finish_reason: 'stop',
        index: 0,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
  return Promise.resolve(
    new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
}

describe('OpenAiAdapter — request body shape (MR-LLM-1 S2)', () => {
  let capturedBody: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFetch: any;

  beforeEach(() => {
    capturedBody = {};
    mockFetch = vi.fn((_url: unknown, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
      // For structured output tests, return valid JSON matching the schema
      const reqBody = capturedBody as { response_format?: { type: string } };
      const content =
        reqBody.response_format?.type === 'json_object'
          ? JSON.stringify([{ title: 'Test', body: 'Test body', severity: 'minor' }])
          : 'plain text response';
      return makeFetchResponse(content);
    });
    vi.stubGlobal('fetch', mockFetch);
    // Provide a dummy API key so the adapter does not throw on missing key
    process.env['OPENAI_API_KEY'] = 'sk-test-dummy';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  // ── Test 2 — response_format injected when structuredOutputSchema is present ──
  it('Test 2: includes response_format: { type: "json_object" } when structuredOutputSchema is provided', async () => {
    const adapter = new OpenAiAdapter('gpt-5');
    const schema = z.array(z.object({ title: z.string(), body: z.string(), severity: z.enum(['critical', 'major', 'minor']) }));
    await adapter.generate({
      systemPrompt: 'You are a reviewer.',
      userPrompt: 'Review this.',
      structuredOutputSchema: schema,
      temperature: 0.4,
      maxTokens: 4096,
      signal: new AbortController().signal,
    });
    expect(capturedBody['response_format']).toEqual({ type: 'json_object' });
  });

  // ── Test 3 — temperature omitted for gpt-5 ──
  it('Test 3: omits temperature and uses max_completion_tokens for gpt-5', async () => {
    const adapter = new OpenAiAdapter('gpt-5');
    await adapter.generate({
      systemPrompt: 'You are a reviewer.',
      userPrompt: 'Review this.',
      temperature: 0.4,
      maxTokens: 4096,
      signal: new AbortController().signal,
    });
    expect(capturedBody['temperature']).toBeUndefined();
    expect(capturedBody['max_completion_tokens']).toBe(4096);
    expect(capturedBody['max_tokens']).toBeUndefined();
  });

  // ── Test 4 — temperature preserved for non-gpt-5/o-series models ──
  it('Test 4: preserves temperature and uses max_tokens for non-gpt-5 models (gpt-4o)', async () => {
    const adapter = new OpenAiAdapter('gpt-4o');
    await adapter.generate({
      systemPrompt: 'You are a reviewer.',
      userPrompt: 'Review this.',
      temperature: 0.4,
      maxTokens: 4096,
      signal: new AbortController().signal,
    });
    expect(capturedBody['temperature']).toBe(0.4);
    expect(capturedBody['max_tokens']).toBe(4096);
    expect(capturedBody['max_completion_tokens']).toBeUndefined();
  });
});

// ============================================================
// MR-LLM-1 S5 — Structured-output return normalization tests
// ============================================================

import { LlmProviderError } from '../types.js';
import { RawSuggestionsArraySchema } from '../../llm/parsers/feedbackParser.js';

describe('OpenAiAdapter — structured-output returns rawText string (MR-LLM-1 S5)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    process.env['OPENAI_API_KEY'] = 'sk-test-dummy';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  // ── T1 — Array schema: content is typeof string, NOT array ──
  it('T1: returns content as string (not array) when structuredOutputSchema is an array schema', async () => {
    const arrayPayload = JSON.stringify([
      { title: 'Fix heading', body: 'The heading is inconsistent.', severity: 'major' },
    ]);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-t1',
          model: 'gpt-5',
          choices: [{ message: { role: 'assistant', content: arrayPayload }, finish_reason: 'stop', index: 0 }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a reviewer.',
      userPrompt: 'Review this.',
      structuredOutputSchema: RawSuggestionsArraySchema,
      temperature: 0.4,
      maxTokens: 4096,
      signal: new AbortController().signal,
    });

    expect(typeof result.content).toBe('string');
    expect(Array.isArray(result.content)).toBe(false);
  });

  // ── T2 — Array schema: JSON.parse(content) validates against RawSuggestionsArraySchema ──
  it('T2: JSON.parse(content) validates against RawSuggestionsArraySchema after array-schema call', async () => {
    const arrayPayload = JSON.stringify([
      { title: 'Fix heading', body: 'The heading is inconsistent.', severity: 'major' },
    ]);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-t2',
          model: 'gpt-5',
          choices: [{ message: { role: 'assistant', content: arrayPayload }, finish_reason: 'stop', index: 0 }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a reviewer.',
      userPrompt: 'Review this.',
      structuredOutputSchema: RawSuggestionsArraySchema,
      temperature: 0.4,
      maxTokens: 4096,
      signal: new AbortController().signal,
    });

    const parsed = JSON.parse(result.content as string);
    const validation = RawSuggestionsArraySchema.safeParse(parsed);
    expect(validation.success).toBe(true);
  });

  // ── T3 — Array schema: malformed JSON throws LlmProviderError('parse_error') ──
  it('T3: throws LlmProviderError parse_error when response is malformed JSON for array schema', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-t3',
          model: 'gpt-5',
          choices: [{ message: { role: 'assistant', content: 'not valid json {{{' }, finish_reason: 'stop', index: 0 }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const adapter = new OpenAiAdapter('gpt-5');
    await expect(
      adapter.generate({
        systemPrompt: 'You are a reviewer.',
        userPrompt: 'Review this.',
        structuredOutputSchema: RawSuggestionsArraySchema,
        temperature: 0.4,
        maxTokens: 4096,
        signal: new AbortController().signal,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError && err.errorClass === 'parse_error',
    );
  });

  // ── T4 — Object schema: content is typeof string, NOT object ──
  it('T4: returns content as string (not object) when structuredOutputSchema is an object schema', async () => {
    const objectPayload = JSON.stringify({ status: 'ok' });
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-t4',
          model: 'gpt-5',
          choices: [{ message: { role: 'assistant', content: objectPayload }, finish_reason: 'stop', index: 0 }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const objectSchema = z.object({ status: z.literal('ok') });
    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a JSON API.',
      userPrompt: 'Return status ok.',
      structuredOutputSchema: objectSchema,
      temperature: 0.4,
      maxTokens: 32,
      signal: new AbortController().signal,
    });

    expect(typeof result.content).toBe('string');
    expect(typeof result.content !== 'object').toBe(true);
  });

  // ── T5 — Object schema: JSON.parse(content) validates against object schema ──
  it('T5: JSON.parse(content) validates against object schema after object-schema call', async () => {
    const objectPayload = JSON.stringify({ status: 'ok' });
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-t5',
          model: 'gpt-5',
          choices: [{ message: { role: 'assistant', content: objectPayload }, finish_reason: 'stop', index: 0 }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const objectSchema = z.object({ status: z.literal('ok') });
    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a JSON API.',
      userPrompt: 'Return status ok.',
      structuredOutputSchema: objectSchema,
      temperature: 0.4,
      maxTokens: 32,
      signal: new AbortController().signal,
    });

    const parsed = JSON.parse(result.content as string);
    const validation = objectSchema.safeParse(parsed);
    expect(validation.success).toBe(true);
  });

  // ── T6 — Object schema: malformed JSON throws LlmProviderError('parse_error') ──
  it('T6: throws LlmProviderError parse_error when response is malformed JSON for object schema', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-t6',
          model: 'gpt-5',
          choices: [{ message: { role: 'assistant', content: '{ broken json' }, finish_reason: 'stop', index: 0 }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const objectSchema = z.object({ status: z.literal('ok') });
    const adapter = new OpenAiAdapter('gpt-5');
    await expect(
      adapter.generate({
        systemPrompt: 'You are a JSON API.',
        userPrompt: 'Return status ok.',
        structuredOutputSchema: objectSchema,
        temperature: 0.4,
        maxTokens: 32,
        signal: new AbortController().signal,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError && err.errorClass === 'parse_error',
    );
  });
});
// ============================================================
// MR-LLM-1 S8 — finish_reason guard + empty-content guard tests
// ============================================================
describe('OpenAiAdapter — finish_reason and empty-content guards (MR-LLM-1 S8)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  const objectSchema = z.object({ status: z.literal('ok') });

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    process.env['OPENAI_API_KEY'] = 'sk-test-dummy';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  // Helper: build a mock OpenAI response with configurable finish_reason and content
  function makeResponse(finishReason: string | null, content: string | null) {
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-s8',
        model: 'gpt-5',
        choices: [
          {
            message: { role: 'assistant', content },
            finish_reason: finishReason,
            index: 0,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── T-S8-1 — Guard A (named-target): finish_reason='content_filter' throws api_error ──
  it('T-S8-1: throws LlmProviderError api_error when finish_reason is content_filter (named-target guard, structured output)', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse('content_filter', '{"status":"ok"}'));
    const adapter = new OpenAiAdapter('gpt-5');
    await expect(
      adapter.generate({
        systemPrompt: 'You are a JSON API.',
        userPrompt: 'Return status ok.',
        structuredOutputSchema: objectSchema,
        temperature: 0.4,
        maxTokens: 32,
        signal: new AbortController().signal,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'api_error' &&
        err.message.includes("content_filter") &&
        err.message.includes('content policy triggered'),
    );
  });

  // ── T-S8-2 — Guard A (named-target): finish_reason='length' throws api_error ──
  it('T-S8-2: throws LlmProviderError api_error when finish_reason is length (named-target guard, structured output)', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse('length', '{"status":"ok"}'));
    const adapter = new OpenAiAdapter('gpt-5');
    await expect(
      adapter.generate({
        systemPrompt: 'You are a JSON API.',
        userPrompt: 'Return status ok.',
        structuredOutputSchema: objectSchema,
        temperature: 0.4,
        maxTokens: 32,
        signal: new AbortController().signal,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'api_error' &&
        err.message.includes('length') &&
        err.message.includes('token truncation'),
    );
  });

  // ── T-S8-2b — Guard A (failing-open): finish_reason='tool_calls' passes through to parse path ──
  // Resolution A carryforward: non-named finish_reason values pass through to Guard B and JSON.parse.
  it('T-S8-2b: finish_reason=tool_calls passes through Guard A and succeeds when content is valid JSON (failing-open default)', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse('tool_calls', '{"status":"ok"}'));
    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a JSON API.',
      userPrompt: 'Return status ok.',
      structuredOutputSchema: objectSchema,
      temperature: 0.4,
      maxTokens: 32,
      signal: new AbortController().signal,
    });
    // Guard A does NOT fire; content passes through to JSON.parse and Zod validation
    expect(typeof result.content).toBe('string');
    expect(result.content).toBe('{"status":"ok"}');
  });

  // ── T-S8-3 — Guard B: content=null (rawText='') with finish_reason='stop' throws api_error ──
  it('T-S8-3: throws LlmProviderError api_error when content is null (rawText empty) with finish_reason stop', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse('stop', null));
    const adapter = new OpenAiAdapter('gpt-5');
    await expect(
      adapter.generate({
        systemPrompt: 'You are a JSON API.',
        userPrompt: 'Return status ok.',
        structuredOutputSchema: objectSchema,
        temperature: 0.4,
        maxTokens: 32,
        signal: new AbortController().signal,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'api_error' &&
        err.message.includes('empty content'),
    );
  });

  // ── T-S8-4 — Guard B: content='' explicitly throws api_error ──
  it('T-S8-4: throws LlmProviderError api_error when content is explicit empty string (structured output)', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse('stop', ''));
    const adapter = new OpenAiAdapter('gpt-5');
    await expect(
      adapter.generate({
        systemPrompt: 'You are a JSON API.',
        userPrompt: 'Return status ok.',
        structuredOutputSchema: objectSchema,
        temperature: 0.4,
        maxTokens: 32,
        signal: new AbortController().signal,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof LlmProviderError &&
        err.errorClass === 'api_error' &&
        err.message.includes('empty content'),
    );
  });

  // ── T-S8-5 — Happy path: finish_reason='stop' + valid JSON content succeeds ──
  it('T-S8-5: succeeds and returns string content when finish_reason is stop and content is valid JSON', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse('stop', '{"status":"ok"}'));
    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a JSON API.',
      userPrompt: 'Return status ok.',
      structuredOutputSchema: objectSchema,
      temperature: 0.4,
      maxTokens: 32,
      signal: new AbortController().signal,
    });
    expect(typeof result.content).toBe('string');
    expect(result.content).toBe('{"status":"ok"}');
  });

  // ── T-S8-6 — Happy path: finish_reason=null + valid JSON content succeeds ──
  it('T-S8-6: succeeds when finish_reason is null (legacy/streaming) and content is valid JSON', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(null, '{"status":"ok"}'));
    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a JSON API.',
      userPrompt: 'Return status ok.',
      structuredOutputSchema: objectSchema,
      temperature: 0.4,
      maxTokens: 32,
      signal: new AbortController().signal,
    });
    expect(typeof result.content).toBe('string');
    expect(result.content).toBe('{"status":"ok"}');
  });

  // ── T-S8-7 — Non-structured path: finish_reason='content_filter' does NOT throw ──
  it('T-S8-7: non-structured-output path is unaffected when finish_reason is content_filter', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse('content_filter', 'some plain text'));
    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a plain text API.',
      userPrompt: 'Return some text.',
      // No structuredOutputSchema — plain text path
      temperature: 0.4,
      maxTokens: 32,
      signal: new AbortController().signal,
    });
    expect(result.content).toBe('some plain text');
  });

  // ── T-S8-8 — Non-structured path: empty content does NOT throw ──
  it('T-S8-8: non-structured-output path is unaffected when content is empty string', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse('stop', ''));
    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a plain text API.',
      userPrompt: 'Return some text.',
      // No structuredOutputSchema — plain text path
      temperature: 0.4,
      maxTokens: 32,
      signal: new AbortController().signal,
    });
    expect(result.content).toBe('');
  });

  // ── T-S8-9 — Non-structured path: null content (rawText='') does NOT throw ──
  it('T-S8-9: non-structured-output path is unaffected when content is null (rawText empty)', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse('stop', null));
    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({
      systemPrompt: 'You are a plain text API.',
      userPrompt: 'Return some text.',
      // No structuredOutputSchema — plain text path
      temperature: 0.4,
      maxTokens: 32,
      signal: new AbortController().signal,
    });
    expect(result.content).toBe('');
  });
});
