/**
 * CHAT-COPILOT-2 Increment A — A3 context assembly + UX + provenance (Q1-hash / Q4 / Q6 / Q7).
 *
 * - Attachments flow into the grounded bundle (matter-scoped; honesty floor — withheld text is never
 *   grounded; per-attachment no_external hold excluded); the bundle returns includedAttachmentIds.
 * - PROVENANCE-SUFFICIENCY EXIT GATE (Q6 — Increment A's exit criterion): an attachment that grounds a
 *   turn, once pinned, SURVIVES the ephemeral conversation-end purge and stays recoverable.
 * - Q4 egress indicator states; the citation chip language proves grounding, NOT correctness (never "verified").
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../db/queries/documents.js', async (orig) => ({ ...(await orig<typeof import('../db/queries/documents.js')>()), getDocumentById: vi.fn() }));
vi.mock('../db/queries/versions.js', async (orig) => ({ ...(await orig<typeof import('../db/queries/versions.js')>()), getVersionById: vi.fn() }));
vi.mock('../db/queries/materials.js', async (orig) => ({ ...(await orig<typeof import('../db/queries/materials.js')>()), listMaterialsForMatter: vi.fn() }));
vi.mock('../db/queries/phase4b.js', async (orig) => ({ ...(await orig<typeof import('../db/queries/phase4b.js')>()), listLockedDecisionsForMatter: vi.fn(), listAdoptLedgerForMatter: vi.fn() }));

import { listMaterialsForMatter } from '../db/queries/materials.js';
import { listLockedDecisionsForMatter, listAdoptLedgerForMatter } from '../db/queries/phase4b.js';
import { assembleGroundedChatContext } from '../llm/chatGrounding.js';
import { computeEgressIndicator } from '../llm/chatEgressIndicator.js';
import { setGroundedChatProviderAllowlistForTests } from '../llm/chatCopilotConfig.js';
import {
  setChatAttachmentStore,
  ingestChatAttachment,
  pinAttachment,
  purgeConversationAttachments,
  getChatAttachment,
} from '../db/queries/chatAttachments.js';
import { createInMemoryAttachmentStore } from './inMemoryAttachmentStore.js';
import { egressClient } from '../llm/egressClient.js';
import { setEgressEventStore, listEgressEvents } from '../db/queries/chatEgress.js';
import { createInMemoryEgressEventStore } from './inMemoryEgressStore.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import { setJobWriteFunctions, setMatterStateProvider, setPaProfileProvider, setPromptSnapshotWriter } from '../db/canonicalMutation.js';
import type { LlmClient, LlmGenerateResult } from '../llm/types.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MATTER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CONV_A = 'c0000000-0000-0000-0000-00000000000a';
const buf = (s: string): Buffer => Buffer.from(s, 'utf8');

const ingest = (over: Partial<Parameters<typeof ingestChatAttachment>[0]>) =>
  ingestChatAttachment({
    userId: U1, matterId: MATTER_A, conversationId: CONV_A,
    filename: 'doc.txt', mimeType: 'text/plain', fileSize: 8, bytes: buf('x'),
    extractedText: 'attachment body text', meanConfidence: null, isImageSource: false, ...over,
  });

describe('CHAT-COPILOT-2 A3 — attachments in the grounded bundle', () => {
  beforeEach(() => {
    setChatAttachmentStore(createInMemoryAttachmentStore());
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    vi.mocked(listMaterialsForMatter).mockResolvedValue([]);
    vi.mocked(listLockedDecisionsForMatter).mockResolvedValue([]);
    vi.mocked(listAdoptLedgerForMatter).mockResolvedValue([]);
  });
  afterEach(() => {
    setChatAttachmentStore(null);
    setGroundedChatProviderAllowlistForTests(null);
    vi.clearAllMocks();
  });

  it('includes a selected, extracted attachment as a grounded source + returns includedAttachmentIds', async () => {
    const a = await ingest({ bytes: buf('A'), extractedText: 'OPERATIVE_ATTACHMENT_TEXT' });
    const g = await assembleGroundedChatContext({ matterId: MATTER_A, userId: U1, documentId: null, attachmentIds: [a.attachment.id] });
    expect(g.includedAttachmentIds).toEqual([a.attachment.id]);
    expect(g.sources.some((s) => s.kind === 'attachment' && s.sourceId === 'attachment:' + a.attachment.id)).toBe(true);
    expect(g.contextText).toContain('OPERATIVE_ATTACHMENT_TEXT');
  });

  it('HONESTY FLOOR: a low-confidence (withheld-text) attachment is NOT grounded', async () => {
    const a = await ingest({ bytes: buf('LC'), extractedText: 'garbled', meanConfidence: 35, isImageSource: true });
    expect(a.attachment.textContent).toBeNull();
    const g = await assembleGroundedChatContext({ matterId: MATTER_A, userId: U1, documentId: null, attachmentIds: [a.attachment.id] });
    expect(g.includedAttachmentIds).toEqual([]);
    expect(g.sources.some((s) => s.kind === 'attachment')).toBe(false);
  });

  it('per-attachment no_external hold excludes the attachment from grounding egress', async () => {
    const a = await ingest({ bytes: buf('H'), extractedText: 'held attachment text', holdFlag: 'no_external' });
    const g = await assembleGroundedChatContext({ matterId: MATTER_A, userId: U1, documentId: null, attachmentIds: [a.attachment.id] });
    expect(g.includedAttachmentIds).toEqual([]);
  });

  it('matter-scope: an attachment from a DIFFERENT matter is not pulled in', async () => {
    const a = await ingest({ matterId: MATTER_B, conversationId: 'c0000000-0000-0000-0000-00000000000b', bytes: buf('X'), extractedText: 'other matter' });
    const g = await assembleGroundedChatContext({ matterId: MATTER_A, userId: U1, documentId: null, attachmentIds: [a.attachment.id] });
    expect(g.includedAttachmentIds).toEqual([]);
  });
});

describe('CHAT-COPILOT-2 A3 — provenance-sufficiency EXIT GATE (Q6)', () => {
  beforeEach(() => setChatAttachmentStore(createInMemoryAttachmentStore()));
  afterEach(() => setChatAttachmentStore(null));

  it('an attachment that grounds a turn, once PINNED, survives the conversation-end purge (recoverable)', async () => {
    const a = await ingest({ bytes: buf('G'), extractedText: 'grounded provenance text' });
    // simulate the exit gate: submitTurn pins each grounded attachment
    await pinAttachment(a.attachment.id, U1, true);
    // conversation end -> ephemeral purge (non-pinned)
    const purged = await purgeConversationAttachments(CONV_A, U1, { includePinned: false });
    expect(purged).toBe(0); // the pinned/provenance attachment was NOT purged
    const survivor = await getChatAttachment(a.attachment.id, U1);
    expect(survivor?.deletedAt).toBeNull();
    expect(survivor?.textContent).toBe('grounded provenance text'); // still recoverable -> promote-to-draft is defensible
  });
});

describe('CHAT-COPILOT-2 A3 — Q4 egress indicator (pure)', () => {
  afterEach(() => setGroundedChatProviderAllowlistForTests(null));

  it('empty allowlist => provider_configured + excluded (cannot egress)', () => {
    const ind = computeEgressIndicator({ provider: 'anthropic', holdFlag: 'none', excludeFromGrounding: false, hasSelection: true });
    expect(ind.states).toEqual(['provider_configured', 'excluded']);
    expect(ind.canEgress).toBe(false);
  });
  it('allowlisted + selection => provider_allowlisted + selected_this_turn (can egress)', () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    const ind = computeEgressIndicator({ provider: 'anthropic', holdFlag: 'none', excludeFromGrounding: false, hasSelection: true });
    expect(ind.states).toEqual(['provider_allowlisted', 'selected_this_turn']);
    expect(ind.canEgress).toBe(true);
  });
  it('no_external hold => excluded (cannot egress) even when allowlisted', () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    const ind = computeEgressIndicator({ provider: 'anthropic', holdFlag: 'no_external', excludeFromGrounding: false, hasSelection: true });
    expect(ind.states).toEqual(['excluded']);
    expect(ind.canEgress).toBe(false);
  });
  it('excludeFromGrounding => allowlisted but excluded (grounding suppressed)', () => {
    setGroundedChatProviderAllowlistForTests(['anthropic']);
    const ind = computeEgressIndicator({ provider: 'anthropic', holdFlag: 'none', excludeFromGrounding: true, hasSelection: true });
    expect(ind.states).toEqual(['provider_allowlisted', 'excluded']);
  });
});

describe('CHAT-COPILOT-2 A3 — Q7 queryable supervision (egress incl. attachment volume)', () => {
  beforeEach(() => {
    setEgressEventStore(createInMemoryEgressEventStore());
    const stub: LlmClient = { generate: () => Promise.resolve({ content: 'ok', tokensPrompt: 1, tokensCompletion: 1, providerMetadata: {} } as LlmGenerateResult) };
    setTestLlmAdapter(stub);
    setJobWriteFunctions({
      insertJob: vi.fn().mockResolvedValue(undefined), markJobRunning: vi.fn().mockResolvedValue(1), markJobCompleted: vi.fn().mockResolvedValue(undefined),
      markJobFailed: vi.fn().mockResolvedValue(undefined), markJobTimedOut: vi.fn().mockResolvedValue(undefined), markJobCancelled: vi.fn().mockResolvedValue(1), updateJobHeartbeat: vi.fn().mockResolvedValue(undefined),
    });
    setMatterStateProvider(async () => '');
    setPaProfileProvider(async () => null);
    setPromptSnapshotWriter(async () => {});
    setGroundedChatProviderAllowlistForTests(['anthropic']);
  });
  afterEach(() => {
    setEgressEventStore(null); setTestLlmAdapter(null); setJobWriteFunctions(null);
    setMatterStateProvider(null); setPaProfileProvider(null); setPromptSnapshotWriter(null);
    setGroundedChatProviderAllowlistForTests(null); vi.clearAllMocks();
  });

  it('records attachment volume on the egress audit, queryable by provider + matter', async () => {
    await egressClient.send({
      audit: { kind: 'chat_primary', matterId: MATTER_A, conversationId: CONV_A, holdFlag: 'none', serializedPayload: 'sys\n\nhi', carriesImageEgress: false, attachmentIds: ['att-1', 'att-2'], includedAttachmentCount: 2 },
      canonical: {
        userId: U1, jobType: 'chat_turn', modelString: 'anthropic:claude-opus-4-5', matterId: MATTER_A,
        txn1Enqueue: (jobId) => Promise.resolve({ jobId }), buildLlmParams: () => ({ systemPrompt: 'sys', userPrompt: 'hi', maxTokens: 8 }),
        txn2Commit: () => Promise.resolve(), txn2Revert: () => Promise.resolve(),
        telemetryCtx: { userId: U1, matterId: MATTER_A, documentId: null, jobId: null },
      },
    });
    const byProviderAndMatter = await listEgressEvents(U1, { provider: 'anthropic', matterId: MATTER_A });
    expect(byProviderAndMatter).toHaveLength(1);
    expect(byProviderAndMatter[0]!.includedAttachmentCount).toBe(2);
    expect(byProviderAndMatter[0]!.decision).toBe('allowed');
  });
});

describe('CHAT-COPILOT-2 A3 — Q4 citation language (never "verified")', () => {
  it('the citation chip says "present in the bundle" and NEVER "verified"', () => {
    const src = readFileSync(fileURLToPath(new URL('../../client/components/CopilotThread.tsx', import.meta.url)), 'utf8');
    // locate the citation-chip region by its test id
    const idx = src.indexOf('data-testid="copilot-citation"');
    expect(idx).toBeGreaterThan(0);
    const region = src.slice(Math.max(0, idx - 600), idx + 400);
    expect(region.toLowerCase()).toContain('present in the bundle');
    expect(region.toLowerCase()).not.toContain('verified');
  });
});
