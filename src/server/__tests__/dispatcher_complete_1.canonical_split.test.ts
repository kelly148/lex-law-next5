/**
 * DISPATCHER-COMPLETE-1 — executeCanonicalMutation enqueue/run split (Component A).
 *
 * GUARD (the critical one): with the split in place, executeCanonicalMutation is byte-for-byte
 * behavior-identical for existing (inline) callers — insert -> markRunning -> LLM -> completed,
 * in order, with a SINGLE insert (no double-insert from the split).
 *
 * D-2 — the atomic claim: a 0-row markJobRunning (another worker won the race) yields 'cancelled'
 * and runs NO LLM/commit; two concurrent claimants on one deferred job -> exactly one runs.
 *
 * D-4 — deferred enqueue: enqueueCanonicalJobForDispatcher persists a 'queued' job + registers a
 * continuation WITHOUT running; a lost continuation (simulated restart) leaves the job recoverable.
 *
 * No real DB / no real provider: setJobWriteFunctions injects spy writers; MockLlmAdapter stubs
 * the model (same pattern as phase2.acceptance.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { clearTelemetryBuffer } from '../test-utils/setup.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import { MockLlmAdapter } from '../llm/mock.js';
import {
  executeCanonicalMutation,
  enqueueCanonicalJobForDispatcher,
  runDeferredCanonicalJob,
  hasDeferredContinuation,
  clearDeferredJobParamsForTest,
  setJobWriteFunctions,
  type CanonicalMutationParams,
} from '../db/canonicalMutation.js';

// ── spy job writers (record call order) ──
function makeSpyWriters(markRunningSeq?: number[]) {
  const order: string[] = [];
  let runIdx = 0;
  const writers = {
    insertJob: vi.fn(async (_newJob: unknown): Promise<string> => {
      order.push('insertJob');
      return 'job';
    }),
    markJobRunning: vi.fn(async (_jobId: string, _userId: string): Promise<number> => {
      order.push('markJobRunning');
      if (markRunningSeq) {
        const v = markRunningSeq[runIdx] ?? 1;
        runIdx += 1;
        return v;
      }
      return 1;
    }),
    markJobCompleted: vi.fn(
      async (
        _jobId: string,
        _userId: string,
        _output: unknown,
        _tokensPrompt: number,
        _tokensCompletion: number,
      ): Promise<number> => {
        order.push('markJobCompleted');
        return 1;
      },
    ),
    markJobFailed: vi.fn(
      async (_jobId: string, _userId: string, _errorClass: string, _errorMessage: string): Promise<void> => {
        order.push('markJobFailed');
      },
    ),
    markJobTimedOut: vi.fn(
      async (_jobId: string, _userId: string, _errorMessage: string): Promise<void> => {
        order.push('markJobTimedOut');
      },
    ),
    markJobCancelled: vi.fn(async (_jobId: string, _userId: string): Promise<number> => {
      order.push('markJobCancelled');
      return 1;
    }),
    updateJobHeartbeat: vi.fn(async (_jobId: string, _userId: string): Promise<void> => {}),
  };
  return { order, writers };
}

function buildParams(overrides: Partial<CanonicalMutationParams> = {}): CanonicalMutationParams {
  const userId = uuidv4();
  return {
    userId,
    jobType: 'reviewer_feedback',
    modelString: 'anthropic:claude-opus-4-5',
    matterId: uuidv4(),
    documentId: uuidv4(),
    txn1Enqueue: vi.fn(async (jobId: string) => ({ jobId, preEnqueueState: 'pre' })),
    buildLlmParams: vi.fn((_jobId: string) => ({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      temperature: 0.4,
      maxTokens: 1000,
    })),
    txn2Commit: vi.fn(async (): Promise<void> => {}),
    txn2Revert: vi.fn(async (): Promise<void> => {}),
    telemetryCtx: { userId, matterId: null, documentId: null, jobId: null },
    ...overrides,
  };
}

beforeEach(() => {
  clearTelemetryBuffer();
  setTestLlmAdapter(null);
  clearDeferredJobParamsForTest();
});
afterEach(() => {
  setTestLlmAdapter(null);
  setJobWriteFunctions(null);
  clearDeferredJobParamsForTest();
  clearTelemetryBuffer();
});

describe('GUARD — executeCanonicalMutation split is byte-for-byte inert (flag-OFF inline path)', () => {
  it('insert -> markRunning -> LLM -> completed, in order, with exactly one insert', async () => {
    const { order, writers } = makeSpyWriters();
    setJobWriteFunctions(writers);
    setTestLlmAdapter(new MockLlmAdapter({ content: 'feedback' }));

    const params = buildParams();
    const result = await executeCanonicalMutation(params);

    expect(result.status).toBe('completed');
    expect(writers.insertJob).toHaveBeenCalledTimes(1); // no double-insert from the split
    expect(writers.markJobRunning).toHaveBeenCalledTimes(1);
    expect(writers.markJobCompleted).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['insertJob', 'markJobRunning', 'markJobCompleted']);
    expect(params.txn1Enqueue).toHaveBeenCalledTimes(1);
    expect(params.txn2Commit).toHaveBeenCalledTimes(1);
    expect(params.txn2Revert).not.toHaveBeenCalled();
  });
});

describe('D-2 — atomic claim (markJobRunning is the single-winner guard)', () => {
  it('a lost claim (markJobRunning -> 0) returns cancelled and runs NO LLM/commit', async () => {
    const { writers } = makeSpyWriters([0]); // claim immediately lost
    setJobWriteFunctions(writers);
    setTestLlmAdapter(new MockLlmAdapter({ content: 'should-not-run' }));

    const params = buildParams();
    const result = await executeCanonicalMutation(params);

    expect(result.status).toBe('cancelled');
    expect(params.buildLlmParams).not.toHaveBeenCalled();
    expect(writers.markJobCompleted).not.toHaveBeenCalled();
    expect(params.txn2Commit).not.toHaveBeenCalled();
  });

  it('two concurrent claimants on one deferred job: exactly one runs, the other no-ops', async () => {
    const { writers } = makeSpyWriters([1, 0]); // first wins, second loses
    setJobWriteFunctions(writers);
    setTestLlmAdapter(new MockLlmAdapter({ content: 'feedback' }));

    const params = buildParams();
    const jobId = await enqueueCanonicalJobForDispatcher(params);
    const [r1, r2] = await Promise.all([
      runDeferredCanonicalJob(jobId),
      runDeferredCanonicalJob(jobId),
    ]);

    const statuses = [r1?.status, r2?.status];
    expect(statuses.filter((s) => s === 'completed')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'cancelled')).toHaveLength(1);
    expect(writers.markJobRunning).toHaveBeenCalledTimes(2);
    expect(writers.markJobCompleted).toHaveBeenCalledTimes(1); // exactly one ran to terminal
  });
});

describe('D-4 — deferred enqueue (recoverable DB row)', () => {
  it('enqueueCanonicalJobForDispatcher persists a queued job + registers a continuation, runs NO LLM', async () => {
    const { order, writers } = makeSpyWriters();
    setJobWriteFunctions(writers);

    const params = buildParams();
    const jobId = await enqueueCanonicalJobForDispatcher(params);

    expect(writers.insertJob).toHaveBeenCalledTimes(1);
    expect(writers.markJobRunning).not.toHaveBeenCalled(); // enqueue-only, not run
    expect(params.txn1Enqueue).toHaveBeenCalledTimes(1);
    expect(params.buildLlmParams).not.toHaveBeenCalled();
    expect(hasDeferredContinuation(jobId)).toBe(true);
    expect(order).toEqual(['insertJob']);
  });

  it('the dispatcher runs a deferred job to terminal (claim + complete; continuation consumed)', async () => {
    const { writers } = makeSpyWriters();
    setJobWriteFunctions(writers);
    setTestLlmAdapter(new MockLlmAdapter({ content: 'feedback' }));

    const params = buildParams();
    const jobId = await enqueueCanonicalJobForDispatcher(params);
    const result = await runDeferredCanonicalJob(jobId);

    expect(result?.status).toBe('completed');
    expect(writers.markJobRunning).toHaveBeenCalledTimes(1);
    expect(writers.markJobCompleted).toHaveBeenCalledTimes(1);
    expect(params.txn2Commit).toHaveBeenCalledTimes(1);
    expect(hasDeferredContinuation(jobId)).toBe(false);
  });

  it('a lost continuation (simulated restart) leaves the job recoverable: runDeferred -> null, no claim', async () => {
    const { writers } = makeSpyWriters();
    setJobWriteFunctions(writers);

    const params = buildParams();
    const jobId = await enqueueCanonicalJobForDispatcher(params);
    clearDeferredJobParamsForTest(); // simulate a process restart dropping in-memory continuations
    expect(hasDeferredContinuation(jobId)).toBe(false);

    const result = await runDeferredCanonicalJob(jobId);
    expect(result).toBeNull();
    // never claimed -> the job ROW stays 'queued' (recoverable; Component B / JOB-RECOVERY-1 reaps it)
    expect(writers.markJobRunning).not.toHaveBeenCalled();
  });
});
