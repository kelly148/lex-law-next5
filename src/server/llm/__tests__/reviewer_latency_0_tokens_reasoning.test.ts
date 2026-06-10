/**
 * REVIEWER-LATENCY-1 Step 0 — persist reasoning tokens (persistence-only).
 *
 * Covers:
 *   1. WRITE PATH: executeCanonicalMutation forwards llmResult.tokensReasoning as the 6th arg to
 *      markJobCompleted (persisted when present; null when the provider doesn't report it), and the
 *      job_completed telemetry payload carries the same value — durable and ephemeral records agree.
 *   2. REQUEST-SIDE INVARIANT (the hard constraint): the four adapters' OUTBOUND request bodies are
 *      byte-identical to pre-change — NO reasoning_effort / thinking / service_tier / new field is
 *      sent to any provider. This is the guard that this increment cannot confound the INSTR-1A0
 *      POA A/B baseline. Reuses the request-body capture machinery from the INSTR-1A0 golden test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  executeCanonicalMutation,
  setJobWriteFunctions,
  setMatterStateProvider,
  setPaProfileProvider,
  setPromptSnapshotWriter,
} from '../../db/canonicalMutation.js';
import { setTestLlmAdapter } from '../registry.js';
import { OpenAiAdapter } from '../openai.js';
import { GoogleAdapter } from '../google.js';
import { XaiAdapter } from '../xai.js';
import { AnthropicAdapter } from '../anthropic.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../types.js';

const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';
const DOC = '33333333-3333-3333-3333-333333333333';

// ---------------------------------------------------------------------------
// 1. Write path — tokensReasoning forwarded to markJobCompleted + telemetry
// ---------------------------------------------------------------------------

class FixedAdapter implements LlmClient {
  constructor(private readonly tokensReasoning: number | undefined) {}
  generate(_params: LlmGenerateParams): Promise<LlmGenerateResult> {
    return Promise.resolve({
      content: 'OUTPUT',
      tokensPrompt: 100,
      tokensCompletion: 50,
      ...(this.tokensReasoning !== undefined ? { tokensReasoning: this.tokensReasoning } : {}),
      providerMetadata: { provider: 'fixed' },
    });
  }
}

function installCapturingJobWrites(captured: { tokensReasoning?: number | null }) {
  setJobWriteFunctions({
    insertJob: vi.fn().mockResolvedValue(undefined),
    markJobRunning: vi.fn().mockResolvedValue(1),
    markJobCompleted: vi
      .fn()
      .mockImplementation(
        (
          _jobId: string,
          _userId: string,
          _output: unknown,
          _tokensPrompt: number,
          _tokensCompletion: number,
          tokensReasoning: number | null,
        ) => {
          captured.tokensReasoning = tokensReasoning;
          return Promise.resolve(1);
        },
      ),
    markJobFailed: vi.fn().mockResolvedValue(undefined),
    markJobTimedOut: vi.fn().mockResolvedValue(undefined),
    markJobCancelled: vi.fn().mockResolvedValue(1),
    updateJobHeartbeat: vi.fn().mockResolvedValue(undefined),
  });
}

const baseParams = () => ({
  userId: USER,
  jobType: 'reviewer_feedback' as const,
  modelString: 'anthropic:claude-opus-4-5',
  matterId: MATTER,
  documentId: DOC,
  txn1Enqueue: async (jobId: string) => ({ jobId }),
  buildLlmParams: () => ({ systemPrompt: 'SYS', userPrompt: 'USER' }),
  txn2Commit: async () => {},
  txn2Revert: async () => {},
  telemetryCtx: { userId: USER, matterId: MATTER, documentId: DOC, jobId: null },
});

describe('REVIEWER-LATENCY-1 Step 0 — write path', () => {
  beforeEach(() => {
    // Composition + injections off so the chokepoint stays on the legacy path (irrelevant here).
    setMatterStateProvider(async () => '');
    setPaProfileProvider(async () => null);
    setPromptSnapshotWriter(async () => {});
  });
  afterEach(() => {
    setJobWriteFunctions(null);
    setMatterStateProvider(null);
    setPaProfileProvider(null);
    setPromptSnapshotWriter(null);
    setTestLlmAdapter(null);
    vi.clearAllMocks();
  });

  it('persists tokensReasoning when the provider reports it', async () => {
    const captured: { tokensReasoning?: number | null } = {};
    installCapturingJobWrites(captured);
    setTestLlmAdapter(new FixedAdapter(4096));

    const result = await executeCanonicalMutation(baseParams());

    expect(result.status).toBe('completed');
    expect(captured.tokensReasoning).toBe(4096);
  });

  it('persists NULL when the provider does not report reasoning tokens (e.g. Anthropic)', async () => {
    const captured: { tokensReasoning?: number | null } = {};
    installCapturingJobWrites(captured);
    setTestLlmAdapter(new FixedAdapter(undefined));

    const result = await executeCanonicalMutation(baseParams());

    expect(result.status).toBe('completed');
    expect(captured.tokensReasoning).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Request-side invariant — no new field sent to any provider
// ---------------------------------------------------------------------------
// The whole point of the increment: persistence-only. These guards capture each adapter's
// outbound request body and assert the EXACT key set — proving no reasoning_effort / thinking /
// service_tier / top_p was introduced. A future request-side increment must update these on purpose.

function makeOkFetch(bodyJson: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(bodyJson),
    text: () => Promise.resolve(JSON.stringify(bodyJson)),
  } as unknown as Response);
}

function capturedBody(mockFetch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
}

const REVIEW_PARAMS = {
  systemPrompt: 'SYS',
  userPrompt: 'USER',
  maxTokens: 16384,
  temperature: 0.4,
  signal: new AbortController().signal,
};

describe('REVIEWER-LATENCY-1 Step 0 — request bodies unchanged (no new provider field)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['OPENAI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
    delete process.env['XAI_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('OpenAI gpt-5: only {model, messages, max_completion_tokens} — no reasoning_effort / service_tier / temperature', async () => {
    process.env['OPENAI_API_KEY'] = 'test-key';
    mockFetch = makeOkFetch({
      id: 'x', object: 'chat.completion', model: 'gpt-5',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    vi.stubGlobal('fetch', mockFetch);
    await new OpenAiAdapter('gpt-5').generate(REVIEW_PARAMS);
    const body = capturedBody(mockFetch);
    expect(Object.keys(body).sort()).toEqual(['max_completion_tokens', 'messages', 'model']);
    expect('reasoning_effort' in body).toBe(false);
    expect('service_tier' in body).toBe(false);
    expect('temperature' in body).toBe(false);
    expect('top_p' in body).toBe(false);
  });

  it('Anthropic claude-opus-4-5: only {model, max_tokens, system, messages} — no thinking / temperature', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    mockFetch = makeOkFetch({
      id: 'x', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'hi' }], model: 'claude-opus-4-5',
      stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    });
    vi.stubGlobal('fetch', mockFetch);
    await new AnthropicAdapter('claude-opus-4-5').generate(REVIEW_PARAMS);
    const body = capturedBody(mockFetch);
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'system']);
    expect('thinking' in body).toBe(false);
    expect('temperature' in body).toBe(false);
  });

  it('Google gemini-2.5-pro: generationConfig has only {maxOutputTokens, temperature} — no thinkingBudget', async () => {
    process.env['GOOGLE_API_KEY'] = 'test-key';
    mockFetch = makeOkFetch({
      candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });
    vi.stubGlobal('fetch', mockFetch);
    await new GoogleAdapter('gemini-2.5-pro').generate(REVIEW_PARAMS);
    const body = capturedBody(mockFetch);
    const genConfig = body['generationConfig'] as Record<string, unknown>;
    expect(Object.keys(genConfig).sort()).toEqual(['maxOutputTokens', 'temperature']);
    expect('thinkingBudget' in genConfig).toBe(false);
    expect('thinkingConfig' in genConfig).toBe(false);
  });

  it('xAI grok-4: only {model, messages, max_tokens, temperature} — no reasoning / service_tier', async () => {
    process.env['XAI_API_KEY'] = 'test-key';
    mockFetch = makeOkFetch({
      id: 'x', object: 'chat.completion', model: 'grok-4',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    vi.stubGlobal('fetch', mockFetch);
    await new XaiAdapter('grok-4').generate(REVIEW_PARAMS);
    const body = capturedBody(mockFetch);
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'temperature']);
    expect('reasoning_effort' in body).toBe(false);
    expect('service_tier' in body).toBe(false);
  });
});
