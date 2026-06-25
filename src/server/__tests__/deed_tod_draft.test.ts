/**
 * deed_tod_draft.test.ts — MONSTER BUILD 2 E4-rest: the TOD (C5) QUICK-DEED/matter builder
 * (toTodInput + buildTodDraft). Proves the gift/seller-side sibling pattern for the Revocable Transfer on Death
 * Deed: the doc-derived facts (verbatim legal, tax id, tax-map reference, property address, assessed value)
 * default from a single uploaded vesting deed + tax record; the attorney supplies the TOD-only facts (transferor
 * capacity, beneficiary designation, notary layout, dates). The TOD assembler returns {status, deed?} — NOT the
 * seller-side failedClosed shape — so the builder/persist branch keys on status. Synthetic, PII-free.
 */
import { describe, it, expect } from 'vitest';
import { buildTodDraft, toTodInput } from '../procedures/deedDraftAgent.js';
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

/** A complete, valid G1 (multiple-individuals SFH) TOD attorney input with the doc-derived fields OMITTED so they
 *  default from extraction. matterId is unused by the pure builder. */
function attorneyInput(overrides: Record<string, unknown> = {}): Parameters<typeof buildTodDraft>[1] {
  return {
    matterId: '00000000-0000-0000-0000-000000000000',
    preparer: 'Mason Law Firm, PLC',
    returnTo: 'Universal Title, 1320 Old Chain Bridge Road, McLean, VA 22101',
    deedDatePhrase: 'October 2025',
    transferor: { name: 'Marcus T. ELLISON', capacity: 'surviving joint tenant' },
    primaryBeneficiaries: {
      persons: ['Daniel HOLLOWAY', 'Rebecca HOLLOWAY-MERCER'],
      vesting: 'joint tenants with the common law right of survivorship',
      relationship: null,
    },
    beingRecital:
      'BEING the same property conveyed unto Marcus T. Ellison by Deed recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
    acknowledgmentMonthYear: 'October 2025',
    notaryCountyBlank: true,
    ...overrides,
  } as Parameters<typeof buildTodDraft>[1];
}

describe('E4-rest TOD builder — doc-derived facts default; attorney supplies the TOD facts', () => {
  it('toTodInput defaults the legal/taxId/taxMapReference/propertyAddress/assessedValue from the extracted facts', () => {
    const facts = consolidateDeedSourceFacts(PACKET.map((m) => ({ materialId: m.id, textContent: m.textContent })));
    const mapped = toTodInput(attorneyInput(), facts);
    expect(mapped.legalDescription).toBe(facts.legalDescription.value); // verbatim from the vesting deed
    expect(mapped.legalDescription).toContain('CEDAR RUN ESTATES');
    expect(mapped.taxId).toBe('7298-44-1201');
    expect(mapped.taxMapReference).toBe('7298-44-1201');
    expect(mapped.propertyAddress).toBe(SITUS); // property address defaults to the tax-record situs
    expect(mapped.assessedValue).not.toBe(''); // resolved from the tax record
  });

  it('buildTodDraft assembles an OK deed with the doc-derived facts resolved into the body', () => {
    const { facts, draft } = buildTodDraft(PACKET, attorneyInput());
    expect(draft.status).toBe('OK');
    expect(draft.deed).toBeDefined();
    expect(draft.deed!.fullText).toContain('REVOCABLE TRANSFER ON DEATH DEED');
    expect(draft.deed!.fullText).toContain('CEDAR RUN ESTATES'); // verbatim legal
    expect(draft.deed!.fullText).toContain('7298-44-1201'); // tax id
    expect(draft.deed!.fullText).toContain(SITUS); // property address (situs default), in the designation
    expect(facts.assessedValue.value).not.toBeNull();
    expect(draft.deed!.fullText).toContain(facts.assessedValue.value!); // assessed value resolved from the tax record
    // Hyphenated beneficiary surname carried intact (no split).
    expect(draft.deed!.fullText).toContain('HOLLOWAY-MERCER');
    expect(draft.deed!.fullText).not.toMatch(/HOLLOWAY MERCER/);
  });

  it('an attorney-supplied property address OVERRIDES the extracted default', () => {
    const { draft } = buildTodDraft(PACKET, attorneyInput({ propertyAddress: '88 Override Way, Reston, VA 20190' }));
    expect(draft.status).toBe('OK');
    expect(draft.deed!.fullText).toContain('88 Override Way, Reston, VA 20190');
    expect(draft.deed!.fullText).not.toContain(SITUS);
  });

  it('fails CLOSED (status WITHHELD, no deed) when the only legal available is truncated', () => {
    const truncatedVesting = VESTING_DEED.replace(
      'among the Land Records of Prince William County, Virginia.',
      'among the', // cut mid-clause -> isLegalTruncated
    );
    const { draft } = buildTodDraft(
      [{ id: 'v', textContent: truncatedVesting }, { id: 't', textContent: TAX_RECORD }],
      attorneyInput(),
    );
    expect(draft.status).toBe('WITHHELD');
    expect(draft.deed).toBeUndefined();
    expect(draft.flags).toContain('LEGAL_DESCRIPTION_TRUNCATED');
  });

  it('fails CLOSED with NO_BENEFICIARY_DESIGNATED when no beneficiary is supplied', () => {
    const { draft } = buildTodDraft(
      PACKET,
      attorneyInput({ primaryBeneficiaries: { persons: [], vesting: 'sole owner', relationship: null } }),
    );
    expect(draft.status).toBe('WITHHELD');
    expect(draft.deed).toBeUndefined();
    expect(draft.flags).toContain('NO_BENEFICIARY_DESIGNATED');
  });
});
