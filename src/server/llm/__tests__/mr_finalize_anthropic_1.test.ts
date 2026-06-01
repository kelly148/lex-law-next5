/**
 * MR-FINALIZE-ANTHROPIC-1 — Anthropic temperature omission tests
 *
 * Verifies that the AnthropicAdapter no longer includes the deprecated
 * `temperature` field in the Anthropic Messages API request body, while
 * preserving all other required request fields and adapter behavior.
 *
 * These are unit tests that intercept the fetch call to inspect the
 * serialized request body. No live network calls are made.
 *
 * Test inventory:
 *   T-FINALIZE-ANTHROPIC-1-1 — request body does NOT include temperature
 *   T-FINALIZE-ANTHROPIC-1-2 — request body preserves model, messages, max_tokens, system
 *   T-FINALIZE-ANTHROPIC-1-3 — non-Anthropic adapter files are unmodified
 *   T-FINALIZE-ANTHROPIC-1-4 — finalize workflow still uses jobType formatting and claude model
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { AnthropicAdapter } from '../anthropic.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Shared mock fetch setup
// ---------------------------------------------------------------------------

const MOCK_ANTHROPIC_RESPONSE = {
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'formatted output' }],
  model: 'claude-opus-4-7',
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
};

function makeMockFetch(capturedBodies: unknown[]) {
  return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    capturedBodies.push(body);
    return {
      ok: true,
      json: async () => MOCK_ANTHROPIC_RESPONSE,
      text: async () => JSON.stringify(MOCK_ANTHROPIC_RESPONSE),
    };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// T-FINALIZE-ANTHROPIC-1-1 — request body does NOT include temperature
// ---------------------------------------------------------------------------

describe('T-FINALIZE-ANTHROPIC-1-1: Anthropic request omits deprecated temperature', () => {
  it('does not include temperature in the serialized request body when temperature is omitted by caller', async () => {
    const capturedBodies: unknown[] = [];
    vi.stubGlobal('fetch', makeMockFetch(capturedBodies));
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = new AnthropicAdapter('claude-opus-4-7');
    await adapter.generate({
      systemPrompt: 'You are a legal document formatter.',
      userPrompt: 'Format this document.',
      maxTokens: 8192,
      signal: AbortSignal.timeout(5000),
    });

    expect(capturedBodies).toHaveLength(1);
    const body = capturedBodies[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, 'temperature')).toBe(false);
  });

  it('does not include temperature in the serialized request body even when caller passes temperature', async () => {
    // Even if a caller passes temperature in LlmGenerateParams, the Anthropic
    // adapter must not forward it to the API. (MR-FINALIZE-ANTHROPIC-1)
    const capturedBodies: unknown[] = [];
    vi.stubGlobal('fetch', makeMockFetch(capturedBodies));
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = new AnthropicAdapter('claude-opus-4-7');
    await adapter.generate({
      systemPrompt: 'You are a legal document formatter.',
      userPrompt: 'Format this document.',
      maxTokens: 8192,
      temperature: 0.3,
      signal: AbortSignal.timeout(5000),
    });

    expect(capturedBodies).toHaveLength(1);
    const body = capturedBodies[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, 'temperature')).toBe(false);
  });

  it('does not include temperature for the finalize model (claude-opus-4-7)', async () => {
    const capturedBodies: unknown[] = [];
    vi.stubGlobal('fetch', makeMockFetch(capturedBodies));
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = new AnthropicAdapter('claude-opus-4-7');
    await adapter.generate({
      systemPrompt: 'Format the document.',
      userPrompt: 'Document content here.',
      maxTokens: 8192,
      signal: AbortSignal.timeout(5000),
    });

    const body = capturedBodies[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, 'temperature')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-FINALIZE-ANTHROPIC-1-2 — required fields preserved
// ---------------------------------------------------------------------------

describe('T-FINALIZE-ANTHROPIC-1-2: Anthropic request preserves required fields', () => {
  it('includes model, messages, max_tokens, and system in the request body', async () => {
    const capturedBodies: unknown[] = [];
    vi.stubGlobal('fetch', makeMockFetch(capturedBodies));
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = new AnthropicAdapter('claude-opus-4-7');
    await adapter.generate({
      systemPrompt: 'You are a legal document formatter.',
      userPrompt: 'Format this document.',
      maxTokens: 8192,
      signal: AbortSignal.timeout(5000),
    });

    const body = capturedBodies[0] as Record<string, unknown>;
    expect(body['model']).toBe('claude-opus-4-7');
    expect(body['max_tokens']).toBe(8192);
    expect(body['system']).toBe('You are a legal document formatter.');
    expect(Array.isArray(body['messages'])).toBe(true);
    const messages = body['messages'] as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toBe('Format this document.');
  });

  it('uses default maxTokens of 4096 when caller does not specify', async () => {
    const capturedBodies: unknown[] = [];
    vi.stubGlobal('fetch', makeMockFetch(capturedBodies));
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = new AnthropicAdapter('claude-opus-4-7');
    await adapter.generate({
      systemPrompt: 'System.',
      userPrompt: 'User.',
      signal: AbortSignal.timeout(5000),
    });

    const body = capturedBodies[0] as Record<string, unknown>;
    expect(body['max_tokens']).toBe(4096);
  });

  it('returns content, tokensPrompt, tokensCompletion, and providerMetadata', async () => {
    vi.stubGlobal('fetch', makeMockFetch([]));
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = new AnthropicAdapter('claude-opus-4-7');
    const result = await adapter.generate({
      systemPrompt: 'Format.',
      userPrompt: 'Content.',
      maxTokens: 8192,
      signal: AbortSignal.timeout(5000),
    });

    expect(result.content).toBe('formatted output');
    expect(result.tokensPrompt).toBe(10);
    expect(result.tokensCompletion).toBe(5);
    expect(result.providerMetadata?.['provider']).toBe('anthropic');
    expect(result.providerMetadata?.['model']).toBe('claude-opus-4-7');
  });
});

// ---------------------------------------------------------------------------
// T-FINALIZE-ANTHROPIC-1-3 — non-Anthropic adapter files unmodified
// ---------------------------------------------------------------------------

describe('T-FINALIZE-ANTHROPIC-1-3: Non-Anthropic provider adapters are unaffected', () => {
  const root = resolve(process.cwd());

  it('openai.ts still includes temperature in its request body construction', () => {
    const src = readFileSync(resolve(root, 'src/server/llm/openai.ts'), 'utf-8');
    // OpenAI adapter conditionally includes temperature (gpt-5/o-series omit it,
    // other models include it). The conditional spread is still present.
    expect(src).toContain('temperature');
  });

  it('google.ts still includes temperature in its request body construction', () => {
    const src = readFileSync(resolve(root, 'src/server/llm/google.ts'), 'utf-8');
    expect(src).toContain('temperature');
  });

  it('xai.ts still includes temperature in its request body construction', () => {
    const src = readFileSync(resolve(root, 'src/server/llm/xai.ts'), 'utf-8');
    expect(src).toContain('temperature');
  });

  it('anthropic.ts does NOT include temperature in the requestBody construction', () => {
    const src = readFileSync(resolve(root, 'src/server/llm/anthropic.ts'), 'utf-8');
    // The requestBody object literal must not include temperature
    // (the comment explaining the omission is allowed)
    const requestBodyMatch = src.match(/const requestBody: AnthropicRequest = \{[^}]+\}/s);
    expect(requestBodyMatch).not.toBeNull();
    const requestBodyBlock = requestBodyMatch![0];
    expect(requestBodyBlock).not.toContain('temperature');
  });
});

// ---------------------------------------------------------------------------
// T-FINALIZE-ANTHROPIC-1-4 — finalize workflow unchanged
// ---------------------------------------------------------------------------

describe('T-FINALIZE-ANTHROPIC-1-4: Finalize workflow still uses formatting jobType and Claude model', () => {
  const root = resolve(process.cwd());

  it("documents4a.ts still uses jobType: 'formatting' for the finalize path", () => {
    const src = readFileSync(resolve(root, 'src/server/procedures/documents4a.ts'), 'utf-8');
    expect(src).toContain("jobType: 'formatting'");
  });

  it("documents4a.ts still uses modelString: 'anthropic:claude-opus-4-7' for finalize", () => {
    const src = readFileSync(resolve(root, 'src/server/procedures/documents4a.ts'), 'utf-8');
    expect(src).toContain("modelString: 'anthropic:claude-opus-4-7'");
  });

  it('documents4a.ts finalize buildLlmParams does not pass temperature', () => {
    const src = readFileSync(resolve(root, 'src/server/procedures/documents4a.ts'), 'utf-8');
    // Find the finalize buildLlmParams block (after modelString: 'anthropic:claude-opus-4-7')
    const modelIdx = src.indexOf("modelString: 'anthropic:claude-opus-4-7'");
    const buildLlmParamsIdx = src.indexOf('buildLlmParams:', modelIdx);
    const txn2CommitIdx = src.indexOf('txn2Commit:', buildLlmParamsIdx);
    const buildLlmParamsBlock = src.substring(buildLlmParamsIdx, txn2CommitIdx);
    expect(buildLlmParamsBlock).not.toContain('temperature');
  });

  it('anthropic.ts model string is unchanged (claude-opus-4-7 is the configured finalize model)', () => {
    // The AnthropicAdapter accepts any modelId — model selection is in documents4a.ts.
    // This test confirms the adapter constructor still accepts the model string.
    const adapter = new AnthropicAdapter('claude-opus-4-7');
    expect(adapter).toBeInstanceOf(AnthropicAdapter);
  });
});

// ---------------------------------------------------------------------------
// MR-CAL-5D — structured-output validate-before-normalize
//
// The evaluator's schema is object-shaped ({ dispositions: [...] }). The
// reviewer-era normalizer unwraps a single-key object whose value is an array,
// which would turn the evaluator's correct object into a bare array and then
// fail the object schema (parse_error -> evaluator job fails -> evaluation=null).
// These tests prove the adapter now validates the raw parsed value FIRST (so
// object schemas pass untouched) while still unwrapping for bare-array schemas.
// ---------------------------------------------------------------------------

function makeMockFetchReturning(text: string) {
  return vi.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'claude-opus-4-5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    text: async () => '',
  }));
}

describe('MR-CAL-5D: Anthropic structured output validates object schemas without unwrapping', () => {
  // Mirrors the evaluator's EvaluatorOutputSchema shape.
  const evaluatorLikeSchema = z.object({
    dispositions: z.array(
      z.object({
        suggestionId: z.string(),
        disposition: z.enum(['adopt', 'reject', 'neutral']),
        synthesisBody: z.string().optional(),
      }),
    ),
  });

  it('preserves an object-shaped { dispositions: [...] } result intact (no unwrap to bare array)', async () => {
    const payload = {
      dispositions: [
        { suggestionId: 's1', disposition: 'adopt', synthesisBody: 'Both reviewers agree.' },
      ],
    };
    vi.stubGlobal('fetch', makeMockFetchReturning(JSON.stringify(payload)));
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = new AnthropicAdapter('claude-opus-4-5');
    const result = await adapter.generate({
      systemPrompt: 'Evaluator.',
      userPrompt: 'Synthesize.',
      maxTokens: 8192,
      structuredOutputSchema: evaluatorLikeSchema,
      signal: AbortSignal.timeout(5000),
    });

    // The returned content must still be the object (re-parses to { dispositions: [...] }),
    // NOT a bare array — i.e. the normalizer did not unwrap it.
    const parsed = JSON.parse(result.content);
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed.dispositions).toHaveLength(1);
    expect(parsed.dispositions[0].suggestionId).toBe('s1');
  });

  it('still unwraps a single-key object wrapper for a bare-array schema (reviewer path preserved)', async () => {
    const arraySchema = z.array(z.object({ title: z.string() }));
    // Model wraps the array in a single-key object, as reviewers sometimes do.
    const wrapped = { suggestions: [{ title: 'Issue A' }, { title: 'Issue B' }] };
    vi.stubGlobal('fetch', makeMockFetchReturning(JSON.stringify(wrapped)));
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = new AnthropicAdapter('claude-sonnet-4-5');
    const result = await adapter.generate({
      systemPrompt: 'Reviewer.',
      userPrompt: 'Review.',
      maxTokens: 8192,
      structuredOutputSchema: arraySchema,
      signal: AbortSignal.timeout(5000),
    });

    const parsed = JSON.parse(result.content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe('Issue A');
  });

  it('throws parse_error when neither the raw value nor the normalized value matches the schema', async () => {
    const arraySchema = z.array(z.object({ title: z.string() }));
    vi.stubGlobal('fetch', makeMockFetchReturning(JSON.stringify({ unexpected: 'shape' })));
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const adapter = new AnthropicAdapter('claude-sonnet-4-5');
    await expect(
      adapter.generate({
        systemPrompt: 'Reviewer.',
        userPrompt: 'Review.',
        maxTokens: 8192,
        structuredOutputSchema: arraySchema,
        signal: AbortSignal.timeout(5000),
      }),
    ).rejects.toThrow(/Zod validation/);
  });
});
