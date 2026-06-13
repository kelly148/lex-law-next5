/**
 * INSTR-2B-core — drafting-time master selection (lawfirm + te, LAYERED) behind
 * MASTER_LAWFIRM_ENABLED (default OFF). Title routing is INSTR-2B-TITLE (deferred):
 * title_settlement gets the lawfirm safe default here.
 *
 * Covers:
 *   1. GUARD — MASTER_LAWFIRM_ENABLED OFF => composition byte-for-byte unchanged (the INSTR-1A0
 *      TE-blob path + legacy elsewhere); master/claude/lawfirm is NEVER composed.
 *   2. Routing (flag ON) — T&E -> te (layered); general/real_estate/unconfirmed/NULL/title_settlement
 *      -> lawfirm (layered); non-Anthropic -> legacy; reviewer/evaluator -> none; regenerate composes.
 *   3. Chokepoint LAYERED assembly (D-4) — master ON TOP of matter-state + role; (D-5) the per-PA
 *      profile is SUPPRESSED when a master is selected, and still injected on the no-master path.
 *   4. prompt_snapshots records the selected asset id + hash + flag state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getPromptAsset,
  clearPromptAssetCacheForTests,
  sha256Hex,
  MASTER_CLAUDE_TE,
  MASTER_CLAUDE_LAWFIRM,
} from '../promptAssets.js';
import { assemblePrompt, setCompositionReaders } from '../assemblePrompt.js';
import { PRIMARY_DRAFTER_MODEL } from '../config.js';
import { setTestLlmAdapter } from '../registry.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../types.js';
import {
  executeCanonicalMutation,
  setJobWriteFunctions,
  setMatterStateProvider,
  setPaProfileProvider,
  setPromptSnapshotWriter,
} from '../../db/canonicalMutation.js';
import type { NewPromptSnapshot, JobType } from '../../db/schema.js';

const ML_FLAG = 'MASTER_LAWFIRM_ENABLED';
const PC_FLAG = 'PROMPT_COMPOSITION_ENABLED';
const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';
const DOC = '33333333-3333-3333-3333-333333333333';

let savedML: string | undefined;
let savedPC: string | undefined;

beforeEach(() => {
  savedML = process.env[ML_FLAG];
  savedPC = process.env[PC_FLAG];
  delete process.env[ML_FLAG];
  delete process.env[PC_FLAG];
});

afterEach(() => {
  if (savedML === undefined) delete process.env[ML_FLAG];
  else process.env[ML_FLAG] = savedML;
  if (savedPC === undefined) delete process.env[PC_FLAG];
  else process.env[PC_FLAG] = savedPC;
  clearPromptAssetCacheForTests();
});

// CAPACITY-ELECTION-UX (R3): the te/lawfirm default now composes ONLY on an AFFIRMATIVELY-ELECTED
// law_firm seat. These 2B-core routing tests exercise an elected law_firm seat by default (capacity
// 'law_firm' + a non-null marker injected here), so they keep testing paKey -> te/lawfirm selection.
// A test that needs the unelected/title path passes engagementCapacity / engagementCapacityElectedAt
// explicitly (the explicit value wins over the default).
const ELECTED = new Date('2026-06-13T00:00:00Z');
const draftArgs = (
  matter:
    | { paKey: string | null; practiceArea: string | null; engagementCapacity?: string | null; engagementCapacityElectedAt?: Date | string | null }
    | null,
  model: string = PRIMARY_DRAFTER_MODEL,
  callRole: 'draft' | 'regenerate' | 'review' | 'evaluator' = 'draft',
) => ({
  matter: matter
    ? {
        paKey: matter.paKey,
        practiceArea: matter.practiceArea,
        engagementCapacity: matter.engagementCapacity ?? 'law_firm',
        engagementCapacityElectedAt:
          matter.engagementCapacityElectedAt === undefined ? ELECTED : matter.engagementCapacityElectedAt,
      }
    : null,
  docType: null,
  callRole,
  model,
} as const);

// ---------------------------------------------------------------------------
// 1. GUARD — MASTER_LAWFIRM_ENABLED OFF => byte-for-byte unchanged; lawfirm NEVER composed
// ---------------------------------------------------------------------------

describe('INSTR-2B-core — GUARD: MASTER_LAWFIRM_ENABLED OFF leaves composition unchanged', () => {
  it('both flags OFF: legacy (no master, no layered)', () => {
    const out = assemblePrompt(draftArgs({ paKey: 'real_estate', practiceArea: 'Real Estate' }));
    expect(out.source).toBe('legacy');
    expect(out.systemText).toBeNull();
    expect(out.layeredMasterText).toBeNull();
    expect(out.flagEnabled).toBe(false);
  });

  it('ML OFF + PROMPT_COMPOSITION ON, T&E draft: the INSTR-1A0 TE BLOB path is unchanged', () => {
    process.env[PC_FLAG] = 'true';
    const out = assemblePrompt(draftArgs({ paKey: 'trusts_estates', practiceArea: null }));
    expect(out.source).toBe(MASTER_CLAUDE_TE);
    expect(out.systemText).toBe(getPromptAsset(MASTER_CLAUDE_TE).text); // BLOB: entire block
    expect(out.layeredMasterText).toBeNull(); // not layered
  });

  it('ML OFF + PROMPT_COMPOSITION ON, general matter: stays legacy — lawfirm is NEVER composed', () => {
    process.env[PC_FLAG] = 'true';
    const out = assemblePrompt(draftArgs({ paKey: 'real_estate', practiceArea: 'Real Estate' }));
    expect(out.source).toBe('legacy'); // NOT master/claude/lawfirm
    expect(out.layeredMasterText).toBeNull();
  });

  it('ML OFF: a title_settlement matter never composes lawfirm', () => {
    process.env[PC_FLAG] = 'true';
    const out = assemblePrompt(draftArgs({ paKey: 'title_settlement', practiceArea: null }));
    expect(out.source).toBe('legacy');
  });
});

// ---------------------------------------------------------------------------
// 2. Routing — MASTER_LAWFIRM_ENABLED ON (pure decision)
// ---------------------------------------------------------------------------

describe('INSTR-2B-core — routing (flag ON)', () => {
  beforeEach(() => {
    process.env[ML_FLAG] = 'true';
  });

  it('T&E paKey -> te, LAYERED (not blob)', () => {
    const out = assemblePrompt(draftArgs({ paKey: 'trusts_estates', practiceArea: null }));
    expect(out.source).toBe(MASTER_CLAUDE_TE);
    expect(out.layeredMasterText).toBe(getPromptAsset(MASTER_CLAUDE_TE).text);
    expect(out.systemText).toBeNull();
    expect(out.assetSha256).toBe(getPromptAsset(MASTER_CLAUDE_TE).sha256);
  });

  it('T&E freeform practiceArea -> te (layered)', () => {
    const out = assemblePrompt(draftArgs({ paKey: null, practiceArea: 'Estate Planning' }));
    expect(out.source).toBe(MASTER_CLAUDE_TE);
    expect(out.layeredMasterText).not.toBeNull();
  });

  it('general / real_estate paKey -> lawfirm (layered, safe default)', () => {
    const out = assemblePrompt(draftArgs({ paKey: 'real_estate', practiceArea: 'Real Estate' }));
    expect(out.source).toBe(MASTER_CLAUDE_LAWFIRM);
    expect(out.layeredMasterText).toBe(getPromptAsset(MASTER_CLAUDE_LAWFIRM).text);
    expect(out.systemText).toBeNull();
    expect(out.assetSha256).toBe(getPromptAsset(MASTER_CLAUDE_LAWFIRM).sha256);
  });

  it('unconfirmed / NULL paKey -> lawfirm (safe default, on an ELECTED law_firm seat)', () => {
    const out = assemblePrompt(draftArgs({ paKey: null, practiceArea: null }));
    expect(out.source).toBe(MASTER_CLAUDE_LAWFIRM);
  });

  it('CAPACITY-ELECTION-UX [residual]: an UNELECTED law_firm matter (NULL marker) -> legacy, NEVER the lawfirm default', () => {
    const out = assemblePrompt(draftArgs({ paKey: 'real_estate', practiceArea: 'Real Estate', engagementCapacity: 'law_firm', engagementCapacityElectedAt: null }));
    expect(out.source).toBe('legacy');
    expect(out.layeredMasterText).toBeNull();
  });

  it('CAPACITY-ELECTION-UX [residual]: capacity ABSENT (legacy/unelected row) -> legacy', () => {
    // engagementCapacity null AND marker null -> not title, not an elected law_firm -> legacy.
    const out = assemblePrompt(draftArgs({ paKey: 'real_estate', practiceArea: 'Real Estate', engagementCapacity: null, engagementCapacityElectedAt: null }));
    expect(out.source).toBe('legacy');
  });

  it('title_settlement paKey -> lawfirm (safe default; Title routing deferred to 2B-TITLE)', () => {
    const out = assemblePrompt(draftArgs({ paKey: 'title_settlement', practiceArea: null }));
    expect(out.source).toBe(MASTER_CLAUDE_LAWFIRM);
  });

  it('regeneration (drafting) composes too — T&E regenerate -> te layered', () => {
    const out = assemblePrompt(draftArgs({ paKey: 'trusts_estates', practiceArea: null }, PRIMARY_DRAFTER_MODEL, 'regenerate'));
    expect(out.source).toBe(MASTER_CLAUDE_TE);
    expect(out.layeredMasterText).not.toBeNull();
  });

  it('non-Anthropic model -> legacy (no master sent to another provider)', () => {
    const out = assemblePrompt(draftArgs({ paKey: 'real_estate', practiceArea: null }, 'openai:gpt-4.1-mini'));
    expect(out.source).toBe('legacy');
  });

  it('reviewer role -> none (legacy; calibration-preserving)', () => {
    const out = assemblePrompt(draftArgs({ paKey: 'real_estate', practiceArea: null }, PRIMARY_DRAFTER_MODEL, 'review'));
    expect(out.source).toBe('legacy');
  });

  it('evaluator role -> none (legacy)', () => {
    const out = assemblePrompt(draftArgs({ paKey: 'real_estate', practiceArea: null }, PRIMARY_DRAFTER_MODEL, 'evaluator'));
    expect(out.source).toBe('legacy');
  });

  it('missing matter -> legacy (fail-closed)', () => {
    const out = assemblePrompt(draftArgs(null));
    expect(out.source).toBe('legacy');
  });
});

// ---------------------------------------------------------------------------
// 3 + 4. Chokepoint LAYERED assembly (D-4/D-5) + snapshot provenance
// ---------------------------------------------------------------------------

class CapturingAdapter implements LlmClient {
  public lastSystemPrompt: string | null = null;
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.lastSystemPrompt = params.systemPrompt;
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
  txn1Enqueue: (jobId: string) => Promise.resolve({ jobId }),
  buildLlmParams: () => ({ systemPrompt: 'ROLE_SYSTEM_PROMPT', userPrompt: 'USER_PROMPT' }),
  txn2Commit: () => Promise.resolve(),
  txn2Revert: () => Promise.resolve(),
  telemetryCtx: { userId: USER, matterId: MATTER, documentId: DOC, jobId: null },
});

describe('INSTR-2B-core — chokepoint LAYERED composition (D-4/D-5) + snapshot', () => {
  let snapshots: NewPromptSnapshot[];

  beforeEach(() => {
    snapshots = [];
    setPromptSnapshotWriter((row) => {
      snapshots.push(row);
      return Promise.resolve();
    });
    setMatterStateProvider(() => Promise.resolve('MATTER_STATE_BLOCK'));
  });

  afterEach(() => {
    setPromptSnapshotWriter(null);
    setMatterStateProvider(null);
    setPaProfileProvider(null);
    setCompositionReaders(null);
    setTestLlmAdapter(null);
    setJobWriteFunctions(null);
    vi.clearAllMocks();
  });

  it('flag ON + T&E draft: te master LAYERED on matter-state + role; PA profile SUPPRESSED (D-5); snapshotted', async () => {
    process.env[ML_FLAG] = 'true';
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setCompositionReaders({
      // CAPACITY-ELECTION-UX (R3): an ELECTED law_firm seat so the te/lawfirm default still composes.
      getMatter: vi.fn().mockResolvedValue({ paKey: 'trusts_estates', practiceArea: null, engagementCapacity: 'law_firm', engagementCapacityElectedAt: ELECTED }) as never,
      getDocument: vi.fn().mockResolvedValue({ documentType: 'last_will_testament' }) as never,
    });
    const paProvider = vi.fn().mockResolvedValue({
      body: 'PA_PROFILE_BODY',
      profileId: '44444444-4444-4444-4444-444444444444',
      version: '1.0',
      paKey: 'trusts_estates',
    });
    setPaProfileProvider(paProvider);

    await executeCanonicalMutation(draftMutationParams('draft_generation'));

    const te = getPromptAsset(MASTER_CLAUDE_TE);
    // D-4 layered order: master, then matter-state, then the per-call role prompt.
    expect(adapter.lastSystemPrompt).toBe(`${te.text}\n\nMATTER_STATE_BLOCK\n\nROLE_SYSTEM_PROMPT`);
    // D-5: the per-PA profile injection is SUPPRESSED when a master is selected.
    expect(paProvider).not.toHaveBeenCalled();
    // Snapshot provenance: the selected asset id + hash + flag state.
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0]!;
    expect(snap.source).toBe(MASTER_CLAUDE_TE);
    expect(snap.assetId).toBe(MASTER_CLAUDE_TE);
    expect(snap.assetSha256).toBe(te.sha256);
    expect(snap.flagEnabled).toBe(true);
    expect(snap.systemText).toBe(adapter.lastSystemPrompt);
    expect(snap.systemSha256).toBe(sha256Hex(adapter.lastSystemPrompt!));
  });

  it('flag ON + general matter draft: lawfirm master LAYERED; snapshot records lawfirm', async () => {
    process.env[ML_FLAG] = 'true';
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setCompositionReaders({
      // CAPACITY-ELECTION-UX (R3): an ELECTED law_firm seat so the lawfirm default still composes.
      getMatter: vi.fn().mockResolvedValue({ paKey: 'real_estate', practiceArea: 'Real Estate', engagementCapacity: 'law_firm', engagementCapacityElectedAt: ELECTED }) as never,
      getDocument: vi.fn().mockResolvedValue({ documentType: 'purchase_agreement' }) as never,
    });
    setPaProfileProvider(vi.fn().mockResolvedValue(null));

    await executeCanonicalMutation(draftMutationParams('draft_generation'));

    const lf = getPromptAsset(MASTER_CLAUDE_LAWFIRM);
    expect(adapter.lastSystemPrompt).toBe(`${lf.text}\n\nMATTER_STATE_BLOCK\n\nROLE_SYSTEM_PROMPT`);
    expect(snapshots[0]!.source).toBe(MASTER_CLAUDE_LAWFIRM);
    expect(snapshots[0]!.assetSha256).toBe(lf.sha256);
  });

  it('GUARD: flag OFF (both) — legacy block byte-identical, PA profile STILL injected (no master)', async () => {
    // Neither MASTER_LAWFIRM_ENABLED nor PROMPT_COMPOSITION_ENABLED set.
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    const paProvider = vi.fn().mockResolvedValue({
      body: 'PA_PROFILE_BODY',
      profileId: '44444444-4444-4444-4444-444444444444',
      version: '1.0',
      paKey: 'real_estate',
    });
    setPaProfileProvider(paProvider);

    await executeCanonicalMutation(draftMutationParams('draft_generation'));

    // Legacy, byte-for-byte: PA profile OUTERMOST, then matter state, then the role prompt.
    expect(adapter.lastSystemPrompt).toBe('PA_PROFILE_BODY\n\nMATTER_STATE_BLOCK\n\nROLE_SYSTEM_PROMPT');
    expect(paProvider).toHaveBeenCalledTimes(1); // no-master path still injects the profile
    expect(snapshots[0]!.source).toBe('legacy');
    expect(snapshots[0]!.flagEnabled).toBe(false);
  });
});
