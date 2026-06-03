/**
 * FOLD-L0-1 Increment 3 — single-lane analysis generation + advance-to-drafting hard-block.
 *
 * Covers:
 *   A. parseGeneratedAnalysis — fail-loud parse of the generated analysis (Fork C/F).
 *   B. matter_analysis job type resolves a prompt version (R11 provenance).
 *   C. document.create advance-to-drafting hard-block (Fork A): an undispositioned
 *      blocker-severity conflict blocks the DECISION to start drafting.
 *
 * No test DB: query layers are mocked. The conflicts gate stub
 * (hasUndispositionedBlocker) is ADDED — no existing assertion is changed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { v4 as uuidv4 } from 'uuid';
import type { Request, Response } from 'express';
import { clearTelemetryBuffer } from '../test-utils/setup.js';
import { parseGeneratedAnalysis, AnalysisGenerationSchema } from '../intake/analysisGenerationParse.js';
import { getPromptVersionForJobType } from '../llm/promptVersions.js';
import type { MatterRow, DocumentRow } from '../../shared/schemas/matters.js';

// ── Mock the query layers document.create touches (no DB in unit tests) ───────
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
  // ADDED stub (Inc3): the new advance-to-drafting gate calls this. Default = no blocker.
  return { ...actual, hasUndispositionedBlocker: vi.fn() };
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
// A. parseGeneratedAnalysis (Fork C/F)
// ============================================================
describe('FOLD-L0-1 Inc3 — parseGeneratedAnalysis', () => {
  const good = {
    assessment: 'Straightforward services agreement.',
    plan: 'Draft an MSA with a SOW exhibit.',
    openQuestions: ['Governing law?', 'Payment terms?'],
    recommendedDocuments: [{ documentType: 'msa', title: 'Master Services Agreement', rationale: 'Primary contract' }],
  };

  it('accepts a valid analysis object', () => {
    const out = parseGeneratedAnalysis(good);
    expect(out.assessment).toContain('services agreement');
    expect(out.openQuestions).toHaveLength(2);
    expect(out.recommendedDocuments[0]?.documentType).toBe('msa');
  });

  it('accepts a valid analysis JSON string', () => {
    const out = parseGeneratedAnalysis(JSON.stringify(good));
    expect(out.plan).toContain('MSA');
  });

  it('strips a markdown code fence', () => {
    const fenced = '```json\n' + JSON.stringify(good) + '\n```';
    const out = parseGeneratedAnalysis(fenced);
    expect(out.assessment).toContain('services agreement');
  });

  it('defaults optional arrays when omitted', () => {
    const out = parseGeneratedAnalysis({ assessment: 'a', plan: 'p' });
    expect(out.openQuestions).toEqual([]);
    expect(out.recommendedDocuments).toEqual([]);
  });

  it('throws ANALYSIS_GENERATION_MALFORMED on unparseable JSON', () => {
    expect(() => parseGeneratedAnalysis('not json {')).toThrow(/ANALYSIS_GENERATION_MALFORMED/);
  });

  it('throws ANALYSIS_GENERATION_MALFORMED on schema mismatch', () => {
    expect(() => parseGeneratedAnalysis({ assessment: 123 })).toThrow(/ANALYSIS_GENERATION_MALFORMED/);
  });

  it('throws ANALYSIS_GENERATION_EMPTY on empty assessment', () => {
    expect(() => parseGeneratedAnalysis({ assessment: '   ', plan: 'p' })).toThrow(/ANALYSIS_GENERATION_EMPTY/);
  });

  it('schema is an object schema (not array)', () => {
    expect(AnalysisGenerationSchema.safeParse(good).success).toBe(true);
  });
});

// ============================================================
// B. matter_analysis job type → prompt version provenance (R11)
// ============================================================
describe('FOLD-L0-1 Inc3 — matter_analysis job type', () => {
  it('resolves a prompt version', () => {
    const v = getPromptVersionForJobType('matter_analysis');
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });
});

// ============================================================
// C. document.create advance-to-drafting hard-block (Fork A)
// ============================================================
describe('FOLD-L0-1 Inc3 — document.create conflicts hard-block', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearTelemetryBuffer();
    vi.mocked(matterQueries.getMatterById).mockResolvedValue(makeMatterRow());
    vi.mocked(matterQueries.updateMatterPhase).mockResolvedValue(null);
    vi.mocked(documentQueries.insertDocument).mockResolvedValue(makeDocRow());
    vi.mocked(documentQueries.listDocumentsForMatter).mockResolvedValue([]);
    vi.mocked(conflictQueries.hasUndispositionedBlocker).mockResolvedValue(false);
  });

  it('allows create when there is no undispositioned blocker', async () => {
    const caller = createCaller(USER_ID);
    const doc = await caller.document.create(CREATE_INPUT);
    expect(doc.id).toBe(DOC_ID);
    expect(vi.mocked(conflictQueries.hasUndispositionedBlocker)).toHaveBeenCalledWith(MATTER_ID, USER_ID);
    expect(vi.mocked(documentQueries.insertDocument)).toHaveBeenCalledTimes(1);
  });

  it('blocks create with PRECONDITION_FAILED when an undispositioned blocker exists', async () => {
    vi.mocked(conflictQueries.hasUndispositionedBlocker).mockResolvedValue(true);
    const caller = createCaller(USER_ID);
    await expect(caller.document.create(CREATE_INPUT)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    // The matter advances to drafting only after the gate clears: no document inserted.
    expect(vi.mocked(documentQueries.insertDocument)).not.toHaveBeenCalled();
  });

  it('the block carries the CONFLICTS_BLOCKER_UNDISPOSITIONED code', async () => {
    vi.mocked(conflictQueries.hasUndispositionedBlocker).mockResolvedValue(true);
    const caller = createCaller(USER_ID);
    try {
      await caller.document.create(CREATE_INPUT);
      throw new Error('expected create to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).message).toContain('CONFLICTS_BLOCKER_UNDISPOSITIONED');
    }
  });
});
