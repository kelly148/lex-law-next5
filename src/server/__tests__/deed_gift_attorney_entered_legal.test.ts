/**
 * DEED-MANUAL-LEGAL-GIFT-1 (G1-G12 core) — the affirmation-gated attorney-entered gift legal description.
 *
 * The gift path is extraction-only by ratified invariant; the operator re-ratified an EXPRESS exception (G1) so
 * that, when the extracted legal is WITHHELD/absent, an attorney may paste it VERBATIM under a full G3 affirmation.
 * These tests lock the records-critical assembler core: G3 (affirmation gate), G4 (field-level provenance), G6
 * (distinct pending-verification state), G8 (byte-for-byte, no editing), and the B6 fail-closed floor. (Client UI,
 * persistence/audit-log migration, N1 non-gift provenance backfill, and N2 uniform affirmation are separate.)
 */
import { describe, it, expect } from 'vitest';
import { consolidateDeedSourceFacts, type DeedMaterialInput } from '../deed/deedSourceFacts.js';
import {
  assembleGiftDeed,
  isGiftLegalAffirmationValid,
  type GiftDeedInput,
  type GiftLegalAffirmation,
} from '../deed/deedGiftAssembler.js';

// A packet WITHOUT a readable vesting-deed legal (only a tax record) → the extracted legal is absent (null).
const TAX_ONLY: DeedMaterialInput[] = [
  {
    materialId: 'mat-tax',
    textContent: ['REAL ESTATE ASSESSMENT', 'Parcel No: 7298-44-1201', 'Total Assessed Value: $588,400.00'].join('\n'),
  },
];
// A packet WITH a verbatim vesting-deed legal (extraction present) — the proven-parsing Mason-form fixture.
const WITH_VESTING: DeedMaterialInput[] = [
  {
    materialId: 'mat-vesting',
    textContent: [
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
    ].join('\n'),
  },
];

const absentLegalFacts = consolidateDeedSourceFacts(TAX_ONLY);
const presentLegalFacts = consolidateDeedSourceFacts(WITH_VESTING);

function giftInput(over: Partial<GiftDeedInput> = {}): GiftDeedInput {
  return {
    grantors: [{ name: 'Marcus T. Ellison' }],
    grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantor's daughter" }],
    fileNumber: '36-2026-7777',
    granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
    locality: 'Prince William County',
    derivationReference: 'in Deed Book 5500 at Page 12',
    ...over,
  };
}

const fullAffirm: GiftLegalAffirmation = { verbatimFromSource: true, responsibleForAccuracy: true, describesSubjectProperty: true, affirmedAt: '2026-07-07T00:00:00Z' };
const PASTED = 'Lot 9, Block A, WILLOW GLEN, as recorded in Deed Book 4412 at Page 118, among the Land Records of Prince William County, Virginia.';

const legalPlaceholderPresent = (d: { placeholders: { field: string }[] }): boolean =>
  d.placeholders.some((p) => p.field === 'Legal description (VERBATIM)');

describe('G3 — the affirmation predicate', () => {
  it('requires ALL three prongs', () => {
    expect(isGiftLegalAffirmationValid(fullAffirm)).toBe(true);
    expect(isGiftLegalAffirmationValid({ ...fullAffirm, describesSubjectProperty: false })).toBe(false);
    expect(isGiftLegalAffirmationValid({ ...fullAffirm, verbatimFromSource: false })).toBe(false);
    expect(isGiftLegalAffirmationValid({ ...fullAffirm, responsibleForAccuracy: false })).toBe(false);
    expect(isGiftLegalAffirmationValid(undefined)).toBe(false);
  });
});

describe('DEED-MANUAL-LEGAL-GIFT-1 — attorney-entered gift legal', () => {
  it('no paste, absent extracted legal → [[ ]] placeholder, no provenance, not resolved (unchanged)', () => {
    const d = assembleGiftDeed(absentLegalFacts, giftInput());
    expect(legalPlaceholderPresent(d)).toBe(true);
    expect(d.verbatimLegalUsed).toBeNull();
    expect(d.legalDescriptionProvenance).toBeNull();
    expect(d.attorneyEnteredLegalPendingVerification).toBe(false);
    expect(d.factsResolved).toBe(false);
    expect(d.warnings).toContain('legal_description_unresolved');
  });

  it('paste WITHOUT affirmation → NOT used, placeholder stays, warned (G3)', () => {
    const d = assembleGiftDeed(absentLegalFacts, giftInput({ legalDescription: PASTED }));
    expect(legalPlaceholderPresent(d)).toBe(true);
    expect(d.verbatimLegalUsed).toBeNull();
    expect(d.legalDescriptionProvenance).toBeNull();
    expect(d.warnings).toContain('legal_paste_unaffirmed');
    expect(d.text).not.toContain(PASTED);
  });

  it('paste with a PARTIAL affirmation (one prong false) → NOT used (G3)', () => {
    const d = assembleGiftDeed(absentLegalFacts, giftInput({ legalDescription: PASTED, legalDescriptionAffirmation: { ...fullAffirm, describesSubjectProperty: false } }));
    expect(legalPlaceholderPresent(d)).toBe(true);
    expect(d.verbatimLegalUsed).toBeNull();
    expect(d.warnings).toContain('legal_paste_unaffirmed');
  });

  it('AFFIRMED paste on an absent extracted legal → used verbatim, provenance attorney_entered, pending, source captured (G3/G4/G5/G6)', () => {
    const d = assembleGiftDeed(absentLegalFacts, giftInput({ legalDescription: PASTED, legalDescriptionSource: 'DB 4412 PG 118', legalDescriptionAffirmation: fullAffirm }));
    expect(legalPlaceholderPresent(d)).toBe(false); // [[ ]] cleared
    expect(d.verbatimLegalUsed).toBe(PASTED);
    expect(d.text).toContain(PASTED);
    expect(d.legalDescriptionProvenance).toBe('attorney_entered');
    expect(d.attorneyEnteredLegalPendingVerification).toBe(true); // G6 distinct state
    expect(d.legalDescriptionSource).toBe('DB 4412 PG 118');
    expect(d.notes.join(' ')).toMatch(/ATTORNEY-ENTERED/);
    expect(d.warnings).not.toContain('legal_description_unresolved');
  });

  it('EXTRACTION wins over a paste — an extracted legal is used, provenance ocr_extracted, paste ignored', () => {
    const d = assembleGiftDeed(presentLegalFacts, giftInput({ legalDescription: PASTED, legalDescriptionAffirmation: fullAffirm }));
    expect(d.legalDescriptionProvenance).toBe('ocr_extracted');
    expect(d.attorneyEnteredLegalPendingVerification).toBe(false);
    expect(d.verbatimLegalUsed).toContain('CEDAR RUN ESTATES');
    expect(d.text).not.toContain(PASTED);
  });

  it('G8 — an affirmed paste is inserted BYTE-FOR-BYTE (no normalization)', () => {
    const odd = 'Lot 7,  Block   C,\nODD  spacing & a call N 12°34\'56" E 100.00 ft, DB 100 PG 1.';
    const d = assembleGiftDeed(absentLegalFacts, giftInput({ legalDescription: odd, legalDescriptionAffirmation: fullAffirm }));
    expect(d.verbatimLegalUsed).toBe(odd); // exactly as entered
  });

  it('B6 fail-closed — an affirmed paste containing a stray marker (TODO) still fails the recordability floor', () => {
    const bad = 'Lot 3, Block B, TODO verify the plat reference, Prince William County, Virginia.';
    const d = assembleGiftDeed(absentLegalFacts, giftInput({ legalDescription: bad, legalDescriptionAffirmation: fullAffirm }));
    expect(d.legalDescriptionProvenance).toBe('attorney_entered'); // it WAS used…
    expect(d.b6.ok).toBe(false); // …but the marker trips B6
    expect(d.factsResolved).toBe(false); // fail-closed: not recordable
  });
});
