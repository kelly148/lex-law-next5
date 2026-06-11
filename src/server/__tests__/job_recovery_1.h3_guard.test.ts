/**
 * JOB-RECOVERY-1 — B-1 H3 guards (canonicalMutation runJob).
 *
 * A throw while marking the job failed inside a revert/failure handler must NOT wedge the job: the
 * guard catches it and runJob still resolves to {status:'failed'} (instead of rejecting and leaving
 * the job stuck 'running'). Exercised at the failure-revert-failed arm and the commit-revert-failed
 * arm (all five guarded arms share the identical pattern).
 *
 * No DB / no provider: setJobWriteFunctions injects a markJobFailed that REJECTS; MockLlmAdapter +
 * throwing txn2Revert drive the revert-handler arms.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { clearTelemetryBuffer } from '../test-utils/setup.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import { MockLlmAdapter } from '../llm/mock.js';
import {
  executeCanonicalMutation,
  setJobWriteFunctions,
  type CanonicalMutationParams,
} from '../db/canonicalMutation.js';

// Job writers where markJobFailed REJECTS (the H3 failure-during-failure-handling case).
const writers = {
  insertJob: vi.fn(async (_n: unknown): Promise<string> => 'job'),
  markJobRunning: vi.fn(async (_j: string, _u: string): Promise<number> => 1),
  markJobCompleted: vi.fn(async (): Promise<number> => 1),
  markJobFailed: vi.fn(async (): Promise<void> => {
    throw new Error('markJobFailed exploded (DB outage during failure handling)');
  }),
  markJobTimedOut: vi.fn(async (): Promise<void> => {}),
  markJobCancelled: vi.fn(async (): Promise<number> => 1),
  updateJobHeartbeat: vi.fn(async (): Promise<void> => {}),
};

function buildParams(overrides: Partial<CanonicalMutationParams> = {}): CanonicalMutationParams {
  const userId = uuidv4();
  return {
    userId,
    jobType: 'reviewer_feedback',
    modelString: 'anthropic:claude-opus-4-5',
    matterId: uuidv4(),
    documentId: uuidv4(),
    txn1Enqueue: vi.fn(async (jobId: string) => ({ jobId, preEnqueueState: 'pre' })),
    buildLlmParams: vi.fn((_jobId: string) => ({ systemPrompt: 'sys', userPrompt: 'usr', temperature: 0.4, maxTokens: 100 })),
    txn2Commit: vi.fn(async (): Promise<void> => {}),
    txn2Revert: vi.fn(async (): Promise<void> => {}),
    telemetryCtx: { userId, matterId: null, documentId: null, jobId: null },
    ...overrides,
  };
}

beforeEach(() => { clearTelemetryBuffer(); setTestLlmAdapter(null); setJobWriteFunctions(writers); });
afterEach(() => { setTestLlmAdapter(null); setJobWriteFunctions(null); clearTelemetryBuffer(); vi.clearAllMocks(); });

describe('B-1 — H3 guard: a markJobFailed throw in a revert handler does not wedge the job', () => {
  it('failure-revert-failed arm: LLM fails + revert throws + markJobFailed throws -> resolves "failed", does not reject', async () => {
    setTestLlmAdapter(new MockLlmAdapter({ errorClass: 'api_error', errorMessage: 'provider down' }));
    const params = buildParams({
      txn2Revert: vi.fn(async () => { throw new Error('revert exploded'); }),
    });
    // Without the H3 guard the rejected markJobFailed would propagate and the promise would reject.
    const result = await executeCanonicalMutation(params);
    expect(result.status).toBe('failed');
    expect(writers.markJobFailed).toHaveBeenCalled(); // it was reached (and threw) — guard absorbed it
  });

  it('commit-revert-failed arm: commit throws + revert throws + markJobFailed throws -> resolves "failed", does not reject', async () => {
    setTestLlmAdapter(new MockLlmAdapter({ content: 'ok' })); // LLM succeeds; the commit path fails
    const params = buildParams({
      txn2Commit: vi.fn(async () => { throw new Error('commit exploded'); }),
      txn2Revert: vi.fn(async () => { throw new Error('revert exploded'); }),
    });
    const result = await executeCanonicalMutation(params);
    expect(result.status).toBe('failed');
    expect(writers.markJobFailed).toHaveBeenCalled();
  });
});
