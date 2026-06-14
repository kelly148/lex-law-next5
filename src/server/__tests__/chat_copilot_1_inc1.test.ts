/**
 * CHAT-COPILOT-1 Inc 1 — data model + lifecycle (HALT-gated acceptance criteria).
 *
 * Proves, with the in-memory store seam (no DB), every Inc 1 blocking precondition:
 *   - STORE-BY-REFERENCE: the persistable projection drops the compiled master / assembled context /
 *     source chunks (and any forbidden key) by construction; citations are reference-only; the write
 *     boundary guard rejects a violation.
 *   - ISOLATION (not just scoped queries): a conversationId cannot be read or appended across
 *     matter / document / owner; capacity divergence (law-firm vs title vs unelected) is detectable.
 *   - LIFECYCLE: delete + legal-hold (hold blocks delete) + export-to-matter-file are exercised.
 *   - DO-NOT-PERSIST: per-turn + per-conversation tombstoning, per-turn exclude-from-grounding, and
 *     post-hoc redaction are honored.
 *   - FLAG GATE: with CHAT_COPILOT_ENABLED OFF the procedures refuse with ZERO store reads.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { appRouter } from '../router.js';
import {
  setChatCopilotStore,
  createConversation,
  getConversationInContext,
  listConversations,
  appendChatMessage,
  softDeleteConversation,
  setLegalHold,
  setConversationMark,
  setMessageExcludeFromGrounding,
  redactMessage,
  exportConversationToMatterFile,
  type ChatCopilotStore,
} from '../db/queries/chatCopilot.js';
import { createInMemoryChatCopilotStore } from './inMemoryChatCopilotStore.js';
import {
  buildCapacitySnapshot,
  capacitySnapshotsDiverge,
  draftingGateDecisionId,
  toPersistableMessage,
  assertPersistableSafe,
  sanitizeCitations,
  FORBIDDEN_PERSIST_KEYS,
  type RichChatTurnInput,
} from '../llm/chatCopilotPolicy.js';

const FLAG = 'CHAT_COPILOT_ENABLED';
const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MATTER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DOC_1 = 'd1111111-1111-1111-1111-111111111111';
const DOC_2 = 'd2222222-2222-2222-2222-222222222222';

const lawFirmElected = {
  engagementCapacity: 'law_firm',
  engagementCapacityElectedAt: new Date('2026-06-13T00:00:00Z'),
  paKey: null,
  practiceArea: null,
};
const titleElected = {
  engagementCapacity: 'title_settlement_agent',
  engagementCapacityElectedAt: new Date('2026-06-13T00:00:00Z'),
  paKey: null,
  practiceArea: null,
};
const lawFirmUnelected = { engagementCapacity: 'law_firm', engagementCapacityElectedAt: null, paKey: null, practiceArea: null };

const turn = (over: Partial<RichChatTurnInput> = {}): RichChatTurnInput => ({
  role: 'attorney',
  text: 'Draft a clause about X.',
  masterApplied: false,
  masterSource: null,
  capacitySnapshot: null,
  draftingGateDecisionId: null,
  ...over,
});

let savedFlag: string | undefined;
beforeEach(() => {
  savedFlag = process.env[FLAG];
  delete process.env[FLAG];
  setChatCopilotStore(createInMemoryChatCopilotStore());
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  setChatCopilotStore(null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Store-by-reference (categorical exclusion, by construction)
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-COPILOT-1 Inc 1 — store-by-reference', () => {
  it('toPersistableMessage DROPS the compiled master / assembled context / source chunks', () => {
    const p = toPersistableMessage(
      turn({
        compiledMasterBody: 'THE WHOLE LAW FIRM MASTER PROMPT',
        assembledContext: 'RAW ASSEMBLED CONTEXT WITH SOURCE CHUNKS',
        sourceChunks: [{ text: 'a wire instruction 123456789' }],
      } as Partial<RichChatTurnInput>),
    );
    const keys = Object.keys(p);
    for (const forbidden of FORBIDDEN_PERSIST_KEYS) expect(keys).not.toContain(forbidden);
    expect(p.content).toBe('Draft a clause about X.'); // the turn text itself IS persisted
    expect(() => assertPersistableSafe(p as unknown as Record<string, unknown>)).not.toThrow();
  });

  it('citations are reduced to reference-only { sourceId, locator } — never chunk text', () => {
    const sanitized = sanitizeCitations([
      { sourceId: 'doc-1', locator: 'p3' } as never,
      { sourceId: 'mat-2', locator: '¶4', text: 'COPIED CHUNK TEXT' } as never,
    ]);
    expect(sanitized).toEqual([
      { sourceId: 'doc-1', locator: 'p3' },
      { sourceId: 'mat-2', locator: '¶4' },
    ]);
  });

  it('assertPersistableSafe REJECTS a forbidden field or a citation carrying extra keys', () => {
    expect(() => assertPersistableSafe({ content: 'x', assembledContext: 'leak' })).toThrow();
    expect(() => assertPersistableSafe({ content: 'x', citations: [{ sourceId: 's', text: 'leak' }] })).toThrow();
    expect(() => assertPersistableSafe({ content: 'x', citations: [{ sourceId: 's', locator: 'p1' }] })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Isolation — a conversationId can't be reused across matter / document / owner / capacity
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-COPILOT-1 Inc 1 — isolation invariants', () => {
  it('a conversation is found only under its OWN owner + matter + document', async () => {
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected, documentId: DOC_1 });
    // correct context
    await expect(
      getConversationInContext(conv.id, { userId: U1, matterId: MATTER_A, documentId: DOC_1 }),
    ).resolves.toMatchObject({ id: conv.id });
    // wrong matter / document / owner -> NOT_FOUND (no existence leak)
    await expect(getConversationInContext(conv.id, { userId: U1, matterId: MATTER_B })).rejects.toThrow(/not found/i);
    await expect(
      getConversationInContext(conv.id, { userId: U1, matterId: MATTER_A, documentId: DOC_2 }),
    ).rejects.toThrow(/not found/i);
    await expect(getConversationInContext(conv.id, { userId: U2, matterId: MATTER_A })).rejects.toThrow(/not found/i);
  });

  it('appending a turn under a DIFFERENT matter is rejected (isolation, not just an owner scope)', async () => {
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected });
    await expect(appendChatMessage({ conversationId: conv.id, ctx: { userId: U1, matterId: MATTER_B }, turn: turn() })).rejects.toThrow(/not found/i);
    // and a valid append works, binding the message to the conversation's matter
    const msg = await appendChatMessage({ conversationId: conv.id, ctx: { userId: U1, matterId: MATTER_A }, turn: turn() });
    expect(msg.matterId).toBe(MATTER_A);
    expect(msg.seq).toBe(0);
  });

  it('capacity divergence (law-firm vs title vs unelected) is detectable; benign re-election is not', () => {
    const lf = buildCapacitySnapshot(lawFirmElected);
    const title = buildCapacitySnapshot(titleElected);
    const unelected = buildCapacitySnapshot(lawFirmUnelected);
    expect(capacitySnapshotsDiverge(lf, title)).toBe(true); // law-firm vs title -> diverge
    expect(capacitySnapshotsDiverge(lf, unelected)).toBe(true); // elected vs unelected -> diverge
    expect(capacitySnapshotsDiverge(lf, lf)).toBe(false);
    // benign re-election: same capacity, still elected, different marker timestamp -> NOT divergence
    const reElected = buildCapacitySnapshot({ ...lawFirmElected, engagementCapacityElectedAt: new Date('2026-07-01T00:00:00Z') });
    expect(capacitySnapshotsDiverge(lf, reElected)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle — delete, legal hold, export-to-matter-file
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-COPILOT-1 Inc 1 — lifecycle', () => {
  it('soft-delete hides a conversation from the list; legal hold BLOCKS delete; clearing the hold re-allows it', async () => {
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected });
    await setLegalHold(conv.id, U1, true, 'litigation hold');
    await expect(softDeleteConversation(conv.id, U1)).rejects.toThrow(/LEGAL_HOLD/);
    expect((await listConversations(MATTER_A, U1)).length).toBe(1); // still present under hold
    await setLegalHold(conv.id, U1, false);
    await softDeleteConversation(conv.id, U1);
    expect((await listConversations(MATTER_A, U1)).length).toBe(0); // hidden after delete
  });

  it('legal hold also PRESERVES content: redaction and a do-not-persist mark are refused under hold; exclude-from-grounding stays allowed', async () => {
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected });
    const msg = await appendChatMessage({ conversationId: conv.id, ctx: { userId: U1, matterId: MATTER_A }, turn: turn({ text: 'preserve me' }) });
    await setLegalHold(conv.id, U1, true, 'litigation hold');
    await expect(redactMessage(msg.id, U1)).rejects.toThrow(/LEGAL_HOLD/);
    await expect(setConversationMark(conv.id, U1, { doNotPersist: true })).rejects.toThrow(/LEGAL_HOLD/);
    // exclude-from-grounding preserves content (only withholds from grounding) -> allowed under hold
    await expect(setConversationMark(conv.id, U1, { excludeFromGrounding: true })).resolves.toBeTruthy();
    // once the hold clears, redaction works again
    await setLegalHold(conv.id, U1, false);
    const redacted = await redactMessage(msg.id, U1);
    expect(redacted?.content).toBeNull();
  });

  it('export-to-matter-file produces the full reference-only thread and stamps exportedAt + exportRef', async () => {
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected, documentId: DOC_1 });
    await appendChatMessage({ conversationId: conv.id, ctx: { userId: U1, matterId: MATTER_A }, turn: turn({ role: 'attorney', text: 'Q1' }) });
    await appendChatMessage({
      conversationId: conv.id,
      ctx: { userId: U1, matterId: MATTER_A },
      turn: turn({ role: 'assistant', text: 'A1', citations: [{ sourceId: 'doc-1', locator: 'p2' }] }),
    });
    const artifact = await exportConversationToMatterFile(conv.id, U1);
    expect(artifact.conversationId).toBe(conv.id);
    expect(artifact.matterId).toBe(MATTER_A);
    expect(artifact.messages.map((m) => m.seq)).toEqual([0, 1]); // ordered
    expect(artifact.messages[1]!.citations).toEqual([{ sourceId: 'doc-1', locator: 'p2' }]); // reference-only
    for (const forbidden of FORBIDDEN_PERSIST_KEYS) {
      for (const m of artifact.messages) expect(Object.keys(m)).not.toContain(forbidden);
    }
    const reread = await getConversationInContext(conv.id, { userId: U1, matterId: MATTER_A });
    expect(reread.exportedAt).not.toBeNull();
    expect(reread.exportRef).toContain(conv.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Do-not-persist + exclude-from-grounding
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-COPILOT-1 Inc 1 — do-not-persist + exclude-from-grounding', () => {
  it('a per-turn do-not-persist turn is tombstoned: ordering kept, content + citations dropped', async () => {
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected });
    const msg = await appendChatMessage({
      conversationId: conv.id,
      ctx: { userId: U1, matterId: MATTER_A },
      turn: turn({ doNotPersist: true, citations: [{ sourceId: 'doc-1' }] }),
    });
    expect(msg.seq).toBe(0);
    expect(msg.content).toBeNull();
    expect(msg.contentHash).toBeNull();
    expect(msg.citations).toBeNull();
    expect(msg.doNotPersist).toBe(true);
  });

  it('a per-CONVERSATION do-not-persist mark tombstones subsequent turns even without a per-turn flag', async () => {
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected });
    await setConversationMark(conv.id, U1, { doNotPersist: true });
    const msg = await appendChatMessage({ conversationId: conv.id, ctx: { userId: U1, matterId: MATTER_A }, turn: turn({ text: 'secret' }) });
    expect(msg.content).toBeNull();
    expect(msg.doNotPersist).toBe(true);
  });

  it('per-turn exclude-from-grounding can be set post-hoc, and a stored turn can be redacted', async () => {
    const conv = await createConversation({ userId: U1, matterId: MATTER_A, matter: lawFirmElected });
    const msg = await appendChatMessage({ conversationId: conv.id, ctx: { userId: U1, matterId: MATTER_A }, turn: turn({ text: 'keep but exclude' }) });
    const excluded = await setMessageExcludeFromGrounding(msg.id, U1, true);
    expect(excluded?.excludeFromGrounding).toBe(true);
    expect(excluded?.content).toBe('keep but exclude'); // still stored
    const redacted = await redactMessage(msg.id, U1);
    expect(redacted?.content).toBeNull();
    expect(redacted?.doNotPersist).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Capacity snapshot + gate-decision id (pure units)
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-COPILOT-1 Inc 1 — capacity snapshot + gate-decision id', () => {
  it('buildCapacitySnapshot captures capacity + election marker (ISO) + title signal', () => {
    const lf = buildCapacitySnapshot(lawFirmElected);
    expect(lf.engagementCapacity).toBe('law_firm');
    expect(lf.electionMarker).toBe(new Date('2026-06-13T00:00:00Z').toISOString());
    expect(lf.titleSignal).toBe(false);
    const titleSig = buildCapacitySnapshot({ engagementCapacity: 'law_firm', engagementCapacityElectedAt: new Date(), paKey: 'title_settlement', practiceArea: null });
    expect(titleSig.titleSignal).toBe(true);
    expect(buildCapacitySnapshot(lawFirmUnelected).electionMarker).toBeNull();
  });

  it('draftingGateDecisionId is deterministic and sensitive to the decision', () => {
    const a = draftingGateDecisionId({ allowed: true, clearance: { state: 'CLEARED' }, blockingPreconditions: [], overriddenPreconditions: [], activeOverrides: [] });
    const a2 = draftingGateDecisionId({ allowed: true, clearance: { state: 'CLEARED' }, blockingPreconditions: [], overriddenPreconditions: [], activeOverrides: [] });
    const blocked = draftingGateDecisionId({ allowed: false, clearance: { state: 'NOT_ESTABLISHED' }, blockingPreconditions: ['conflicts'], overriddenPreconditions: [], activeOverrides: [] });
    expect(a).toBe(a2);
    expect(a).not.toBe(blocked);
    expect(a.startsWith('gate_')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flag gate — OFF refuses with ZERO store reads
// ─────────────────────────────────────────────────────────────────────────────
describe('CHAT-COPILOT-1 Inc 1 — flag gate (default OFF, fail-closed, zero reads)', () => {
  it('with CHAT_COPILOT_ENABLED OFF, a copilot procedure refuses and never touches the store', async () => {
    // a store whose every method throws — proves the OFF path performs ZERO reads/writes.
    const throwingStore = new Proxy({} as ChatCopilotStore, {
      get() {
        return () => {
          throw new Error('store must not be touched when the flag is OFF');
        };
      },
    });
    setChatCopilotStore(throwingStore);
    const caller = appRouter.createCaller({ req: {} as Request, res: {} as Response, userId: U1 });
    await expect(caller.chatCopilot.list({ matterId: MATTER_A })).rejects.toThrow(/CHAT_COPILOT_DISABLED/);
  });
});
