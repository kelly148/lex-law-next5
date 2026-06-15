/**
 * CHAT-COPILOT-2 Increment B — multi-model review panel (behavioral + structural).
 *
 * No test DB: the egress broker is driven via its seams (in-memory egress store + test LLM adapter + job
 * write stubs + the provider allowlist), the panel tables via the in-memory ChatReviewStore, and the
 * query/grounding reads are mocked. The panel flow (prepare -> run -> disposition) runs end-to-end through
 * the REAL procedure + the REAL egress broker. Covers the blocking acceptance criteria: broker routing +
 * authorizationBasis, self-review exclusion, 1:1 traceability, raw-by-reference, citation flag-not-reject,
 * degraded states, panel-confirm, flag-OFF, owner+matter isolation, purge coverage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';

vi.mock('../db/queries/matters.js', async (orig) => ({ ...(await orig<typeof import('../db/queries/matters.js')>()), getMatterById: vi.fn() }));
vi.mock('../db/queries/chatCopilot.js', async (orig) => ({ ...(await orig<typeof import('../db/queries/chatCopilot.js')>()), getConversationInContext: vi.fn(), listMessages: vi.fn() }));
vi.mock('../llm/chatGrounding.js', async (orig) => ({ ...(await orig<typeof import('../llm/chatGrounding.js')>()), assembleGroundedChatContext: vi.fn() }));

import { getMatterById } from '../db/queries/matters.js';
import { getConversationInContext, listMessages } from '../db/queries/chatCopilot.js';
import { assembleGroundedChatContext, type GroundedChatAssembly } from '../llm/chatGrounding.js';
import { egressClient, EgressBlockedError } from '../llm/egressClient.js';
import { setEgressEventStore, listEgressEvents } from '../db/queries/chatEgress.js';
import { createInMemoryEgressEventStore } from './inMemoryEgressStore.js';
import { setChatReviewStore, listReviewRawOutputsForRun } from '../db/queries/chatReviewPanel.js';
import { createInMemoryChatReviewStore } from './inMemoryChatReviewStore.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import { setGroundedChatProviderAllowlistForTests } from '../llm/chatCopilotConfig.js';
import { setJobWriteFunctions, setMatterStateProvider, setPaProfileProvider, setPromptSnapshotWriter } from '../db/canonicalMutation.js';
import { appRouter } from '../router.js';
import type { LlmClient, LlmGenerateResult } from '../llm/types.js';
import type { MatterRow } from '../../shared/schemas/matters.js';
import type { ChatConversationRow, ChatMessageRow } from '../../shared/schemas/chatCopilot.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CONV_A = 'c0000000-0000-0000-0000-00000000000a';
const MSG_A = 'd0000000-0000-0000-0000-00000000000a';

const caller = (userId: string) => appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });

const BUNDLE: GroundedChatAssembly = {
  sources: [{ sourceId: 'doc:x@y', kind: 'operative_document', label: 'Operative doc', text: 'body', locator: null }],
  sourceIds: ['doc:x@y'],
  contextText: '[GROUNDED CONTEXT]\n[SOURCE id=doc:x@y]\nbody\n[/SOURCE]',
  omittedCount: 0,
  truncated: false,
  npiWithheldCount: 2,
  includedAttachmentIds: [],
};

function convWith(holdFlag: 'none' | 'no_panel' | 'no_external'): ChatConversationRow {
  return { id: CONV_A, documentId: null, holdFlag } as unknown as ChatConversationRow;
}
function assistantMsg(content: string): ChatMessageRow {
  return { id: MSG_A, role: 'assistant', content } as unknown as ChatMessageRow;
}

// A stub LLM: reviewers return 2 itemized suggestions (one cites a bundle source, one cites an off-bundle
// authority); the dispositioner returns one disposition per index.
const stub: LlmClient = {
  generate: (params) => {
    let content: string;
    if (params.systemPrompt.includes('INDEPENDENT reviewer')) {
      content = JSON.stringify({
        suggestions: [
          { suggestion: 'Tighten the indemnity scope [[cite:doc:x@y]]' },
          { suggestion: 'Add the recording statute [[cite:va_code:55.1-345]]' },
        ],
      });
    } else if (params.systemPrompt.includes('PRIMARY model that produced')) {
      // A well-formed dispositioner: exactly one disposition per suggestion index actually in the prompt.
      const ds = ['adopt', 'reject', 'modify_and_adopt'] as const;
      const idxs = [...params.userPrompt.matchAll(/\[(\d+)\] \(from/g)].map((mm) => Number(mm[1]));
      content = JSON.stringify({ dispositions: idxs.map((index, k) => ({ index, disposition: ds[k % 3], reasoning: 'reasoned.' })) });
    } else {
      content = 'ok';
    }
    return Promise.resolve({ content, tokensPrompt: 1, tokensCompletion: 1, providerMetadata: {} } as LlmGenerateResult);
  },
};

function installSeams() {
  setEgressEventStore(createInMemoryEgressEventStore());
  setChatReviewStore(createInMemoryChatReviewStore());
  setTestLlmAdapter(stub);
  setJobWriteFunctions({
    insertJob: vi.fn().mockResolvedValue(undefined), markJobRunning: vi.fn().mockResolvedValue(1),
    markJobCompleted: vi.fn().mockResolvedValue(undefined), markJobFailed: vi.fn().mockResolvedValue(undefined),
    markJobTimedOut: vi.fn().mockResolvedValue(undefined), markJobCancelled: vi.fn().mockResolvedValue(1),
    updateJobHeartbeat: vi.fn().mockResolvedValue(undefined),
  });
  setMatterStateProvider(async () => '');
  setPaProfileProvider(async () => null);
  setPromptSnapshotWriter(async () => {});
}

describe('CHAT-COPILOT-2-INCB — review panel (behavioral)', () => {
  beforeEach(() => {
    process.env['CHAT_REVIEW_PANEL_ENABLED'] = 'true';
    installSeams();
    setGroundedChatProviderAllowlistForTests(['openai', 'google', 'xai', 'anthropic']);
    vi.mocked(getMatterById).mockResolvedValue({ id: MATTER_A, userId: U1 } as unknown as MatterRow);
    vi.mocked(getConversationInContext).mockResolvedValue(convWith('none'));
    vi.mocked(listMessages).mockResolvedValue([assistantMsg('The draft analysis under review.')]);
    vi.mocked(assembleGroundedChatContext).mockResolvedValue(BUNDLE);
  });
  afterEach(() => {
    delete process.env['CHAT_REVIEW_PANEL_ENABLED'];
    setEgressEventStore(null); setChatReviewStore(null); setTestLlmAdapter(null); setJobWriteFunctions(null);
    setMatterStateProvider(null); setPaProfileProvider(null); setPromptSnapshotWriter(null);
    setGroundedChatProviderAllowlistForTests(null); vi.clearAllMocks();
  });

  it('panel-confirm preview shows the post-filter transmitting set + the exact reviewer models', async () => {
    const prep = await caller(U1).chatReviewPanel.prepareReview({
      conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt', 'gemini'],
    });
    expect(prep.reviewers).toEqual(['gpt', 'gemini']);
    expect(prep.transmitting.includedSources).toEqual([{ sourceId: 'doc:x@y', kind: 'operative_document', label: 'Operative doc' }]);
    expect(prep.transmitting.npiWithheldCount).toBe(2); // post-minimization reality, not the pre-filter selection
    expect(typeof prep.panelConfirmId).toBe('string');
  });

  it('SELF-REVIEW EXCLUSION: the primary (Claude) can never be a panel reviewer', async () => {
    await expect(
      caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['claude'] }),
    ).rejects.toThrow('SELF_REVIEW_EXCLUDED');
    await expect(
      caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt', 'claude_lite'] }),
    ).rejects.toThrow('SELF_REVIEW_EXCLUDED');
  });

  it('a no_external / no_panel hold refuses the panel (fail-closed) before any send', async () => {
    vi.mocked(getConversationInContext).mockResolvedValue(convWith('no_panel'));
    await expect(
      caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt'] }),
    ).rejects.toThrow('PANEL_HELD_NO_PANEL');
    expect(await listEgressEvents(U1, { matterId: MATTER_A })).toHaveLength(0);
  });

  it('run: each reviewer lane + the dispositioner route through the broker (kind chat_panel, basis panel_confirm)', async () => {
    const prep = await caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt', 'gemini'] });
    const run = await caller(U1).chatReviewPanel.runReview({ panelConfirmId: prep.panelConfirmId, matterId: MATTER_A });
    const events = await listEgressEvents(U1, { matterId: MATTER_A });
    // 2 reviewer lanes + 1 dispositioner = 3 logged egress events, all kind chat_panel + basis panel_confirm.
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.kind === 'chat_panel')).toBe(true);
    expect(events.every((e) => e.authorizationBasis === 'panel_confirm')).toBe(true);
    expect(events.every((e) => e.decision === 'allowed')).toBe(true);
    expect(run.status).toBe('complete');
    expect(run.dispositionerStatus).toBe('success');
  });

  it('1:1 traceability: every reviewer suggestion maps to exactly one dispositioned item (no merge/drop)', async () => {
    const prep = await caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt', 'gemini'] });
    const run = await caller(U1).chatReviewPanel.runReview({ panelConfirmId: prep.panelConfirmId, matterId: MATTER_A });
    // 2 reviewers * 2 suggestions each = 4 items, each with a distinct suggestion hash + a disposition.
    expect(run.items).toHaveLength(4);
    expect(new Set(run.items.map((i) => i.suggestionHash)).size).toBe(2); // 2 distinct suggestion texts (each from 2 reviewers)
    expect(run.items.every((i) => i.primaryDisposition !== null)).toBe(true);
    expect(run.items.every((i) => i.primaryReasoning !== null)).toBe(true);
    expect(run.items.filter((i) => i.reviewerModel === 'gpt')).toHaveLength(2);
    expect(run.items.filter((i) => i.reviewerModel === 'gemini')).toHaveLength(2);
  });

  it('raw reviewer output is persisted BY-REFERENCE, distinct from the itemized suggestions', async () => {
    const prep = await caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt'] });
    const run = await caller(U1).chatReviewPanel.runReview({ panelConfirmId: prep.panelConfirmId, matterId: MATTER_A });
    const raws = await listReviewRawOutputsForRun(prep.panelConfirmId, U1);
    expect(raws).toHaveLength(1);
    expect(raws[0]!.rawText).toContain('suggestions'); // the verbatim raw model output (the JSON)
    expect(raws[0]!.egressEventId).not.toBeNull(); // each lane is its own logged egress
    // items reference the raw output, and store the ITEMIZED suggestion (not the whole raw blob)
    expect(run.items.every((i) => i.rawOutputRef === raws[0]!.id)).toBe(true);
    expect(run.items.every((i) => i.suggestion !== raws[0]!.rawText)).toBe(true);
  });

  it('citation flag-not-reject: an off-bundle citation is FLAGGED unverified, never dropped', async () => {
    const prep = await caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt'] });
    const run = await caller(U1).chatReviewPanel.runReview({ panelConfirmId: prep.panelConfirmId, matterId: MATTER_A });
    expect(run.items).toHaveLength(2); // BOTH suggestions kept (none discarded)
    const inBundle = run.items.find((i) => i.suggestion.includes('doc:x@y'));
    const offBundle = run.items.find((i) => i.suggestion.includes('va_code'));
    expect(inBundle!.citationStatus).toBe('in_bundle');
    expect(offBundle!.citationStatus).toBe('unverified');
  });

  it('degraded — ZERO reviewers succeed (off-allowlist): dispositioner skipped, never a partial "agreement"', async () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']); // panel providers NOT allowlisted -> all lanes blocked
    const prep = await caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt', 'gemini'] });
    const run = await caller(U1).chatReviewPanel.runReview({ panelConfirmId: prep.panelConfirmId, matterId: MATTER_A });
    expect(run.dispositionerStatus).toBe('skipped');
    expect(run.items).toHaveLength(0);
    const raws = await listReviewRawOutputsForRun(prep.panelConfirmId, U1);
    expect(raws.every((r) => r.laneStatus === 'blocked')).toBe(true); // each absent reviewer is recorded
  });

  it('degraded — dispositioner off-allowlist: raw suggestions kept, marked NOT yet synthesized', async () => {
    setGroundedChatProviderAllowlistForTests(['openai', 'google']); // reviewers reachable; anthropic (dispositioner) NOT
    const prep = await caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt'] });
    const run = await caller(U1).chatReviewPanel.runReview({ panelConfirmId: prep.panelConfirmId, matterId: MATTER_A });
    expect(run.dispositionerStatus).toBe('failed');
    expect(run.items).toHaveLength(2);
    expect(run.items.every((i) => i.primaryDisposition === null)).toBe(true); // "not yet synthesized"
  });

  it('degraded — dispositioner returns a MALFORMED set (duplicate/missing index): treated as failed, never silently partial', async () => {
    // 1 reviewer -> 2 items, but the dispositioner returns [0, 0] (duplicate index 0, index 1 missing). Not
    // exactly-one-per-index -> the synthesis is rejected as unreliable (items stay "not yet synthesized")
    // rather than applying a last-write-wins/partial mapping that could read as fully vetted.
    setTestLlmAdapter({
      generate: (params) => {
        const content = params.systemPrompt.includes('PRIMARY model that produced')
          ? JSON.stringify({ dispositions: [{ index: 0, disposition: 'adopt', reasoning: 'x' }, { index: 0, disposition: 'reject', reasoning: 'y' }] })
          : JSON.stringify({ suggestions: [{ suggestion: 'A' }, { suggestion: 'B' }] });
        return Promise.resolve({ content, tokensPrompt: 1, tokensCompletion: 1, providerMetadata: {} } as LlmGenerateResult);
      },
    });
    const prep = await caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt'] });
    const run = await caller(U1).chatReviewPanel.runReview({ panelConfirmId: prep.panelConfirmId, matterId: MATTER_A });
    expect(run.items).toHaveLength(2);
    expect(run.dispositionerStatus).toBe('failed');
    expect(run.items.every((i) => i.primaryDisposition === null)).toBe(true);
  });

  it('degraded — PARTIAL run: an absent reviewer is attributable; a successful reviewer still produces items', async () => {
    setGroundedChatProviderAllowlistForTests(['openai', 'anthropic']); // gpt reachable; grok (xai) NOT
    const prep = await caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt', 'grok'] });
    const run = await caller(U1).chatReviewPanel.runReview({ panelConfirmId: prep.panelConfirmId, matterId: MATTER_A });
    const raws = await listReviewRawOutputsForRun(prep.panelConfirmId, U1);
    expect(raws.find((r) => r.reviewerModel === 'grok')!.laneStatus).toBe('blocked');
    expect(raws.find((r) => r.reviewerModel === 'gpt')!.laneStatus).toBe('success');
    expect(run.items.every((i) => i.reviewerModel === 'gpt')).toBe(true);
    expect(run.dispositionerStatus).toBe('success');
  });

  it('attorney-final: recordAttorneyDecision persists an override; nothing auto-applied', async () => {
    const prep = await caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt'] });
    const run = await caller(U1).chatReviewPanel.runReview({ panelConfirmId: prep.panelConfirmId, matterId: MATTER_A });
    expect(run.items.every((i) => i.attorneyDecision === 'pending')).toBe(true); // nothing auto-decided
    const decided = await caller(U1).chatReviewPanel.recordAttorneyDecision({ itemId: run.items[0]!.id, matterId: MATTER_A, decision: 'override', overrideReason: 'I disagree with adopt.' });
    expect(decided.item.attorneyDecision).toBe('override');
    expect(decided.item.attorneyOverrideReason).toBe('I disagree with adopt.');
  });

  it('owner isolation: another owner cannot run or read a run they do not own', async () => {
    const prep = await caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt'] });
    vi.mocked(getMatterById).mockResolvedValue({ id: MATTER_A, userId: U2 } as unknown as MatterRow);
    await expect(
      caller(U2).chatReviewPanel.runReview({ panelConfirmId: prep.panelConfirmId, matterId: MATTER_A }),
    ).rejects.toThrow('Panel run not found'); // owner-scoped getRun returns null for U2
  });

  it('flag-OFF: every panel procedure refuses and reads NOTHING', async () => {
    delete process.env['CHAT_REVIEW_PANEL_ENABLED'];
    await expect(caller(U1).chatReviewPanel.prepareReview({ conversationId: CONV_A, matterId: MATTER_A, messageId: MSG_A, reviewerModels: ['gpt'] })).rejects.toThrow('CHAT_REVIEW_PANEL_DISABLED');
    await expect(caller(U1).chatReviewPanel.runReview({ panelConfirmId: MSG_A, matterId: MATTER_A })).rejects.toThrow('CHAT_REVIEW_PANEL_DISABLED');
    await expect(caller(U1).chatReviewPanel.listReviews({ conversationId: CONV_A, matterId: MATTER_A })).rejects.toThrow('CHAT_REVIEW_PANEL_DISABLED');
    expect(vi.mocked(getMatterById)).not.toHaveBeenCalled(); // refused before any read
    expect(await caller(U1).chatReviewPanel.isPanelEnabled()).toEqual({ enabled: false });
  });
});

// ── Egress-broker extensions (unit) ─────────────────────────────────────────────────────────────────────
describe('CHAT-COPILOT-2-INCB — egress no_panel gate + panel_confirm basis (unit)', () => {
  beforeEach(() => {
    installSeams();
    setGroundedChatProviderAllowlistForTests(['anthropic']);
  });
  afterEach(() => {
    setEgressEventStore(null); setChatReviewStore(null); setTestLlmAdapter(null); setJobWriteFunctions(null);
    setMatterStateProvider(null); setPaProfileProvider(null); setPromptSnapshotWriter(null);
    setGroundedChatProviderAllowlistForTests(null); vi.clearAllMocks();
  });
  const baseCanonical = {
    userId: U1, jobType: 'chat_turn' as const, modelString: 'anthropic:claude-opus-4-5', matterId: MATTER_A,
    txn1Enqueue: (jobId: string) => Promise.resolve({ jobId }),
    buildLlmParams: () => ({ systemPrompt: 'sys', userPrompt: 'hi', maxTokens: 8 }),
    txn2Commit: () => Promise.resolve(), txn2Revert: () => Promise.resolve(),
    telemetryCtx: { userId: U1, matterId: MATTER_A, documentId: null, jobId: null },
  };

  it("a 'no_panel' hold BLOCKS a chat_panel send (hold_no_panel)", async () => {
    await expect(
      egressClient.send({ audit: { kind: 'chat_panel', matterId: MATTER_A, holdFlag: 'no_panel', serializedPayload: 'x', carriesImageEgress: false }, canonical: baseCanonical }),
    ).rejects.toThrow(EgressBlockedError);
    const ev = (await listEgressEvents(U1, { matterId: MATTER_A }))[0]!;
    expect(ev.decision).toBe('blocked');
    expect(ev.blockReason).toContain('hold_no_panel');
  });

  it("a 'no_panel' hold does NOT block the primary (chat_primary) send", async () => {
    const res = await egressClient.send({ audit: { kind: 'chat_primary', matterId: MATTER_A, holdFlag: 'no_panel', serializedPayload: 'x', carriesImageEgress: false }, canonical: baseCanonical });
    expect(res.egressEventId).toBeTruthy();
    const ev = (await listEgressEvents(U1, { matterId: MATTER_A }))[0]!;
    expect(ev.decision).toBe('allowed');
  });
});

// ── Structural: purge coverage + flag wiring (source scan; CRLF-safe) ───────────────────────────────────
describe('CHAT-COPILOT-2-INCB — purge coverage + flag wiring', () => {
  const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
  const read = (rel: string): string => readFileSync(ROOT + rel, 'utf8');

  it('all three review tables purge WITH the matter (work-product) and are NOT preserved', () => {
    const purge = read('src/server/db/queries/matterPurge.ts');
    expect(purge).toContain("step('chatReviewItems', chatReviewItems");
    expect(purge).toContain("step('chatReviewRawOutputs', chatReviewRawOutputs");
    expect(purge).toContain("step('chatReviewRuns', chatReviewRuns");
    const preserve = purge.slice(purge.indexOf('EVERYDAY_DELETE_PRESERVE'), purge.indexOf('EVERYDAY_DELETE_PRESERVE') + 260);
    expect(preserve).not.toContain('chatReview');
  });

  it('the panel flag is fail-closed default-OFF and the procedure is in the egress COPILOT_SURFACE', () => {
    expect(read('src/server/config/featureFlags.ts')).toContain("process.env['CHAT_REVIEW_PANEL_ENABLED'] === 'true'");
    expect(read('src/server/__tests__/architecture_egress_broker.test.ts')).toContain("server/procedures/chatReviewPanel.ts");
  });
});
