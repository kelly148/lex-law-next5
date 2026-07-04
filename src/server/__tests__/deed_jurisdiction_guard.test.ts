/**
 * ULTRABUILD-1 W2c (QA-6 / run-sheet 0.8) — VA-only deed-drafting refusal guard.
 *
 * The deed agent drafts Virginia deeds only. A KNOWN non-VA governing jurisdiction (e.g. MD) must be refused
 * at the shared assertDeedDraftingAllowed chokepoint — never silence, never a VA-styled instrument for a
 * non-VA matter. Two layers: (1) the pure predicate isNonVaDeedJurisdiction; (2) the router-level refusal via
 * a tRPC caller with the DB/gate leaves mocked (mirrors deed_draft_agent_inc1c). LOOSE policy: null/unset
 * jurisdiction is NOT refused (preserves existing behavior; the strict-refuse-null option is a flagged
 * operator decision).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../db/queries/matters.js', () => ({ getMatterById: vi.fn() }));
vi.mock('../db/queries/materials.js', () => ({ listMaterialsForMatter: vi.fn() }));
vi.mock('../db/queries/documents.js', () => ({
  insertDocument: vi.fn(),
  updateDocumentCurrentVersion: vi.fn(),
  updateDocumentNotes: vi.fn(),
  getDocumentById: vi.fn(),
}));
vi.mock('../db/queries/versions.js', () => ({
  getNextVersionNumber: vi.fn(),
  insertVersion: vi.fn(),
  getLatestVersionForDocument: vi.fn(),
}));
vi.mock('../conflicts/postureGate.js', () => ({ resolvePostureDraftingGate: vi.fn() }));
vi.mock('../db/queries/conflicts.js', () => ({ hasUndispositionedBlocker: vi.fn() }));

import {
  deedDraftAgentRouter,
  isNonVaDeedJurisdiction,
  DEED_JURISDICTION_NOT_VA_CODE,
} from '../procedures/deedDraftAgent.js';
import { getMatterById } from '../db/queries/matters.js';
import { insertDocument } from '../db/queries/documents.js';
import { hasUndispositionedBlocker } from '../db/queries/conflicts.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const M1 = '22222222-2222-2222-2222-222222222222';
const caller = () => deedDraftAgentRouter.createCaller({ req: {} as Request, res: {} as Response, userId: U1 });
const giftInput = () => ({
  matterId: M1,
  grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Priya Ellison', descriptor: 'husband and wife' }],
  grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantors' daughter" }],
  fileNumber: '36-2026-7777',
  granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
  derivationReference: 'in Deed Book 5500 at Page 12',
});

describe('W2c — isNonVaDeedJurisdiction (pure VA-only predicate)', () => {
  it('is TRUE only for a known, explicitly-set non-VA jurisdiction (normalized)', () => {
    expect(isNonVaDeedJurisdiction('MD')).toBe(true);
    expect(isNonVaDeedJurisdiction('md')).toBe(true);
    expect(isNonVaDeedJurisdiction('  Md  ')).toBe(true);
    expect(isNonVaDeedJurisdiction('DC')).toBe(true);
  });
  it('is FALSE for VA (any case/whitespace) and for null/unset (loose policy)', () => {
    expect(isNonVaDeedJurisdiction('VA')).toBe(false);
    expect(isNonVaDeedJurisdiction('va')).toBe(false);
    expect(isNonVaDeedJurisdiction(' VA ')).toBe(false);
    expect(isNonVaDeedJurisdiction(null)).toBe(false);
    expect(isNonVaDeedJurisdiction(undefined)).toBe(false);
    expect(isNonVaDeedJurisdiction('')).toBe(false);
  });
});

describe('W2c — deed generation refuses a known non-VA matter', () => {
  const orig = process.env['DEED_DRAFT_AGENT_ENABLED'];
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
  });
  afterEach(() => {
    if (orig === undefined) delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    else process.env['DEED_DRAFT_AGENT_ENABLED'] = orig;
  });

  it('a MD matter is refused with DEED_JURISDICTION_NOT_VA; nothing is created', async () => {
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: M1,
      userId: U1,
      archivedAt: null,
      jurisdiction: 'MD',
    });
    await expect(caller().createGiftDraft(giftInput())).rejects.toThrow(new RegExp(DEED_JURISDICTION_NOT_VA_CODE));
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('a null-jurisdiction matter is NOT refused on jurisdiction grounds (loose policy)', async () => {
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: M1,
      userId: U1,
      archivedAt: null,
      jurisdiction: null,
    });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    // It passes the jurisdiction guard (and fails later — materials/assembly not mocked — but NEVER with the
    // jurisdiction code), proving null is not refused on jurisdiction grounds.
    let msg = '';
    try {
      await caller().createGiftDraft(giftInput());
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).not.toContain(DEED_JURISDICTION_NOT_VA_CODE);
  });
});
