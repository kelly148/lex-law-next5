/**
 * INSTR-2C R6 — the addendum precedence-floor is a FAIL-CLOSED runtime tripwire.
 *
 * The canonicalMutation post-assembly assertion refuses to dispatch an outline master whose
 * model-bound system block does not START with the verbatim addendum. This test forces that path by
 * mocking the chokepoint to return an outline master WITHOUT the addendum floor, and proves the model
 * is NEVER reached (fail-closed). The positive case (addendum present, first) dispatches normally.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../llm/assemblePrompt.js', async (orig) => {
  const actual = await orig<typeof import('../llm/assemblePrompt.js')>();
  return { ...actual, resolvePromptComposition: vi.fn() };
});

import { resolvePromptComposition } from '../llm/assemblePrompt.js';
import { OUTLINE_ADDENDUM } from '../llm/outlineMasterComposition.js';
import { PRIMARY_DRAFTER_MODEL } from '../llm/config.js';
import {
  executeCanonicalMutation,
  setJobWriteFunctions,
  setMatterStateProvider,
  setPaProfileProvider,
  setPromptSnapshotWriter,
} from '../db/canonicalMutation.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';

const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';
const BASE = 'You are an expert legal document drafter. Generate a structured outline.';

class CapturingAdapter implements LlmClient {
  public lastSystemPrompt: string | null = null;
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.lastSystemPrompt = params.systemPrompt;
    return Promise.resolve({ content: 'REPLY', tokensPrompt: 1, tokensCompletion: 1, providerMetadata: { provider: 'capture' } });
  }
}

type Composition = Awaited<ReturnType<typeof resolvePromptComposition>>;
const outlineComposition = (layeredMasterText: string): Composition => ({
  source: 'master/claude/lawfirm',
  systemText: null,
  layeredMasterText,
  assetSha256: 'deadbeef',
  flagEnabled: true,
  callRole: 'outline',
  docType: null,
});

let capturing: CapturingAdapter;

beforeEach(() => {
  capturing = new CapturingAdapter();
  setTestLlmAdapter(capturing);
  setJobWriteFunctions({
    insertJob: vi.fn().mockResolvedValue(undefined),
    markJobRunning: vi.fn().mockResolvedValue(1),
    markJobCompleted: vi.fn().mockResolvedValue(undefined),
    markJobFailed: vi.fn().mockResolvedValue(undefined),
    markJobTimedOut: vi.fn().mockResolvedValue(undefined),
    markJobCancelled: vi.fn().mockResolvedValue(1),
    updateJobHeartbeat: vi.fn().mockResolvedValue(undefined),
  });
  setMatterStateProvider(async () => ''); // empty, so the block is the layered master + base only
  setPaProfileProvider(async () => null);
  setPromptSnapshotWriter(async () => {});
});

afterEach(() => {
  setTestLlmAdapter(null);
  setJobWriteFunctions(null);
  setMatterStateProvider(null);
  setPaProfileProvider(null);
  setPromptSnapshotWriter(null);
  vi.clearAllMocks();
});

function runOutline(): Promise<{ status: string; threw: boolean }> {
  return executeCanonicalMutation({
    userId: USER,
    jobType: 'outline_generation',
    modelString: PRIMARY_DRAFTER_MODEL,
    matterId: MATTER,
    txn1Enqueue: (jobId) => Promise.resolve({ jobId }),
    buildLlmParams: () => ({ systemPrompt: BASE, userPrompt: 'outline', temperature: 0.2, maxTokens: 4096 }),
    txn2Commit: () => Promise.resolve(),
    txn2Revert: () => Promise.resolve(),
    telemetryCtx: { userId: USER, matterId: MATTER, documentId: null, jobId: null },
  }).then(
    (r) => ({ status: r.status, threw: false }),
    () => ({ status: 'rejected', threw: true }),
  );
}

describe('INSTR-2C R6 — addendum floor fail-closed tripwire', () => {
  it('an outline master MISSING the addendum floor is NEVER dispatched (fail-closed)', async () => {
    vi.mocked(resolvePromptComposition).mockResolvedValue(outlineComposition('MASTER TEXT WITH NO ADDENDUM'));
    const r = await runOutline();
    // The model was never called — the tripwire fired before dispatch.
    expect(capturing.lastSystemPrompt).toBeNull();
    expect(r.status).not.toBe('completed');
  });

  it('an outline master whose addendum is NOT FIRST (present but off the floor) is NEVER dispatched', async () => {
    vi.mocked(resolvePromptComposition).mockResolvedValue(outlineComposition(`SOME PREAMBLE\n\n${OUTLINE_ADDENDUM}\n\nMASTER`));
    const r = await runOutline();
    expect(capturing.lastSystemPrompt).toBeNull();
    expect(r.status).not.toBe('completed');
  });

  it('an outline master WITH the addendum first dispatches normally (the model sees it at byte-0)', async () => {
    vi.mocked(resolvePromptComposition).mockResolvedValue(outlineComposition(`${OUTLINE_ADDENDUM}\n\nMASTER`));
    const r = await runOutline();
    expect(r.status).toBe('completed');
    expect(capturing.lastSystemPrompt).not.toBeNull();
    expect(capturing.lastSystemPrompt!.startsWith(OUTLINE_ADDENDUM)).toBe(true);
  });
});
