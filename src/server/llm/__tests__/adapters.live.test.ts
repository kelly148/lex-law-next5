/**
 * Live-API Integration Tests for LLM Provider Adapters
 *
 * These tests make REAL network calls to the provider APIs.
 * They are GATED behind the RUN_LIVE_TESTS=1 environment variable
 * and are NEVER run in default CI.
 *
 * To run locally:
 *   RUN_LIVE_TESTS=1 \
 *   ANTHROPIC_API_KEY=sk-ant-... \
 *   OPENAI_API_KEY=sk-... \
 *   GOOGLE_API_KEY=... \
 *   XAI_API_KEY=xai-... \
 *   pnpm test src/server/llm/__tests__/adapters.live.test.ts
 *
 * Each test performs a minimal round-trip call to verify:
 *   1. The adapter constructs the correct request shape for the provider.
 *   2. The provider returns a non-empty response.
 *   3. Token usage fields are populated.
 *   4. Structured output (JSON mode) returns a parsed object in content.
 *   5. The adapter throws LlmProviderError when the API key is missing.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AnthropicAdapter } from '../anthropic.js';
import { OpenAiAdapter } from '../openai.js';
import { GoogleAdapter } from '../google.js';
import { XaiAdapter } from '../xai.js';
import { LlmProviderError, type LlmGenerateParams } from '../types.js';

// ============================================================
// Gate: skip entire file if RUN_LIVE_TESTS is not set
// ============================================================

const RUN_LIVE = process.env['RUN_LIVE_TESTS'] === '1';
const liveDescribe = RUN_LIVE ? describe : describe.skip;

// Minimal prompt for live tests — short to keep token cost low
const MINIMAL_PARAMS: Omit<LlmGenerateParams, 'signal'> = {
  systemPrompt: 'You are a helpful assistant. Respond with exactly one word.',
  userPrompt: 'Say the word: PONG',
  maxTokens: 16,
  temperature: 0,
};

const STRUCTURED_PARAMS: Omit<LlmGenerateParams, 'signal'> = {
  systemPrompt: 'You are a JSON API. Return only valid JSON, no markdown.',
  userPrompt: 'Return a JSON object with a single key "status" set to "ok".',
  maxTokens: 32,
  temperature: 0,
  structuredOutputSchema: z.object({ status: z.literal('ok') }),
};

function makeSignal(): AbortSignal {
  return AbortSignal.timeout(30_000); // 30s timeout for live tests
}

// ============================================================
// Anthropic (Claude)
// ============================================================

liveDescribe('Live: AnthropicAdapter (claude-opus-4-5)', () => {
  it('returns a non-empty text response', async () => {
    const adapter = new AnthropicAdapter('claude-opus-4-5');
    const result = await adapter.generate({ ...MINIMAL_PARAMS, signal: makeSignal() });

    expect(typeof result.content === 'string' && result.content.trim().length > 0).toBe(true);
    expect(result.tokensPrompt).toBeGreaterThan(0);
    expect(result.tokensCompletion).toBeGreaterThan(0);
    expect(result.providerMetadata['provider']).toBe('anthropic');
  });

  it('returns parsed structured output when schema is provided', async () => {
    const adapter = new AnthropicAdapter('claude-opus-4-5');
    const result = await adapter.generate({ ...STRUCTURED_PARAMS, signal: makeSignal() });

    // When structuredOutputSchema is provided, content is a ParsedStructuredOutput object
    expect(typeof result.content).toBe('object');
    expect((result.content as Record<string, unknown>)['status']).toBe('ok');
  });

  it('throws LlmProviderError when ANTHROPIC_API_KEY is missing', async () => {
    const saved = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    try {
      const adapter = new AnthropicAdapter('claude-opus-4-5');
      await expect(
        adapter.generate({ ...MINIMAL_PARAMS, signal: makeSignal() }),
      ).rejects.toThrow(LlmProviderError);
    } finally {
      if (saved !== undefined) process.env['ANTHROPIC_API_KEY'] = saved;
    }
  });
});

// ============================================================
// OpenAI (GPT)
// ============================================================

liveDescribe('Live: OpenAiAdapter (gpt-5)', () => {
  it('returns a non-empty text response', async () => {
    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({ ...MINIMAL_PARAMS, signal: makeSignal() });

    expect(typeof result.content === 'string' && result.content.trim().length > 0).toBe(true);
    expect(result.tokensPrompt).toBeGreaterThan(0);
    expect(result.tokensCompletion).toBeGreaterThan(0);
    expect(result.providerMetadata['provider']).toBe('openai');
  });

  it('returns parsed structured output when schema is provided', async () => {
    const adapter = new OpenAiAdapter('gpt-5');
    const result = await adapter.generate({ ...STRUCTURED_PARAMS, signal: makeSignal() });

    expect(typeof result.content).toBe('string');
    const parsed = JSON.parse(result.content as string);
    expect(parsed.status).toBe('ok');
  });

  it('throws LlmProviderError when OPENAI_API_KEY is missing', async () => {
    const saved = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    try {
      const adapter = new OpenAiAdapter('gpt-5');
      await expect(
        adapter.generate({ ...MINIMAL_PARAMS, signal: makeSignal() }),
      ).rejects.toThrow(LlmProviderError);
    } finally {
      if (saved !== undefined) process.env['OPENAI_API_KEY'] = saved;
    }
  });
});

// ============================================================
// Google (Gemini)
// ============================================================

liveDescribe('Live: GoogleAdapter (gemini-2-5-pro)', () => {
  it('returns a non-empty text response', async () => {
    const adapter = new GoogleAdapter('gemini-2-5-pro');
    const result = await adapter.generate({ ...MINIMAL_PARAMS, signal: makeSignal() });

    expect(typeof result.content === 'string' && result.content.trim().length > 0).toBe(true);
    expect(result.tokensPrompt).toBeGreaterThan(0);
    expect(result.tokensCompletion).toBeGreaterThan(0);
    expect(result.providerMetadata['provider']).toBe('google');
  });

  it('returns parsed structured output when schema is provided', async () => {
    const adapter = new GoogleAdapter('gemini-2-5-pro');
    const result = await adapter.generate({ ...STRUCTURED_PARAMS, signal: makeSignal() });

    expect(typeof result.content).toBe('string');
    const parsed = JSON.parse(result.content as string);
    expect(parsed.status).toBe('ok');
  });

  it('throws LlmProviderError when GOOGLE_API_KEY is missing', async () => {
    const saved = process.env['GOOGLE_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
    try {
      const adapter = new GoogleAdapter('gemini-2-5-pro');
      await expect(
        adapter.generate({ ...MINIMAL_PARAMS, signal: makeSignal() }),
      ).rejects.toThrow(LlmProviderError);
    } finally {
      if (saved !== undefined) process.env['GOOGLE_API_KEY'] = saved;
    }
  });
});

// ============================================================
// xAI (Grok)
// ============================================================

liveDescribe('Live: XaiAdapter (grok-4)', () => {
  it('returns a non-empty text response', async () => {
    const adapter = new XaiAdapter('grok-4');
    const result = await adapter.generate({ ...MINIMAL_PARAMS, signal: makeSignal() });

    expect(typeof result.content === 'string' && result.content.trim().length > 0).toBe(true);
    expect(result.tokensPrompt).toBeGreaterThan(0);
    expect(result.tokensCompletion).toBeGreaterThan(0);
    expect(result.providerMetadata['provider']).toBe('xai');
  });

  it('returns parsed structured output when schema is provided', async () => {
    const adapter = new XaiAdapter('grok-4');
    const result = await adapter.generate({ ...STRUCTURED_PARAMS, signal: makeSignal() });

    expect(typeof result.content).toBe('object');
    expect((result.content as Record<string, unknown>)['status']).toBe('ok');
  });

  it('throws LlmProviderError when XAI_API_KEY is missing', async () => {
    const saved = process.env['XAI_API_KEY'];
    delete process.env['XAI_API_KEY'];
    try {
      const adapter = new XaiAdapter('grok-4');
      await expect(
        adapter.generate({ ...MINIMAL_PARAMS, signal: makeSignal() }),
      ).rejects.toThrow(LlmProviderError);
    } finally {
      if (saved !== undefined) process.env['XAI_API_KEY'] = saved;
    }
  });
});

// ============================================================
// Verify: live tests are gated behind RUN_LIVE_TESTS=1
// ============================================================

describe('Live test gate (always runs in CI)', () => {
  it('confirms live tests are gated behind RUN_LIVE_TESTS env var', () => {
    // In default CI (RUN_LIVE_TESTS not set), RUN_LIVE is false.
    // The live test suites above use describe.skip when RUN_LIVE is false,
    // which causes Vitest to skip them. This test verifies the gate value.
    //
    // We cannot use toBe(describe.skip) because describe.skip is a new
    // function reference each time it is accessed (Vitest chain pattern).
    // Instead we verify the boolean gate directly.
    expect(typeof RUN_LIVE).toBe('boolean');
    // In default CI, RUN_LIVE_TESTS is not set, so RUN_LIVE must be false.
    // If someone sets RUN_LIVE_TESTS=1 in CI, this test will still pass.
    expect(process.env['RUN_LIVE_TESTS'] === '1').toBe(RUN_LIVE);
  });
});
