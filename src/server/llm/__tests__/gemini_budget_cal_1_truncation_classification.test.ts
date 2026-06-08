/**
 * GEMINI-BUDGET-CALIBRATION-1 — Increment 1
 * Safety-critical classification-boundary assertion.
 *
 * THE INVARIANT (triad-flagged, load-bearing): a reviewer response truncated at the output
 * ceiling MUST classify as api_error (truncation), NEVER as parse_error. If a truncation lands
 * in the parse bucket, neither the shipped MODEL-RELIABILITY-UAT-1 transient-retry nor the
 * future L2 escalation (both keyed on the truncation error class) can act — the cut-off falls
 * silently into a generic lane failure. It must also NEVER be salvaged/repaired into a partial
 * review passed off as complete (a truncated review is a FAILED review).
 *
 * STATE AT BUILD TIME (verified by the GEMINI-BUDGET-CAL-1 mapping fan-out):
 *   - OpenAI  — guarded (finish_reason 'length')      [regression pin]
 *   - Gemini  — guarded (finishReason 'MAX_TOKENS')   [regression pin — the UAT-1 fix]
 *   - Anthropic — was UNGUARDED → parse_error          [FIXED here: stop_reason 'max_tokens']
 *   - xAI/Grok  — was UNGUARDED → parse_error          [FIXED here: finish_reason 'length']
 *
 * Each provider is asserted twice:
 *   (a) truncated partial JSON at the ceiling → api_error (the boundary), and
 *   (b) the SAME unparseable JSON with a NON-truncation stop reason → parse_error (proves the
 *       guard is surgical: it does not swallow genuine malformations).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAiAdapter } from '../openai.js';
import { AnthropicAdapter } from '../anthropic.js';
import { GoogleAdapter } from '../google.js';
import { XaiAdapter } from '../xai.js';
import { LlmProviderError, type JobErrorClass } from '../types.js';
import { RawSuggestionsArraySchema } from '../parsers/feedbackParser.js';
import { isTransientRetryable } from '../../db/canonicalMutation.js';

// A partial reviewer array cut off mid-string — JSON.parse fails ("Unterminated string"),
// which is exactly how a truncation USED to masquerade as a parse_error.
const PARTIAL_JSON = '[{"title":"Governing law","body":"The clause is amb';

const BASE_PARAMS = {
  systemPrompt: 'You are a legal reviewer.',
  userPrompt: 'Review this document.',
  maxTokens: 256,
  temperature: 0.3,
  structuredOutputSchema: RawSuggestionsArraySchema,
  signal: new AbortController().signal,
};

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

// Per-provider response shapes (mirror each adapter's response interface).
function openAiLikeBody(content: string, finishReason: string) {
  return {
    id: 'cmpl-test',
    model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 256, total_tokens: 266 },
  };
}
function anthropicBody(text: string, stopReason: string) {
  return {
    id: 'msg-test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'test-model',
    stop_reason: stopReason,
    usage: { input_tokens: 10, output_tokens: 256 },
  };
}
function geminiBody(text: string, finishReason: string) {
  return {
    candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 256, totalTokenCount: 266 },
  };
}

function expectErrorClass(p: Promise<unknown>, cls: JobErrorClass): Promise<void> {
  return expect(p).rejects.toSatisfy(
    (err: unknown) => err instanceof LlmProviderError && err.errorClass === cls,
  );
}

async function captureRejection(p: Promise<unknown>): Promise<unknown> {
  let resolved = false;
  let captured: unknown;
  try {
    await p;
    resolved = true;
  } catch (err) {
    captured = err;
  }
  if (resolved) throw new Error('expected the promise to reject, but it resolved');
  return captured;
}

describe('GEMINI-BUDGET-CAL-1 — truncation classifies as api_error, never parse_error (all four providers)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    process.env['OPENAI_API_KEY'] = 'test-key';
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['GOOGLE_API_KEY'] = 'test-key';
    process.env['XAI_API_KEY'] = 'test-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
    delete process.env['XAI_API_KEY'];
  });

  // ── OpenAI (regression pin) ───────────────────────────────────────────────
  it('OpenAI: finish_reason "length" + partial JSON → api_error', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(openAiLikeBody(PARTIAL_JSON, 'length')));
    await expectErrorClass(new OpenAiAdapter('gpt-5').generate({ ...BASE_PARAMS }), 'api_error');
  });
  it('OpenAI: same partial JSON with finish_reason "stop" → parse_error (guard is surgical)', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(openAiLikeBody(PARTIAL_JSON, 'stop')));
    await expectErrorClass(new OpenAiAdapter('gpt-5').generate({ ...BASE_PARAMS }), 'parse_error');
  });

  // ── Gemini (regression pin — the UAT-1 fix) ───────────────────────────────
  it('Gemini: finishReason "MAX_TOKENS" + partial JSON → api_error', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(geminiBody(PARTIAL_JSON, 'MAX_TOKENS')));
    await expectErrorClass(new GoogleAdapter('gemini-2.5-pro').generate({ ...BASE_PARAMS }), 'api_error');
  });
  it('Gemini: same partial JSON with finishReason "STOP" → parse_error (guard is surgical)', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(geminiBody(PARTIAL_JSON, 'STOP')));
    await expectErrorClass(new GoogleAdapter('gemini-2.5-pro').generate({ ...BASE_PARAMS }), 'parse_error');
  });

  // ── Anthropic (FIXED in this increment) ───────────────────────────────────
  it('Anthropic: stop_reason "max_tokens" + partial JSON → api_error (was parse_error before this fix)', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(anthropicBody(PARTIAL_JSON, 'max_tokens')));
    await expectErrorClass(new AnthropicAdapter('claude-opus-4-5').generate({ ...BASE_PARAMS }), 'api_error');
  });
  it('Anthropic: same partial JSON with stop_reason "end_turn" → parse_error (guard is surgical)', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(anthropicBody(PARTIAL_JSON, 'end_turn')));
    await expectErrorClass(new AnthropicAdapter('claude-opus-4-5').generate({ ...BASE_PARAMS }), 'parse_error');
  });

  // ── xAI / Grok (FIXED in this increment) ──────────────────────────────────
  it('xAI: finish_reason "length" + partial JSON → api_error (was parse_error before this fix)', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(openAiLikeBody(PARTIAL_JSON, 'length')));
    await expectErrorClass(new XaiAdapter('grok-4').generate({ ...BASE_PARAMS }), 'api_error');
  });
  it('xAI: same partial JSON with finish_reason "stop" → parse_error (guard is surgical)', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(openAiLikeBody(PARTIAL_JSON, 'stop')));
    await expectErrorClass(new XaiAdapter('grok-4').generate({ ...BASE_PARAMS }), 'parse_error');
  });

  // ── Composition with MODEL-RELIABILITY-UAT-1 ──────────────────────────────
  // A truncation api_error must be NON-transient: re-running at the same budget just truncates
  // again. The transient-retry layer (canonicalMutation.isTransientRetryable) keys on message
  // wording, so pin that each provider's real truncation error is not retried — this guards
  // against a future reword sneaking a 5xx/network token into a truncation message.
  it('OpenAI: the real truncation error is api_error AND not transiently retried', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(openAiLikeBody(PARTIAL_JSON, 'length')));
    const err = await captureRejection(new OpenAiAdapter('gpt-5').generate({ ...BASE_PARAMS }));
    expect(err).toBeInstanceOf(LlmProviderError);
    expect((err as LlmProviderError).errorClass).toBe('api_error');
    expect(isTransientRetryable(err)).toBe(false);
  });
  it('Gemini: the real truncation error is api_error AND not transiently retried', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(geminiBody(PARTIAL_JSON, 'MAX_TOKENS')));
    const err = await captureRejection(new GoogleAdapter('gemini-2.5-pro').generate({ ...BASE_PARAMS }));
    expect(err).toBeInstanceOf(LlmProviderError);
    expect((err as LlmProviderError).errorClass).toBe('api_error');
    expect(isTransientRetryable(err)).toBe(false);
  });
  it('Anthropic: the real truncation error is api_error AND not transiently retried', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(anthropicBody(PARTIAL_JSON, 'max_tokens')));
    const err = await captureRejection(new AnthropicAdapter('claude-opus-4-5').generate({ ...BASE_PARAMS }));
    expect(err).toBeInstanceOf(LlmProviderError);
    expect((err as LlmProviderError).errorClass).toBe('api_error');
    expect(isTransientRetryable(err)).toBe(false);
  });
  it('xAI: the real truncation error is api_error AND not transiently retried', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(openAiLikeBody(PARTIAL_JSON, 'length')));
    const err = await captureRejection(new XaiAdapter('grok-4').generate({ ...BASE_PARAMS }));
    expect(err).toBeInstanceOf(LlmProviderError);
    expect((err as LlmProviderError).errorClass).toBe('api_error');
    expect(isTransientRetryable(err)).toBe(false);
  });
});
