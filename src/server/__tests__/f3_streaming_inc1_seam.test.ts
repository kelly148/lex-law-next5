/**
 * F3 token streaming (DRAFT-STREAMING-1) Inc 1 — the runJob streaming SEAM (behavioral, no live models) +
 * the SSE endpoint (source-audit, no HTTP harness in this repo).
 *
 * Behavioral (via executeCanonicalMutation + setTestLlmAdapter(MockLlmAdapter) + spy job writers, the
 * dispatcher_complete_1 pattern): the MockLlmAdapter returns DISTINCT content for generate() ('BLOCKING')
 * vs generateStream() ('STREAMED-*') so each test proves WHICH path ran by the persisted output.
 *   - flag ON + draft_generation -> streaming path; the accumulated stream result is what txn2Commit persists
 *   - flag OFF -> byte-for-byte generate() (no streaming)
 *   - non-draft jobType (reviewer_feedback) -> never streams, even with the flag ON
 *   - structuredOutputSchema present -> never streams (the stream path does not validate JSON)
 *   - mid-stream error -> txn2Commit is NEVER called; txn2Revert + markJobFailed run (discard-on-interrupt)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { clearTelemetryBuffer } from '../test-utils/setup.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import { MockLlmAdapter, type MockLlmAdapterOptions } from '../llm/mock.js';
import {
  executeCanonicalMutation,
  setJobWriteFunctions,
  clearDeferredJobParamsForTest,
  type CanonicalMutationParams,
} from '../db/canonicalMutation.js';
import { _resetDraftStreamsForTest } from '../streaming/draftStreamBus.js';

function makeSpyWriters() {
  return {
    insertJob: vi.fn(async (): Promise<string> => 'job'),
    markJobRunning: vi.fn(async (): Promise<number> => 1),
    markJobCompleted: vi.fn(async (): Promise<number> => 1),
    markJobFailed: vi.fn(async (): Promise<void> => {}),
    markJobTimedOut: vi.fn(async (): Promise<void> => {}),
    markJobCancelled: vi.fn(async (): Promise<number> => 1),
    updateJobHeartbeat: vi.fn(async (): Promise<void> => {}),
  };
}

function buildParams(
  jobType: CanonicalMutationParams['jobType'],
  txn2Commit: CanonicalMutationParams['txn2Commit'],
  txn2Revert: CanonicalMutationParams['txn2Revert'],
  llmParamsExtra: { structuredOutputSchema?: z.ZodTypeAny } = {},
): CanonicalMutationParams {
  const userId = uuidv4();
  return {
    userId,
    jobType,
    modelString: 'anthropic:claude-opus-4-5',
    matterId: uuidv4(),
    documentId: uuidv4(),
    txn1Enqueue: vi.fn(async (jobId: string) => ({ jobId, preEnqueueState: 'pre' })),
    buildLlmParams: vi.fn((_jobId: string) => ({ systemPrompt: 'sys', userPrompt: 'usr', maxTokens: 1000, ...llmParamsExtra })),
    txn2Commit,
    txn2Revert,
    telemetryCtx: { userId, matterId: null, documentId: null, jobId: null },
  };
}

const STREAM_OPTS: MockLlmAdapterOptions = {
  content: 'BLOCKING',
  streamContent: 'STREAMED-DRAFT',
  tokensPrompt: 11,
  tokensCompletion: 7,
};

const FLAG = 'DRAFT_STREAMING_ENABLED';
let savedFlag: string | undefined;
beforeEach(() => {
  savedFlag = process.env[FLAG];
  delete process.env[FLAG];
  clearTelemetryBuffer();
  setTestLlmAdapter(null);
  clearDeferredJobParamsForTest();
  _resetDraftStreamsForTest();
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  setTestLlmAdapter(null);
  setJobWriteFunctions(null);
  clearDeferredJobParamsForTest();
  _resetDraftStreamsForTest();
});

describe('F3 runJob streaming seam — behavioral', () => {
  it('flag ON + draft_generation: persists the STREAMED result via txn2Commit', async () => {
    process.env[FLAG] = 'true';
    const writers = makeSpyWriters();
    setJobWriteFunctions(writers);
    setTestLlmAdapter(new MockLlmAdapter(STREAM_OPTS));
    const txn2Commit = vi.fn(async (_p: unknown): Promise<void> => {});
    const txn2Revert = vi.fn(async (_p: unknown): Promise<void> => {});

    await executeCanonicalMutation(buildParams('draft_generation', txn2Commit, txn2Revert));

    expect(txn2Commit).toHaveBeenCalledTimes(1);
    expect(txn2Commit.mock.calls[0]![0]).toMatchObject({ output: 'STREAMED-DRAFT', tokensPrompt: 11, tokensCompletion: 7 });
    expect(writers.markJobCompleted).toHaveBeenCalledTimes(1);
    expect(txn2Revert).not.toHaveBeenCalled();
  });

  it('flag OFF + draft_generation: byte-for-byte generate() path (BLOCKING content, no stream)', async () => {
    // flag deleted in beforeEach
    const writers = makeSpyWriters();
    setJobWriteFunctions(writers);
    setTestLlmAdapter(new MockLlmAdapter(STREAM_OPTS));
    const txn2Commit = vi.fn(async (_p: unknown): Promise<void> => {});

    await executeCanonicalMutation(buildParams('draft_generation', txn2Commit, vi.fn(async (_p: unknown): Promise<void> => {})));

    expect(txn2Commit).toHaveBeenCalledTimes(1);
    expect(txn2Commit.mock.calls[0]![0]).toMatchObject({ output: 'BLOCKING' });
    expect(writers.markJobCompleted).toHaveBeenCalledTimes(1);
  });

  it('flag ON + reviewer_feedback: never streams (non-draft jobType excluded) -> BLOCKING', async () => {
    process.env[FLAG] = 'true';
    setJobWriteFunctions(makeSpyWriters());
    setTestLlmAdapter(new MockLlmAdapter(STREAM_OPTS));
    const txn2Commit = vi.fn(async (_p: unknown): Promise<void> => {});

    await executeCanonicalMutation(buildParams('reviewer_feedback', txn2Commit, vi.fn(async (_p: unknown): Promise<void> => {})));

    expect(txn2Commit.mock.calls[0]![0]).toMatchObject({ output: 'BLOCKING' });
  });

  it('flag ON + draft with a structuredOutputSchema: never streams -> BLOCKING', async () => {
    process.env[FLAG] = 'true';
    setJobWriteFunctions(makeSpyWriters());
    setTestLlmAdapter(new MockLlmAdapter(STREAM_OPTS));
    const txn2Commit = vi.fn(async (_p: unknown): Promise<void> => {});

    await executeCanonicalMutation(
      buildParams('draft_generation', txn2Commit, vi.fn(async (_p: unknown): Promise<void> => {}), { structuredOutputSchema: z.object({ x: z.string() }) }),
    );
    // generate() returns 'BLOCKING' (the mock has no structuredContent), proving the non-stream path ran.
    expect(txn2Commit.mock.calls[0]![0]).toMatchObject({ output: 'BLOCKING' });
  });

  it('flag ON + mid-stream error: NEVER commits; reverts + marks failed (discard-on-interrupt)', async () => {
    process.env[FLAG] = 'true';
    const writers = makeSpyWriters();
    setJobWriteFunctions(writers);
    // Stream emits 1 delta then throws — emittedAny=true so NO fallback; the failure propagates.
    setTestLlmAdapter(new MockLlmAdapter({ ...STREAM_OPTS, streamErrorAfter: 1 }));
    const txn2Commit = vi.fn(async (_p: unknown): Promise<void> => {});
    const txn2Revert = vi.fn(async (_p: unknown): Promise<void> => {});

    await executeCanonicalMutation(buildParams('draft_generation', txn2Commit, txn2Revert)).catch(() => {});

    expect(txn2Commit).not.toHaveBeenCalled(); // no partial version persisted
    expect(txn2Revert).toHaveBeenCalledTimes(1);
    expect(writers.markJobFailed).toHaveBeenCalledTimes(1);
    expect(writers.markJobCompleted).not.toHaveBeenCalled();
  });
});

// ── SSE endpoint + seam gating (source-audit) ──────────────────────────────────
describe('F3 SSE endpoint + seam gating — source-audit', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const read = (rel: string): string => fs.readFileSync(path.join(ROOT, 'src', rel), 'utf-8');
  const index = read('server/index.ts');
  const canonical = read('server/db/canonicalMutation.ts');

  it('registers GET /api/stream/draft/:jobId', () => {
    expect(index).toContain("'/api/stream/draft/:jobId'");
  });

  it('is auth-gated (session userId -> 401) and owner-scoped (getJobById(jobId, userId) -> 404)', () => {
    const route = index.slice(index.indexOf("'/api/stream/draft/:jobId'"), index.indexOf("'/api/documents/:documentId/export'"));
    expect(route).toContain('extractUserId(session)');
    expect(route).toContain("res.status(401)");
    expect(route).toContain('getJobById(jobId, userId)');
    expect(route).toContain("res.status(404)");
  });

  it('sets SSE headers and cleans up the subscription on client disconnect', () => {
    const route = index.slice(index.indexOf("'/api/stream/draft/:jobId'"), index.indexOf("'/api/documents/:documentId/export'"));
    expect(route).toContain("'text/event-stream'");
    expect(route).toContain('subscribeDraftStream(jobId');
    expect(route).toContain("res.on('close'");
    expect(route).toContain('unsubscribe()');
  });

  it('the runJob seam gates streaming on ALL of: flag, draft jobType, generateStream, no schema, no egress', () => {
    const seam = canonical.slice(canonical.indexOf('const canStream ='), canonical.indexOf('const generateStreaming ='));
    expect(seam).toContain('isDraftStreamingEnabled()');
    expect(seam).toContain('DRAFT_STREAMING_JOB_TYPES.has(jobType)');
    expect(seam).toContain("typeof adapter.generateStream === 'function'");
    expect(seam).toContain('llmParams.structuredOutputSchema === undefined');
    expect(seam).toContain('params.egress === undefined');
  });

  it('the non-egress dispatch chooses streaming only when canStream (else the unchanged blocking call)', () => {
    expect(canonical).toContain('canStream ? await generateStreaming() : await generateWithRetry()');
  });
});
