/**
 * MODEL-RELIABILITY-UAT-1 — Fix 3: bounded retry on transient provider failures
 *
 * The single LLM chokepoint (executeCanonicalMutation) had no retry layer, so any
 * transient blip (provider 5xx, 429 rate limit, dropped socket) failed the job — and a
 * reviewer lane with it. These tests prove:
 *   - a transient failure (rate_limited / 5xx / network) is retried then succeeds;
 *   - auth_error and parse_error are NOT retried (fail fast);
 *   - retries are bounded (max 2 → at most 3 attempts);
 *   - timeout/abort is never retried (isTransientRetryable unit checks).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setTestLlmAdapter } from '../llm/registry.js';
import {
  executeCanonicalMutation,
  setJobWriteFunctions,
  isTransientRetryable,
  type CanonicalMutationParams,
} from '../db/canonicalMutation.js';
import { LlmProviderError, type LlmClient, type LlmGenerateResult } from '../llm/types.js';

const noopJobWriteFunctions = {
  insertJob: async (): Promise<string> => 'noop',
  markJobRunning: async (): Promise<number> => 1,
  markJobCompleted: async (): Promise<number> => 1,
  markJobFailed: async (): Promise<void> => {},
  markJobTimedOut: async (): Promise<void> => {},
  markJobCancelled: async (): Promise<number> => 1,
  updateJobHeartbeat: async (): Promise<void> => {},
};

/** Adapter that throws `err` for the first `failTimes` calls, then succeeds. */
class FlakyAdapter implements LlmClient {
  public calls = 0;
  constructor(private readonly failTimes: number, private readonly err: unknown) {}
  async generate(): Promise<LlmGenerateResult> {
    this.calls += 1;
    if (this.calls <= this.failTimes) throw this.err;
    return { content: '[]', tokensPrompt: 1, tokensCompletion: 1, providerMetadata: {} };
  }
}

interface CapturedRevert {
  errorClass?: string;
}

function buildParams(captured: CapturedRevert): CanonicalMutationParams {
  const userId = uuidv4();
  return {
    userId,
    jobType: 'reviewer_feedback',
    modelString: 'openai:gpt-5',
    // No matterId → matter-state / PA-profile injection branches are skipped (no DB).
    txn1Enqueue: async (jobId: string) => ({ jobId, preEnqueueState: 'review_pending' }),
    buildLlmParams: () => ({
      systemPrompt: 'You are a reviewer.',
      userPrompt: 'Review.',
      maxTokens: 256,
      temperature: 0.4,
    }),
    txn2Commit: async () => {},
    txn2Revert: async ({ errorClass }) => {
      captured.errorClass = errorClass;
    },
    telemetryCtx: { userId, matterId: null, documentId: null, jobId: null },
  };
}

describe('isTransientRetryable (MODEL-RELIABILITY-UAT-1)', () => {
  it('retries rate_limited', () => {
    expect(isTransientRetryable(new LlmProviderError('rate_limited', '429'))).toBe(true);
  });
  it('retries a 5xx api_error (status in message)', () => {
    expect(isTransientRetryable(new LlmProviderError('api_error', 'OpenAI API error 503: overloaded'))).toBe(true);
  });
  it('retries transient network errors', () => {
    expect(isTransientRetryable(new LlmProviderError('api_error', 'Anthropic fetch failed: ECONNRESET'))).toBe(true);
  });
  it('does NOT retry auth_error', () => {
    expect(isTransientRetryable(new LlmProviderError('auth_error', '401'))).toBe(false);
  });
  it('does NOT retry parse_error', () => {
    expect(isTransientRetryable(new LlmProviderError('parse_error', 'bad json'))).toBe(false);
  });
  it('does NOT retry a 4xx api_error', () => {
    expect(isTransientRetryable(new LlmProviderError('api_error', 'OpenAI API error 400: bad request'))).toBe(false);
  });
  it('does NOT retry an abort/timeout', () => {
    const e = new Error('aborted');
    e.name = 'TimeoutError';
    expect(isTransientRetryable(e)).toBe(false);
  });
});

describe('executeCanonicalMutation retry behavior (MODEL-RELIABILITY-UAT-1)', () => {
  beforeEach(() => {
    setJobWriteFunctions(noopJobWriteFunctions);
  });
  afterEach(() => {
    setTestLlmAdapter(null);
    setJobWriteFunctions(null);
  });

  it('retries a transient rate_limited failure once, then completes', async () => {
    const adapter = new FlakyAdapter(1, new LlmProviderError('rate_limited', 'OpenAI API error 429'));
    setTestLlmAdapter(adapter);
    const captured: CapturedRevert = {};
    const result = await executeCanonicalMutation(buildParams(captured));
    expect(result.status).toBe('completed');
    expect(adapter.calls).toBe(2); // 1 initial + 1 retry
  });

  it('retries a 5xx server error then completes', async () => {
    const adapter = new FlakyAdapter(1, new LlmProviderError('api_error', 'xAI Grok API error 502: bad gateway'));
    setTestLlmAdapter(adapter);
    const captured: CapturedRevert = {};
    const result = await executeCanonicalMutation(buildParams(captured));
    expect(result.status).toBe('completed');
    expect(adapter.calls).toBe(2);
  });

  it('does NOT retry auth_error — fails on first attempt', async () => {
    const adapter = new FlakyAdapter(99, new LlmProviderError('auth_error', 'OpenAI API error 401'));
    setTestLlmAdapter(adapter);
    const captured: CapturedRevert = {};
    const result = await executeCanonicalMutation(buildParams(captured));
    expect(result.status).toBe('failed');
    expect(adapter.calls).toBe(1);
    expect(captured.errorClass).toBe('auth_error');
  });

  it('does NOT retry parse_error — fails on first attempt', async () => {
    const adapter = new FlakyAdapter(99, new LlmProviderError('parse_error', 'unterminated string'));
    setTestLlmAdapter(adapter);
    const captured: CapturedRevert = {};
    const result = await executeCanonicalMutation(buildParams(captured));
    expect(result.status).toBe('failed');
    expect(adapter.calls).toBe(1);
    expect(captured.errorClass).toBe('parse_error');
  });

  it('bounds retries at 2 (3 attempts total) then fails with the final class', async () => {
    const adapter = new FlakyAdapter(99, new LlmProviderError('rate_limited', 'OpenAI API error 429'));
    setTestLlmAdapter(adapter);
    const captured: CapturedRevert = {};
    const result = await executeCanonicalMutation(buildParams(captured));
    expect(result.status).toBe('failed');
    expect(adapter.calls).toBe(3); // 1 initial + 2 retries (MAX_LLM_RETRIES)
    expect(captured.errorClass).toBe('rate_limited');
  });
});
