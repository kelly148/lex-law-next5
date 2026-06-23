/**
 * DEED-DRAFT-AGENT-1 Inc 2 — deterministic drafter's-notes tests.
 *
 * The advisory layer must (a) ground every statutory citation in the verified KB (deedKbVa) — the hard
 * no-hallucinated-citation rule — (b) spot the right issues deterministically per the gift facts, and (c) keep
 * the notes OUT of the recordable deed body. Fixtures reuse the Inc-1 synthetic gift packet.
 */
import { describe, it, expect } from 'vitest';
import { consolidateDeedSourceFacts } from '../deed/deedSourceFacts.js';
import { assembleGiftDeed, type GiftDeedInput } from '../deed/deedGiftAssembler.js';
import { buildGiftDrafterNotes } from '../deed/deedGiftNotes.js';
import { checkAnnotationLeak } from '../deed/deedDraftGates.js';
import { VA_DEED_TYPES, VA_STATUTORY_CITATIONS, VA_EXEMPTIONS } from '../deed/deedKbVa.js';

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
const FACTS = consolidateDeedSourceFacts([
  { materialId: 'v', textContent: VESTING_DEED },
  { materialId: 't', textContent: TAX_RECORD },
]);

function notesFor(input: GiftDeedInput): ReturnType<typeof buildGiftDrafterNotes> {
  return buildGiftDrafterNotes(FACTS, input, assembleGiftDeed(FACTS, input));
}

const fullGift = (): GiftDeedInput => ({
  grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Priya Ellison', descriptor: 'husband and wife' }],
  grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantors' daughter" }],
  fileNumber: '36-2026-7777',
  granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
  derivationReference: 'in Deed Book 5500 at Page 12',
});

// the complete set of VERIFIED KB citation strings — the only cites the notes layer may emit.
const VERIFIED_KB_CITES = new Set<string>([
  ...VA_DEED_TYPES.map((t) => t.exemptionCitation).filter((c): c is string => Boolean(c)),
  ...VA_STATUTORY_CITATIONS.map((c) => c.citation),
  ...VA_EXEMPTIONS.map((e) => e.citation),
]);

describe('buildGiftDrafterNotes — grounded, deterministic advisory', () => {
  it('NO hallucinated citations: every citation in every note is a verified KB string', () => {
    for (const input of [fullGift(), { ...fullGift(), grantees: [{ name: 'A B' }, { name: 'C D' }] }, { ...fullGift(), grantors: [{ name: 'Acme Trust' }] }]) {
      for (const note of notesFor(input).notes) {
        for (const cite of note.citations) {
          expect(VERIFIED_KB_CITES.has(cite)).toBe(true);
        }
      }
    }
  });

  it('always verifies the gift exemption (the two-part P.D. 93-212 requirement) with § 58.1-811(D)', () => {
    const ex = notesFor(fullGift()).notes.find((n) => n.category === 'exemption');
    expect(ex).toBeTruthy();
    expect(ex?.citations).toContain('Va. Code § 58.1-811(D)');
    expect(ex?.text).toMatch(/Deed of Gift/);
    expect(ex?.text).toMatch(/grant and convey/);
  });

  it('always emits the gift-tax/basis advisory and the no-title-examination caveat', () => {
    const cats = notesFor(fullGift()).notes.map((n) => n.category);
    expect(cats).toContain('gift_tax');
    expect(cats).toContain('title_caveat');
    expect(cats).toContain('alternative'); // the TODD alternative
  });

  it('a non-individual party -> an ESCALATE note', () => {
    const n = notesFor({ ...fullGift(), grantors: [{ name: 'The Smith Family Trust' }] }).notes.find((x) => x.category === 'entity_party');
    expect(n?.severity).toBe('escalate');
  });

  it('multiple non-spouse grantees -> a JTWROS tenancy note citing §§ 55.1-134/135', () => {
    const n = notesFor({ ...fullGift(), grantees: [{ name: 'Owen Park' }, { name: 'Jenna Park' }] }).notes.find((x) => x.category === 'tenancy');
    expect(n?.text).toMatch(/joint tenants/i);
    expect(n?.citations.some((c) => c.includes('55.1-134') || c.includes('55.1-135'))).toBe(true);
  });

  it('married-couple grantees -> a TBE tenancy note citing § 55.1-136', () => {
    const n = notesFor({ ...fullGift(), grantees: [{ name: 'Owen Park' }, { name: 'Jenna Park' }], granteesAreMarriedCouple: true }).notes.find((x) => x.category === 'tenancy');
    expect(n?.text).toMatch(/tenants by the entirety/i);
    expect(n?.citations.some((c) => c.includes('55.1-136'))).toBe(true);
  });

  it('a name-reconciliation (B4) note surfaces the record owner from the packet', () => {
    const n = notesFor(fullGift()).notes.find((x) => x.category === 'name_reconciliation');
    expect(n?.text).toMatch(/Marcus T\. ELLISON|Priya ELLISON/);
  });

  it('unresolved placeholders -> an unresolved-facts note; none when fact-complete', () => {
    expect(notesFor({ ...fullGift(), fileNumber: null }).notes.some((n) => n.category === 'unresolved_facts')).toBe(true);
    expect(notesFor(fullGift()).notes.some((n) => n.category === 'unresolved_facts')).toBe(false);
  });

  it('renders a numbered "DELETE BEFORE RECORDING" page that is NOT spliced into the deed body', () => {
    const { rendered } = notesFor(fullGift());
    expect(rendered).toMatch(/^DRAFTER'S NOTES — DELETE BEFORE RECORDING/);
    expect(rendered).toMatch(/\n1\. \(/); // numbered
    // the deed body stays clean — the notes are separate; the fact-complete deed still passes B6:
    const draft = assembleGiftDeed(FACTS, fullGift());
    expect(draft.text).not.toContain("DRAFTER'S NOTES");
    expect(checkAnnotationLeak(draft.text).ok).toBe(true);
  });

  it('is deterministic — byte-identical on repeat', () => {
    expect(JSON.stringify(notesFor(fullGift()))).toBe(JSON.stringify(notesFor(fullGift())));
  });
});
