/**
 * CHAT-COPILOT-1 Inc 2 — persistence + windowed multi-turn history + master-laundering mitigations.
 *
 * PURE: window-scrub, posture-aware summary selection/segmentation, freeze-on-divergence, last-N window.
 * INTEGRATION (real chatCopilot.submitTurn through the router, DB-free via the store seam + the chat-turn
 * seams): history-replay laundering CLOSED (a stored master-applied turn cannot leak into a turn the LIVE
 * gate refuses), freeze-on-capacity-divergence, the fresh per-turn gate (persisted flags are audit-only),
 * and the flag-OFF byte-for-byte zero-read regression.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../db/queries/matters.js', async (orig) => {
  const actual = await orig<typeof import('../db/queries/matters.js')>();
  return { ...actual, getMatterById: vi.fn() };
});
// CHAT-COPILOT-2 A1: the primary send now routes through the egress broker, which gates on the allowlist.
// These integration tests allowlist 'anthropic' so the broker PERMITS the send; that also makes grounding
// eligible, so the grounding readers are mocked to EMPTY (these are persistence tests, not grounding tests).
vi.mock('../db/queries/materials.js', async (orig) => ({ ...(await orig<typeof import('../db/queries/materials.js')>()), listMaterialsForMatter: vi.fn(), listPinnedMaterials: vi.fn() }));
vi.mock('../db/queries/phase4b.js', async (orig) => ({ ...(await orig<typeof import('../db/queries/phase4b.js')>()), listLockedDecisionsForMatter: vi.fn(), listAdoptLedgerForMatter: vi.fn() }));

import { appRouter } from '../router.js';
import { getMatterById } from '../db/queries/matters.js';
import { listMaterialsForMatter, listPinnedMaterials } from '../db/queries/materials.js';
import { listLockedDecisionsForMatter, listAdoptLedgerForMatter } from '../db/queries/phase4b.js';
import { setEgressEventStore } from '../db/queries/chatEgress.js';
import { createInMemoryEgressEventStore } from './inMemoryEgressStore.js';
import { setGroundedChatProviderAllowlistForTests } from '../llm/chatCopilotConfig.js';
import {
  setChatCopilotStore,
  createConversation,
  appendChatMessage,
  getConversationInContext,
  type ChatCopilotStore,
} from '../db/queries/chatCopilot.js';
import { createInMemoryChatCopilotStore } from './inMemoryChatCopilotStore.js';
import { setChatGateReader } from '../llm/chatMasterComposition.js';
import {
  setJobWriteFunctions,
  setMatterStateProvider,
  setPaProfileProvider,
  setPromptSnapshotWriter,
} from '../db/canonicalMutation.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';
import {
  scrubWindow,
  selectHistoryWindow,
  selectCompatibleSummaries,
  segmentForSummary,
  evaluateFreeze,
  assembleCopilotWindow,
  buildCapacitySnapshot,
  type WindowMessage,
} from '../llm/chatCopilotPolicy.js';
import type { CapacitySnapshot, ChatSummaryRow } from '../../shared/schemas/chatCopilot.js';

const COPILOT_FLAG = 'CHAT_COPILOT_ENABLED';
const CHAT_FLAG = 'MASTER_CHAT_ENABLED';
const U1 = '11111111-1111-1111-1111-111111111111';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const lawFirmElected = { engagementCapacity: 'law_firm', engagementCapacityElectedAt: new Date('2026-06-13T00:00:00Z'), paKey: null, practiceArea: null };
const titleElected = { engagementCapacity: 'title_settlement_agent', engagementCapacityElectedAt: new Date('2026-06-13T00:00:00Z'), paKey: null, practiceArea: null };
const lfSnap = buildCapacitySnapshot(lawFirmElected);
const titleSnap = buildCapacitySnapshot(titleElected);

const wm = (over: Partial<WindowMessage> & { seq: number; masterApplied: boolean }): WindowMessage => ({
  role: 'attorney',
  content: `turn ${over.seq}`,
  doNotPersist: false,
  excludeFromGrounding: false,
  capacitySnapshot: lfSnap,
  ...over,
});
const summary = (masterApplied: boolean, cap: CapacitySnapshot, text: string): ChatSummaryRow => ({
  id: '00000000-0000-0000-0000-000000000000',
  userId: U1,
  matterId: MATTER_A,
  conversationId: '00000000-0000-0000-0000-000000000000',
  capacitySnapshot: cap,
  posture: { masterApplied, masterSource: masterApplied ? 'master/claude/lawfirm' : null, engagementCapacity: cap.engagementCapacity, electionMarker: cap.electionMarker, titleSignal: cap.titleSignal },
  coversFromSeq: 0,
  coversToSeq: 1,
  summaryText: text,
  createdAt: new Date(),
});

// ─────────────────────────────────────────────────────────────────────────────
// PURE — window / scrub / posture-aware summaries / segmentation / freeze
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-COPILOT-1 Inc 2 — pure mitigations', () => {
  it('selectHistoryWindow returns the last-N content turns and skips do-not-persist tombstones', () => {
    const msgs = [wm({ seq: 0, masterApplied: false }), wm({ seq: 1, masterApplied: false, content: null, doNotPersist: true }), wm({ seq: 2, masterApplied: false }), wm({ seq: 3, masterApplied: false })];
    const win = selectHistoryWindow(msgs, 2);
    expect(win.map((m) => m.seq)).toEqual([2, 3]); // last 2 non-tombstone
  });

  it('window-scrub DROPS master-applied priors when the current turn is NEUTRAL; keeps them when master-applied', () => {
    const win = [wm({ seq: 0, masterApplied: true, content: 'REPRESENTATIONAL' }), wm({ seq: 1, masterApplied: false, content: 'neutral talk' })];
    const neutral = scrubWindow(win, false);
    expect(neutral.window.map((m) => m.seq)).toEqual([1]); // master-applied prior removed
    expect(neutral.scrubbedMasterTurns).toBe(1);
    const master = scrubWindow(win, true);
    expect(master.window.map((m) => m.seq)).toEqual([0, 1]); // same-posture continuity kept
    expect(master.scrubbedMasterTurns).toBe(0);
  });

  it('posture-aware summaries: a master / cross-capacity summary is NEVER fed into an incompatible turn', () => {
    const lfMaster = summary(true, lfSnap, 'law-firm master summary');
    const lfNeutral = summary(false, lfSnap, 'neutral summary');
    const titleNeutral = summary(false, titleSnap, 'title summary');
    // a NEUTRAL law-firm turn gets only the neutral law-firm summary (never the master one, never title)
    expect(selectCompatibleSummaries([lfMaster, lfNeutral, titleNeutral], { masterApplied: false, capacitySnapshot: lfSnap })).toEqual([lfNeutral]);
    // a MASTER law-firm turn gets only the master law-firm summary
    expect(selectCompatibleSummaries([lfMaster, lfNeutral, titleNeutral], { masterApplied: true, capacitySnapshot: lfSnap })).toEqual([lfMaster]);
    // a law-firm-capacity summary is never fed into a title turn
    expect(selectCompatibleSummaries([lfMaster, lfNeutral], { masterApplied: false, capacitySnapshot: titleSnap })).toEqual([]);
  });

  it('segmentForSummary never spans a master/non-master boundary', () => {
    const msgs = [wm({ seq: 0, masterApplied: true }), wm({ seq: 1, masterApplied: true }), wm({ seq: 2, masterApplied: false }), wm({ seq: 3, masterApplied: true })];
    const segs = segmentForSummary(msgs);
    expect(segs.map((s) => s.map((m) => m.seq))).toEqual([[0, 1], [2], [3]]);
    for (const s of segs) expect(new Set(s.map((m) => m.masterApplied)).size).toBe(1); // homogeneous
  });

  it('evaluateFreeze: divergence freezes; same posture does not; already-frozen is reported', () => {
    expect(evaluateFreeze({ frozenAt: null, freezeReason: null, capacitySnapshot: lfSnap }, lfSnap).freeze).toBe(false);
    expect(evaluateFreeze({ frozenAt: null, freezeReason: null, capacitySnapshot: lfSnap }, titleSnap)).toMatchObject({ freeze: true, reason: 'capacity_divergence' });
    expect(evaluateFreeze({ frozenAt: new Date(), freezeReason: 'x', capacitySnapshot: lfSnap }, lfSnap)).toMatchObject({ alreadyFrozen: true });
  });

  it('assembleCopilotWindow composes last-N + scrub + posture-compatible summaries', () => {
    const out = assembleCopilotWindow({
      priorMessages: [wm({ seq: 0, masterApplied: true, content: 'REP' }), wm({ seq: 1, masterApplied: false, content: 'neutral' })],
      summaries: [summary(true, lfSnap, 'master sum'), summary(false, lfSnap, 'neutral sum')],
      currentMasterApplied: false,
      currentCapacitySnapshot: lfSnap,
      limit: 10,
    });
    expect(out.windowMessages.map((m) => m.content)).toEqual(['neutral']); // master prior scrubbed
    expect(out.scrubbedMasterTurns).toBe(1);
    expect(out.includedSummaries.map((s) => s.summaryText)).toEqual(['neutral sum']); // master summary excluded
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION — submitTurn through the router (store seam + chat-turn seams)
// ─────────────────────────────────────────────────────────────────────────────
class CapturingAdapter implements LlmClient {
  public lastSystemPrompt: string | null = null;
  public lastUserPrompt: string | null = null;
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.lastSystemPrompt = params.systemPrompt;
    this.lastUserPrompt = params.userPrompt;
    return Promise.resolve({ content: 'REPLY', tokensPrompt: 1, tokensCompletion: 1, providerMetadata: { provider: 'capture' } });
  }
}

type MatterReturn = Awaited<ReturnType<typeof getMatterById>>;
const asMatter = (o: Record<string, unknown>): MatterReturn => ({ id: MATTER_A, userId: U1, paKey: null, practiceArea: null, ...o } as unknown as MatterReturn);

function caller() {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId: U1 });
}

let capturing: CapturingAdapter;
let savedCopilot: string | undefined;
let savedChat: string | undefined;

describe('CHAT-COPILOT-1 Inc 2 — submitTurn integration', () => {
  beforeEach(() => {
    savedCopilot = process.env[COPILOT_FLAG];
    savedChat = process.env[CHAT_FLAG];
    process.env[COPILOT_FLAG] = 'true';
    process.env[CHAT_FLAG] = 'true';
    setChatCopilotStore(createInMemoryChatCopilotStore());
    setEgressEventStore(createInMemoryEgressEventStore());
    setGroundedChatProviderAllowlistForTests(['anthropic']); // broker permits the anthropic primary send
    vi.mocked(listMaterialsForMatter).mockResolvedValue([]);
    vi.mocked(listPinnedMaterials).mockResolvedValue([]);
    vi.mocked(listLockedDecisionsForMatter).mockResolvedValue([]);
    vi.mocked(listAdoptLedgerForMatter).mockResolvedValue([]);
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
    setMatterStateProvider(async () => '');
    setPaProfileProvider(async () => null);
    setPromptSnapshotWriter(async () => {});
  });
  afterEach(() => {
    if (savedCopilot === undefined) delete process.env[COPILOT_FLAG]; else process.env[COPILOT_FLAG] = savedCopilot;
    if (savedChat === undefined) delete process.env[CHAT_FLAG]; else process.env[CHAT_FLAG] = savedChat;
    setChatCopilotStore(null);
    setEgressEventStore(null);
    setGroundedChatProviderAllowlistForTests(null);
    setChatGateReader(null);
    setTestLlmAdapter(null);
    setJobWriteFunctions(null);
    setMatterStateProvider(null);
    setPaProfileProvider(null);
    setPromptSnapshotWriter(null);
    vi.clearAllMocks();
  });

  it('history-replay laundering CLOSED: a stored master-applied turn does NOT leak into a turn the live gate refuses', async () => {
    vi.mocked(getMatterById).mockResolvedValue(asMatter(lawFirmElected));
    // a conversation bound to the law-firm seat, with a prior MASTER-APPLIED turn carrying representational text.
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected });
    await appendChatMessage({ conversationId: conv.id, ctx: { userId: U1, matterId: MATTER_A }, turn: { role: 'assistant', text: 'REPRESENTATIONAL_SECRET', masterApplied: true, masterSource: 'master/claude/lawfirm', capacitySnapshot: lfSnap, draftingGateDecisionId: null } });
    // the LIVE gate now REFUSES (not cleared) -> this turn is neutral -> window-scrub must drop the prior master turn.
    setChatGateReader(() => Promise.resolve({ allowed: false }));
    const res = await caller().chatCopilot.submitTurn({ conversationId: conv.id, matterId: MATTER_A, turnText: 'what is our position' });
    expect(res.master.applied).toBe(false); // fresh gate refused -> neutral (persisted master flag did NOT short-circuit)
    expect(res.window.scrubbedMasterTurns).toBeGreaterThanOrEqual(1);
    expect(capturing.lastUserPrompt).not.toContain('REPRESENTATIONAL_SECRET'); // the master-applied prior was scrubbed
    expect(capturing.lastSystemPrompt).not.toContain('master'); // no master text layered on a neutral turn
  });

  it('same-posture continuity: when the live gate CLEARS, a prior master turn is kept (not scrubbed)', async () => {
    vi.mocked(getMatterById).mockResolvedValue(asMatter(lawFirmElected));
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected });
    await appendChatMessage({ conversationId: conv.id, ctx: { userId: U1, matterId: MATTER_A }, turn: { role: 'assistant', text: 'PRIOR_LAWFIRM_CONTENT', masterApplied: true, masterSource: 'master/claude/lawfirm', capacitySnapshot: lfSnap, draftingGateDecisionId: null } });
    setChatGateReader(() => Promise.resolve({ allowed: true }));
    const res = await caller().chatCopilot.submitTurn({ conversationId: conv.id, matterId: MATTER_A, turnText: 'continue' });
    expect(res.master.applied).toBe(true);
    expect(res.window.scrubbedMasterTurns).toBe(0);
    expect(capturing.lastUserPrompt).toContain('PRIOR_LAWFIRM_CONTENT'); // same-posture continuity preserved
  });

  it('freeze-on-capacity-divergence: a thread whose live capacity diverges is FROZEN and refuses the turn', async () => {
    // conversation born law-firm; the matter later becomes title/settlement -> divergence.
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected });
    vi.mocked(getMatterById).mockResolvedValue(asMatter(titleElected));
    setChatGateReader(() => Promise.resolve({ allowed: true }));
    await expect(caller().chatCopilot.submitTurn({ conversationId: conv.id, matterId: MATTER_A, turnText: 'advise' })).rejects.toThrow(/CONVERSATION_FROZEN_CAPACITY_DIVERGENCE/);
    // the conversation is now frozen; a subsequent turn refuses with the already-frozen code
    const frozen = await getConversationInContext(conv.id, { userId: U1, matterId: MATTER_A });
    expect(frozen.frozenAt).not.toBeNull();
    await expect(caller().chatCopilot.submitTurn({ conversationId: conv.id, matterId: MATTER_A, turnText: 'again' })).rejects.toThrow(/CONVERSATION_FROZEN/);
  });

  it('flag-OFF byte-for-byte: submitTurn refuses with ZERO reads and never reaches a model', async () => {
    delete process.env[COPILOT_FLAG];
    const throwingStore = new Proxy({} as ChatCopilotStore, { get() { return () => { throw new Error('store must not be touched when the flag is OFF'); }; } });
    setChatCopilotStore(throwingStore);
    await expect(caller().chatCopilot.submitTurn({ conversationId: '00000000-0000-0000-0000-000000000000', matterId: MATTER_A, turnText: 'hi' })).rejects.toThrow(/CHAT_COPILOT_DISABLED/);
    expect(capturing.lastUserPrompt).toBeNull(); // no model call
    expect(vi.mocked(getMatterById)).not.toHaveBeenCalled(); // zero reads
  });
});
