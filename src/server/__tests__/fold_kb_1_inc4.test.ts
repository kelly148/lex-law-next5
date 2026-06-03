/**
 * FOLD-KB-1 Increment 4 — per-PA master-prompt auto-load at the LLM-dispatch chokepoint (Fork E).
 *
 * Mirrors the FOLD-L1-2 matter-state injection test. The matter-state provider is stubbed to ''
 * so we isolate the PA-profile injection. Best-effort: a failed/absent load degrades to the base
 * prompt (byte-identical). Source-audit confirms the wiring + the surface-not-inject distinction.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  executeCanonicalMutation,
  setJobWriteFunctions,
  setMatterStateProvider,
  setPaProfileProvider,
} from '../db/canonicalMutation.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';

const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';
const DOC = '33333333-3333-3333-3333-333333333333';

class CapturingAdapter implements LlmClient {
  public lastSystemPrompt: string | null = null;
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.lastSystemPrompt = params.systemPrompt;
    return Promise.resolve({ content: '[]', tokensPrompt: 1, tokensCompletion: 1, providerMetadata: { provider: 'capture' } });
  }
}

function installNoopJobWrites() {
  setJobWriteFunctions({
    insertJob: vi.fn().mockResolvedValue(undefined),
    markJobRunning: vi.fn().mockResolvedValue(1),
    markJobCompleted: vi.fn().mockResolvedValue(undefined),
    markJobFailed: vi.fn().mockResolvedValue(undefined),
    markJobTimedOut: vi.fn().mockResolvedValue(undefined),
    markJobCancelled: vi.fn().mockResolvedValue(1),
    updateJobHeartbeat: vi.fn().mockResolvedValue(undefined),
  });
}

const baseMutationParams = (matterId?: string) => ({
  userId: USER,
  jobType: 'reviewer_feedback' as const,
  modelString: 'anthropic:claude-opus-4-5',
  ...(matterId !== undefined ? { matterId } : {}),
  documentId: DOC,
  txn1Enqueue: async (jobId: string) => ({ jobId }),
  buildLlmParams: () => ({ systemPrompt: 'ROLE_SYSTEM_PROMPT', userPrompt: 'USER_PROMPT' }),
  txn2Commit: async () => {},
  txn2Revert: async () => {},
  telemetryCtx: { userId: USER, matterId: matterId ?? null, documentId: DOC, jobId: null },
});

const profile = (body: string) => ({ body, profileId: '44444444-4444-4444-4444-444444444444', version: '1.0', paKey: 'real_estate' });

describe('FOLD-KB-1 Inc4 — per-PA profile auto-load at the chokepoint', () => {
  afterEach(() => {
    setMatterStateProvider(null);
    setPaProfileProvider(null);
    setTestLlmAdapter(null);
    setJobWriteFunctions(null);
    vi.clearAllMocks();
  });

  it('prepends the active PA profile to the systemPrompt when matterId is present', async () => {
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setMatterStateProvider(async () => ''); // isolate PA injection
    setPaProfileProvider(async () => profile('PA_MASTER_PROMPT'));

    const result = await executeCanonicalMutation(baseMutationParams(MATTER));

    expect(result.status).toBe('completed');
    expect(adapter.lastSystemPrompt).toBe('PA_MASTER_PROMPT\n\nROLE_SYSTEM_PROMPT');
  });

  it('is best-effort: a failing PA-profile read degrades to the base prompt; call still dispatches', async () => {
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setMatterStateProvider(async () => '');
    setPaProfileProvider(async () => {
      throw new Error('simulated PA profile read failure');
    });

    const result = await executeCanonicalMutation(baseMutationParams(MATTER));

    expect(result.status).toBe('completed');
    expect(adapter.lastSystemPrompt).toBe('ROLE_SYSTEM_PROMPT');
  });

  it('no confirmed profile (provider returns null) leaves the base prompt unchanged', async () => {
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setMatterStateProvider(async () => '');
    setPaProfileProvider(async () => null);

    await executeCanonicalMutation(baseMutationParams(MATTER));
    expect(adapter.lastSystemPrompt).toBe('ROLE_SYSTEM_PROMPT');
  });

  it('does not load a profile when there is no matterId', async () => {
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setMatterStateProvider(async () => '');
    const paProvider = vi.fn().mockResolvedValue(profile('SHOULD_NOT_BE_USED'));
    setPaProfileProvider(paProvider);

    await executeCanonicalMutation(baseMutationParams(undefined));
    expect(paProvider).not.toHaveBeenCalled();
    expect(adapter.lastSystemPrompt).toBe('ROLE_SYSTEM_PROMPT');
  });
});

function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('FOLD-KB-1 Inc4 — chokepoint wiring (source audit)', () => {
  const cm = readSrc('../db/canonicalMutation.ts');
  it('canonicalMutation exposes the PA-profile test seam and injects best-effort', () => {
    expect(cm).toMatch(/export function setPaProfileProvider/);
    expect(cm).toMatch(/getPaProfileProvider\(\)\(/);
    expect(cm).toMatch(/pa_profile_loaded_for_job/);
  });
});
