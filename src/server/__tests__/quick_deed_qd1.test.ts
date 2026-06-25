/**
 * DEED-DRAFT-AGENT-1 QUICK DEED (QD-1) — the quickDeed router.
 *
 * The fast-lane surface backend: quickDeed.create auto-creates a lightweight owning matter; quickDeed.generate
 * reuses the EXACT gift core but BYPASSES the conflicts-at-intake gate (Quick Deed default-OFF, spec §5) and
 * stamps the non-blocking "No conflicts check performed (Quick Deed mode)." note into the existing free-text
 * document notes. v1 dispatches ONLY the Deed of Gift; any other registry key is rejected. Same DB/gate-leaf
 * mocking style as deed_draft_agent_inc1c.test.ts. Flag state is driven by env (the real feature-flag read).
 *
 * Also a REGRESSION on createGiftDraft: its conflicts gate is still ENFORCED (the bypass is Quick-Deed-only).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

// ── mock the DB/gate leaves (the pure assembler modules are NOT mocked) ──
vi.mock('../db/queries/matters.js', () => ({ getMatterById: vi.fn(), insertMatter: vi.fn() }));
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
// QD-2: generate now reads the firm toggle via the query layer; mock it to the default (toggle OFF) so QD-1's
// conflicts-bypassed assertions still hold (deedConflictsEnforced:false === QD-1's default-OFF behavior).
vi.mock('../db/queries/conflictPolicy.js', () => ({ getFirmConflictPolicy: vi.fn(), setFirmConflictPolicy: vi.fn() }));

import {
  quickDeedRouter,
  deedDraftAgentRouter,
  QUICK_DEED_NO_CONFLICTS_NOTE,
} from '../procedures/deedDraftAgent.js';
import { getMatterById, insertMatter } from '../db/queries/matters.js';
import { listMaterialsForMatter } from '../db/queries/materials.js';
import { insertDocument, updateDocumentCurrentVersion } from '../db/queries/documents.js';
import { getNextVersionNumber, insertVersion } from '../db/queries/versions.js';
import { resolvePostureDraftingGate } from '../conflicts/postureGate.js';
import { hasUndispositionedBlocker } from '../db/queries/conflicts.js';
import { getFirmConflictPolicy } from '../db/queries/conflictPolicy.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const M1 = '22222222-2222-2222-2222-222222222222';
const quick = () => quickDeedRouter.createCaller({ req: {} as Request, res: {} as Response, userId: U1 });
const agent = () => deedDraftAgentRouter.createCaller({ req: {} as Request, res: {} as Response, userId: U1 });

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

function fullGenerate(over: Record<string, unknown> = {}) {
  return {
    matterId: M1,
    deedType: 'deed_of_gift',
    grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Priya Ellison', descriptor: 'husband and wife' }],
    grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantors' daughter" }],
    fileNumber: '36-2026-7777',
    granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
    derivationReference: 'in Deed Book 5500 at Page 12',
    ...over,
  };
}

const origDeed = process.env['DEED_DRAFT_AGENT_ENABLED'];
const origConflict = process.env['CONFLICT_GATE_ENABLED'];

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env['DEED_DRAFT_AGENT_ENABLED'];
  delete process.env['CONFLICT_GATE_ENABLED'];
  // QD-2 default: the firm toggle is OFF (deedConflictsEnforced:false) -> QD-1's conflicts-bypassed behavior.
  (getFirmConflictPolicy as ReturnType<typeof vi.fn>).mockResolvedValue({
    policy: { schemaVersion: 1, transactionalPosture: 'ENFORCED', deedConflictsEnforced: false },
    source: 'default',
  });
});
afterEach(() => {
  if (origDeed === undefined) delete process.env['DEED_DRAFT_AGENT_ENABLED'];
  else process.env['DEED_DRAFT_AGENT_ENABLED'] = origDeed;
  if (origConflict === undefined) delete process.env['CONFLICT_GATE_ENABLED'];
  else process.env['CONFLICT_GATE_ENABLED'] = origConflict;
});

describe('quickDeed.listDeedTypes', () => {
  it('listDeedTypes refuses when the flag is OFF', async () => {
    await expect(quick().listDeedTypes()).rejects.toThrow(/DEED_DRAFT_AGENT_DISABLED/);
  });

  it('listDeedTypes returns the registry with gift + seller-side wired for generation', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    const types = await quick().listDeedTypes();
    const gift = types.find((t) => t.key === 'deed_of_gift');
    const seller = types.find((t) => t.key === 'seller_side');
    expect(gift?.quickDeedGenerates).toBe(true);
    expect(seller?.quickDeedGenerates).toBe(true); // seller-side is now wired for Quick Deed generation
    // every OTHER registered type is listed but NOT wired for generation
    const wired = new Set(['deed_of_gift', 'seller_side']);
    expect(types.filter((t) => !wired.has(t.key)).every((t) => t.quickDeedGenerates === false)).toBe(true);
    expect(types.length).toBeGreaterThan(2); // the surface enumerates the whole built set
  });
});

describe('quickDeed.create — auto-creates the lightweight owning matter', () => {
  it('refuses (DEED_DRAFT_AGENT_DISABLED) when the flag is OFF — no matter inserted', async () => {
    await expect(quick().create()).rejects.toThrow(/DEED_DRAFT_AGENT_DISABLED/);
    expect(insertMatter).not.toHaveBeenCalled();
  });

  it('flag ON: inserts a matter titled "Quick Deed — YYYY-MM-DD" and returns its id', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (insertMatter as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1 });
    const res = await quick().create();
    expect(res.matterId).toBe(M1);
    expect(insertMatter).toHaveBeenCalledTimes(1);
    const arg = (insertMatter as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg.userId).toBe(U1);
    expect(arg.title).toMatch(/^Quick Deed — \d{4}-\d{2}-\d{2}$/);
  });
});

describe('quickDeed.generate — gift-only, conflicts BYPASSED, stamp in notes', () => {
  it('flag OFF -> DEED_DRAFT_AGENT_DISABLED; no document created', async () => {
    await expect(quick().generate(fullGenerate())).rejects.toThrow(/DEED_DRAFT_AGENT_DISABLED/);
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('NOT_FOUND when the matter is not owned/absent', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(quick().generate(fullGenerate())).rejects.toThrow(/Matter not found/);
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('rejects a registered-but-unwired deed type with QUICK_DEED_TYPE_NOT_WIRED', async () => {
    // (seller_side is now wired, so a still-unwired registered key is used as the example here.)
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    await expect(quick().generate(fullGenerate({ deedType: 'deed_into_llc' }))).rejects.toThrow(
      /QUICK_DEED_TYPE_NOT_WIRED: deed_into_llc is registered but not yet wired/,
    );
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized deed type with QUICK_DEED_TYPE_NOT_WIRED (not recognized)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    await expect(quick().generate(fullGenerate({ deedType: 'made_up_type' }))).rejects.toThrow(
      /QUICK_DEED_TYPE_NOT_WIRED: made_up_type is not a recognized deed type/,
    );
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('BYPASSES the conflicts gate: an undispositioned blocker does NOT block (legacy gate not consulted)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    // even if a blocker would exist, Quick Deed must NOT consult it
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (listMaterialsForMatter as ReturnType<typeof vi.fn>).mockResolvedValue(MATERIAL_ROWS.map((m) => ({ ...m })));
    (insertDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-q', documentType: 'deed' });
    (getNextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (insertVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ver-q', versionNumber: 1 });
    (updateDocumentCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-q' });

    const res = await quick().generate(fullGenerate());

    expect(res.documentId).toBe('doc-q');
    expect(hasUndispositionedBlocker).not.toHaveBeenCalled();
    expect(resolvePostureDraftingGate).not.toHaveBeenCalled();
    expect(insertDocument).toHaveBeenCalled();
  });

  it('BYPASSES the conflicts gate even when CONFLICT_GATE_ENABLED is ON (posture gate not consulted)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    process.env['CONFLICT_GATE_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (resolvePostureDraftingGate as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, blockingReasons: ['no_client_party'] });
    (listMaterialsForMatter as ReturnType<typeof vi.fn>).mockResolvedValue(MATERIAL_ROWS.map((m) => ({ ...m })));
    (insertDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-q2', documentType: 'deed' });
    (getNextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (insertVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ver-q2', versionNumber: 1 });
    (updateDocumentCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-q2' });

    const res = await quick().generate(fullGenerate());
    expect(res.documentId).toBe('doc-q2');
    expect(resolvePostureDraftingGate).not.toHaveBeenCalled();
  });

  it('happy path: creates a deed doc + version with VERBATIM legal, stamps the no-conflicts note in document notes', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (listMaterialsForMatter as ReturnType<typeof vi.fn>).mockResolvedValue(MATERIAL_ROWS.map((m) => ({ ...m })));
    (insertDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-3', documentType: 'deed' });
    (getNextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (insertVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ver-3', versionNumber: 1 });
    (updateDocumentCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-3' });

    const res = await quick().generate(fullGenerate());

    // a 'deed' document is created in 'drafting' with NO version yet, then the version + current pointer:
    expect(insertDocument).toHaveBeenCalledWith(
      expect.objectContaining({ matterId: M1, documentType: 'deed', workflowState: 'drafting', currentVersionId: null }),
    );
    const docArg = (insertDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    // the conflicts-bypass stamp is in the EXISTING free-text notes field (schema-free):
    expect(docArg.notes).toContain(QUICK_DEED_NO_CONFLICTS_NOTE);
    // the drafter's notes / delete-before-recording page is still present (gift core reused unchanged):
    expect(docArg.notes).toContain("DRAFTER'S NOTES — DELETE BEFORE RECORDING");

    const versionArg = (insertVersion as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(versionArg.documentId).toBe('doc-3');
    expect(versionArg.content).toContain(GIFT_LEGAL); // verbatim legal persisted
    expect(versionArg.content).toContain('grant and convey');
    expect(versionArg.content).not.toContain(QUICK_DEED_NO_CONFLICTS_NOTE); // stamp is in notes, not the deed body
    expect(updateDocumentCurrentVersion).toHaveBeenCalledWith('doc-3', U1, 'ver-3');

    expect(res.documentId).toBe('doc-3');
    expect(res.matterId).toBe(M1);
    // LOCKSTEP: the return reports the ACTUAL gate outcome, and it matches the stamp that was written.
    expect(res.conflictsBypassed).toBe(true);
    expect(res.conflictsChecked).toBe(false);
    expect(res.conflictsChecked).toBe(!res.conflictsBypassed);
    expect(res.factsResolved).toBe(true);
    expect(res.placeholders).toEqual([]);
  });

  it('LOCKSTEP: the no-conflicts stamp is present IFF the return reports conflictsBypassed', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (listMaterialsForMatter as ReturnType<typeof vi.fn>).mockResolvedValue(MATERIAL_ROWS.map((m) => ({ ...m })));
    (insertDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-ls', documentType: 'deed' });
    (getNextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (insertVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ver-ls', versionNumber: 1 });
    (updateDocumentCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-ls' });

    const res = await quick().generate(fullGenerate());
    const docArg = (insertDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    // The stamp's presence in the persisted notes equals the returned conflictsBypassed flag — one source.
    expect(docArg.notes.includes(QUICK_DEED_NO_CONFLICTS_NOTE)).toBe(res.conflictsBypassed);
  });
});

// ── Quick Deed multi-category dispatch: seller-side now generates (the first non-gift category) ──
describe('quickDeed.generate — seller-side dispatch (wired)', () => {
  // A complete seller-side generate: shared party/grantee-address at the top level; the new-transaction facts
  // nested under sellerSide. The doc-derived legal/taxId/locality/assessedValue default from MATERIAL_ROWS.
  function fullSellerGenerate(over: Record<string, unknown> = {}) {
    return {
      matterId: M1,
      deedType: 'seller_side',
      grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Priya Ellison' }],
      grantees: [{ name: 'Daniel Wong' }],
      granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
      sellerSide: {
        warrantyType: 'Special Warranty',
        considerationFigs: '$612,000.00',
        amountWords: 'SIX HUNDRED TWELVE THOUSAND AND 00/100',
        titleInsurer: 'STEWART TITLE GUARANTY COMPANY',
        grantorDescriptor: 'a married couple',
        tenancy: 'as sole owner',
        vestingRecital:
          'BEING the same property conveyed unto Marcus T. Ellison and Priya Ellison by Deed recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
        venue: 'COUNTY OF PRINCE WILLIAM',
        returnTo: 'Universal Title',
        sellerType: 'individual' as const,
        fileNumber: '26-00091-K',
      },
      ...over,
    };
  }

  it('happy path: dispatches the seller-side core, persists a deed doc/version with VERBATIM legal + the stamp', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (listMaterialsForMatter as ReturnType<typeof vi.fn>).mockResolvedValue(MATERIAL_ROWS.map((m) => ({ ...m })));
    (insertDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-s', documentType: 'deed' });
    (getNextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (insertVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ver-s', versionNumber: 1 });
    (updateDocumentCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-s' });

    const res = await quick().generate(fullSellerGenerate());

    expect(res.failedClosed).toBe(false);
    expect(res.documentId).toBe('doc-s');
    expect(res.recordableFloorOk).not.toBeNull(); // a seller-side-specific result field

    const docArg = (insertDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(docArg.documentType).toBe('deed');
    expect(docArg.notes).toContain(QUICK_DEED_NO_CONFLICTS_NOTE); // stamp threaded into the seller-side notes

    const verArg = (insertVersion as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(verArg.content).toContain(GIFT_LEGAL); // verbatim legal resolved from the uploaded vesting deed
    expect(verArg.content).toContain('Daniel Wong'); // the new grantee (buyer)
    expect(verArg.content).not.toContain(QUICK_DEED_NO_CONFLICTS_NOTE); // stamp is in notes, not the deed body
    expect(updateDocumentCurrentVersion).toHaveBeenCalledWith('doc-s', U1, 'ver-s');
  });

  it('fails CLOSED (no void deed) when the only legal available is truncated — documentId null, no persist', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    const truncated = VESTING_DEED.replace(
      'among the Land Records of Prince William County, Virginia.',
      'among the',
    );
    (listMaterialsForMatter as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'mat-vesting', textContent: truncated },
      { id: 'mat-tax', textContent: TAX_RECORD },
    ]);

    const res = await quick().generate(fullSellerGenerate());

    expect(res.failedClosed).toBe(true);
    expect(res.documentId).toBeNull();
    expect(res.failures.some((f: string) => /truncat/i.test(f))).toBe(true);
    expect(insertDocument).not.toHaveBeenCalled();
  });
});

// ── REGRESSION: createGiftDraft's conflicts gate is UNCHANGED (the bypass is Quick-Deed-only) ──
describe('createGiftDraft regression — its conflicts gate is still ENFORCED (bypass is Quick-Deed-only)', () => {
  function fullGift(over: Record<string, unknown> = {}) {
    return {
      matterId: M1,
      grantors: [{ name: 'Marcus T. Ellison' }],
      grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantors' daughter" }],
      fileNumber: '36-2026-7777',
      granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
      derivationReference: 'in Deed Book 5500 at Page 12',
      ...over,
    };
  }

  it('an undispositioned blocker STILL blocks createGiftDraft (legacy gate enforced) — no document created', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await expect(agent().createGiftDraft(fullGift())).rejects.toThrow(/CONFLICTS_BLOCKER_UNDISPOSITIONED/);
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('the affirmative posture gate STILL blocks createGiftDraft when CONFLICT_GATE_ENABLED is ON', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    process.env['CONFLICT_GATE_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (resolvePostureDraftingGate as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, blockingReasons: ['no_client_party'] });
    await expect(agent().createGiftDraft(fullGift())).rejects.toThrow(/CONFLICTS_NOT_CLEARED/);
    expect(resolvePostureDraftingGate).toHaveBeenCalled();
    expect(insertDocument).not.toHaveBeenCalled();
  });
});
