/**
 * INSTR-1A0 (INSTRUCTIONS-LEG-1) — blob-first master-prompt delivery: golden tests.
 *
 * Covers, hash-compared against the pinned manifest SHA-256:
 *   1. Loader — the committed master/claude/te asset loads and validates at boot;
 *      a byte-drifted asset fails LOUDLY; an unmanifested ID throws.
 *   2. assemblePrompt (pure) — the 1A0 decision matrix: flag OFF / non-draft role /
 *      non-Anthropic-drafter model / non-T&E practice area all stay legacy; the one
 *      wired path returns the verbatim master as the ENTIRE system block. Exact-match
 *      only — a case variant of a listed practice area does NOT compose.
 *   3. Chokepoint (executeCanonicalMutation) — flag ON sends the master as the entire
 *      system block (matter-state + PA-profile injections intentionally NOT applied);
 *      flag OFF produces the legacy injected system block BYTE-IDENTICALLY with zero
 *      composition DB reads. Both paths persist a prompt snapshot; non-draft jobs don't.
 *   4. Anthropic adapter — the composed block rides the TOP-LEVEL `system` parameter of
 *      the Anthropic request (not a user turn), byte-identical on both paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadPromptAssets,
  getPromptAsset,
  clearPromptAssetCacheForTests,
  sha256Hex,
  MASTER_CLAUDE_TE,
} from '../promptAssets.js';
import { assemblePrompt, setCompositionReaders, callRoleForJobType } from '../assemblePrompt.js';
import { PRIMARY_DRAFTER_MODEL } from '../config.js';
import { setTestLlmAdapter } from '../registry.js';
import { AnthropicAdapter } from '../anthropic.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../types.js';
import {
  executeCanonicalMutation,
  setJobWriteFunctions,
  setMatterStateProvider,
  setPaProfileProvider,
  setPromptSnapshotWriter,
} from '../../db/canonicalMutation.js';
import type { NewPromptSnapshot, JobType } from '../../db/schema.js';

/** The pinned golden hash of TE_Master_Instructions_v1.md (must equal prompts/manifest.json). */
const TE_SHA256 = '127e18eba82c0d1633e446b74989513ee3abc4b3c97d67b333b2772359f40f00';

const FLAG = 'PROMPT_COMPOSITION_ENABLED';
const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';
const DOC = '33333333-3333-3333-3333-333333333333';

let savedFlag: string | undefined;

beforeEach(() => {
  savedFlag = process.env[FLAG];
  delete process.env[FLAG];
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
});

// ---------------------------------------------------------------------------
// 1. Loader — manifest + hash validation
// ---------------------------------------------------------------------------

describe('INSTR-1A0 — prompt-asset loader', () => {
  afterEach(() => {
    clearPromptAssetCacheForTests();
  });

  it('loads master/claude/te and its bytes hash-match the pinned golden SHA-256', () => {
    const assets = loadPromptAssets();
    const asset = assets.get(MASTER_CLAUDE_TE);
    expect(asset).toBeDefined();
    expect(asset!.sha256).toBe(TE_SHA256);
    // Re-hash the loaded text: byte-fidelity end to end (LF, no BOM, no reformatting).
    expect(sha256Hex(Buffer.from(asset!.text, 'utf8'))).toBe(TE_SHA256);
    expect(asset!.text.length).toBeGreaterThan(0);
  });

  it('fails LOUDLY on a hash mismatch (byte-drifted asset refuses to load)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'instr1a0-'));
    try {
      mkdirSync(join(dir, 'prompts', 'assets'), { recursive: true });
      writeFileSync(join(dir, 'prompts', 'assets', 'tampered.md'), 'tampered content\n', 'utf8');
      writeFileSync(
        join(dir, 'prompts', 'manifest.json'),
        JSON.stringify({
          version: 1,
          assets: { 'master/claude/te': { file: 'prompts/assets/tampered.md', sha256: TE_SHA256 } },
        }),
        'utf8',
      );
      expect(() => loadPromptAssets(dir)).toThrow(/hash mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws on an asset ID that is not in the manifest', () => {
    loadPromptAssets();
    expect(() => getPromptAsset('master/claude/nonexistent')).toThrow(/Unknown prompt asset/);
  });
});

// ---------------------------------------------------------------------------
// 2. assemblePrompt — the pure 1A0 decision matrix
// ---------------------------------------------------------------------------

const TE_MATTER = { paKey: 'trusts_estates', practiceArea: null };

describe('INSTR-1A0 — assemblePrompt decision matrix', () => {
  it('flag OFF returns legacy even on the fully-matching path', () => {
    const out = assemblePrompt({
      matter: TE_MATTER,
      docType: 'last_will_testament',
      callRole: 'draft',
      model: PRIMARY_DRAFTER_MODEL,
    });
    expect(out.source).toBe('legacy');
    expect(out.systemText).toBeNull();
    expect(out.flagEnabled).toBe(false);
  });

  it('flag ON + draft + Anthropic drafter + T&E paKey composes the verbatim master (hash-compared)', () => {
    process.env[FLAG] = 'true';
    const out = assemblePrompt({
      matter: TE_MATTER,
      docType: 'last_will_testament',
      callRole: 'draft',
      model: PRIMARY_DRAFTER_MODEL,
    });
    expect(out.source).toBe(MASTER_CLAUDE_TE);
    expect(out.assetSha256).toBe(TE_SHA256);
    expect(out.systemText).not.toBeNull();
    expect(sha256Hex(Buffer.from(out.systemText!, 'utf8'))).toBe(TE_SHA256);
  });

  it('matches the matter freeform practiceArea against the exact literal set', () => {
    process.env[FLAG] = 'true';
    const out = assemblePrompt({
      matter: { paKey: null, practiceArea: 'Estate Planning' },
      docType: null,
      callRole: 'draft',
      model: PRIMARY_DRAFTER_MODEL,
    });
    expect(out.source).toBe(MASTER_CLAUDE_TE);
  });

  it('exact-match only: a case variant of a listed practice area stays legacy (no inference)', () => {
    process.env[FLAG] = 'true';
    const out = assemblePrompt({
      matter: { paKey: null, practiceArea: 'estate planning' },
      docType: null,
      callRole: 'draft',
      model: PRIMARY_DRAFTER_MODEL,
    });
    expect(out.source).toBe('legacy');
  });

  it('non-draft call roles stay legacy (regeneration is NOT wired in 1A0)', () => {
    process.env[FLAG] = 'true';
    const out = assemblePrompt({
      matter: TE_MATTER,
      docType: null,
      callRole: 'regenerate',
      model: PRIMARY_DRAFTER_MODEL,
    });
    expect(out.source).toBe('legacy');
  });

  it('a non-Anthropic-drafter model stays legacy (lite generation model)', () => {
    process.env[FLAG] = 'true';
    const out = assemblePrompt({
      matter: TE_MATTER,
      docType: null,
      callRole: 'draft',
      model: 'openai:gpt-4.1-mini',
    });
    expect(out.source).toBe('legacy');
  });

  it('a missing matter stays legacy', () => {
    process.env[FLAG] = 'true';
    const out = assemblePrompt({
      matter: null,
      docType: null,
      callRole: 'draft',
      model: PRIMARY_DRAFTER_MODEL,
    });
    expect(out.source).toBe('legacy');
  });

  it('maps draft_generation -> draft and regeneration -> regenerate', () => {
    expect(callRoleForJobType('draft_generation')).toBe('draft');
    expect(callRoleForJobType('regeneration')).toBe('regenerate');
    expect(callRoleForJobType('reviewer_feedback')).toBe('review');
  });
});

// ---------------------------------------------------------------------------
// 3. Chokepoint — executeCanonicalMutation golden behavior + snapshots
// ---------------------------------------------------------------------------

class CapturingAdapter implements LlmClient {
  public lastSystemPrompt: string | null = null;
  public lastUserPrompt: string | null = null;
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.lastSystemPrompt = params.systemPrompt;
    this.lastUserPrompt = params.userPrompt;
    return Promise.resolve({
      content: 'DRAFT_OUTPUT',
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

const draftMutationParams = (jobType: JobType) => ({
  userId: USER,
  jobType,
  modelString: PRIMARY_DRAFTER_MODEL,
  matterId: MATTER,
  documentId: DOC,
  txn1Enqueue: async (jobId: string) => ({ jobId }),
  buildLlmParams: () => ({ systemPrompt: 'ROLE_SYSTEM_PROMPT', userPrompt: 'USER_PROMPT' }),
  txn2Commit: async () => {},
  txn2Revert: async () => {},
  telemetryCtx: { userId: USER, matterId: MATTER, documentId: DOC, jobId: null },
});

describe('INSTR-1A0 — chokepoint composition + snapshot (executeCanonicalMutation)', () => {
  let snapshots: NewPromptSnapshot[];
  let getMatterReader: ReturnType<typeof vi.fn>;
  let getDocumentReader: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    snapshots = [];
    setPromptSnapshotWriter(async (row) => {
      snapshots.push(row);
    });
    getMatterReader = vi.fn().mockResolvedValue({ paKey: 'trusts_estates', practiceArea: null });
    getDocumentReader = vi.fn().mockResolvedValue({ documentType: 'last_will_testament' });
    setCompositionReaders({
      getMatter: getMatterReader as never,
      getDocument: getDocumentReader as never,
    });
  });

  afterEach(() => {
    setPromptSnapshotWriter(null);
    setCompositionReaders(null);
    setMatterStateProvider(null);
    setPaProfileProvider(null);
    setTestLlmAdapter(null);
    setJobWriteFunctions(null);
    vi.clearAllMocks();
  });

  it('flag ON + T&E draft: the verbatim master is the ENTIRE system block (injections skipped) and is snapshotted', async () => {
    process.env[FLAG] = 'true';
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    const stateProvider = vi.fn().mockResolvedValue('MATTER_STATE_BLOCK');
    const paProvider = vi.fn().mockResolvedValue({
      body: 'PA_PROFILE_BODY',
      profileId: '44444444-4444-4444-4444-444444444444',
      version: '1.0',
      paKey: 'trusts_estates',
    });
    setMatterStateProvider(stateProvider);
    setPaProfileProvider(paProvider);

    const result = await executeCanonicalMutation(draftMutationParams('draft_generation'));

    expect(result.status).toBe('completed');
    const master = getPromptAsset(MASTER_CLAUDE_TE);
    // The EXACT asset text is the entire system block — hash-compared.
    expect(adapter.lastSystemPrompt).toBe(master.text);
    expect(sha256Hex(Buffer.from(adapter.lastSystemPrompt!, 'utf8'))).toBe(TE_SHA256);
    // The legacy injections did not run on the composed path (no per-job data in the block).
    expect(stateProvider).not.toHaveBeenCalled();
    expect(paProvider).not.toHaveBeenCalled();
    // Snapshot: composed provenance.
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0]!;
    expect(snap.source).toBe(MASTER_CLAUDE_TE);
    expect(snap.assetId).toBe(MASTER_CLAUDE_TE);
    expect(snap.assetSha256).toBe(TE_SHA256);
    expect(snap.systemText).toBe(master.text);
    expect(snap.systemSha256).toBe(TE_SHA256);
    expect(snap.flagEnabled).toBe(true);
    expect(snap.callRole).toBe('draft');
    expect(snap.modelString).toBe(PRIMARY_DRAFTER_MODEL);
    expect(snap.providerId).toBe('anthropic');
  });

  it('flag OFF: the legacy injected system block is byte-identical, composition does ZERO reads, and is snapshotted as legacy', async () => {
    // FLAG deliberately unset (default OFF).
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setMatterStateProvider(async () => 'MATTER_STATE_BLOCK');
    setPaProfileProvider(async () => ({
      body: 'PA_PROFILE_BODY',
      profileId: '44444444-4444-4444-4444-444444444444',
      version: '1.0',
      paKey: 'trusts_estates',
    }));

    const result = await executeCanonicalMutation(draftMutationParams('draft_generation'));

    expect(result.status).toBe('completed');
    // Byte-identical legacy composition: PA profile OUTERMOST, then matter state, then the role prompt.
    const expectedLegacy = 'PA_PROFILE_BODY\n\nMATTER_STATE_BLOCK\n\nROLE_SYSTEM_PROMPT';
    expect(adapter.lastSystemPrompt).toBe(expectedLegacy);
    // Zero composition DB reads when the flag is off.
    expect(getMatterReader).not.toHaveBeenCalled();
    expect(getDocumentReader).not.toHaveBeenCalled();
    // Snapshot: legacy provenance, full text + hash of what was actually sent.
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0]!;
    expect(snap.source).toBe('legacy');
    expect(snap.assetId).toBeNull();
    expect(snap.assetSha256).toBeNull();
    expect(snap.systemText).toBe(expectedLegacy);
    expect(snap.systemSha256).toBe(sha256Hex(expectedLegacy));
    expect(snap.flagEnabled).toBe(false);
  });

  it('flag ON but a non-T&E matter stays legacy byte-identically (exact-match gate)', async () => {
    process.env[FLAG] = 'true';
    getMatterReader.mockResolvedValue({ paKey: 'real_estate', practiceArea: 'Real Estate' });
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setMatterStateProvider(async () => 'MATTER_STATE_BLOCK');
    setPaProfileProvider(async () => null);

    await executeCanonicalMutation(draftMutationParams('draft_generation'));

    expect(adapter.lastSystemPrompt).toBe('MATTER_STATE_BLOCK\n\nROLE_SYSTEM_PROMPT');
    expect(snapshots[0]!.source).toBe('legacy');
  });

  it('regeneration is snapshotted but never composed in 1A0', async () => {
    process.env[FLAG] = 'true';
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setMatterStateProvider(async () => '');
    setPaProfileProvider(async () => null);

    await executeCanonicalMutation(draftMutationParams('regeneration'));

    expect(adapter.lastSystemPrompt).toBe('ROLE_SYSTEM_PROMPT');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.source).toBe('legacy');
    expect(snapshots[0]!.callRole).toBe('regenerate');
  });

  it('non-draft jobs do not write a snapshot', async () => {
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setMatterStateProvider(async () => '');
    setPaProfileProvider(async () => null);

    await executeCanonicalMutation(draftMutationParams('reviewer_feedback'));

    expect(snapshots).toHaveLength(0);
  });

  it('a failing snapshot write never breaks the draft call (best-effort)', async () => {
    setPromptSnapshotWriter(async () => {
      throw new Error('simulated snapshot write failure');
    });
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setMatterStateProvider(async () => '');
    setPaProfileProvider(async () => null);

    const result = await executeCanonicalMutation(draftMutationParams('draft_generation'));
    expect(result.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// 4. Anthropic adapter — the block rides the TOP-LEVEL system parameter
// ---------------------------------------------------------------------------

function makeAnthropicOkResponse(): Response {
  const body = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'DRAFT_OUTPUT' }],
    model: 'claude-opus-4-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('INSTR-1A0 — Anthropic adapter delivers the system block via the top-level system param', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('flag-ON shape: the exact master asset text lands in request.system (hash-compared), not in a user turn', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicOkResponse());
    const master = getPromptAsset(MASTER_CLAUDE_TE);

    const adapter = new AnthropicAdapter('claude-opus-4-5');
    await adapter.generate({
      systemPrompt: master.text,
      userPrompt: 'USER_TURN_CONTENT',
      maxTokens: 64,
      signal: new AbortController().signal,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string) as {
      system: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody.system).toBe(master.text);
    expect(sha256Hex(Buffer.from(requestBody.system, 'utf8'))).toBe(TE_SHA256);
    expect(requestBody.messages).toEqual([{ role: 'user', content: 'USER_TURN_CONTENT' }]);
  });

  it('flag-OFF shape: a legacy system block passes through byte-identically', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicOkResponse());

    const adapter = new AnthropicAdapter('claude-opus-4-5');
    await adapter.generate({
      systemPrompt: 'PA_PROFILE_BODY\n\nMATTER_STATE_BLOCK\n\nROLE_SYSTEM_PROMPT',
      userPrompt: 'USER_TURN_CONTENT',
      maxTokens: 64,
      signal: new AbortController().signal,
    });

    const requestBody = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string) as {
      system: string;
    };
    expect(requestBody.system).toBe('PA_PROFILE_BODY\n\nMATTER_STATE_BLOCK\n\nROLE_SYSTEM_PROMPT');
  });
});
