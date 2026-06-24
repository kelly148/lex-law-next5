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

import { deedDraftAgentRouter, buildGiftDraft } from '../procedures/deedDraftAgent.js';
import { buildGiftDrafterNotes } from '../deed/deedGiftNotes.js';
import { getMatterById } from '../db/queries/matters.js';
import { listMaterialsForMatter } from '../db/queries/materials.js';
import { insertDocument, updateDocumentCurrentVersion, updateDocumentNotes, getDocumentById } from '../db/queries/documents.js';
import { getNextVersionNumber, insertVersion, getLatestVersionForDocument } from '../db/queries/versions.js';
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

    // Inc 2: the deterministic drafter's notes are returned AND stored in the document NOTES field (delete
    // before recording) — NOT in the recordable version content (B6 stays clean).
    expect(res.drafterNotes.length).toBeGreaterThan(0);
    expect(res.drafterNotes.some((n) => n.category === 'exemption')).toBe(true);
    const docArg = (insertDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(docArg.notes).toContain("DRAFTER'S NOTES — DELETE BEFORE RECORDING");
    expect(versionArg.content).not.toContain("DRAFTER'S NOTES"); // notes are not in the deed body
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

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// Inc 4 — the refine loop (regenerateDeedDraft): a NEW VERSION on the EXISTING document honoring the revised
// input, verbatim legal preserved, notes re-spotted, same fail-closed gates. (Reuses the version path; the
// version history IS the refine-loop provenance.)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('Inc 4 — refine loop: the pure regenerate core (verbatim legal survives; notes re-spot)', () => {
  it('regenerating with a revised warranty preserves the verbatim legal AND re-spots the warranty note', () => {
    const general = buildGiftDraft(MATERIAL_ROWS, { grantors: fullGift().grantors, grantees: fullGift().grantees, fileNumber: '36-2026-7777', granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109', derivationReference: 'in Deed Book 5500 at Page 12' });
    const special = buildGiftDraft(MATERIAL_ROWS, { grantors: fullGift().grantors, grantees: fullGift().grantees, warranty: 'Special Warranty', fileNumber: '36-2026-7777', granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109', derivationReference: 'in Deed Book 5500 at Page 12' });
    // verbatim legal identical across the regeneration:
    expect(general.draft.verbatimLegalUsed).toBe(GIFT_LEGAL);
    expect(special.draft.verbatimLegalUsed).toBe(GIFT_LEGAL);
    // the applied warranty changed (the attorney's adopt decision expressed as a revised input):
    expect(general.draft.warranty).not.toBe(special.draft.warranty);
    expect(special.draft.warranty).toBe('Special Warranty');
    // the re-spotted notes reflect the revised warranty:
    const notes = buildGiftDrafterNotes(special.facts, { grantors: fullGift().grantors, grantees: fullGift().grantees, warranty: 'Special Warranty' }, special.draft);
    expect(notes.notes.find((n) => n.category === 'warranty')?.text).toContain('Special Warranty');
  });
});

describe('deedDraftAgent.regenerateDeedDraft — fail-closed gates + a new version on the existing doc', () => {
  const origDeed = process.env['DEED_DRAFT_AGENT_ENABLED'];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    delete process.env['CONFLICT_GATE_ENABLED'];
  });
  afterEach(() => {
    if (origDeed === undefined) delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    else process.env['DEED_DRAFT_AGENT_ENABLED'] = origDeed;
  });

  const DOC = '33333333-3333-3333-3333-333333333333';
  function regenInput(over: Record<string, unknown> = {}) {
    return { documentId: DOC, ...fullGift(), ...over };
  }

  it('flag OFF -> PRECONDITION_FAILED (DEED_DRAFT_AGENT_DISABLED); no version added', async () => {
    await expect(caller().regenerateDeedDraft(regenInput())).rejects.toThrow(/DEED_DRAFT_AGENT_DISABLED/);
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('NOT_FOUND when the target document is not owned/absent', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (getDocumentById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(caller().regenerateDeedDraft(regenInput())).rejects.toThrow(/Document not found/);
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('rejects a non-deed document type (NOT_A_DEED_DOCUMENT)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (getDocumentById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: DOC, matterId: M1, documentType: 'engagement_letter', archivedAt: null, workflowState: 'drafting' });
    await expect(caller().regenerateDeedDraft(regenInput())).rejects.toThrow(/NOT_A_DEED_DOCUMENT/);
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('rejects a document that belongs to a different matter (DOCUMENT_MATTER_MISMATCH)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (getDocumentById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: DOC, matterId: 'other-matter', documentType: 'deed', archivedAt: null, workflowState: 'drafting' });
    await expect(caller().regenerateDeedDraft(regenInput())).rejects.toThrow(/DOCUMENT_MATTER_MISMATCH/);
    expect(insertVersion).not.toHaveBeenCalled();
  });

  // FIX 1 — the DRAFTING-ONLY gate: a document past drafting (or archived) must REJECT, so a regenerate can
  // never add a version / repoint currentVersionId onto an accepted/official/archived version.
  it.each([
    ['substantively_accepted', { workflowState: 'substantively_accepted', archivedAt: null }, /DOCUMENT_NOT_DRAFTING/],
    ['finalizing', { workflowState: 'finalizing', archivedAt: null }, /DOCUMENT_NOT_DRAFTING/],
    ['complete', { workflowState: 'complete', archivedAt: null }, /DOCUMENT_NOT_DRAFTING/],
    ['archived (archivedAt set)', { workflowState: 'drafting', archivedAt: new Date() }, /DOCUMENT_ARCHIVED/],
  ])('rejects a %s document (no version added)', async (_label, docState, errRe) => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (getDocumentById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: DOC, matterId: M1, documentType: 'deed', ...docState });
    await expect(caller().regenerateDeedDraft(regenInput())).rejects.toThrow(errRe);
    expect(insertVersion).not.toHaveBeenCalled();
    expect(updateDocumentCurrentVersion).not.toHaveBeenCalled();
  });

  it('happy path: adds a NEW VERSION (versionNumber + iterationNumber incremented), preserves verbatim legal, re-spots notes', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (getDocumentById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: DOC, matterId: M1, documentType: 'deed', archivedAt: null, workflowState: 'drafting' });
    (listMaterialsForMatter as ReturnType<typeof vi.fn>).mockResolvedValue(MATERIAL_ROWS.map((m) => ({ ...m })));
    (getLatestVersionForDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ver-1', versionNumber: 1, iterationNumber: 1 });
    (getNextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(2);
    (insertVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ver-2', versionNumber: 2 });
    (updateDocumentCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: DOC });
    (updateDocumentNotes as ReturnType<typeof vi.fn>).mockResolvedValue({ id: DOC });

    // the attorney ADOPTS the warranty note by revising the input to Special Warranty:
    const res = await caller().regenerateDeedDraft(regenInput({ warranty: 'Special Warranty' }));

    // a NEW version was added to the EXISTING document — NO new document was created:
    expect(insertDocument).not.toHaveBeenCalled();
    const versionArg = (insertVersion as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(versionArg.documentId).toBe(DOC);
    expect(versionArg.versionNumber).toBe(2); // incremented
    expect(versionArg.iterationNumber).toBe(2); // incremented (refine-loop provenance)
    expect(versionArg.content).toContain(GIFT_LEGAL); // VERBATIM legal survives the regeneration
    expect(versionArg.content).toContain('grant and convey');
    expect(versionArg.content).toContain('Special Warranty'); // the adopted decision is in the new body
    expect(updateDocumentCurrentVersion).toHaveBeenCalledWith(DOC, U1, 'ver-2');
    // the document notes were REFRESHED with the re-spotted notes (NOT a new document's notes):
    const notesArg = (updateDocumentNotes as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(notesArg?.[0]).toBe(DOC);
    expect(notesArg?.[2]).toContain("DRAFTER'S NOTES — DELETE BEFORE RECORDING");
    expect(notesArg?.[2]).toContain('Special Warranty'); // notes re-spotted to the revised input
    expect(res.versionNumber).toBe(2);
    expect(res.iterationNumber).toBe(2);
    expect(res.warranty).toBe('Special Warranty');
  });

  it('first regeneration of a doc with no prior version starts iterationNumber at 1', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (getDocumentById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: DOC, matterId: M1, documentType: 'deed', archivedAt: null, workflowState: 'drafting' });
    (listMaterialsForMatter as ReturnType<typeof vi.fn>).mockResolvedValue(MATERIAL_ROWS.map((m) => ({ ...m })));
    (getLatestVersionForDocument as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getNextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (insertVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ver-x', versionNumber: 1 });
    (updateDocumentCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: DOC });
    (updateDocumentNotes as ReturnType<typeof vi.fn>).mockResolvedValue({ id: DOC });

    const res = await caller().regenerateDeedDraft(regenInput());
    expect(res.iterationNumber).toBe(1);
  });
});
