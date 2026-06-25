/**
 * deed_quick_intake_l1.test.ts — DEED-DRAFT-AGENT-1 Quick Deed LAYER 1 (E1) acceptance bar.
 *
 * The operator's "stop making me re-type" UAT, encoded as a durable deterministic test: run the REAL pipeline
 * (extractDeedIngest -> consolidateDeedSourceFacts -> assembleGiftDeed) over a single uploaded vesting deed + a
 * tax record, and assert the document-derived facts (legal, locality, tax id, assessed value, AND the grantee's
 * address — defaulted to the property situs per the operator rule) RESOLVE into the gift draft instead of being
 * re-typed. The only remaining [[ ]] placeholders are the genuinely attorney-supplied facts (the Mason file
 * number, and the derivation/"Being" reference the attorney confirms — a deed body never carries its own
 * recording stamp). Synthetic, PII-free text.
 */
import { describe, it, expect } from 'vitest';
import { consolidateDeedSourceFacts, type DeedMaterialInput } from '../deed/deedSourceFacts.js';
import { assembleGiftDeed, type GiftDeedInput } from '../deed/deedGiftAssembler.js';
import { extractDeedIngest } from '../deed/deedIngestExtract.js';

// ── synthetic packet: the donor's prior vesting deed + the locality tax record ──────────────────────────────
const VESTING_DEED = [
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

const SITUS = '4120 Cedar Run Lane, Manassas, VA 20109';
const TAX_RECORD = [
  'REAL ESTATE ASSESSMENT',
  'Parcel No: 7298-44-1201',
  `Property Address: ${SITUS}`,
  'Land Value: $120,000.00',
  'Improvement Value: $468,400.00',
  'Total Assessed Value: $588,400.00',
].join('\n');

const PACKET: DeedMaterialInput[] = [
  { materialId: 'mat-vesting', textContent: VESTING_DEED },
  { materialId: 'mat-tax', textContent: TAX_RECORD },
];

/** A MINIMAL gift input: only the irreducible attorney facts (donor + donee identities). Everything else the
 *  document supplies must come from the extracted facts — that is the Layer-1 contract. */
function minimalGift(): GiftDeedInput {
  return {
    grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Priya Ellison', descriptor: 'husband and wife' }],
    grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantors' daughter" }],
  };
}

describe('Quick Deed Layer 1 (E1) — property (situs) address extraction', () => {
  it('extractDeedIngest surfaces the labeled situs from the tax record (verbatim)', () => {
    const r = extractDeedIngest(TAX_RECORD);
    expect(r.docType).toBe('tax_record');
    const addr = r.fields.find((f) => f.key === 'propertyAddress');
    expect(addr?.value).toBe(SITUS);
    expect(addr?.withheld).toBe(false);
  });

  it('a tax record with NO labeled situs surfaces no property address (honesty floor; never guessed)', () => {
    const noSitus = TAX_RECORD.split('\n').filter((l) => !l.startsWith('Property Address:')).join('\n');
    const r = extractDeedIngest(noSitus);
    const addr = r.fields.find((f) => f.key === 'propertyAddress');
    expect(addr?.value ?? null).toBeNull();
  });

  it('consolidateDeedSourceFacts surfaces propertyAddress from the tax record with provenance', () => {
    const facts = consolidateDeedSourceFacts(PACKET);
    expect(facts.propertyAddress.value).toBe(SITUS);
    expect(facts.propertyAddress.sourceDocType).toBe('tax_record');
    expect(facts.propertyAddress.sourceMaterialId).toBe('mat-tax');
  });
});

describe('Quick Deed Layer 1 (E1) — the UAT: doc-derived facts resolve, no re-typing', () => {
  const facts = consolidateDeedSourceFacts(PACKET);
  const draft = assembleGiftDeed(facts, minimalGift());
  const phFields = draft.placeholders.map((p) => p.field);

  it('the document-derived facts RESOLVE (no [[ ]] for legal, locality, tax id, assessed value, grantee address)', () => {
    expect(phFields).not.toContain('Legal description (VERBATIM)');
    expect(phFields).not.toContain('Recording locality');
    expect(phFields).not.toContain('Tax I.D. (GPIN/Map) number');
    expect(phFields).not.toContain('Assessed value');
    expect(phFields).not.toContain("Grantee's address");
  });

  it("the grantee's address DEFAULTS to the property situs (operator rule) and appears on the draft", () => {
    expect(draft.text).toContain(`Grantee's Address: ${SITUS}`);
    expect(draft.notes.some((n) => /defaulted to the property \(situs\) address/i.test(n))).toBe(true);
  });

  it('the ONLY remaining placeholders are the attorney-supplied file number + derivation reference', () => {
    expect(phFields.sort()).toEqual(['Derivation (Being) reference', 'File number'].sort());
  });

  it('the verbatim legal description is the one extracted from the vesting deed', () => {
    expect(draft.verbatimLegalUsed).toBe(facts.legalDescription.value);
    expect(draft.verbatimLegalUsed).toContain('CEDAR RUN ESTATES');
  });
});

describe('Quick Deed Layer 1 (E1) — attorney override + honesty floor', () => {
  it('an explicit granteeAddress WINS over the situs default (no default note)', () => {
    const facts = consolidateDeedSourceFacts(PACKET);
    const draft = assembleGiftDeed(facts, { ...minimalGift(), granteeAddress: '88 Override Way, Reston, VA 20190' });
    expect(draft.text).toContain("Grantee's Address: 88 Override Way, Reston, VA 20190");
    expect(draft.text).not.toContain(SITUS);
    expect(draft.notes.some((n) => /defaulted to the property/i.test(n))).toBe(false);
  });

  it('no situs anywhere -> the grantee address is a [[ ]] placeholder (never fabricated)', () => {
    const noSitus = TAX_RECORD.split('\n').filter((l) => !l.startsWith('Property Address:')).join('\n');
    const facts = consolidateDeedSourceFacts([
      { materialId: 'mat-vesting', textContent: VESTING_DEED },
      { materialId: 'mat-tax', textContent: noSitus },
    ]);
    const draft = assembleGiftDeed(facts, minimalGift());
    expect(draft.placeholders.map((p) => p.field)).toContain("Grantee's address");
  });
});
