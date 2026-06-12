/**
 * CHAT-DISPATCH-1 — chat→model dispatch substrate tests.
 *
 * Proves:
 *   1. Flag OFF (default) — chatDispatch.submitTurn refuses with CHAT_DISPATCH_DISABLED before
 *      any DB read or model call; isEnabled reflects the flag (the byte-for-byte-inert GUARD).
 *   2. Registration — 'chat_turn' is in the job-type allow-list and resolves a prompt version
 *      (reuses the drafter role), so the chokepoint accepts it with no migration.
 *   3. No master — callRoleForJobType('chat_turn') is 'other', so assemblePrompt returns legacy
 *      even with composition enabled; a chat turn NEVER composes a master asset (master-into-chat
 *      is INSTR Phase D, triad-gated).
 *   4. Dispatch path — a chat_turn job routed through executeCanonicalMutation calls the model
 *      with EXACTLY the substrate system prompt (no master, no master-state prepend) and returns
 *      the model text (enqueue→run→response).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { appRouter } from '../router.js';
import { JOB_TYPE_VALUES } from '../db/schema.js';
import { getPromptVersionForJobType, PROMPT_VERSION } from '../llm/promptVersions.js';
import { callRoleForJobType, assemblePrompt } from '../llm/assemblePrompt.js';
import { PRIMARY_DRAFTER_MODEL } from '../llm/config.js';
import { CHAT_TURN_SYSTEM_PROMPT } from '../procedures/chatDispatch.js';
import {
  executeCanonicalMutation,
  setJobWriteFunctions,
  setMatterStateProvider,
  setPaProfileProvider,
  setPromptSnapshotWriter,
} from '../db/canonicalMutation.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';

const FLAG = 'CHAT_DISPATCH_ENABLED';
const COMPOSITION_FLAG = 'PROMPT_COMPOSITION_ENABLED';
const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';

let savedFlag: string | undefined;
let savedComposition: string | undefined;

beforeEach(() => {
  savedFlag = process.env[FLAG];
  savedComposition = process.env[COMPOSITION_FLAG];
  delete process.env[FLAG];
  delete process.env[COMPOSITION_FLAG];
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  if (savedComposition === undefined) delete process.env[COMPOSITION_FLAG];
  else process.env[COMPOSITION_FLAG] = savedComposition;
});

function caller(userId = USER) {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });
}

// ---------------------------------------------------------------------------
// 1. Flag-OFF GUARD — the procedure is inert when CHAT_DISPATCH_ENABLED is off
// ---------------------------------------------------------------------------

describe('CHAT-DISPATCH-1 — flag-OFF GUARD', () => {
  it('submitTurn refuses with CHAT_DISPATCH_DISABLED before any DB read or model call', async () => {
    await expect(
      caller().chatDispatch.submitTurn({ matterId: MATTER, turnText: 'What is the deadline?' }),
    ).rejects.toThrow('CHAT_DISPATCH_DISABLED');
  });

  it('isEnabled reflects the flag (false by default, true when exactly "true")', async () => {
    expect((await caller().chatDispatch.isEnabled()).enabled).toBe(false);
    process.env[FLAG] = 'true';
    expect((await caller().chatDispatch.isEnabled()).enabled).toBe(true);
    process.env[FLAG] = 'TRUE';
    expect((await caller().chatDispatch.isEnabled()).enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2 + 3. Registration + no-master composition
// ---------------------------------------------------------------------------

describe('CHAT-DISPATCH-1 — chat_turn registration + no-master composition', () => {
  it("'chat_turn' is registered in the job-type allow-list", () => {
    expect((JOB_TYPE_VALUES as readonly string[]).includes('chat_turn')).toBe(true);
  });

  it("resolves a prompt version (reuses the drafter role) and does NOT throw", () => {
    expect(getPromptVersionForJobType('chat_turn')).toBe(PROMPT_VERSION.drafter);
  });

  it("maps to call-role 'other', so a chat turn composes NO master even with composition ON", () => {
    expect(callRoleForJobType('chat_turn')).toBe('other');
    process.env[COMPOSITION_FLAG] = 'true';
    const out = assemblePrompt({
      matter: { paKey: 'trusts_estates', practiceArea: null },
      docType: null,
      callRole: callRoleForJobType('chat_turn'),
      model: PRIMARY_DRAFTER_MODEL,
    });
    expect(out.source).toBe('legacy');
    expect(out.systemText).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Dispatch path — enqueue→run→response with NO master
// ---------------------------------------------------------------------------

class CapturingAdapter implements LlmClient {
  public lastSystemPrompt: string | null = null;
  public lastUserPrompt: string | null = null;
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.lastSystemPrompt = params.systemPrompt;
    this.lastUserPrompt = params.userPrompt;
    return Promise.resolve({
      content: 'CHAT_MODEL_REPLY',
      tokensPrompt: 1,
      tokensCompletion: 1,
      providerMetadata: { provider: 'capture' },
    });
  }
}

function installNoopJobWrites(): void {
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

describe('CHAT-DISPATCH-1 — chat_turn dispatch path (executeCanonicalMutation)', () => {
  afterEach(() => {
    setPromptSnapshotWriter(null);
    setMatterStateProvider(null);
    setPaProfileProvider(null);
    setTestLlmAdapter(null);
    setJobWriteFunctions(null);
    vi.clearAllMocks();
  });

  it('routes a chat_turn through the chokepoint and returns the model text with NO master', async () => {
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    // Empty legacy injections so the system block is exactly the substrate prompt.
    setMatterStateProvider(async () => '');
    setPaProfileProvider(async () => null);
    setPromptSnapshotWriter(async () => {});

    let response = '';
    const result = await executeCanonicalMutation({
      userId: USER,
      jobType: 'chat_turn',
      modelString: PRIMARY_DRAFTER_MODEL,
      matterId: MATTER,
      txn1Enqueue: (jobId) => Promise.resolve({ jobId }),
      buildLlmParams: () => ({
        systemPrompt: CHAT_TURN_SYSTEM_PROMPT,
        userPrompt: 'What is the recording deadline?',
        temperature: 0.3,
        maxTokens: 2048,
      }),
      txn2Commit: ({ output }) => {
        response = typeof output === 'string' ? output : JSON.stringify(output);
        return Promise.resolve();
      },
      txn2Revert: () => Promise.resolve(),
      telemetryCtx: { userId: USER, matterId: MATTER, documentId: null, jobId: null },
    });

    expect(result.status).toBe('completed');
    expect(response).toBe('CHAT_MODEL_REPLY');
    // No master, no matter-state prepend: the system block is EXACTLY the substrate prompt.
    expect(adapter.lastSystemPrompt).toBe(CHAT_TURN_SYSTEM_PROMPT);
    expect(adapter.lastUserPrompt).toBe('What is the recording deadline?');
  });
});
