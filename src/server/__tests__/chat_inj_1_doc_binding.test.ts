/**
 * CHAT-INJ-1 R7 hardening — documentId must belong to the BOUND matter.
 *
 * Owner-scoping alone is insufficient: a document the caller owns but that belongs to a DIFFERENT
 * matter would pull a second matter's context into the chat turn once any document context is
 * layered in. submitTurn now binds the optional documentId to the matter (assertDocumentInMatter):
 *   - a same-owner document from ANOTHER matter -> rejected, and the model is NEVER reached (so no
 *     cross-matter context is assembled);
 *   - a document that belongs to the bound matter -> proceeds unchanged;
 *   - no documentId -> unchanged (the document read never happens).
 * Independent of MASTER_CHAT_ENABLED (tested with it OFF — the substrate case).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../db/queries/matters.js', async (orig) => {
  const actual = await orig<typeof import('../db/queries/matters.js')>();
  return { ...actual, getMatterById: vi.fn() };
});
vi.mock('../db/queries/documents.js', async (orig) => {
  const actual = await orig<typeof import('../db/queries/documents.js')>();
  return { ...actual, getDocumentById: vi.fn() };
});
vi.mock('../db/queries/auditEvents.js', async (orig) => {
  const actual = await orig<typeof import('../db/queries/auditEvents.js')>();
  return { ...actual, recordAuditEvent: vi.fn().mockResolvedValue(undefined) };
});

import { appRouter } from '../router.js';
import { getMatterById } from '../db/queries/matters.js';
import { getDocumentById } from '../db/queries/documents.js';
import { setJobWriteFunctions, setMatterStateProvider, setPaProfileProvider, setPromptSnapshotWriter } from '../db/canonicalMutation.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';

const DISPATCH_FLAG = 'CHAT_DISPATCH_ENABLED';
const CHAT_FLAG = 'MASTER_CHAT_ENABLED';
const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';
const OTHER_MATTER = '33333333-3333-3333-3333-333333333333';
const DOC = '44444444-4444-4444-4444-444444444444';

type MatterReturn = Awaited<ReturnType<typeof getMatterById>>;
type DocReturn = Awaited<ReturnType<typeof getDocumentById>>;
const asMatter = (): MatterReturn => ({ id: MATTER, userId: USER, engagementCapacity: 'law_firm', paKey: null, practiceArea: null } as unknown as MatterReturn);
const asDoc = (matterId: string): DocReturn => ({ id: DOC, userId: USER, matterId } as unknown as DocReturn);

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
let savedDispatch: string | undefined;
let savedChat: string | undefined;

beforeEach(() => {
  savedDispatch = process.env[DISPATCH_FLAG];
  savedChat = process.env[CHAT_FLAG];
  process.env[DISPATCH_FLAG] = 'true';
  delete process.env[CHAT_FLAG]; // substrate (master OFF) — the doc binding is orthogonal to it
  vi.mocked(getMatterById).mockResolvedValue(asMatter());
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
  if (savedDispatch === undefined) delete process.env[DISPATCH_FLAG]; else process.env[DISPATCH_FLAG] = savedDispatch;
  if (savedChat === undefined) delete process.env[CHAT_FLAG]; else process.env[CHAT_FLAG] = savedChat;
  setTestLlmAdapter(null);
  setJobWriteFunctions(null);
  setMatterStateProvider(null);
  setPaProfileProvider(null);
  setPromptSnapshotWriter(null);
  vi.clearAllMocks();
});

describe('CHAT-INJ-1 R7 — documentId-belongs-to-matter binding', () => {
  it('REJECTS a same-owner document from ANOTHER matter and never reaches the model', async () => {
    vi.mocked(getDocumentById).mockResolvedValue(asDoc(OTHER_MATTER));
    await expect(
      caller().chatDispatch.submitTurn({ matterId: MATTER, documentId: DOC, turnText: 'use that other doc' }),
    ).rejects.toThrow('Document not found in this matter');
    // No cross-matter context assembled: the model was never called.
    expect(capturing.lastSystemPrompt).toBeNull();
    expect(getDocumentById).toHaveBeenCalledWith(DOC, USER);
  });

  it('REJECTS a documentId that does not resolve (owner miss)', async () => {
    vi.mocked(getDocumentById).mockResolvedValue(null);
    await expect(
      caller().chatDispatch.submitTurn({ matterId: MATTER, documentId: DOC, turnText: 'q' }),
    ).rejects.toThrow('Document not found in this matter');
    expect(capturing.lastSystemPrompt).toBeNull();
  });

  it('ALLOWS a document that belongs to the bound matter (proceeds to the model)', async () => {
    vi.mocked(getDocumentById).mockResolvedValue(asDoc(MATTER));
    const res = await caller().chatDispatch.submitTurn({ matterId: MATTER, documentId: DOC, turnText: 'q' });
    expect(res.response).toBe('REPLY');
    expect(capturing.lastSystemPrompt).not.toBeNull();
  });

  it('no documentId -> the document read never happens (unchanged)', async () => {
    const res = await caller().chatDispatch.submitTurn({ matterId: MATTER, turnText: 'q' });
    expect(res.response).toBe('REPLY');
    expect(getDocumentById).not.toHaveBeenCalled();
  });
});
