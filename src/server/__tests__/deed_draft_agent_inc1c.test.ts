/**
 * DEED-DRAFT-AGENT-1 Inc 1c — the wiring procedure (deedDraftAgent router).
 *
 * Two layers: (1) the PURE buildGiftDraft helper exercised over a real synthetic packet (no DB); (2) the
 * createGiftDraft procedure via a tRPC caller with the DB/gate leaves mocked — asserting the three fail-closed
 * gates (flag, ownership, conflicts-at-intake) and the happy-path document/version persistence with the
 * verbatim deed text. Flag + conflict-gate state is driven by env (the real feature-flag reads).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

// ── mock the DB/gate leaves the procedure calls (the pure assembler modules are NOT mocked) ──
vi.mock('../db/queries/matters.js', () => ({ getMatterById: vi.fn() }));
vi.mock('../db/queries/materials.js', () => ({ listMaterialsForMatter: vi.fn() }));
vi.mock('../db/queries/documents.js', () => ({ insertDocument: vi.fn(), updateDocumentCurrentVersion: vi.fn() }));
vi.mock('../db/queries/versions.js', () => ({ getNextVersionNumber: vi.fn(), insertVersion: vi.fn() }));
vi.mock('../conflicts/postureGate.js', () => ({ resolvePostureDraftingGate: vi.fn() }));
vi.mock('../db/queries/conflicts.js', () => ({ hasUndispositionedBlocker: vi.fn() }));

import { deedDraftAgentRouter, buildGiftDraft } from '../procedures/deedDraftAgent.js';
import { getMatterById } from '../db/queries/matters.js';
import { listMaterialsForMatter } from '../db/queries/materials.js';
import { insertDocument, updateDocumentCurrentVersion } from '../db/queries/documents.js';
import { getNextVersionNumber, insertVersion } from '../db/queries/versions.js';
import { resolvePostureDraftingGate } from '../conflicts/postureGate.js';
import { hasUndispositionedBlocker } from '../db/queries/conflicts.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const M1 = '22222222-2222-2222-2222-222222222222';
const caller = () => deedDraftAgentRouter.createCaller({ req: {} as Request, res: {} as Response, userId: U1 });

// synthetic gift packet (prior vesting deed -> the donors; a tax record)
const VESTING_DEED = [
  'THIS DEED, made this 2nd day of May, 2019, by and between Harold V. GREER, an unmarried man, (the "Grantor"), and Marcus T. ELLISON and',
  'Priya ELLISON, husband and wife, (the "Grantees"),',
  'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with General Warranty, unto the said Grantees, in fee simple, as tenants by the entirety with the right of survivorship, all that parcel located in',
  'Prince William County, Commonwealth of Virginia, to wit:',
  '   Lot 12, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
  '   BEING the same property conveyed unto Harold V. Greer by Deed in Deed Book 3000 at Page 100.',
  'This conveyance is made subject to covenants of record.',
  'Tax I.D. Number: 7298-44-1201',
].join('\n');
const TAX_RECORD = 'REAL ESTATE ASSESSMENT\nParcel No: 7298-44-1201\nTotal Assessed Value: $588,400.00';
const GIFT_LEGAL = 'Lot 12, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.';

const MATERIAL_ROWS = [
  { id: 'mat-vesting', textContent: VESTING_DEED },
  { id: 'mat-tax', textContent: TAX_RECORD },
];

function fullGift() {
  return {
    matterId: M1,
    grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Priya Ellison', descriptor: 'husband and wife' }],
    grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantors' daughter" }],
    fileNumber: '36-2026-7777',
    granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
    derivationReference: 'in Deed Book 5500 at Page 12',
  };
}

// ── pure helper ──────────────────────────────────────────────────────────────────

describe('buildGiftDraft (pure: consolidate + assemble)', () => {
  it('assembles the verbatim-legal gift draft from material rows', () => {
    const { facts, draft } = buildGiftDraft(MATERIAL_ROWS, {
      grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Priya Ellison', descriptor: 'husband and wife' }],
      grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantors' daughter" }],
      fileNumber: '36-2026-7777',
      granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
      derivationReference: 'in Deed Book 5500 at Page 12',
    });
    expect(facts.legalDescription.value).toBe(GIFT_LEGAL);
    expect(draft.verbatimLegalUsed).toBe(GIFT_LEGAL);
    expect(draft.text).toContain('DEED OF GIFT');
    expect(draft.text).toContain('grant and convey');
    expect(draft.factsResolved).toBe(true);
  });
});

// ── procedure: gates + persistence ───────────────────────────────────────────────

describe('deedDraftAgent.createGiftDraft — fail-closed gates + persistence', () => {
  const origDeed = process.env['DEED_DRAFT_AGENT_ENABLED'];
  const origConflict = process.env['CONFLICT_GATE_ENABLED'];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    delete process.env['CONFLICT_GATE_ENABLED'];
  });
  afterEach(() => {
    if (origDeed === undefined) delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    else process.env['DEED_DRAFT_AGENT_ENABLED'] = origDeed;
    if (origConflict === undefined) delete process.env['CONFLICT_GATE_ENABLED'];
    else process.env['CONFLICT_GATE_ENABLED'] = origConflict;
  });

  it('isEnabled reflects the flag', async () => {
    expect((await caller().isEnabled()).enabled).toBe(false);
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    expect((await caller().isEnabled()).enabled).toBe(true);
  });

  it('refuses (PRECONDITION_FAILED) when the flag is OFF — nothing is created', async () => {
    await expect(caller().createGiftDraft(fullGift())).rejects.toThrow(/DEED_DRAFT_AGENT_DISABLED/);
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('NOT_FOUND when the matter is not owned/absent', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(caller().createGiftDraft(fullGift())).rejects.toThrow(/Matter not found/);
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('fail-closed on the conflicts-at-intake gate (CONFLICT_GATE_ENABLED) — no document created', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    process.env['CONFLICT_GATE_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (resolvePostureDraftingGate as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, blockingReasons: ['no_client_party'] });
    await expect(caller().createGiftDraft(fullGift())).rejects.toThrow(/CONFLICTS_NOT_CLEARED/);
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('legacy conflicts gate (flag off): an undispositioned blocker blocks', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await expect(caller().createGiftDraft(fullGift())).rejects.toThrow(/CONFLICTS_BLOCKER_UNDISPOSITIONED/);
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('happy path: creates a "deed" document + a first version carrying the VERBATIM deed text', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (listMaterialsForMatter as ReturnType<typeof vi.fn>).mockResolvedValue(MATERIAL_ROWS.map((m) => ({ ...m })));
    (insertDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-1', documentType: 'deed', draftingMode: 'iterative', title: 'Deed of Gift' });
    (getNextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (insertVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ver-1', versionNumber: 1 });
    (updateDocumentCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-1' });

    const res = await caller().createGiftDraft(fullGift());

    // a 'deed' document is created in 'drafting' with NO version yet, then the version + current pointer:
    expect(insertDocument).toHaveBeenCalledWith(expect.objectContaining({ matterId: M1, documentType: 'deed', workflowState: 'drafting', currentVersionId: null }));
    const versionArg = (insertVersion as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(versionArg.documentId).toBe('doc-1');
    expect(versionArg.content).toContain(GIFT_LEGAL); // the verbatim legal is in the persisted version
    expect(versionArg.content).toContain('grant and convey');
    expect(updateDocumentCurrentVersion).toHaveBeenCalledWith('doc-1', U1, 'ver-1');
    expect(res.documentId).toBe('doc-1');
    expect(res.factsResolved).toBe(true);
    expect(res.placeholders).toEqual([]);
  });

  it('happy path with a missing fact: still creates the draft, surfaces placeholders, factsResolved=false', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (listMaterialsForMatter as ReturnType<typeof vi.fn>).mockResolvedValue(MATERIAL_ROWS.map((m) => ({ ...m })));
    (insertDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-2', documentType: 'deed', draftingMode: 'iterative', title: 'Deed of Gift' });
    (getNextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (insertVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ver-2', versionNumber: 1 });
    (updateDocumentCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-2' });

    const res = await caller().createGiftDraft({ ...fullGift(), fileNumber: null }); // no file number -> placeholder
    expect(res.factsResolved).toBe(false);
    expect(res.placeholders.some((p) => p.field === 'File number')).toBe(true);
    expect(insertDocument).toHaveBeenCalled(); // the draft IS created — the attorney fills the placeholder
  });
});
