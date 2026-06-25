/**
 * deed_into_trust_draft.test.ts — MONSTER BUILD 2 E6: the Deed-INTO-TRUST (C2) matter builder
 * (toIntoTrustInput + buildIntoTrustDraft). Proves the LLC/seller-side/TOD sibling pattern for "deed into a
 * revocable living trust": the doc-derived facts (verbatim condo legal, tax id, assessed value, grantee return
 * address -> situs, jurisdiction situs -> locality) default from a vesting deed + tax record; the load-bearing
 * `trusteesRecital` is ATTORNEY-SUPPLIED VERBATIM (never auto-fabricated from the extracted certificate_of_trust
 * trust name / trustee names — those are leads only); the attorney supplies the exemplar / exemption basis /
 * marital status / heldAs / trust structure / TBE-note selector / granting verb / instrument date / notary
 * jurisdiction / preparer / derivation. The into-trust assembler returns {status, deed?} — the branch keys on
 * status. Synthetic, PII-free; the Exemplar-A GOLD input shape is mirrored from the committed fixture pack.
 */
import { describe, it, expect } from 'vitest';
import { buildIntoTrustDraft, toIntoTrustInput } from '../procedures/deedDraftAgent.js';
import { consolidateDeedSourceFacts } from '../deed/deedSourceFacts.js';

// A non-truncated SYNTHETIC condo legal (Exemplar-A is condo): carries a recorded-Declaration Instrument-No.
// anchor + the closing "among the land records of <jurisdiction>, Virginia." terminus, so isLegalTruncated passes.
const CONDO_LEGAL =
  'Condominium Unit No. 412, THE BELLWEATHER AT QUARRY STATION Condominium, and together with the limited common ' +
  'elements appurtenant thereto, including limited common element parking space(s) RPT-08, and storage space ' +
  'RS-31, established by condominium instruments recorded on March 2, 2009, Instrument No. 090004411 ' +
  '("Declaration"), and any supplemental declarations and/or amendments recorded subsequent thereto, among the ' +
  'land records of the County of Fairfax, Virginia.';

const VESTING_DEED = [
  'THIS DEED, made this 2nd day of May, 2019, by and between Quillon DEVELOPMENTS, and Rosalind A. WHITMORE and',
  'Desmond P. WHITMORE, a married couple, (the "Grantees"),',
  'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with General Warranty and English',
  'Covenants of title, unto the said Grantees, in fee simple, as tenants by the entirety, all that parcel located in',
  'the County of Fairfax, Commonwealth of Virginia, to wit:',
  `   ${CONDO_LEGAL}`,
  '   BEING the same property conveyed by Deed dated June 1, 2009, recorded as Instrument No. 090004555.',
  'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
  'Tax I.D. Number: 0417-09-0412',
].join('\n');

const SITUS = '2140 Quarry Court Unit 412, Reston, VA 20191';
const TAX_RECORD = [
  'REAL ESTATE ASSESSMENT',
  'Parcel No: 0417-09-0412',
  `Property Address: ${SITUS}`,
  'Total Assessed Value: $553,200.00',
].join('\n');

// SYNTHETIC certificate of trust — surfaces the trust name / trustee names / trust date as LEADS only.
const CERT_OF_TRUST = [
  'CERTIFICATE OF TRUST',
  'This Certificate of Trust is executed pursuant to Va. Code § 64.2-775.',
  'Trust Name and Date: The Trust is known as The Whitmore Family Revocable Living Trust, established by a Trust',
  'Agreement dated August 14, 2021.',
  'Current Trustees: The currently acting Trustees are Rosalind A. Whitmore and Desmond P. Whitmore, serving as',
  'Co-Trustees.',
  'Trustee Powers: The Trustees have broad powers under Article IX of the Trust Agreement.',
].join('\n');

const PACKET = [
  { id: 'v', textContent: VESTING_DEED },
  { id: 't', textContent: TAX_RECORD },
  { id: 'c', textContent: CERT_OF_TRUST },
];

// The attorney-supplied trustees recital (LOAD-BEARING VERBATIM — names the trustees + the trust; the assembler
// keys the GRANTEES party block off it). It is NOT defaulted from the extracted trust facts.
const TRUSTEES_RECITAL =
  'Rosalind A. WHITMORE and Desmond P. WHITMORE, Trustees of the THE WHITMORE FAMILY REVOCABLE LIVING TRUST, dated August 14, 2021';

/** The new-transaction facts the attorney supplies (mirrors the GOLD Exemplar-A shape from the fixture pack); the
 *  doc-derived fields are omitted so they default from extraction. */
function attorneyInput(overrides: Record<string, unknown> = {}): Parameters<typeof buildIntoTrustDraft>[1] {
  return {
    matterId: '00000000-0000-0000-0000-000000000000',
    exemplar: 'A',
    exemptionBasis: ['58.1-811(A)(12)'],
    titleSearchPerformed: false,
    preparer: { name: 'Kelly Satterwhite, Esq.', vsb: '91049', firm: 'The Mason Law Firm, PLC' },
    consideration: '$0.00',
    instrumentDate: { day: '9th', month: 'April', year: '2026' },
    grantors: [{ full: 'Rosalind A. WHITMORE' }, { full: 'Desmond P. WHITMORE' }],
    grantorMaritalStatus: 'a married couple',
    heldAs: 'tenants_by_entirety',
    trustStructure: 'single_joint_trust',
    trusteesRecital: TRUSTEES_RECITAL,
    granteeObjectPlurality: 'GRANTEES',
    grantingVerb: 'quitclaim, release and convey',
    lceIdentificationFootnote: true,
    derivation:
      'For derivation of title, see Deed intended to be recorded immediately prior hereto, among the aforesaid land records.',
    tbeImmunityNote: 'Exemplar-A',
    notaryJurisdiction: { type: 'CITY', name: 'ALEXANDRIA' },
    ...overrides,
  } as Parameters<typeof buildIntoTrustDraft>[1];
}

describe('E6 into-trust builder — doc-derived facts default; attorney supplies the recital + variant facts', () => {
  it('toIntoTrustInput defaults the legal/taxId/assessedValue/granteeReturnAddress/situs from extraction', () => {
    const facts = consolidateDeedSourceFacts(PACKET.map((m) => ({ materialId: m.id, textContent: m.textContent })));
    const mapped = toIntoTrustInput(attorneyInput(), facts);
    expect(mapped.legalDescription).toBe(facts.legalDescription.value); // verbatim from the vesting deed
    expect(mapped.legalDescription).toContain('THE BELLWEATHER AT QUARRY STATION');
    expect(mapped.taxId).toBe('0417-09-0412');
    expect(mapped.assessedValue).not.toBe(''); // resolved from the tax record
    expect(mapped.granteeReturnAddress).toBe(SITUS); // grantee return address defaults to the situs
    expect(mapped.jurisdictionSitus).not.toBe(''); // jurisdiction situs defaults from the locality
    // The load-bearing trustees recital is the ATTORNEY-SUPPLIED value, NOT defaulted from the extracted trust name.
    expect(mapped.trusteesRecital).toBe(TRUSTEES_RECITAL);
  });

  it('surfaces the extracted certificate-of-trust facts as LEADS (not used to fabricate the recital)', () => {
    const facts = consolidateDeedSourceFacts(PACKET.map((m) => ({ materialId: m.id, textContent: m.textContent })));
    // The extractor surfaced the trust name / trustees / date as leads...
    expect(facts.trustLegalName.value).toBe('The Whitmore Family Revocable Living Trust');
    expect(facts.trusteeNames.values).toEqual(['Rosalind A. Whitmore', 'Desmond P. Whitmore']);
    expect(facts.trustDate.value).toBe('August 14, 2021');
    // ...but the recital the assembler consumes is the ATTORNEY's verbatim text, not the auto-built lead.
    const mapped = toIntoTrustInput(attorneyInput(), facts);
    expect(mapped.trusteesRecital).toBe(TRUSTEES_RECITAL);
    expect(mapped.trusteesRecital).not.toBe(facts.trustLegalName.value);
  });

  it('buildIntoTrustDraft assembles an OK Exemplar-A deed with the doc-derived facts + recital in the body', () => {
    const { facts, draft } = buildIntoTrustDraft(PACKET, attorneyInput());
    expect(draft.status).toBe('OK');
    expect(draft.deed).toBeDefined();
    expect(draft.deed!.fullText).toContain('THE BELLWEATHER AT QUARRY STATION'); // verbatim legal
    expect(draft.deed!.fullText).toContain('0417-09-0412'); // tax id
    expect(draft.deed!.fullText).toContain(SITUS); // grantee return address (situs default)
    expect(facts.assessedValue.value).not.toBeNull();
    expect(draft.deed!.fullText).toContain(facts.assessedValue.value!); // assessed value resolved from the tax record
    expect(draft.deed!.fullText).toContain('THE WHITMORE FAMILY REVOCABLE LIVING TRUST'); // the attorney recital
    // Exemplar-A invariants: quitclaim verb + the §55.1-136(C) TBE note present.
    expect(draft.deed!.fullText).toContain('quitclaim, release and convey');
    expect(draft.deed!.fullText).toContain('pursuant to Virginia Code § 55.1-136(C)');
  });

  it('an attorney-supplied grantee return address OVERRIDES the extracted situs default', () => {
    const { draft } = buildIntoTrustDraft(PACKET, attorneyInput({ granteeReturnAddress: '88 Override Way, Reston, VA 20190' }));
    expect(draft.status).toBe('OK');
    expect(draft.deed!.fullText).toContain('88 Override Way, Reston, VA 20190');
    expect(draft.deed!.fullText).not.toContain(SITUS);
  });

  it('fails CLOSED (status WITHHELD, no deed) when the only legal available is truncated', () => {
    // Cut the condo legal mid-clause (drop the closing land-records terminus) so isLegalTruncated fires.
    const truncatedLegal = CONDO_LEGAL.replace(
      ', among the land records of the County of Fairfax, Virginia.',
      ', among the',
    );
    const cutVesting = VESTING_DEED.replace(CONDO_LEGAL, truncatedLegal);
    const { draft } = buildIntoTrustDraft(
      [{ id: 'v', textContent: cutVesting }, { id: 't', textContent: TAX_RECORD }, { id: 'c', textContent: CERT_OF_TRUST }],
      attorneyInput(),
    );
    expect(draft.status).toBe('WITHHELD');
    expect(draft.deed).toBeUndefined();
    expect(draft.flags).toContain('LEGAL_DESCRIPTION_TRUNCATED');
  });

  it('fails CLOSED with TRUSTEES_RECITAL_MISSING when the attorney omits the load-bearing recital', () => {
    const { draft } = buildIntoTrustDraft(PACKET, attorneyInput({ trusteesRecital: '   ' }));
    expect(draft.status).toBe('WITHHELD');
    expect(draft.deed).toBeUndefined();
    expect(draft.flags).toContain('TRUSTEES_RECITAL_MISSING');
  });
});
