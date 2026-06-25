/**
 * deed_out_of_llc_draft.test.ts — MONSTER BUILD 2 E5: the Deed-OUT-OF-LLC (C4) QUICK-DEED/matter builder
 * (toOutOfLlcInput + buildOutOfLlcDraft). Proves the sibling pattern for "deed out of an LLC": the doc-derived
 * facts (verbatim legal, tax id, assessed value, grantee address -> situs, locality) default from a vesting deed
 * + tax record; the GRANTOR LLC (bare) and the MEMBER set default from the new llc_authority doc (operating
 * agreement / SCC record); the attorney supplies the new-transaction facts (file number, execution month+year,
 * notary locality, derivation instrument number, return-to block). The out-of-LLC assembler returns {status,
 * deed?} — branch keys on status; Special Warranty, never General. Synthetic, PII-free.
 */
import { describe, it, expect } from 'vitest';
import { buildOutOfLlcDraft, toOutOfLlcInput } from '../procedures/deedDraftAgent.js';
import { consolidateDeedSourceFacts } from '../deed/deedSourceFacts.js';

const VESTING_DEED = [
  'THIS DEED, made this 2nd day of May, 2019, by and between Harold V. GREER, an unmarried man, (the "Grantor"), and Maplehurst Holdings LLC,',
  '(the "Grantee"),',
  'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with Special Warranty of title,',
  'unto the said Grantee, in fee simple, all that parcel located in',
  'Loudoun County, Commonwealth of Virginia, to wit:',
  '   Lot 61, Section 3, HAWKSLEY GLEN, as the same appears duly dedicated, platted and',
  '   recorded in Deed Book 2207 at Page 0844, among the Land Records of Loudoun County, Virginia.',
  '   BEING the same property conveyed by Deed dated June 1, 2018, recorded in Deed Book 3000 at Page 100.',
  'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
  'Tax I.D. Number: 0173-19-0412',
].join('\n');

const SITUS = '8814 Larkspur Meadow Lane, Aldie, Virginia 20105';
const TAX_RECORD = [
  'REAL ESTATE ASSESSMENT',
  'Parcel No: 0173-19-0412',
  `Property Address: ${SITUS}`,
  'Total Assessed Value: $1,275,400.00',
].join('\n');

// SYNTHETIC operating agreement: bare LLC legal name + two members (the bare member-grantee set defaults here).
const LLC_DOC = [
  'OPERATING AGREEMENT OF MAPLEHURST HOLDINGS LLC',
  'A Virginia Limited Liability Company',
  'ARTICLE III. MEMBER; CAPITAL; OWNERSHIP INTEREST',
  'Members: Desmond R. Okafor and Priya N. Venkataraman',
  'Percentage Interest: 50% each',
].join('\n');

const PACKET = [
  { id: 'v', textContent: VESTING_DEED },
  { id: 't', textContent: TAX_RECORD },
  { id: 'l', textContent: LLC_DOC },
];

/** The new-transaction facts the attorney supplies; doc-derived + LLC fields omitted so they default. */
function attorneyInput(overrides: Record<string, unknown> = {}): Parameters<typeof buildOutOfLlcDraft>[1] {
  return {
    matterId: '00000000-0000-0000-0000-000000000000',
    fileNumber: '41-2026-7720',
    consideration: '0.00',
    executionMonth: 'July',
    executionYear: '2026',
    localityType: 'County',
    derivationInstrumentNumber: '202401090012744',
    notaryLocality: 'COUNTY OF LOUDOUN',
    returnTo: {
      company: 'Universal Title',
      line1: '3031 Fairview Park Drive',
      line2: 'Suite 375',
      cityStateZip: 'Falls Church, VA 22042',
      phone: '(703) 354-2100',
    },
    ...overrides,
  } as Parameters<typeof buildOutOfLlcDraft>[1];
}

describe('E5 out-of-LLC builder — doc-derived + LLC facts default; attorney supplies the new-transaction facts', () => {
  it('toOutOfLlcInput defaults the legal/taxId/assessedValue/granteeAddress/locality from extraction and the grantor LLC + members from the LLC fact', () => {
    const facts = consolidateDeedSourceFacts(PACKET.map((m) => ({ materialId: m.id, textContent: m.textContent })));
    const mapped = toOutOfLlcInput(attorneyInput(), facts);
    expect(mapped.legalDescription).toBe(facts.legalDescription.value); // verbatim from the vesting deed
    expect(mapped.legalDescription).toContain('HAWKSLEY GLEN');
    expect(mapped.taxId).toBe('0173-19-0412');
    expect(mapped.assessedValue).not.toBe(''); // resolved from the tax record
    expect(mapped.granteeAddress).toBe(SITUS); // grantee address defaults to the situs
    expect(mapped.localityName.length).toBeGreaterThan(0); // locality resolved from the vesting deed
    // The grantor LLC (BARE) defaults from the extracted llc_authority legal name.
    expect(mapped.grantorLlc).toBe('MAPLEHURST HOLDINGS LLC');
    // The member set defaults from the extracted llc_authority members (bare names, default "Member" title).
    expect(mapped.members.map((m) => m.name)).toEqual(['Desmond R. Okafor', 'Priya N. Venkataraman']);
  });

  it('buildOutOfLlcDraft assembles an OK Special-Warranty deed with the doc-derived + LLC facts in the body', () => {
    const { facts, draft } = buildOutOfLlcDraft(PACKET, attorneyInput());
    expect(draft.status).toBe('OK');
    expect(draft.deed).toBeDefined();
    expect(draft.deed!.fullText).toContain('HAWKSLEY GLEN'); // verbatim legal
    expect(draft.deed!.fullText).toContain('0173-19-0412'); // tax id
    expect(draft.deed!.fullText).toContain(SITUS); // grantee address (situs default)
    expect(facts.assessedValue.value).not.toBeNull();
    expect(draft.deed!.fullText).toContain('MAPLEHURST HOLDINGS LLC'); // bare LLC grantor name
    expect(draft.deed!.fullText).toContain('Desmond R. Okafor, Member'); // member signature line
    expect(draft.deed!.fullText).toContain('Priya N. Venkataraman, Member');
    // Out-of-LLC invariant: Special Warranty, never General.
    expect(draft.deed!.fullText).toContain('with Special Warranty of title');
    expect(draft.deed!.fullText).not.toContain('General Warranty');
  });

  it('an attorney-supplied member set OVERRIDES the extracted member default', () => {
    const { draft } = buildOutOfLlcDraft(
      PACKET,
      attorneyInput({ members: [{ name: 'Anselm J. Fairweather', signatureTitle: 'Managing Member' }] }),
    );
    expect(draft.status).toBe('OK');
    expect(draft.deed!.fullText).toContain('Anselm J. Fairweather, Managing Member');
    expect(draft.deed!.fullText).not.toContain('Desmond R. Okafor');
  });

  it('fails CLOSED (status WITHHELD, no deed) when the only legal available is truncated', () => {
    const truncatedVesting = VESTING_DEED.replace(
      'among the Land Records of Loudoun County, Virginia.',
      'among the', // cut mid-clause -> isLegalTruncated
    );
    const { draft } = buildOutOfLlcDraft(
      [{ id: 'v', textContent: truncatedVesting }, { id: 't', textContent: TAX_RECORD }, { id: 'l', textContent: LLC_DOC }],
      attorneyInput(),
    );
    expect(draft.status).toBe('WITHHELD');
    expect(draft.deed).toBeUndefined();
    expect(draft.flags).toContain('LEGAL_DESCRIPTION_TRUNCATED');
  });

  it('fails CLOSED with WARRANTY_MISMATCH when the attorney passes a General-Warranty token', () => {
    const { draft } = buildOutOfLlcDraft(
      PACKET,
      attorneyInput({ warrantyToken: 'grant and convey, with General Warranty of title' }),
    );
    expect(draft.status).toBe('WITHHELD');
    expect(draft.deed).toBeUndefined();
    expect(draft.flags).toContain('WARRANTY_MISMATCH');
  });
});
