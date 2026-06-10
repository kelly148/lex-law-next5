/**
 * REVIEWER-LATENCY-1 Step 2a — OpenAI reviewer-lane speed params (flag-gated).
 *
 * Covers:
 *   1. Resolver (config.ts) — flag OFF => null for everything; flag ON => { reasoningEffort:'low',
 *      serviceTier:'priority' } ONLY for jobType reviewer_feedback on openai:gpt-5; null for the
 *      drafter, the evaluator, every other model, and env-overridable.
 *   2. OpenAI adapter — flag-OFF-equivalent (no params) request body is byte-identical to today (no
 *      reasoning_effort / service_tier); flag-ON-equivalent gpt-5 reviewer request carries EXACTLY
 *      reasoning_effort=low + service_tier=priority and nothing else changed; reasoning_effort is
 *      withheld from a non-reasoning model; the granted service_tier echo is captured.
 *   3. Other adapters (Anthropic/Google/xAI) ignore the new fields — request bodies unchanged.
 *   4. Reasoning-token coverage still flows (item 4): Gemini thoughtsTokenCount and xAI
 *      reasoning_tokens -> tokensReasoning (no change; asserted).
 *   5. Drafter path unchanged under both flag states.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveReviewerLatencyTuning, PRIMARY_DRAFTER_MODEL } from '../config.js';
import { OpenAiAdapter } from '../openai.js';
import { GoogleAdapter } from '../google.js';
import { XaiAdapter } from '../xai.js';
import { AnthropicAdapter } from '../anthropic.js';

const FLAG = 'REVIEWER_LATENCY_TUNING_ENABLED';
const EFFORT_ENV = 'REVIEWER_GPT5_REASONING_EFFORT';
const TIER_ENV = 'REVIEWER_GPT5_SERVICE_TIER';

function saveEnv(keys: string[]): Record<string, string | undefined> {
  const s: Record<string, string | undefined> = {};
  for (const k of keys) s[k] = process.env[k];
  return s;
}
function restoreEnv(s: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// ---------------------------------------------------------------------------
// 1. Resolver
// ---------------------------------------------------------------------------

describe('REVIEWER-LATENCY-1 Step 2a — resolveReviewerLatencyTuning', () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = saveEnv([FLAG, EFFORT_ENV, TIER_ENV]);
    delete process.env[FLAG];
    delete process.env[EFFORT_ENV];
    delete process.env[TIER_ENV];
  });
  afterEach(() => {
    restoreEnv(saved);
  });

  it('flag OFF returns null for the gpt-5 reviewer lane', () => {
    expect(resolveReviewerLatencyTuning('reviewer_feedback', 'openai:gpt-5')).toBeNull();
  });

  it('flag ON returns low+priority for the gpt-5 reviewer lane', () => {
    process.env[FLAG] = 'true';
    expect(resolveReviewerLatencyTuning('reviewer_feedback', 'openai:gpt-5')).toEqual({
      reasoningEffort: 'low',
      serviceTier: 'priority',
    });
  });

  it('flag ON returns null for non-reviewer job types (drafter, evaluator)', () => {
    process.env[FLAG] = 'true';
    expect(resolveReviewerLatencyTuning('draft_generation', 'openai:gpt-5')).toBeNull();
    expect(resolveReviewerLatencyTuning('regeneration', 'openai:gpt-5')).toBeNull();
    expect(resolveReviewerLatencyTuning('evaluator', 'openai:gpt-5')).toBeNull();
  });

  it('flag ON returns null for every non-gpt-5 reviewer model', () => {
    process.env[FLAG] = 'true';
    for (const m of [
      'anthropic:claude-opus-4-5',
      'google:gemini-2.5-pro',
      'xai:grok-4',
      'openai:gpt-4.1-mini',
      PRIMARY_DRAFTER_MODEL,
    ]) {
      expect(resolveReviewerLatencyTuning('reviewer_feedback', m)).toBeNull();
    }
  });

  it('flag ON honors env overrides for effort and tier', () => {
    process.env[FLAG] = 'true';
    process.env[EFFORT_ENV] = 'minimal';
    process.env[TIER_ENV] = 'default';
    expect(resolveReviewerLatencyTuning('reviewer_feedback', 'openai:gpt-5')).toEqual({
      reasoningEffort: 'minimal',
      serviceTier: 'default',
    });
  });
});

// ---------------------------------------------------------------------------
// Request-capture helpers
// ---------------------------------------------------------------------------

function makeOpenAiFetch(serviceTierEcho?: string): ReturnType<typeof vi.fn> {
  const body = {
    id: 'x',
    object: 'chat.completion',
    model: 'gpt-5',
    ...(serviceTierEcho !== undefined ? { service_tier: serviceTierEcho } : {}),
    choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, completion_tokens_details: { reasoning_tokens: 5 } },
  };
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

function capturedBody(mockFetch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
}

const BASE = {
  systemPrompt: 'SYS',
  userPrompt: 'USER',
  maxTokens: 16384,
  temperature: 0.4,
  signal: new AbortController().signal,
};

// ---------------------------------------------------------------------------
// 2. OpenAI adapter — flag OFF vs ON request bodies
// ---------------------------------------------------------------------------

describe('REVIEWER-LATENCY-1 Step 2a — OpenAI gpt-5 request body', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env['OPENAI_API_KEY'] = 'test-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
  });

  it('flag-OFF-equivalent (no params): body is byte-identical to today — no reasoning_effort / service_tier', async () => {
    mockFetch = makeOpenAiFetch();
    vi.stubGlobal('fetch', mockFetch);
    await new OpenAiAdapter('gpt-5').generate(BASE);
    const body = capturedBody(mockFetch);
    expect(Object.keys(body).sort()).toEqual(['max_completion_tokens', 'messages', 'model']);
    expect('reasoning_effort' in body).toBe(false);
    expect('service_tier' in body).toBe(false);
  });

  it('flag-ON-equivalent: gpt-5 reviewer body carries EXACTLY reasoning_effort=low + service_tier=priority, nothing else changed', async () => {
    mockFetch = makeOpenAiFetch('priority');
    vi.stubGlobal('fetch', mockFetch);
    await new OpenAiAdapter('gpt-5').generate({ ...BASE, reasoningEffort: 'low', serviceTier: 'priority' });
    const body = capturedBody(mockFetch);
    expect(Object.keys(body).sort()).toEqual([
      'max_completion_tokens',
      'messages',
      'model',
      'reasoning_effort',
      'service_tier',
    ]);
    expect(body['reasoning_effort']).toBe('low');
    expect(body['service_tier']).toBe('priority');
    // unchanged: still gpt-5 with completion-token budget, no temperature
    expect(body['model']).toBe('gpt-5');
    expect(body['max_completion_tokens']).toBe(16384);
    expect('temperature' in body).toBe(false);
  });

  it('withholds reasoning_effort from a non-reasoning model (gpt-4.1-mini) but still sets service_tier', async () => {
    mockFetch = makeOpenAiFetch('priority');
    vi.stubGlobal('fetch', mockFetch);
    await new OpenAiAdapter('gpt-4.1-mini').generate({ ...BASE, reasoningEffort: 'low', serviceTier: 'priority' });
    const body = capturedBody(mockFetch);
    expect('reasoning_effort' in body).toBe(false); // guarded to reasoning models
    expect(body['service_tier']).toBe('priority');
  });

  it('captures the granted service_tier echo in providerMetadata', async () => {
    mockFetch = makeOpenAiFetch('priority');
    vi.stubGlobal('fetch', mockFetch);
    const res = await new OpenAiAdapter('gpt-5').generate({ ...BASE, serviceTier: 'priority' });
    expect(res.providerMetadata?.['serviceTier']).toBe('priority');
  });
});

// ---------------------------------------------------------------------------
// 3 + 4. Other adapters: request unchanged + reasoning-token coverage intact
// ---------------------------------------------------------------------------

describe('REVIEWER-LATENCY-1 Step 2a — non-OpenAI adapters untouched + reasoning coverage', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
    delete process.env['XAI_API_KEY'];
  });

  it('Anthropic (drafter model) ignores the new fields — request body unchanged', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    const respBody = {
      id: 'x', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'hi' }], model: 'claude-opus-4-5',
      stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    };
    mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve(respBody), text: () => Promise.resolve(JSON.stringify(respBody)),
    } as unknown as Response);
    vi.stubGlobal('fetch', mockFetch);
    // Pass the tuning fields: a correct adapter must ignore them entirely.
    await new AnthropicAdapter('claude-opus-4-5').generate({ ...BASE, reasoningEffort: 'low', serviceTier: 'priority' });
    const body = capturedBody(mockFetch);
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'system']);
    expect('reasoning_effort' in body).toBe(false);
    expect('service_tier' in body).toBe(false);
  });

  it('Gemini thoughtsTokenCount still flows to tokensReasoning (coverage unchanged)', async () => {
    process.env['GOOGLE_API_KEY'] = 'test-key';
    const respBody = {
      candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30, thoughtsTokenCount: 7 },
    };
    mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve(respBody), text: () => Promise.resolve(JSON.stringify(respBody)),
    } as unknown as Response);
    vi.stubGlobal('fetch', mockFetch);
    const res = await new GoogleAdapter('gemini-2.5-pro').generate(BASE);
    expect(res.tokensReasoning).toBe(7);
    const body = capturedBody(mockFetch);
    expect('service_tier' in body).toBe(false);
  });

  it('xAI reasoning_tokens still flows to tokensReasoning (coverage unchanged)', async () => {
    process.env['XAI_API_KEY'] = 'test-key';
    const respBody = {
      id: 'x', object: 'chat.completion', model: 'grok-4',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 9 } },
    };
    mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve(respBody), text: () => Promise.resolve(JSON.stringify(respBody)),
    } as unknown as Response);
    vi.stubGlobal('fetch', mockFetch);
    const res = await new XaiAdapter('grok-4').generate(BASE);
    expect(res.tokensReasoning).toBe(9);
    const body = capturedBody(mockFetch);
    expect('reasoning_effort' in body).toBe(false);
    expect('service_tier' in body).toBe(false);
  });
});
