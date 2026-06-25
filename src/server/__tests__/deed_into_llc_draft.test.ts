/**
 * deed_into_llc_draft.test.ts — MONSTER BUILD 2 E5: the Deed-INTO-LLC (C3) QUICK-DEED/matter builder
 * (toIntoLlcInput + buildIntoLlcDraft). Proves the gift/seller-side/TOD sibling pattern for "deed into an LLC":
 * the doc-derived facts (verbatim legal, tax id, assessed value, grantee return address -> situs) default from a
 * vesting deed + tax record; the LLC GRANTEE legal name defaults from the new llc_authority doc (SCC/operating
 * agreement) and the ", a Virginia Limited Liability Company" designator is appended; the attorney supplies the
 * new-transaction facts (consideration, instrument date, grantor cardinality/marital status, notary, derivation,
 * subject-to). The into-LLC assembler returns {status, deed?} — branch keys on status. Synthetic, PII-free.
 */
import { describe, it, expect } from 'vitest';
import { buildIntoLlcDraft, toIntoLlcInput } from '../procedures/deedDraftAgent.js';
import { consolidateDeedSourceFacts } from '../deed/deedSourceFacts.js';

const VESTING_DEED = [
  'THIS DEED, made this 2nd day of May, 2019, by and between Harold V. GREER, an unmarried man, (the "Grantor"), and Dahlia OKONKWO,',
  '(the "Grantee"),',
  'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with General Warranty and English Covenants of title,',
  'unto the said Grantee, in fee simple, as sole owner, all that parcel located in',
  'Fairfax County, Commonwealth of Virginia, to wit:',
  '   Lot TWENTY-SEVEN (27), HAWTHORNE RIDGE, as the same appears duly dedicated, platted and',
  '   recorded in Deed Book 8412 at Page 0337, among the Land Records of Fairfax County, Virginia.',
  '   BEING the same property conveyed unto Dahlia Okonkwo by Deed dated June 1, 2001, recorded in Deed Book 3000 at Page 100.',
  'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
  'Tax I.D. Number: 1184-55-0027',
].join('\n');

const SITUS = '7720 Marlowe Glen Court, Springfield, VA 22150';
const TAX_RECORD = [
  'REAL ESTATE ASSESSMENT',
  'Parcel No: 1184-55-0027',
  `Property Address: ${SITUS}`,
  'Total Assessed Value: $612,400.00',
].join('\n');

const LLC_DOC = [
  'Entity Information',
  'Entity Name: Marlowe Glen Holdings LLC',
  'Entity ID: 11876543',
  'Entity Type: Limited Liability Company',
  'Entity Status: Active',
  'Formation Date: 03/18/2026',
  'Jurisdiction: VA',
  'Members: Dahlia Okonkwo',
  'State Corporation Commission',
].join('\n');

const PACKET = [
  { id: 'v', textContent: VESTING_DEED },
  { id: 't', textContent: TAX_RECORD },
  { id: 'l', textContent: LLC_DOC },
];

/** The new-transaction facts the attorney supplies; doc-derived + LLC fields omitted so they default. */
function attorneyInput(overrides: Record<string, unknown> = {}): Parameters<typeof buildIntoLlcDraft>[1] {
  return {
    matterId: '00000000-0000-0000-0000-000000000000',
    preparedBy: 'Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC',
    titleSearch: 'Prepared without benefit of title search',
    consideration: '$0.00',
    instrumentDatePhrase: '____ day of April, 2026',
    grantors: [{ name: 'Dahlia OKONKWO', maritalStatus: 'unmarried' }],
    grantorCardinality: 'single',
    propertyJurisdiction: 'County of Fairfax, Virginia',
    derivationOfTitle:
      'For derivation of title, see Deed recorded in Deed Book _________, at page __________, among the aforesaid land records.',
    subjectTo:
      'This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.',
    notaryJurisdiction: { commonwealth: 'COMMONWEALTH OF VIRGINIA', locality: 'CITY OF ALEXANDRIA' },
    ...overrides,
  } as Parameters<typeof buildIntoLlcDraft>[1];
}

describe('E5 into-LLC builder — doc-derived + LLC facts default; attorney supplies the new-transaction facts', () => {
  it('toIntoLlcInput defaults the legal/taxId/assessedValue/granteeAddressReturn from extraction and the grantee LLC from the LLC fact', () => {
    const facts = consolidateDeedSourceFacts(PACKET.map((m) => ({ materialId: m.id, textContent: m.textContent })));
    const mapped = toIntoLlcInput(attorneyInput(), facts);
    expect(mapped.legalDescription).toBe(facts.legalDescription.value); // verbatim from the vesting deed
    expect(mapped.legalDescription).toContain('HAWTHORNE RIDGE');
    expect(mapped.taxId).toBe('1184-55-0027');
    expect(mapped.assessedValue).not.toBe(''); // resolved from the tax record
    expect(mapped.granteeAddressReturn).toBe(SITUS); // grantee return address defaults to the situs
    // The grantee LLC defaults from the extracted llc_authority legal name, with the VA designator appended.
    expect(mapped.granteeLlc).toBe('Marlowe Glen Holdings LLC, a Virginia Limited Liability Company');
  });

  it('does NOT double-append the VA designator when the attorney already supplied a fully-qualified grantee LLC', () => {
    const facts = consolidateDeedSourceFacts(PACKET.map((m) => ({ materialId: m.id, textContent: m.textContent })));
    const mapped = toIntoLlcInput(
      attorneyInput({ granteeLlc: 'Briar Hollow Family LLC, a Virginia Limited Liability Company' }),
      facts,
    );
    expect(mapped.granteeLlc).toBe('Briar Hollow Family LLC, a Virginia Limited Liability Company');
  });

  it('buildIntoLlcDraft assembles an OK quitclaim deed with the doc-derived + LLC facts in the body', () => {
    const { facts, draft } = buildIntoLlcDraft(PACKET, attorneyInput());
    expect(draft.status).toBe('OK');
    expect(draft.deed).toBeDefined();
    expect(draft.deed!.fullText).toContain('HAWTHORNE RIDGE'); // verbatim legal
    expect(draft.deed!.fullText).toContain('1184-55-0027'); // tax id
    expect(draft.deed!.fullText).toContain(SITUS); // grantee return address (situs default)
    expect(facts.assessedValue.value).not.toBeNull();
    expect(draft.deed!.fullText).toContain(facts.assessedValue.value!); // assessed value resolved from the tax record
    expect(draft.deed!.fullText).toContain('Marlowe Glen Holdings LLC, a Virginia Limited Liability Company');
    // Quitclaim-into-LLC invariant: the quitclaim verb is present and NO warranty bled in.
    expect(draft.deed!.fullText).toContain('quitclaim release and convey');
    expect(draft.deed!.fullText).not.toContain('General Warranty');
    expect(draft.deed!.fullText).not.toContain('Special Warranty');
  });

  it('an attorney-supplied grantee return address OVERRIDES the extracted situs default', () => {
    const { draft } = buildIntoLlcDraft(PACKET, attorneyInput({ granteeAddressReturn: '88 Override Way, Reston, VA 20190' }));
    expect(draft.status).toBe('OK');
    expect(draft.deed!.fullText).toContain('88 Override Way, Reston, VA 20190');
    expect(draft.deed!.fullText).not.toContain(SITUS);
  });

  it('fails CLOSED (status WITHHELD, no deed) when the only legal available is truncated', () => {
    const truncatedVesting = VESTING_DEED.replace(
      'among the Land Records of Fairfax County, Virginia.',
      'among the', // cut mid-clause -> isLegalTruncated
    );
    const { draft } = buildIntoLlcDraft(
      [{ id: 'v', textContent: truncatedVesting }, { id: 't', textContent: TAX_RECORD }, { id: 'l', textContent: LLC_DOC }],
      attorneyInput(),
    );
    expect(draft.status).toBe('WITHHELD');
    expect(draft.deed).toBeUndefined();
    expect(draft.flags).toContain('TRUNCATED_LEGAL_DESCRIPTION');
  });

  it('fails CLOSED with INVALID_LLC_DESIGNATOR when no LLC doc is present and the attorney supplied no grantee LLC', () => {
    const { draft } = buildIntoLlcDraft(
      [{ id: 'v', textContent: VESTING_DEED }, { id: 't', textContent: TAX_RECORD }],
      attorneyInput(),
    );
    expect(draft.status).toBe('WITHHELD');
    expect(draft.deed).toBeUndefined();
    expect(draft.flags).toContain('INVALID_LLC_DESIGNATOR');
  });
});
