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
