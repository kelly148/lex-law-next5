/**
 * deed_confirmation_draft.test.ts — MONSTER BUILD 2 E4-rest: the Deed of Confirmation (C1) QUICK-DEED/matter
 * builder (toConfirmationInput + buildConfirmationDraft). Proves the sibling pattern: the doc-derived facts
 * (verbatim legal, tax id, assessed value, grantee-return-address->situs, locality) default from a single
 * uploaded vesting deed + tax record; the attorney supplies the archetype + chain-of-title facts (the assembler
 * NEVER fabricates a chain link). The Confirmation assembler returns {status, deed?} — branch on status. The
 * survivorship S5 fail-closed path (exactly one co-owner must equal the decedent) is exercised here. Synthetic,
 * PII-free.
 */
import { describe, it, expect } from 'vitest';
import { buildConfirmationDraft, toConfirmationInput } from '../procedures/deedDraftAgent.js';
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

/** A complete, valid C1-a survivorship attorney input with the doc-derived fields OMITTED so they default from
 *  extraction. The decedent (Priya ELLISON) matches exactly one co-owner, so the survivor (Marcus T. ELLISON)
 *  derives unambiguously. matterId is unused by the pure builder. */
function attorneyInput(overrides: Record<string, unknown> = {}): Parameters<typeof buildConfirmationDraft>[1] {
  return {
    matterId: '00000000-0000-0000-0000-000000000000',
    archetype: 'C1-a-survivorship',
    exemptionCode: '58.1-810(1)',
    preparer: 'Mason Law Firm, PLC',
    preparedNote: 'Prepared without the benefit of a title examination.',
    consideration: '$0.00 (confirmatory)',
    grantingDatePhrase: 'March, 2026',
    partyName: 'Marcus T. ELLISON',
    vesting: 'sole owner',
    grantingVerb: 'grant and convey',
    warranty: 'General Warranty and English Covenants of title',
    subjectTo: 'covenants, conditions, restrictions, easements and rights of way of record',
    chainSurvivorship: {
      tookTitleAs: 'joint tenants with the common law right of survivorship',
      coOwners: ['Marcus T. ELLISON', 'Priya ELLISON'],
      vestingDeedDate: 'May 2, 2019',
      vestingDeedRecorded: 'May 5, 2019',
      vestingInstrumentNumber: '201905050012345',
      recordsCounty: 'Prince William County, Virginia',
    },
    decedent: { name: 'Priya ELLISON', dateOfDeath: 'January 10, 2026' },
    beingRecitalPriorInstrument: '201905050012345',
    ...overrides,
  } as Parameters<typeof buildConfirmationDraft>[1];
}

describe('E4-rest Confirmation builder — doc-derived facts default; attorney supplies the chain-of-title', () => {
  it('toConfirmationInput defaults the legal/taxId/assessedValue/granteeReturnAddress/locality from the facts', () => {
    const facts = consolidateDeedSourceFacts(PACKET.map((m) => ({ materialId: m.id, textContent: m.textContent })));
    const mapped = toConfirmationInput(attorneyInput(), facts);
    expect(mapped.legalDescription).toBe(facts.legalDescription.value); // verbatim from the vesting deed
    expect(mapped.legalDescription).toContain('CEDAR RUN ESTATES');
    expect(mapped.taxId).toBe('7298-44-1201'); // Exemplar-A renders Tax ID from the parcel id
    expect(mapped.assessedValue).not.toBe(''); // resolved from the tax record
    expect(mapped.granteeReturnAddress).toBe(SITUS); // grantee return address defaults to the situs
    expect(mapped.locality).toBe(facts.propertyLocality.value); // locality resolved from the vesting deed
  });

  it('buildConfirmationDraft assembles an OK deed with the doc-derived facts + derived survivor in the body', () => {
    const { facts, draft } = buildConfirmationDraft(PACKET, attorneyInput());
    expect(draft.status).toBe('OK');
    expect(draft.deed).toBeDefined();
    expect(draft.deed!.fullText).toContain('DEED OF CONFIRMATION');
    expect(draft.deed!.fullText).toContain('CEDAR RUN ESTATES'); // verbatim legal
    expect(draft.deed!.fullText).toContain('7298-44-1201'); // tax id
    expect(draft.deed!.fullText).toContain(SITUS); // grantee return address (situs default)
    expect(facts.assessedValue.value).not.toBeNull();
    expect(draft.deed!.fullText).toContain(facts.assessedValue.value!); // assessed value resolved
    // Survivor derived as the co-owner who is NOT the decedent (surface-not-decide, unambiguous).
    expect(draft.deed!.whereasRecitals).toContain('Marcus T. ELLISON became the sole owner');
    expect(draft.deed!.whereasRecitals).toContain('Priya ELLISON'); // the decedent named in the chain
  });

  it('an attorney-supplied grantee return address OVERRIDES the extracted default', () => {
    const { draft } = buildConfirmationDraft(
      PACKET,
      attorneyInput({ granteeReturnAddress: '88 Override Way, Reston, VA 20190' }),
    );
    expect(draft.status).toBe('OK');
    expect(draft.deed!.fullText).toContain('88 Override Way, Reston, VA 20190');
    expect(draft.deed!.fullText).not.toContain(SITUS);
  });

  it('fails CLOSED (status WITHHELD, no deed) when the only legal available is truncated', () => {
    const truncatedVesting = VESTING_DEED.replace(
      'among the Land Records of Prince William County, Virginia.',
      'among the', // cut mid-clause -> isLegalTruncated
    );
    const { draft } = buildConfirmationDraft(
      [{ id: 'v', textContent: truncatedVesting }, { id: 't', textContent: TAX_RECORD }],
      attorneyInput(),
    );
    expect(draft.status).toBe('WITHHELD');
    expect(draft.deed).toBeUndefined();
    expect(draft.flags).toContain('LEGAL_DESCRIPTION_INCOMPLETE');
  });

  it('fails CLOSED with PARTIES_NOT_IDENTICAL when the parties are asserted not the same person', () => {
    const { draft } = buildConfirmationDraft(PACKET, attorneyInput({ grantorGranteeSame: false }));
    expect(draft.status).toBe('WITHHELD');
    expect(draft.deed).toBeUndefined();
    expect(draft.flags).toContain('PARTIES_NOT_IDENTICAL');
  });

  it('fails CLOSED with INCOMPLETE_SURVIVORSHIP_CHAIN when the decedent matches NEITHER co-owner (ambiguous)', () => {
    const { draft } = buildConfirmationDraft(
      PACKET,
      attorneyInput({ decedent: { name: 'Someone Not An Owner', dateOfDeath: 'January 10, 2026' } }),
    );
    expect(draft.status).toBe('WITHHELD');
    expect(draft.deed).toBeUndefined();
    expect(draft.flags).toContain('INCOMPLETE_SURVIVORSHIP_CHAIN');
  });
});
