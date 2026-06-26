/**
 * deed_seller_side_draft.test.ts — MONSTER BUILD 2 E4: the seller-side QUICK-DEED/matter builder
 * (toSellerSideInput + buildSellerSideDraft). Proves the gift sibling pattern for seller-side: the doc-derived
 * facts (verbatim legal, locality, tax id, assessed value, grantee-address->situs) default from a single
 * uploaded vesting deed + tax record; the attorney supplies only the new-transaction facts
 * (warranty/consideration/parties/tenancy/venue/vesting recital). Synthetic, PII-free.
 */
import { describe, it, expect } from 'vitest';
import { buildSellerSideDraft, toSellerSideInput } from '../procedures/deedDraftAgent.js';
import { consolidateDeedSourceFacts } from '../deed/deedSourceFacts.js';

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
  'Total Assessed Value: $588,400.00',
].join('\n');

const PACKET = [
  { id: 'v', textContent: VESTING_DEED },
  { id: 't', textContent: TAX_RECORD },
];

/** The new-transaction facts the attorney supplies (the document cannot). Doc-derived fields are omitted so they
 *  default from extraction. matterId is unused by the pure builder (it takes materials + input directly). */
function attorneyInput(overrides: Record<string, unknown> = {}): Parameters<typeof buildSellerSideDraft>[1] {
  return {
    matterId: '00000000-0000-0000-0000-000000000000',
    warrantyType: 'General Warranty',
    fileNumber: '26-00091-K',
    titleInsurer: 'STEWART TITLE GUARANTY COMPANY',
    considerationFigs: '$612,000.00',
    amountWords: 'SIX HUNDRED TWELVE THOUSAND AND 00/100',
    grantors: [{ name: 'Marcus T. ELLISON' }, { name: 'Priya ELLISON' }],
    grantorDescriptor: 'a married couple',
    grantees: [{ name: 'Daniel WONG' }],
    tenancy: 'as sole owner',
    vestingRecital:
      'BEING the same property conveyed unto Marcus T. Ellison and Priya Ellison by Deed recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
    venue: 'COUNTY OF PRINCE WILLIAM',
    returnTo: 'Universal Title',
    ...overrides,
  } as Parameters<typeof buildSellerSideDraft>[1];
}

describe('E4 seller-side builder — doc-derived facts default; attorney supplies the new-transaction facts', () => {
  it('toSellerSideInput defaults the legal/locality/taxId/assessedValue/grantee-address from the extracted facts', () => {
    const facts = consolidateDeedSourceFacts(PACKET.map((m) => ({ materialId: m.id, textContent: m.textContent })));
    const mapped = toSellerSideInput(attorneyInput(), facts);
    expect(mapped.legalDescription).toBe(facts.legalDescription.value); // verbatim from the vesting deed
    expect(mapped.legalDescription).toContain('CEDAR RUN ESTATES');
    expect(mapped.taxId).toBe('7298-44-1201');
    expect(mapped.assessedValue).not.toBe(''); // resolved from the tax record
    expect(mapped.granteeAddress).toBe(SITUS); // grantee address defaults to the property situs
    expect(mapped.county.length).toBeGreaterThan(0); // locality resolved from the vesting deed
  });

  it('buildSellerSideDraft assembles a recordable draft with the doc-derived facts resolved into the deed body', () => {
    const { facts, draft } = buildSellerSideDraft(PACKET, attorneyInput());
    expect(draft.failedClosed).toBe(false);
    expect(draft.text).toContain('CEDAR RUN ESTATES'); // verbatim legal
    expect(draft.text).toContain(SITUS); // grantee address (situs default)
    expect(facts.assessedValue.value).not.toBeNull();
    expect(draft.text).toContain(facts.assessedValue.value!); // assessed value resolved from the tax record
    expect(draft.text).toContain('7298-44-1201'); // tax id
    expect(draft.parts?.grantingClause).toContain('Prince William County'); // locality
  });

  it('an attorney-supplied legal/grantee-address OVERRIDES the extracted default', () => {
    const { draft } = buildSellerSideDraft(
      PACKET,
      attorneyInput({ granteeAddress: '88 Override Way, Reston, VA 20190' }),
    );
    expect(draft.text).toContain('88 Override Way, Reston, VA 20190');
    expect(draft.text).not.toContain(SITUS);
  });

  it('F3: an ESTATE seller-side deed on the DEFAULT General Warranty surfaces the §2.1.0/B1 fiduciary-warranty caution', () => {
    // A fiduciary giving a General Warranty exposes the estate to a pre-decedent title-defect claims tail (KB
    // §2.1.0/B1). The caution must fire on the DEFAULT warranty path (Monster UAT v2 F3 re-verify), not only when
    // Special is chosen. A grounded single-Executor estate deed (one grantor, power of sale, "Executor of Estate
    // of <decedent>" capacity) emits, carrying the caution on draft.notes.
    const { draft } = buildSellerSideDraft(
      PACKET,
      attorneyInput({
        sellerType: 'estate',
        powerOfSale: true,
        warrantyType: 'General Warranty',
        grantorDescriptor: '',
        grantors: [{ name: 'Harold V. GREER', capacity: 'Executor of Estate of Vivian R. Greer' }],
      }),
    );
    expect(draft.failedClosed).toBe(false); // a grounded single-executor estate deed emits
    expect(draft.notes.some((n) => n.includes('Fiduciary-warranty risk (KB §2.1.0/B1)'))).toBe(true);
  });

  it('fails CLOSED (no void deed) when the only legal available is truncated', () => {
    const truncatedVesting = VESTING_DEED.replace(
      'among the Land Records of Prince William County, Virginia.',
      'among the', // cut mid-clause -> isLegalTruncated
    );
    const { draft } = buildSellerSideDraft(
      [{ id: 'v', textContent: truncatedVesting }, { id: 't', textContent: TAX_RECORD }],
      attorneyInput(),
    );
    expect(draft.failedClosed).toBe(true);
    expect(draft.text).toBe('');
    expect(draft.failures.some((f) => /truncat/i.test(f))).toBe(true);
  });
});
