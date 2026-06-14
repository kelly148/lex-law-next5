/**
 * CHAT-COPILOT-1 Inc 3+4 — grounding + citations (BUNDLED, FAIL-CLOSED).
 *
 * PURE: provider allowlist (empty => inert), NPI minimization, citation parse/validation, budget-by-mode,
 * context render. INTEGRATION (real chatCopilot.submitTurn through the router, DB-free via the store seam +
 * mocked query modules): the KEY fail-closed test (empty allowlist => NO document/material text reaches the
 * model), only-allowlisted-provider grounds, NPI default-withhold + affirmative select, hallucinated-sourceId
 * rejection, omitted/truncation surfaced, matter/document scoping, sensitivity downgrade, flag-OFF zero-read.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../db/queries/matters.js', async (orig) => ({ ...(await orig<typeof import('../db/queries/matters.js')>()), getMatterById: vi.fn() }));
vi.mock('../db/queries/documents.js', async (orig) => ({ ...(await orig<typeof import('../db/queries/documents.js')>()), getDocumentById: vi.fn() }));
vi.mock('../db/queries/versions.js', async (orig) => ({ ...(await orig<typeof import('../db/queries/versions.js')>()), getVersionById: vi.fn() }));
vi.mock('../db/queries/materials.js', async (orig) => ({ ...(await orig<typeof import('../db/queries/materials.js')>()), listMaterialsForMatter: vi.fn(), listPinnedMaterials: vi.fn() }));
vi.mock('../db/queries/phase4b.js', async (orig) => ({ ...(await orig<typeof import('../db/queries/phase4b.js')>()), listLockedDecisionsForMatter: vi.fn(), listAdoptLedgerForMatter: vi.fn() }));

import { appRouter } from '../router.js';
import { getMatterById } from '../db/queries/matters.js';
import { getDocumentById } from '../db/queries/documents.js';
import { getVersionById } from '../db/queries/versions.js';
import { listMaterialsForMatter, listPinnedMaterials } from '../db/queries/materials.js';
import { listLockedDecisionsForMatter, listAdoptLedgerForMatter } from '../db/queries/phase4b.js';
import {
  setChatCopilotStore,
  createConversation,
  setConversationMark,
} from '../db/queries/chatCopilot.js';
import { createInMemoryChatCopilotStore } from './inMemoryChatCopilotStore.js';
// CHAT-COPILOT-2 A1: submitTurn's primary send now routes through the egress broker, which writes a
// chat_egress_events row. Inject the in-memory egress store so the broker has a DB-free audit sink.
import { setEgressEventStore, listEgressEvents } from '../db/queries/chatEgress.js';
import { createInMemoryEgressEventStore } from './inMemoryEgressStore.js';
import { setChatGateReader } from '../llm/chatMasterComposition.js';
import { setJobWriteFunctions, setMatterStateProvider, setPaProfileProvider, setPromptSnapshotWriter } from '../db/canonicalMutation.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';
import {
  isGroundedChatProviderAllowed,
  setGroundedChatProviderAllowlistForTests,
  chatTurnBudgetForMode,
  materialTagsAreNpiWithheld,
} from '../llm/chatCopilotConfig.js';
import { parseChatCitations, npiWithheldMaterialIds, renderGroundedContext, type GroundedSource } from '../llm/chatGrounding.js';

const COPILOT_FLAG = 'CHAT_COPILOT_ENABLED';
const U1 = '11111111-1111-1111-1111-111111111111';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DOC_1 = 'd1111111-1111-1111-1111-111111111111';
const VER_1 = 'e1111111-1111-1111-1111-111111111111';
const MAT_1 = 'c1111111-1111-1111-1111-111111111111';
const MAT_NPI = 'c2222222-2222-2222-2222-222222222222';
const MAT_EMPTY = 'c3333333-3333-3333-3333-333333333333';
const lawFirmElected = { engagementCapacity: 'law_firm', engagementCapacityElectedAt: new Date('2026-06-13T00:00:00Z'), paKey: null, practiceArea: null };

// CHAT-COPILOT-1-GCFG: the grounded-chat allowlist is now env-driven (GROUNDED_CHAT_PROVIDERS). Make every
// test in this file HERMETIC w.r.t. that env var so the KEY fail-closed assertions (empty allowlist => no
// document/material text leaves the system) hold by construction regardless of any ambient env. The test
// seam (setGroundedChatProviderAllowlistForTests) still takes precedence, so seam-driven tests are unaffected.
let _savedGroundedEnv: string | undefined;
beforeEach(() => {
  _savedGroundedEnv = process.env.GROUNDED_CHAT_PROVIDERS;
  delete process.env.GROUNDED_CHAT_PROVIDERS;
});
afterEach(() => {
  if (_savedGroundedEnv === undefined) delete process.env.GROUNDED_CHAT_PROVIDERS;
  else process.env.GROUNDED_CHAT_PROVIDERS = _savedGroundedEnv;
});

// ─────────────────────────────────────────────────────────────────────────────
// PURE
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-COPILOT-1 Inc 3+4 — pure', () => {
  afterEach(() => setGroundedChatProviderAllowlistForTests(null));

  it('provider allowlist ships EMPTY (fail-closed): no provider is allowed by default', () => {
    expect(isGroundedChatProviderAllowed('anthropic')).toBe(false);
    expect(isGroundedChatProviderAllowed('openai')).toBe(false);
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    expect(isGroundedChatProviderAllowed('anthropic')).toBe(true);
    expect(isGroundedChatProviderAllowed('openai')).toBe(false); // only the listed provider
  });

  it('NPI minimization: a withheld-category-tagged material is withheld unless affirmatively selected', () => {
    expect(materialTagsAreNpiWithheld(['wire_instructions'])).toBe(true);
    expect(materialTagsAreNpiWithheld(['notes'])).toBe(false);
    const mats = [{ id: MAT_1, tags: [] }, { id: MAT_NPI, tags: ['wire_instructions'] }];
    expect(npiWithheldMaterialIds(mats, new Set())).toEqual([MAT_NPI]); // withheld by default
    expect(npiWithheldMaterialIds(mats, new Set([MAT_NPI]))).toEqual([]); // affirmatively selected -> included
  });

  it('citation fidelity: a cited sourceId NOT in the assembled set is rejected (dropped, not returned)', () => {
    const valid = new Set(['material:c1', 'doc:d1@v1']);
    const out = parseChatCitations('See [[cite:material:c1|p2]] and [[cite:material:HALLUCINATED]] and [[cite:doc:d1@v1]].', valid);
    expect(out.citations).toEqual([{ sourceId: 'material:c1', locator: 'p2' }, { sourceId: 'doc:d1@v1' }]);
    expect(out.rejectedCount).toBe(1); // the hallucinated id was rejected
  });

  it('dynamic budget by mode (not one fixed cap); render marks sourceIds + cite instruction', () => {
    expect(chatTurnBudgetForMode('review')).toBeGreaterThan(chatTurnBudgetForMode('default'));
    expect(chatTurnBudgetForMode(undefined)).toBe(chatTurnBudgetForMode('default'));
    const sources: GroundedSource[] = [{ sourceId: 'material:c1', kind: 'material', label: 'notes', text: 'TXT', locator: null }];
    const rendered = renderGroundedContext(sources);
    expect(rendered).toContain('id=material:c1');
    expect(rendered).toContain('[[cite:SOURCE_ID]]');
    expect(renderGroundedContext([])).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION — submitTurn grounding (fail-closed default + the allowlisted path)
// ─────────────────────────────────────────────────────────────────────────────
class CapturingAdapter implements LlmClient {
  public lastUserPrompt: string | null = null;
  public responseText = 'REPLY';
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.lastUserPrompt = params.userPrompt;
    return Promise.resolve({ content: this.responseText, tokensPrompt: 1, tokensCompletion: 1, providerMetadata: { provider: 'capture' } });
  }
}
type MatterReturn = Awaited<ReturnType<typeof getMatterById>>;
const asMatter = (o: Record<string, unknown>): MatterReturn => ({ id: MATTER_A, userId: U1, paKey: null, practiceArea: null, ...o } as unknown as MatterReturn);
const mat = (id: string, textContent: string | null, tags: string[]) => ({ id, userId: U1, matterId: MATTER_A, filename: `${id}.txt`, mimeType: null, fileSize: null, storageKey: null, textContent, extractionStatus: 'extracted', extractionError: null, tags, description: null, pinned: false, uploadSource: 'upload', deletedAt: null, createdAt: new Date(), updatedAt: new Date() });
function caller() { return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId: U1 }); }

let capturing: CapturingAdapter;
let saved: string | undefined;

describe('CHAT-COPILOT-1 Inc 3+4 — submitTurn grounding integration', () => {
  beforeEach(() => {
    saved = process.env[COPILOT_FLAG];
    process.env[COPILOT_FLAG] = 'true';
    setChatCopilotStore(createInMemoryChatCopilotStore());
    setEgressEventStore(createInMemoryEgressEventStore());
    capturing = new CapturingAdapter();
    setTestLlmAdapter(capturing);
    setJobWriteFunctions({
      insertJob: vi.fn().mockResolvedValue(undefined), markJobRunning: vi.fn().mockResolvedValue(1), markJobCompleted: vi.fn().mockResolvedValue(undefined),
      markJobFailed: vi.fn().mockResolvedValue(undefined), markJobTimedOut: vi.fn().mockResolvedValue(undefined), markJobCancelled: vi.fn().mockResolvedValue(1), updateJobHeartbeat: vi.fn().mockResolvedValue(undefined),
    });
    setMatterStateProvider(async () => '');
    setPaProfileProvider(async () => null);
    setPromptSnapshotWriter(async () => {});
    setChatGateReader(() => Promise.resolve({ allowed: true }));
    // default grounding fixtures (matter-state + the operative doc + materials)
    vi.mocked(getMatterById).mockResolvedValue(asMatter(lawFirmElected));
    vi.mocked(getDocumentById).mockResolvedValue({ id: DOC_1, matterId: MATTER_A, userId: U1, title: 'Smith Trust', currentVersionId: VER_1 } as never);
    vi.mocked(getVersionById).mockResolvedValue({ id: VER_1, versionNumber: 3, content: 'OPERATIVE_DOC_TEXT' } as never);
    vi.mocked(listPinnedMaterials).mockResolvedValue([]);
    vi.mocked(listMaterialsForMatter).mockResolvedValue([mat(MAT_1, 'MATERIAL_TEXT', []), mat(MAT_NPI, 'WIRE_DETAILS_SECRET', ['wire_instructions']), mat(MAT_EMPTY, null, [])] as never);
    vi.mocked(listLockedDecisionsForMatter).mockResolvedValue([]);
    vi.mocked(listAdoptLedgerForMatter).mockResolvedValue([]);
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[COPILOT_FLAG]; else process.env[COPILOT_FLAG] = saved;
    setChatCopilotStore(null); setEgressEventStore(null); setChatGateReader(null); setTestLlmAdapter(null); setJobWriteFunctions(null);
    setMatterStateProvider(null); setPaProfileProvider(null); setPromptSnapshotWriter(null);
    setGroundedChatProviderAllowlistForTests(null);
    vi.clearAllMocks();
  });

  it('KEY FAIL-CLOSED (CHAT-COPILOT-2 A1): with the EMPTY allowlist the PRIMARY send is BLOCKED (logged), NO model call, NO document/material text assembled', async () => {
    // allowlist left EMPTY (the prod default). CHAT-COPILOT-2 A1 routes the primary send through the
    // egress broker, which gates on the allowlist FAIL-CLOSED. So the EMPTY allowlist now BLOCKS the
    // send entirely (stronger than the prior 'grounding inert, primary responds') — the copilot cannot
    // operate until a provider is allowlisted (the intended GLBA posture). The blocked decision is logged.
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected, documentId: DOC_1 });
    await expect(
      caller().chatCopilot.submitTurn({ conversationId: conv.id, matterId: MATTER_A, turnText: 'summarize the trust' }),
    ).rejects.toThrow(/EGRESS_BLOCKED/);
    // No model call at all — the guarantee is stronger than before (not just 'no doc text in the prompt').
    expect(capturing.lastUserPrompt).toBeNull();
    // grounding readers are never consulted when grounding is inert
    expect(vi.mocked(getDocumentById)).not.toHaveBeenCalled();
    expect(vi.mocked(listMaterialsForMatter)).not.toHaveBeenCalled();
    // the blocked send is logged (incident-detection evidence — G3)
    const events = await listEgressEvents(U1, { matterId: MATTER_A });
    expect(events.length).toBe(1);
    expect(events[0]!.decision).toBe('blocked');
    expect(events[0]!.blockReason).toContain('provider_not_allowlisted');
    expect(events[0]!.status).toBe('blocked');
  });

  it('only an ALLOWLISTED provider operates + grounds (CHAT-COPILOT-2 A1): allowlist [openai] BLOCKS the anthropic primary; [anthropic] sends + grounds', async () => {
    // [openai] does not include the chat provider (anthropic): post-A1 the PRIMARY send is BLOCKED at the
    // broker (not merely grounding-inert). No model call; the blocked decision is logged.
    setGroundedChatProviderAllowlistForTests(['openai']);
    let conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected, documentId: DOC_1 });
    await expect(
      caller().chatCopilot.submitTurn({ conversationId: conv.id, matterId: MATTER_A, turnText: 'q' }),
    ).rejects.toThrow(/EGRESS_BLOCKED/);
    expect(capturing.lastUserPrompt).toBeNull();

    // [anthropic] (the chat provider) IS allowlisted: the primary send is allowed AND grounding activates.
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected, documentId: DOC_1 });
    const res = await caller().chatCopilot.submitTurn({ conversationId: conv.id, matterId: MATTER_A, turnText: 'q' });
    expect(res.grounding.grounded).toBe(true);
    expect(capturing.lastUserPrompt).toContain('OPERATIVE_DOC_TEXT'); // operative document grounded
    expect(capturing.lastUserPrompt).toContain('MATERIAL_TEXT');
    expect(capturing.lastUserPrompt).toContain('id=doc:' + DOC_1 + '@' + VER_1); // sourceId minted
  });

  it('NPI default-withhold: a wire-instructions material is excluded by default; affirmative select includes it', async () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected, documentId: DOC_1 });
    const res = await caller().chatCopilot.submitTurn({ conversationId: conv.id, matterId: MATTER_A, turnText: 'q' });
    expect(capturing.lastUserPrompt).not.toContain('WIRE_DETAILS_SECRET'); // withheld by default
    expect(res.grounding.npiWithheldCount).toBe(1);
    // affirmatively select the NPI material for this turn -> it IS sent
    const conv2 = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected, documentId: DOC_1 });
    const res2 = await caller().chatCopilot.submitTurn({ conversationId: conv2.id, matterId: MATTER_A, turnText: 'q', selectedMaterialIds: [MAT_NPI] });
    expect(capturing.lastUserPrompt).toContain('WIRE_DETAILS_SECRET');
    expect(res2.grounding.npiWithheldCount).toBe(0);
  });

  it('citation fidelity end-to-end: a hallucinated sourceId in the model output is rejected, the valid one kept', async () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    capturing.responseText = 'Per [[cite:material:' + MAT_1 + '|p1]] and [[cite:material:NOPE]].';
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected, documentId: DOC_1 });
    const res = await caller().chatCopilot.submitTurn({ conversationId: conv.id, matterId: MATTER_A, turnText: 'q' });
    expect(res.citations).toEqual([{ sourceId: 'material:' + MAT_1, locator: 'p1' }]);
    expect(res.rejectedCitationCount).toBe(1);
  });

  it('no SILENT truncation: omitted (no-content) materials are surfaced in the response', async () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected, documentId: DOC_1 });
    const res = await caller().chatCopilot.submitTurn({ conversationId: conv.id, matterId: MATTER_A, turnText: 'q' });
    // MAT_EMPTY (null content) is omitted (no_content); the NPI material is counted under npiWithheldCount, not omitted
    expect(res.grounding.omittedCount).toBeGreaterThanOrEqual(1);
  });

  it('grounding is scoped to the bound matter + document (no cross-matter assembly)', async () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected, documentId: DOC_1 });
    await caller().chatCopilot.submitTurn({ conversationId: conv.id, matterId: MATTER_A, turnText: 'q' });
    expect(vi.mocked(listMaterialsForMatter)).toHaveBeenCalledWith(MATTER_A, U1);
    expect(vi.mocked(getDocumentById)).toHaveBeenCalledWith(DOC_1, U1);
    expect(vi.mocked(listLockedDecisionsForMatter)).toHaveBeenCalledWith(MATTER_A, U1);
  });

  it('sensitivity downgrade: a conversation marked excludeFromGrounding stays matter-state-only even when allowlisted', async () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected, documentId: DOC_1 });
    await setConversationMark(conv.id, U1, { excludeFromGrounding: true });
    const res = await caller().chatCopilot.submitTurn({ conversationId: conv.id, matterId: MATTER_A, turnText: 'q' });
    expect(res.grounding.grounded).toBe(false);
    expect(capturing.lastUserPrompt).not.toContain('OPERATIVE_DOC_TEXT');
  });

  it('flag-OFF: submitTurn refuses with ZERO reads (no grounding, no model call)', async () => {
    delete process.env[COPILOT_FLAG];
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    await expect(caller().chatCopilot.submitTurn({ conversationId: '00000000-0000-0000-0000-000000000000', matterId: MATTER_A, turnText: 'q' })).rejects.toThrow(/CHAT_COPILOT_DISABLED/);
    expect(vi.mocked(getMatterById)).not.toHaveBeenCalled();
    expect(vi.mocked(getDocumentById)).not.toHaveBeenCalled();
    expect(capturing.lastUserPrompt).toBeNull();
  });
});
