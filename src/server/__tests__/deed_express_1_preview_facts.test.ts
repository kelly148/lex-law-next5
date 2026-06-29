/**
 * deed_express_1_preview_facts.test.ts — DEED-EXPRESS-1 (inc1, Gift).
 *
 * The Express flow auto-seeds the new-deed GRANTOR from the prior deed's grantee of record (= the current owner =
 * the donor on a gift). `quickDeed.previewFacts` now additively surfaces that value as `granteeOfRecord` plus a
 * `resolved.granteeOfRecord` transparency flag, so the client can PRE-FILL it flagged "confirm grantor" — never
 * silently authoritative. This is ADDITIVE: it does NOT change the reconciliation-only consolidation semantics
 * (#19); it just surfaces the already-consolidated value. The model still never authors the legal description.
 *
 * The procedure is exercised through a tRPC caller with only the materials leaf mocked; consolidateDeedSourceFacts
 * runs for real. We assert previewFacts faithfully maps the consolidated grantee-of-record value through —
 * present (a single, unambiguous prior owner) and null (no prior grantee named) — and that it is flag-gated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../db/queries/materials.js', () => ({ listMaterialsForMatter: vi.fn() }));

import { quickDeedRouter } from '../procedures/deedDraftAgent.js';
import { consolidateDeedSourceFacts } from '../deed/deedSourceFacts.js';
import { listMaterialsForMatter } from '../db/queries/materials.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const M1 = '22222222-2222-2222-2222-222222222222';
const caller = () => quickDeedRouter.createCaller({ req: {} as Request, res: {} as Response, userId: U1 });
const listMock = listMaterialsForMatter as unknown as ReturnType<typeof vi.fn>;

// A prior vesting deed naming a SINGLE grantee of record = the current owner = the presumptive new-deed grantor.
// Structurally faithful to the Mason form (mirrors the gift-assembler PACKET fixture) so the legal resolves too.
const SINGLE_GRANTEE_VESTING = [
  'THIS DEED, made this 2nd day of May, 2019, by and between Harold V. GREER, an unmarried man, (the "Grantor"), and Marcus T. ELLISON, an unmarried man, (the "Grantee"),',
  'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with General Warranty and English Covenants of title,',
  'unto the said Grantee, in fee simple, as sole owner, all that parcel located in',
  'Prince William County, Commonwealth of Virginia, to wit:',
  '   Lot 12, Section 3, CEDAR RUN ESTATES, as the same appears duly dedicated, platted and',
  '   recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
  '   BEING the same property conveyed unto Harold V. Greer by Deed dated June 1, 2001, recorded in Deed Book 3000 at Page 100.',
  'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
  'Tax I.D. Number: 7298-44-1201',
].join('\n');

// A prior vesting deed naming a MARRIED COUPLE as grantees of record (the canonical VA residential gift: the
// couple are the current owners / donors). granteeOfRecord.value is null for 2+ owners (honesty floor); the names
// live in granteeOfRecord.values — so granteeOfRecordNames is what lets the Express flow seed both grantors.
const COUPLE_GRANTEE_VESTING = [
  'THIS DEED, made this 2nd day of May, 2019, by and between Harold V. GREER, an unmarried man, (the "Grantor"), and Marcus T. ELLISON and',
  'Priya ELLISON, husband and wife, (the "Grantees"),',
  'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with General Warranty and English Covenants of title,',
  'unto the said Grantees, in fee simple, as tenants by the entirety with the right of survivorship, all that parcel located in',
  'Prince William County, Commonwealth of Virginia, to wit:',
  '   Lot 12, Section 3, CEDAR RUN ESTATES, as the same appears duly dedicated, platted and',
  '   recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
  '   BEING the same property conveyed unto Harold V. Greer by Deed dated June 1, 2001, recorded in Deed Book 3000 at Page 100.',
  'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
  'Tax I.D. Number: 7298-44-1201',
].join('\n');

const TAX_RECORD = ['REAL ESTATE ASSESSMENT', 'Parcel No: 7298-44-1201', 'Total Assessed Value: $588,400.00'].join('\n');

describe('quickDeed.previewFacts — DEED-EXPRESS-1 grantee-of-record surfacing', () => {
  const orig = process.env['DEED_DRAFT_AGENT_ENABLED'];
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
  });
  afterEach(() => {
    if (orig === undefined) delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    else process.env['DEED_DRAFT_AGENT_ENABLED'] = orig;
  });

  it('surfaces granteeOfRecord + granteeOfRecordNames + grantorOfRecord when the prior deed names a (single) grantee', async () => {
    const materials = [
      { id: 'mat-vesting', textContent: SINGLE_GRANTEE_VESTING },
      { id: 'mat-tax', textContent: TAX_RECORD },
    ];
    listMock.mockResolvedValue(materials);
    const facts = consolidateDeedSourceFacts(materials.map((m) => ({ materialId: m.id, textContent: m.textContent })));
    // Precondition: this fixture yields a single, non-null grantee of record (exercises the populated path).
    expect(facts.granteeOfRecord.value).not.toBeNull();

    const res = await caller().previewFacts({ matterId: M1 });
    expect(res.granteeOfRecord).toBe(facts.granteeOfRecord.value); // single consolidated value = the presumptive grantor
    expect(res.granteeOfRecordNames).toEqual(facts.granteeOfRecord.values); // the seed source (one name here)
    expect(res.grantorOfRecord).toBe(facts.grantorOfRecord.value); // display-only context (the prior deed's grantor)
    expect(res.resolved.granteeOfRecord).toBe(true);
    // The additive fields do not disturb the existing resolution transparency. The fixture is structurally complete,
    // so the legal + locality both resolve (a concrete check, not a recomputation of the production formula).
    expect(res.resolved.legalDescription).toBe(true);
    expect(res.resolved.locality).toBe(true);
  });

  it('surfaces BOTH names in granteeOfRecordNames for a married-couple prior deed (granteeOfRecord.value is null)', async () => {
    const materials = [
      { id: 'mat-vesting', textContent: COUPLE_GRANTEE_VESTING },
      { id: 'mat-tax', textContent: TAX_RECORD },
    ];
    listMock.mockResolvedValue(materials);
    const facts = consolidateDeedSourceFacts(materials.map((m) => ({ materialId: m.id, textContent: m.textContent })));
    // Precondition: 2 owners → single value is null, the names live in .values (the seed source).
    expect(facts.granteeOfRecord.value).toBeNull();
    expect(facts.granteeOfRecord.values.length).toBe(2);

    const res = await caller().previewFacts({ matterId: M1 });
    expect(res.granteeOfRecord).toBeNull(); // single value null for a couple
    expect(res.granteeOfRecordNames).toEqual(facts.granteeOfRecord.values); // BOTH owners surfaced for seeding
    expect(res.granteeOfRecordNames.length).toBe(2);
    expect(res.resolved.granteeOfRecord).toBe(true); // a prior grantee WAS surfaced (multi-owner) → seed available
  });

  it('returns empty granteeOfRecordNames + null granteeOfRecord/grantorOfRecord when the packet names no prior grantee', async () => {
    const materials = [{ id: 'mat-tax', textContent: TAX_RECORD }]; // tax record only — no vesting deed, no parties
    listMock.mockResolvedValue(materials);
    const res = await caller().previewFacts({ matterId: M1 });
    expect(res.granteeOfRecord).toBeNull();
    expect(res.granteeOfRecordNames).toEqual([]);
    expect(res.grantorOfRecord).toBeNull();
    expect(res.resolved.granteeOfRecord).toBe(false);
  });

  it('is flag-gated: fails closed (PRECONDITION_FAILED) when DEED_DRAFT_AGENT_ENABLED is off', async () => {
    delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    listMock.mockResolvedValue([]);
    await expect(caller().previewFacts({ matterId: M1 })).rejects.toThrow(/DEED_DRAFT_AGENT_DISABLED/);
  });
});
