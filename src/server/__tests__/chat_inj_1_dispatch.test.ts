/**
 * CHAT-INJ-1 — submitTurn integration (R4 UI notice, R8 provenance + no-send, R9 no-extra-write).
 *
 * Drives the real chatDispatch.submitTurn through the router with the matter read + audit write
 * mocked (CI has no test DB) and the conflicts gate + chokepoint supplied via their test seams:
 *   - flag ON + representational + gate cleared  -> master injected, UI notice returned, provenance
 *     recorded (action 'chat_master_injected', JSON payload — no new column);
 *   - flag ON + non-representational (title)      -> neutral, no notice, provenance 'chat_master_neutral';
 *   - flag OFF                                    -> neutral, NO gate read, NO provenance write (R9);
 *   - R8 no-send: the prompts forbid sending and the result carries no transport/recipient field.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../db/queries/matters.js', async (orig) => {
  const actual = await orig<typeof import('../db/queries/matters.js')>();
  return { ...actual, getMatterById: vi.fn() };
});
vi.mock('../db/queries/auditEvents.js', async (orig) => {
  const actual = await orig<typeof import('../db/queries/auditEvents.js')>();
  return { ...actual, recordAuditEvent: vi.fn().mockResolvedValue(undefined) };
});

import { appRouter } from '../router.js';
import { getMatterById } from '../db/queries/matters.js';
import { recordAuditEvent } from '../db/queries/auditEvents.js';
import { CHAT_TURN_SYSTEM_PROMPT } from '../procedures/chatDispatch.js';
import { CHAT_MASTER_ADDENDUM, CHAT_MASTER_UI_NOTICE, setChatGateReader } from '../llm/chatMasterComposition.js';
import { getPromptAsset, MASTER_CLAUDE_LAWFIRM } from '../llm/promptAssets.js';
import {
  setJobWriteFunctions,
  setMatterStateProvider,
  setPaProfileProvider,
  setPromptSnapshotWriter,
} from '../db/canonicalMutation.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';

const CHAT_FLAG = 'MASTER_CHAT_ENABLED';
const DISPATCH_FLAG = 'CHAT_DISPATCH_ENABLED';
const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';

type MatterReturn = Awaited<ReturnType<typeof getMatterById>>;
const asMatter = (o: { engagementCapacity?: string | null; paKey?: string | null; practiceArea?: string | null }): MatterReturn =>
  ({ id: MATTER, userId: USER, paKey: null, practiceArea: null, ...o } as unknown as MatterReturn);

class CapturingAdapter implements LlmClient {
  public lastSystemPrompt: string | null = null;
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.lastSystemPrompt = params.systemPrompt;
    return Promise.resolve({ content: 'REPLY', tokensPrompt: 1, tokensCompletion: 1, providerMetadata: { provider: 'capture' } });
  }
}

function caller() {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId: USER });
}

let capturing: CapturingAdapter;
let savedChat: string | undefined;
let savedDispatch: string | undefined;

beforeEach(() => {
  savedChat = process.env[CHAT_FLAG];
  savedDispatch = process.env[DISPATCH_FLAG];
  delete process.env[CHAT_FLAG];
  process.env[DISPATCH_FLAG] = 'true'; // dispatch substrate ON so submitTurn does not refuse
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
  setMatterStateProvider(async () => ''); // empty so the system block is master + substrate only
  setPaProfileProvider(async () => null);
  setPromptSnapshotWriter(async () => {});
});

afterEach(() => {
  if (savedChat === undefined) delete process.env[CHAT_FLAG];
  else process.env[CHAT_FLAG] = savedChat;
  if (savedDispatch === undefined) delete process.env[DISPATCH_FLAG];
  else process.env[DISPATCH_FLAG] = savedDispatch;
  setChatGateReader(null);
  setTestLlmAdapter(null);
  setJobWriteFunctions(null);
  setMatterStateProvider(null);
  setPaProfileProvider(null);
  setPromptSnapshotWriter(null);
  vi.clearAllMocks();
});

describe('CHAT-INJ-1 submitTurn — flag ON, representational, gate cleared', () => {
  it('injects the master, returns the R4 UI notice, and records R8 provenance', async () => {
    process.env[CHAT_FLAG] = 'true';
    vi.mocked(getMatterById).mockResolvedValue(asMatter({ engagementCapacity: 'law_firm' }));
    setChatGateReader(() => Promise.resolve({ allowed: true }));

    const res = await caller().chatDispatch.submitTurn({ matterId: MATTER, turnText: 'Draft a clause.' });

    expect(res.master.applied).toBe(true);
    expect(res.master.source).toBe(MASTER_CLAUDE_LAWFIRM);
    expect(res.master.notice).toBe(CHAT_MASTER_UI_NOTICE);
    expect(res.response).toBe('REPLY');
    // The model actually saw the master asset + the non-suppressible addendum.
    expect(capturing.lastSystemPrompt).toContain(getPromptAsset(MASTER_CLAUDE_LAWFIRM).text);
    expect(capturing.lastSystemPrompt).toContain(CHAT_MASTER_ADDENDUM);

    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(recordAuditEvent).mock.calls[0]![0];
    expect(arg.eventType).toBe('model_output');
    expect(arg.actor).toBe('system');
    expect(arg.action).toBe('chat_master_injected');
    expect(arg.targetType).toBe('chat_turn');
    expect(arg.matterId).toBe(MATTER);
    const payload = arg.payload as { masterId: string; representational: boolean; flagEnabled: boolean };
    expect(payload.masterId).toBe(MASTER_CLAUDE_LAWFIRM);
    expect(payload.representational).toBe(true);
    expect(payload.flagEnabled).toBe(true);
  });
});

describe('CHAT-INJ-1 submitTurn — flag ON, non-representational (title)', () => {
  it('injects NO master, returns no notice, and records a neutral provenance row', async () => {
    process.env[CHAT_FLAG] = 'true';
    vi.mocked(getMatterById).mockResolvedValue(asMatter({ engagementCapacity: 'title_settlement_agent', paKey: 'trusts_estates' }));
    setChatGateReader(() => Promise.resolve({ allowed: true }));

    const res = await caller().chatDispatch.submitTurn({ matterId: MATTER, turnText: 'advise the buyer' });

    expect(res.master.applied).toBe(false);
    expect(res.master.notice).toBeNull();
    expect(capturing.lastSystemPrompt).toBe(CHAT_TURN_SYSTEM_PROMPT); // substrate only, no master
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAuditEvent).mock.calls[0]![0].action).toBe('chat_master_neutral');
  });
});

describe('CHAT-INJ-1 submitTurn — flag OFF (R9 no extra read/write)', () => {
  it('neutral substrate, the gate is NEVER read, and NO provenance is written', async () => {
    // CHAT_FLAG unset by beforeEach (dispatch flag ON).
    const gateSpy = vi.fn();
    setChatGateReader((m, u) => {
      gateSpy(m, u);
      return Promise.resolve({ allowed: true });
    });
    vi.mocked(getMatterById).mockResolvedValue(asMatter({ engagementCapacity: 'law_firm' }));

    const res = await caller().chatDispatch.submitTurn({ matterId: MATTER, turnText: 'hello' });

    expect(res.master.applied).toBe(false);
    expect(res.master.notice).toBeNull();
    expect(capturing.lastSystemPrompt).toBe(CHAT_TURN_SYSTEM_PROMPT); // byte-for-byte substrate
    expect(gateSpy).not.toHaveBeenCalled(); // ZERO extra reads
    expect(recordAuditEvent).not.toHaveBeenCalled(); // NO extra write
  });
});

describe('CHAT-INJ-1 R8 — no send path', () => {
  it('the substrate prompt and the addendum both forbid sending', () => {
    expect(CHAT_TURN_SYSTEM_PROMPT.toLowerCase()).toContain('do not send');
    expect(CHAT_MASTER_ADDENDUM.toLowerCase()).toMatch(/must not be sent/);
  });

  it('the submitTurn result carries no transport/recipient field (returns to the attorney only)', async () => {
    process.env[CHAT_FLAG] = 'true';
    vi.mocked(getMatterById).mockResolvedValue(asMatter({ engagementCapacity: 'law_firm' }));
    setChatGateReader(() => Promise.resolve({ allowed: true }));
    const res = await caller().chatDispatch.submitTurn({ matterId: MATTER, turnText: 'q' });
    expect(Object.keys(res).sort()).toEqual(['jobId', 'master', 'response', 'status']);
  });
});
