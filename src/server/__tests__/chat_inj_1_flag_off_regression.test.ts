/**
 * CHAT-INJ-1 — R9 flag-OFF byte-for-byte regression + chokepoint layering proof.
 *
 * R9 (the load-bearing regression): with NO chatMasterText (the flag-OFF path, since
 * chatDispatch passes chatMasterText only when a master was injected), a chat_turn through the
 * chokepoint produces the EXACT CHAT-DISPATCH-1 substrate system block — the master branch is
 * never entered, matter-state behavior is unchanged, no per-PA double layer appears.
 *
 * Layering (the flag-ON path): when chatMasterText IS supplied, the chokepoint layers it like the
 * drafting master — OUTERMOST, on top of the matter-state block — and SUPPRESSES the per-PA profile
 * (D-5 parity). This mirrors the canonicalMutation change exactly, with no DB (test seams only).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
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
import { resolveChatMaster, setChatGateReader, type ChatGateReader } from '../llm/chatMasterComposition.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';

const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';
const MASTER_BLOCK = 'FIRM-MASTER-TEXT\n\n[INTERNAL CHAT — ATTORNEY-SUPERVISED WORK PRODUCT] addendum';
const MATTER_STATE = 'MATTER-STATE-BLOCK';

// Both drafting-composition flags OFF so chat_turn composition is unambiguously legacy.
const LAWFIRM = 'MASTER_LAWFIRM_ENABLED';
const COMPOSITION = 'PROMPT_COMPOSITION_ENABLED';
let savedLawfirm: string | undefined;
let savedComposition: string | undefined;

class CapturingAdapter implements LlmClient {
  public lastSystemPrompt: string | null = null;
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.lastSystemPrompt = params.systemPrompt;
    return Promise.resolve({
      content: 'REPLY',
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

function runChatTurn(opts: {
  chatMasterText?: string;
  matterState: string;
  paProfileSpy?: () => Promise<{ body: string; profileId: string; paKey: string; version: string } | null>;
}): Promise<{ systemPrompt: string | null }> {
  const adapter = new CapturingAdapter();
  setTestLlmAdapter(adapter);
  installNoopJobWrites();
  setMatterStateProvider(async () => opts.matterState);
  setPaProfileProvider(opts.paProfileSpy ?? (async () => null));
  setPromptSnapshotWriter(async () => {});
  return executeCanonicalMutation({
    userId: USER,
    jobType: 'chat_turn',
    modelString: PRIMARY_DRAFTER_MODEL,
    matterId: MATTER,
    ...(opts.chatMasterText !== undefined ? { chatMasterText: opts.chatMasterText } : {}),
    txn1Enqueue: (jobId) => Promise.resolve({ jobId }),
    buildLlmParams: () => ({
      systemPrompt: CHAT_TURN_SYSTEM_PROMPT,
      userPrompt: 'a question',
      temperature: 0.3,
      maxTokens: 2048,
    }),
    txn2Commit: () => Promise.resolve(),
    txn2Revert: () => Promise.resolve(),
    telemetryCtx: { userId: USER, matterId: MATTER, documentId: null, jobId: null },
  }).then(() => ({ systemPrompt: adapter.lastSystemPrompt }));
}

beforeEach(() => {
  savedLawfirm = process.env[LAWFIRM];
  savedComposition = process.env[COMPOSITION];
  delete process.env[LAWFIRM];
  delete process.env[COMPOSITION];
});
afterEach(() => {
  if (savedLawfirm === undefined) delete process.env[LAWFIRM];
  else process.env[LAWFIRM] = savedLawfirm;
  if (savedComposition === undefined) delete process.env[COMPOSITION];
  else process.env[COMPOSITION] = savedComposition;
  setPromptSnapshotWriter(null);
  setMatterStateProvider(null);
  setPaProfileProvider(null);
  setTestLlmAdapter(null);
  setJobWriteFunctions(null);
  vi.clearAllMocks();
});

describe('CHAT-INJ-1 R9 — flag-OFF byte-for-byte (no chatMasterText)', () => {
  it('no master, empty matter-state -> system block is EXACTLY the substrate prompt', async () => {
    const { systemPrompt } = await runChatTurn({ matterState: '' });
    expect(systemPrompt).toBe(CHAT_TURN_SYSTEM_PROMPT);
  });

  it('no master, with matter-state -> matter-state + substrate ONLY (no master layer)', async () => {
    const { systemPrompt } = await runChatTurn({ matterState: MATTER_STATE });
    expect(systemPrompt).toBe(`${MATTER_STATE}\n\n${CHAT_TURN_SYSTEM_PROMPT}`);
    expect(systemPrompt).not.toContain('INTERNAL CHAT');
  });

  it('the PA-profile would still load when no master is present (unchanged legacy behavior)', async () => {
    const paSpy = vi.fn().mockResolvedValue({ body: 'PA-BODY', profileId: 'p1', paKey: 'x', version: '1' });
    const { systemPrompt } = await runChatTurn({ matterState: '', paProfileSpy: paSpy });
    expect(paSpy).toHaveBeenCalledTimes(1); // legacy path consults the PA profile
    expect(systemPrompt).toBe(`PA-BODY\n\n${CHAT_TURN_SYSTEM_PROMPT}`);
  });
});

describe('CHAT-INJ-1 — chokepoint layering (chatMasterText present)', () => {
  it('master is layered OUTERMOST on top of the substrate (empty matter-state)', async () => {
    const { systemPrompt } = await runChatTurn({ chatMasterText: MASTER_BLOCK, matterState: '' });
    expect(systemPrompt).toBe(`${MASTER_BLOCK}\n\n${CHAT_TURN_SYSTEM_PROMPT}`);
  });

  it('master OUTERMOST, then matter-state, then the base prompt', async () => {
    const { systemPrompt } = await runChatTurn({ chatMasterText: MASTER_BLOCK, matterState: MATTER_STATE });
    expect(systemPrompt).toBe(`${MASTER_BLOCK}\n\n${MATTER_STATE}\n\n${CHAT_TURN_SYSTEM_PROMPT}`);
  });

  it('D-5 parity: the per-PA profile is SUPPRESSED when a master is injected (never consulted)', async () => {
    const paSpy = vi.fn().mockResolvedValue({ body: 'PA-BODY', profileId: 'p1', paKey: 'x', version: '1' });
    const { systemPrompt } = await runChatTurn({ chatMasterText: MASTER_BLOCK, matterState: '', paProfileSpy: paSpy });
    expect(paSpy).not.toHaveBeenCalled(); // master governs; no double identity layer
    expect(systemPrompt).toBe(`${MASTER_BLOCK}\n\n${CHAT_TURN_SYSTEM_PROMPT}`);
    expect(systemPrompt).not.toContain('PA-BODY');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R9 — flag-OFF neutral + ZERO reads across representative matter types (resolver level).
// The chokepoint tests above prove byte-for-byte legacy when no chatMasterText is supplied; these
// prove the DECISION supplies no chatMasterText (layeredMasterText === null) AND never reads the
// gate when MASTER_CHAT_ENABLED is OFF — for a title-elected matter and a matter-less turn, not just
// the representational happy path. True-by-construction (the flag check precedes all matter logic),
// now asserted explicitly per the review.
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-INJ-1 R9 — flag-OFF neutral + zero reads (representative matter types)', () => {
  const CHAT_FLAG = 'MASTER_CHAT_ENABLED';
  let savedChat: string | undefined;
  beforeEach(() => {
    savedChat = process.env[CHAT_FLAG];
    delete process.env[CHAT_FLAG]; // OFF
  });
  afterEach(() => {
    if (savedChat === undefined) delete process.env[CHAT_FLAG];
    else process.env[CHAT_FLAG] = savedChat;
    setChatGateReader(null);
  });

  /** A gate reader that counts its calls, so we can assert ZERO reads when the flag is OFF. */
  function countingGate(): { reader: ChatGateReader; calls: () => number } {
    let n = 0;
    const reader: ChatGateReader = () => {
      n += 1;
      return Promise.resolve({ allowed: true });
    };
    return { reader, calls: () => n };
  }

  const titleElected = { engagementCapacity: 'title_settlement_agent', paKey: 'trusts_estates', practiceArea: null };

  it('flag OFF + title-elected matter -> neutral (legacy bytes), ZERO gate reads', async () => {
    const gate = countingGate();
    setChatGateReader(gate.reader);
    const d = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: titleElected, principal: { userId: USER } });
    expect(d.inject).toBe(false);
    expect(d.layeredMasterText).toBeNull(); // no master -> chatMasterText absent -> byte-for-byte legacy
    expect(d.reason).toBe('flag_off');
    expect(gate.calls()).toBe(0); // ZERO extra reads
  });

  it('flag OFF + matter-less turn -> neutral (legacy bytes), ZERO gate reads', async () => {
    const gate = countingGate();
    setChatGateReader(gate.reader);
    const d = await resolveChatMaster({ matterId: MATTER, userId: USER, matter: null, principal: { userId: USER } });
    expect(d.inject).toBe(false);
    expect(d.layeredMasterText).toBeNull();
    expect(d.reason).toBe('flag_off');
    expect(gate.calls()).toBe(0);
  });
});
