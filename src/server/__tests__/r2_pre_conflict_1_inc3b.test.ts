/**
 * R2-PRE-CONFLICT-1 Inc 3b — enforcement wiring (BLOCK-until #1).
 *
 * Wires the affirmative `evaluateConflictClearance` predicate into the four conflict-sensitive
 * transitions (disposition §3C), behind the CONFLICT_GATE_ENABLED feature flag (DEFAULT OFF):
 *   1. advance-to-drafting (document.create)
 *   2. lockPlan
 *   3. the cleared-disposition ROOT (conflictsClearedForPlanning, written in lockPlan)
 *   4. export/send (GET /api/documents/:documentId/export)
 *
 * Coverage:
 *   A. Behavioral (document.create): FLAG ON enforces affirmative CLEARED via evaluateConflictClearance;
 *      non-cleared blocks with the distinct reason; OFF preserves the legacy hasUndispositionedBlocker path.
 *   B. Source analysis (the repo's pattern for the query layer + the Express export route): every site
 *      consumes the SINGLE shared predicate behind the flag; export is fail-closed + independent of
 *      SENDABILITY_GATE_ENABLED; the intentional fail-closed/fail-to-warn asymmetry is documented;
 *      finalize is deliberately NOT gated.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { v4 as uuidv4 } from 'uuid';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { clearTelemetryBuffer } from '../test-utils/setup.js';
import type { MatterRow, DocumentRow } from '../../shared/schemas/matters.js';

import * as matterQueries from '../db/queries/matters.js';
import * as documentQueries from '../db/queries/documents.js';
import * as conflictQueries from '../db/queries/conflicts.js';

vi.mock('../db/queries/matters.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/matters.js')>();
  return { ...actual, getMatterById: vi.fn(), updateMatterPhase: vi.fn() };
});
vi.mock('../db/queries/documents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/documents.js')>();
  return { ...actual, insertDocument: vi.fn(), listDocumentsForMatter: vi.fn() };
});
vi.mock('../db/queries/conflicts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/conflicts.js')>();
  // Inc 3b: the ON path advances via resolveDraftingGate, which calls evaluateAllClearanceReasons; the OFF
  // path calls hasUndispositionedBlocker. (CONFLICT-GATE-OVERRIDE-1 moved the ON-path predicate to the
  // non-short-circuiting evaluateAllClearanceReasons so an attested override of one precondition cannot
  // mask another; evaluateConflictClearance stays mocked for any other transitive caller.)
  return { ...actual, hasUndispositionedBlocker: vi.fn(), evaluateConflictClearance: vi.fn(), evaluateAllClearanceReasons: vi.fn() };
});

import { appRouter } from '../router.js';

const USER_ID = uuidv4();
const MATTER_ID = uuidv4();
const DOC_ID = uuidv4();

const createCaller = (userId: string) =>
  appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });

function makeMatterRow(): MatterRow {
  return {
    id: MATTER_ID,
    userId: USER_ID,
    title: 'Test Matter',
    clientName: null,
    practiceArea: null,
    phase: 'intake',
    analysisStatus: 'none',
    archivedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeDocRow(): DocumentRow {
  return {
    id: DOC_ID,
    userId: USER_ID,
    matterId: MATTER_ID,
    title: 'Test Document',
    documentType: 'contract',
    customTypeLabel: null,
    draftingMode: 'template',
    templateBindingStatus: 'bound',
    templateVersionId: null,
    templateSnapshot: null,
    variableMap: null,
    workflowState: 'drafting',
    currentVersionId: null,
    officialSubstantiveVersionNumber: null,
    officialFinalVersionNumber: null,
    completedAt: null,
    archivedAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const CREATE_INPUT = {
  matterId: MATTER_ID,
  title: 'Test Document',
  documentType: 'contract',
  draftingMode: 'template' as const,
};

// ============================================================
// A. Behavioral — document.create advance-to-drafting under the flag
// ============================================================
describe('R2-PRE-CONFLICT-1 Inc3b — document.create enforcement (CONFLICT_GATE_ENABLED)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearTelemetryBuffer();
    vi.mocked(matterQueries.getMatterById).mockResolvedValue(makeMatterRow());
    vi.mocked(matterQueries.updateMatterPhase).mockResolvedValue(null);
    vi.mocked(documentQueries.insertDocument).mockResolvedValue(makeDocRow());
    vi.mocked(documentQueries.listDocumentsForMatter).mockResolvedValue([]);
  });
  afterEach(() => {
    delete process.env['CONFLICT_GATE_ENABLED'];
  });

  it('FLAG ON: allows create when the affirmative predicate returns CLEARED', async () => {
    process.env['CONFLICT_GATE_ENABLED'] = 'true';
    vi.mocked(conflictQueries.evaluateAllClearanceReasons).mockResolvedValue({ state: 'CLEARED', reasons: [] });
    const doc = await createCaller(USER_ID).document.create(CREATE_INPUT);
    expect(doc.id).toBe(DOC_ID);
    // The shared affirmative predicate gates — NOT the legacy boolean.
    expect(vi.mocked(conflictQueries.evaluateAllClearanceReasons)).toHaveBeenCalledWith(MATTER_ID, USER_ID);
    expect(vi.mocked(conflictQueries.hasUndispositionedBlocker)).not.toHaveBeenCalled();
    expect(vi.mocked(documentQueries.insertDocument)).toHaveBeenCalledTimes(1);
  });

  it('FLAG ON: blocks create (PRECONDITION_FAILED) on an unconfirmed client party — never "not blocked"', async () => {
    process.env['CONFLICT_GATE_ENABLED'] = 'true';
    vi.mocked(conflictQueries.evaluateAllClearanceReasons).mockResolvedValue({
      state: 'NOT_ESTABLISHED',
      reasons: ['unconfirmed_client_party'],
    });
    await expect(createCaller(USER_ID).document.create(CREATE_INPUT)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(vi.mocked(documentQueries.insertDocument)).not.toHaveBeenCalled();
  });

  it('FLAG ON: the block carries CONFLICTS_NOT_CLEARED + the distinct reason', async () => {
    process.env['CONFLICT_GATE_ENABLED'] = 'true';
    vi.mocked(conflictQueries.evaluateAllClearanceReasons).mockResolvedValue({
      state: 'NOT_ESTABLISHED',
      reasons: ['no_conflict_check'],
    });
    try {
      await createCaller(USER_ID).document.create(CREATE_INPUT);
      throw new Error('expected create to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).message).toContain('CONFLICTS_NOT_CLEARED');
      expect((err as TRPCError).message).toContain('no_conflict_check');
    }
  });

  it('FLAG OFF (default): legacy path — uses hasUndispositionedBlocker, not the affirmative predicate', async () => {
    vi.mocked(conflictQueries.hasUndispositionedBlocker).mockResolvedValue(false);
    const doc = await createCaller(USER_ID).document.create(CREATE_INPUT);
    expect(doc.id).toBe(DOC_ID);
    expect(vi.mocked(conflictQueries.hasUndispositionedBlocker)).toHaveBeenCalledWith(MATTER_ID, USER_ID);
    expect(vi.mocked(conflictQueries.evaluateAllClearanceReasons)).not.toHaveBeenCalled();
  });
});

// ============================================================
// B. Source analysis — the four sites, the flag, the asymmetry, finalize-not-gated
// ============================================================
describe('R2-PRE-CONFLICT-1 Inc3b — enforcement-wiring source audit (no bypass)', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
  const flags = read('src/server/config/featureFlags.ts');
  const documents = read('src/server/procedures/documents.ts');
  const analysis = read('src/server/db/queries/matterAnalysis.ts');
  const index = read('src/server/index.ts');
  const documents4a = read('src/server/procedures/documents4a.ts');
  // CONFLICT-GATE-OVERRIDE-1: the ON-path predicate + fail-closed-on-error try/catch moved into the
  // override-aware resolver; the create/export blocks now call resolveDraftingGate.
  const gateOverrideQueries = read('src/server/db/queries/gateOverride.ts');

  it('the flag is env-gated and DEFAULT OFF (absence preserves legacy behavior)', () => {
    expect(flags).toContain('export function isConflictGateEnabled()');
    expect(flags).toContain("process.env['CONFLICT_GATE_ENABLED'] === 'true'");
  });

  it('advance-to-drafting gates on the shared predicate behind the flag', () => {
    const block = documents.slice(documents.indexOf('Advance-to-drafting conflicts gate'), documents.indexOf('const doc = await insertDocument'));
    expect(block).toContain('isConflictGateEnabled()');
    // CONFLICT-TOGGLE-1 Inc 2: the ON branch now consults the POSTURE-aware resolver, which wraps the
    // override-aware resolveDraftingGate (default ENFORCED → fail-closed unchanged; ADVISORY lets the absence
    // of clearance pass but a positive blocker still hard-stops).
    expect(block).toContain('resolvePostureDraftingGate(input.matterId, ctx.userId)');
    expect(block).toContain('!gate.allowed');
    expect(block).toContain('CONFLICTS_NOT_CLEARED');
    // legacy path still present + UNCHANGED for the OFF branch
    expect(block).toContain('hasUndispositionedBlocker(input.matterId, ctx.userId)');
  });

  it('lockPlan (the cleared-disposition ROOT) gates on the posture-aware resolver, keeping the all-hits gate', () => {
    // CONFLICT-TOGGLE-1 Inc 2: lockPlan's affirmative-clearance block moved from evaluateConflictClearance to
    // the posture-aware resolver; the all-hits gate is KEPT (it already hard-stops an undispositioned blocker
    // for every posture); conflictsClearedForPlanning is set TRUE only when actually CLEARED (never on an
    // advisory pass).
    const fn = analysis.slice(analysis.indexOf('export async function lockPlan'), analysis.indexOf('conflictsClearedForPlanning: clearedForPlanning'));
    expect(fn).toContain('allHitsDispositionedForLatest(a.matterId, params.userId)'); // kept
    expect(fn).toContain('isConflictGateEnabled()');
    expect(fn).toContain('resolvePostureDraftingGate(a.matterId, params.userId)');
    expect(fn).toContain("postureGate.base.clearance.state === 'CLEARED'");
  });

  it('export/send gates on the shared predicate, behind the flag, INDEPENDENT of the sendability flag', () => {
    const start = index.indexOf('conflict-clearance export gate');
    expect(start).toBeGreaterThan(-1);
    const block = index.slice(start, index.indexOf('FOLD-SEND-1 export-safety gate'));
    expect(block).toContain('isConflictGateEnabled()');
    // CONFLICT-TOGGLE-1 Inc 2: export consults the same POSTURE-aware resolver as advance-to-drafting (which
    // wraps the override-aware, fail-closed resolveDraftingGate).
    expect(block).toContain('resolvePostureDraftingGate(doc.matterId, userId)');
    expect(block).toContain('!gate.allowed');
    expect(block).toContain('CONFLICTS_NOT_CLEARED');
    expect(block).toContain('reasons: gate.blockingReasons');
    // FAIL-CLOSED: an evaluation error blocks. The fail-closed try/catch moved INTO resolveDraftingGate
    // (it must never fall through to export), so assert it at its new home.
    expect(gateOverrideQueries).toContain("reasons: ['clearance_evaluation_failed']");
    // independent of the sendability flag — the conflict gate must not reference it
    expect(block).not.toContain('isSendabilityGateEnabled');
  });

  it('documents the intentional FAIL-CLOSED vs fail-to-warn asymmetry so a future reader will not "fix" it', () => {
    expect(flags.toLowerCase()).toContain('fail-closed');
    expect(index).toContain('Do not');
    expect(index.toLowerCase()).toContain('fail-closed');
  });

  it('finalize is deliberately NOT conflict-gated (export is the deliverable boundary)', () => {
    const fn = documents4a.slice(documents4a.indexOf('finalize: protectedProcedure'));
    expect(fn).not.toContain('evaluateConflictClearance');
    expect(fn).not.toContain('isConflictGateEnabled');
  });
});
