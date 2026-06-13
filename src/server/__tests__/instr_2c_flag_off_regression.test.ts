/**
 * INSTR-2C — R7 flag-OFF byte-for-byte regression + R6 model-bound addendum + R10 no-downstream.
 *
 * R7: with MASTER_OUTLINE_ENABLED OFF, an outline_generation job through the chokepoint composes
 * byte-for-byte the legacy outline assembly (matter-state + base prompt, NO master, NO addendum) with
 * ZERO extra reads (the composition matter-read and the conflict gate are never consulted) — across the
 * representative matter types (representational, ambiguous, title, uncleared).
 * R6: flag ON + valid cell -> the addendum appears verbatim in the MODEL-BOUND system block, FIRST.
 * R10: the draft-generation path never loads the outline output (no-downstream-contamination pin).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRIMARY_DRAFTER_MODEL } from '../llm/config.js';
import { setCompositionReaders } from '../llm/assemblePrompt.js';
import { setOutlineGateReader, OUTLINE_ADDENDUM, type OutlineGateReader } from '../llm/outlineMasterComposition.js';
import { getPromptAsset, MASTER_CLAUDE_LAWFIRM } from '../llm/promptAssets.js';
import {
  executeCanonicalMutation,
  setJobWriteFunctions,
  setMatterStateProvider,
  setPaProfileProvider,
  setPromptSnapshotWriter,
} from '../db/canonicalMutation.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';

const OUTLINE_FLAG = 'MASTER_OUTLINE_ENABLED';
const LAWFIRM_FLAG = 'MASTER_LAWFIRM_ENABLED';
const BLOB_FLAG = 'PROMPT_COMPOSITION_ENABLED';
const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';
const BASE = 'You are an expert legal document drafter. Generate a structured outline.';

// CAPACITY-ELECTION-UX (R3): the representational law_firm seat now requires an affirmative election
// marker; the lawFirm fixture carries it (the flag-OFF cases short-circuit before the marker is read).
type Matter = { engagementCapacity?: string | null; engagementCapacityElectedAt?: Date | string | null; paKey?: string | null; practiceArea?: string | null };
const lawFirm: Matter = { engagementCapacity: 'law_firm', engagementCapacityElectedAt: new Date('2026-06-13T00:00:00Z'), paKey: null, practiceArea: null };
const titleElected: Matter = { engagementCapacity: 'title_settlement_agent', paKey: null, practiceArea: null };
const ambiguous: Matter = { paKey: 'corporate', practiceArea: null }; // capacity field ABSENT (unelected)

class CapturingAdapter implements LlmClient {
  public lastSystemPrompt: string | null = null;
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.lastSystemPrompt = params.systemPrompt;
    return Promise.resolve({ content: 'REPLY', tokensPrompt: 1, tokensCompletion: 1, providerMetadata: { provider: 'capture' } });
  }
}

let capturing: CapturingAdapter;
let matterReads = 0;
let gateReads = 0;
const flags = [OUTLINE_FLAG, LAWFIRM_FLAG, BLOB_FLAG];
const saved: Record<string, string | undefined> = {};

function installSeams(matter: Matter, gateAllowed: boolean): void {
  matterReads = 0;
  gateReads = 0;
  setCompositionReaders({
    getMatter: async () => {
      matterReads += 1;
      return matter;
    },
    getDocument: async () => null,
  });
  const gate: OutlineGateReader = () => {
    gateReads += 1;
    return Promise.resolve({ allowed: gateAllowed });
  };
  setOutlineGateReader(gate);
}

function runOutline(): Promise<{ systemPrompt: string | null }> {
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
  setMatterStateProvider(async () => ''); // empty so the system block is master/addendum + base only
  setPaProfileProvider(async () => null);
  setPromptSnapshotWriter(async () => {});
  return executeCanonicalMutation({
    userId: USER,
    jobType: 'outline_generation',
    modelString: PRIMARY_DRAFTER_MODEL,
    matterId: MATTER,
    documentId: '33333333-3333-3333-3333-333333333333',
    txn1Enqueue: (jobId) => Promise.resolve({ jobId }),
    buildLlmParams: () => ({ systemPrompt: BASE, userPrompt: 'outline this', temperature: 0.2, maxTokens: 4096 }),
    txn2Commit: () => Promise.resolve(),
    txn2Revert: () => Promise.resolve(),
    telemetryCtx: { userId: USER, matterId: MATTER, documentId: null, jobId: null },
  }).then(() => ({ systemPrompt: capturing.lastSystemPrompt }));
}

beforeEach(() => {
  for (const f of flags) {
    saved[f] = process.env[f];
    delete process.env[f];
  }
});
afterEach(() => {
  for (const f of flags) {
    if (saved[f] === undefined) delete process.env[f];
    else process.env[f] = saved[f]!;
  }
  setCompositionReaders(null);
  setOutlineGateReader(null);
  setTestLlmAdapter(null);
  setJobWriteFunctions(null);
  setMatterStateProvider(null);
  setPaProfileProvider(null);
  setPromptSnapshotWriter(null);
  vi.clearAllMocks();
});

describe('INSTR-2C R7 — flag-OFF byte-for-byte + zero reads (representative matter types)', () => {
  it.each([
    ['representational', lawFirm, true],
    ['ambiguous', ambiguous, true],
    ['title', titleElected, true],
    ['uncleared', lawFirm, false],
  ] as Array<[string, Matter, boolean]>)(
    'flag OFF + %s matter -> legacy outline bytes (no master/addendum), ZERO composition+gate reads',
    async (_label, matter, gateAllowed) => {
      // flag OFF (all composition flags unset by beforeEach)
      installSeams(matter, gateAllowed);
      const { systemPrompt } = await runOutline();
      expect(systemPrompt).toBe(BASE); // empty matter-state + no master = the base prompt, byte-for-byte
      expect(systemPrompt).not.toContain(OUTLINE_ADDENDUM);
      expect(matterReads).toBe(0); // ZERO extra reads
      expect(gateReads).toBe(0);
    },
  );
});

describe('INSTR-2C R6/R2 — flag ON, valid cell: addendum verbatim in the model-bound block', () => {
  it('law_firm + cleared gate -> the model sees the addendum FIRST, then the master, then the base', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    installSeams(lawFirm, true);
    const { systemPrompt } = await runOutline();
    expect(systemPrompt).not.toBeNull();
    expect(systemPrompt!.startsWith(OUTLINE_ADDENDUM)).toBe(true); // precedence floor, in the model-bound text
    expect(systemPrompt).toContain(getPromptAsset(MASTER_CLAUDE_LAWFIRM).text);
    expect(systemPrompt!.endsWith(BASE)).toBe(true);
  });

  it('flag ON but title matter -> legacy bytes (no master/addendum)', async () => {
    process.env[OUTLINE_FLAG] = 'true';
    installSeams(titleElected, true);
    const { systemPrompt } = await runOutline();
    expect(systemPrompt).toBe(BASE);
    expect(systemPrompt).not.toContain(OUTLINE_ADDENDUM);
  });
});

describe('INSTR-2C R10 — outline feeds no other model (no-downstream pin)', () => {
  it('the draft-generation procedure never loads the outline output', () => {
    const draftPath = fileURLToPath(new URL('../procedures/documents4a.ts', import.meta.url));
    const src = readFileSync(draftPath, 'utf8');
    // The outline output lives in document_outlines, read via getOutline* (phase4b). The draft path
    // must not consume it — so the no-downstream-contamination premise cannot silently regress.
    expect(src).not.toMatch(/document_outlines/);
    expect(src).not.toMatch(/getOutline/);
    expect(src.toLowerCase()).not.toContain('outline');
  });
});
