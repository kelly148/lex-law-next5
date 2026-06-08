/**
 * MODEL-RELIABILITY-UAT-1 — Fix 2: error-class differentiation
 *
 * Proves that HTTP 429 → 'rate_limited' and 401/403 → 'auth_error' (else 'api_error')
 * are now distinguishable, both via the shared httpStatusToErrorClass helper and via
 * each provider adapter's non-OK response path. Before this fix all of these collapsed
 * to 'api_error', so a transient rate limit was indistinguishable from a dead key in
 * jobs.errorClass / telemetry / the review-session failure surface.
 *
 * Reproduces the failure mode: a 429 from any reviewer adapter previously surfaced as
 * 'api_error' (same as auth/5xx); now it surfaces as 'rate_limited' (retryable) and an
 * auth failure as 'auth_error' (non-retryable).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpStatusToErrorClass, classifyProviderError, LlmProviderError } from '../types.js';
import { OpenAiAdapter } from '../openai.js';
import { XaiAdapter } from '../xai.js';
import { AnthropicAdapter } from '../anthropic.js';
import { GoogleAdapter } from '../google.js';

const BASE_PARAMS = {
  systemPrompt: 'You are a legal reviewer.',
  userPrompt: 'Review this document.',
  maxTokens: 256,
  temperature: 0.3,
  signal: new AbortController().signal,
};

function makeErrorResponse(status: number, body = '{"error":"x"}'): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('httpStatusToErrorClass (MODEL-RELIABILITY-UAT-1)', () => {
  it('maps 429 → rate_limited', () => {
    expect(httpStatusToErrorClass(429)).toBe('rate_limited');
  });
  it('maps 401 and 403 → auth_error', () => {
    expect(httpStatusToErrorClass(401)).toBe('auth_error');
    expect(httpStatusToErrorClass(403)).toBe('auth_error');
  });
  it('maps 500/503/400/404 → api_error (unchanged default)', () => {
    expect(httpStatusToErrorClass(500)).toBe('api_error');
    expect(httpStatusToErrorClass(503)).toBe('api_error');
    expect(httpStatusToErrorClass(400)).toBe('api_error');
    expect(httpStatusToErrorClass(404)).toBe('api_error');
  });
});

describe('classifyProviderError fallback (MODEL-RELIABILITY-UAT-1)', () => {
  it('preserves LlmProviderError.errorClass for the new classes', () => {
    expect(classifyProviderError(new LlmProviderError('rate_limited', 'x'))).toBe('rate_limited');
    expect(classifyProviderError(new LlmProviderError('auth_error', 'x'))).toBe('auth_error');
  });
  it('detects 429 / 401 in a raw (non-LlmProviderError) message', () => {
    expect(classifyProviderError(new Error('HTTP 429 too many requests'))).toBe('rate_limited');
    expect(classifyProviderError(new Error('HTTP 401 unauthorized'))).toBe('auth_error');
  });
});

// Adapter-level: each provider classifies non-OK status consistently.
const ADAPTERS: Array<{ name: string; make: () => { generate: (p: typeof BASE_PARAMS) => Promise<unknown> }; key: string }> = [
  { name: 'OpenAI', make: () => new OpenAiAdapter('gpt-5'), key: 'OPENAI_API_KEY' },
  { name: 'xAI', make: () => new XaiAdapter('grok-4'), key: 'XAI_API_KEY' },
  { name: 'Anthropic', make: () => new AnthropicAdapter('claude-opus-4-5'), key: 'ANTHROPIC_API_KEY' },
  { name: 'Google', make: () => new GoogleAdapter('gemini-2.5-pro'), key: 'GOOGLE_API_KEY' },
];

for (const a of ADAPTERS) {
  describe(`${a.name} adapter — HTTP status classification (MODEL-RELIABILITY-UAT-1)`, () => {
    let mockFetch: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);
      process.env[a.key] = 'test-key';
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env[a.key];
    });

    it('429 → rate_limited', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(429));
      await expect(a.make().generate(BASE_PARAMS)).rejects.toSatisfy(
        (err: unknown) => err instanceof LlmProviderError && err.errorClass === 'rate_limited',
      );
    });
    it('401 → auth_error', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(401));
      await expect(a.make().generate(BASE_PARAMS)).rejects.toSatisfy(
        (err: unknown) => err instanceof LlmProviderError && err.errorClass === 'auth_error',
      );
    });
    it('403 → auth_error', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(403));
      await expect(a.make().generate(BASE_PARAMS)).rejects.toSatisfy(
        (err: unknown) => err instanceof LlmProviderError && err.errorClass === 'auth_error',
      );
    });
    it('500 → api_error (unchanged)', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(500));
      await expect(a.make().generate(BASE_PARAMS)).rejects.toSatisfy(
        (err: unknown) => err instanceof LlmProviderError && err.errorClass === 'api_error',
      );
    });
  });
}
