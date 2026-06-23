/**
 * DEED-DRAFT-AGENT-1 Inc 3 — the companion engagement-letter GENERATOR + Bien-Aime FORMATTER.
 *
 * The send-safety + professional-responsibility spine lives in the generated TEXT (the verbatim disclaimer /
 * representation clauses), so the heavy assertion weight is here: verbatim-clause presence (exact strings),
 * the deed cross-link (deed type / vesting / exemption identical to the deed), the conditional clauses, the
 * honesty floor ([[ ]] placeholders, never invented), and fail-closed spine integrity. The formatter is
 * presentation — tested for the canonical letterhead constant, the routing predicate, and that it produces a
 * section without throwing (NO Packer render — that produces "" locally per the known DOCX-render gotcha).
 */
import { describe, it, expect } from 'vitest';
import { consolidateDeedSourceFacts } from '../deed/deedSourceFacts.js';
import { assembleGiftDeed } from '../deed/deedGiftAssembler.js';
import { buildEngagementLetter, type EngagementLetterInput } from '../deed/deedEngagementLetter.js';
import {
  buildEngagementLetterSection,
  classifyEngagementLetterBlocks,
  isEngagementLetterDocType,
  MASON_LETTERHEAD,
  ENGAGEMENT_LETTER_DOC_TYPE,
} from '../deed/engagementLetterFormatter.js';

// ── verbatim protected-spine clauses (must appear EXACTLY) ──
const OPENING =
  'My firm is pleased to provide legal assistance regarding the matter referenced above. This engagement letter sets forth the terms, conditions, and objectives of the engagement and clarifies the nature and limitations of my services.';
const TITLE_SEARCH =
  'A title search of the Property and a judgment search of all persons involved in the title transfer may show how this Deed would affect the liens and encumbrances against the Property. A title search was not requested or performed in conjunction with drafting this Deed. The Mason Law Firm, PLC does not perform title searches, but I can order one if you wish. Please let me know in writing prior to proceeding if a title search is desired.';
const CLOSING =
  'If the foregoing is acceptable, please sign a copy of this letter in the space provided and return it to me. Please do not hesitate to let me know if you have any questions.';

const facts = consolidateDeedSourceFacts([]);

/** A JTWROS "addition to title" gift (Bien-Aime shape): donor gifts a half-interest, ending JTWROS with the donee. */
function jtwrosDeed() {
  return assembleGiftDeed(facts, {
    grantors: [{ name: 'Harold V. Greer' }],
    grantees: [{ name: 'Harold V. Greer' }, { name: 'Marie A. Bien-Aime' }],
  });
}
function soleOwnerDeed() {
  return assembleGiftDeed(facts, {
    grantors: [{ name: 'Marcus T. Ellison' }],
    grantees: [{ name: 'Hannah R. Ellison' }],
  });
}

const FULL_INPUT: EngagementLetterInput = {
  clientNames: ['Harold V. Greer'],
  granteeNames: ['Harold V. Greer', 'Marie A. Bien-Aime'],
  recipientNames: ['Marie A. Bien-Aime'],
  recipientPronoun: { subject: 'she', possessive: 'her' },
  date: 'June 18, 2026',
  clientAddress: '108 Maple Avenue\nManassas, Virginia 20110',
  salutation: 'Dear Mr. Greer:',
  propertyAddress: '500 Cedar Run Lane, Manassas, Virginia 20109',
  reAction: 'Addition of Marie A. Bien-Aime to Title',
  recordingCounty: 'Prince William County',
  feeAmount: '350.00',
};

describe('buildEngagementLetter — verbatim protected spine', () => {
  it('emits the opening, title-search disclaimer, and closing VERBATIM', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), FULL_INPUT);
    expect(letter.text).toContain(OPENING);
    expect(letter.text).toContain(TITLE_SEARCH);
    expect(letter.text).toContain(CLOSING);
    expect(letter.text).toContain('By signing below, you acknowledge that The Mason Law Firm, PLC cannot provide legal representation regarding these or other matters not specifically indicated.');
    expect(letter.text).toContain('AGREED AND ACCEPTED:');
    expect(letter.text).toContain('This letter correctly sets forth my understanding of the terms of this engagement.');
    expect(letter.text).toContain('Kelly Satterwhite, Esq. (VSB #91049)');
    expect(letter.spine.verbatimOk).toBe(true);
    expect(letter.spine.missingInvariants).toEqual([]);
  });

  it('spine.intact is TRUE when every spine slot is resolved', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), FULL_INPUT);
    expect(letter.spine.unresolvedFields).toEqual([]);
    expect(letter.spine.intact).toBe(true);
    expect(letter.placeholders).toEqual([]);
  });
});

describe('buildEngagementLetter — deed cross-link (letter and deed cannot disagree)', () => {
  it('deed type / exemption / vesting are taken from the companion deed', () => {
    const deed = jtwrosDeed();
    const letter = buildEngagementLetter(facts, deed, FULL_INPUT);
    expect(letter.crossLink.deedType).toBe('Deed of Gift');
    expect(letter.crossLink.exemptionCitation).toBe('Va. Code § 58.1-811(D)');
    expect(letter.crossLink.vesting).toBe(deed.vesting.language);
    // the recital echoes the deed's exact exemption citation + the deed's exact vesting language
    expect(letter.text).toContain('exempt from Virginia state and local recordation tax pursuant to Va. Code § 58.1-811(D).');
    expect(letter.text).toContain(deed.vesting.language);
    expect(letter.text).toContain('Enclosure: Deed of Gift');
  });

  it('JTWROS adds the survivorship tail; sole-owner does not', () => {
    const jt = buildEngagementLetter(facts, jtwrosDeed(), FULL_INPUT);
    expect(jt.conditionals.survivorshipTail).toBe(true);
    expect(jt.text).toContain('so that upon the death of either owner the entire fee simple interest in the Property will pass automatically to the survivor');

    const sole = buildEngagementLetter(facts, soleOwnerDeed(), {
      clientNames: ['Marcus T. Ellison'],
      granteeNames: ['Hannah R. Ellison'],
      recipientNames: ['Hannah R. Ellison'],
      recipientPronoun: { subject: 'she', possessive: 'her' },
      feeAmount: '350.00',
    });
    expect(sole.conditionals.survivorshipTail).toBe(false);
    expect(sole.text).not.toContain('pass automatically to the survivor');
  });
});

describe('buildEngagementLetter — separate representation (conditional)', () => {
  it('INCLUDES the separate-rep clause verbatim when a non-client recipient exists', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), FULL_INPUT);
    expect(letter.separateRepIncluded).toBe(true);
    expect(letter.text).toContain('I represent you, Harold V. Greer, alone in this matter. I do not represent Marie A. Bien-Aime, the recipient of an interest in the Property; she is not my client, and she may wish to consult her own counsel regarding this transfer.');
  });

  it('OMITS the separate-rep clause when there is no non-client recipient', () => {
    const letter = buildEngagementLetter(facts, soleOwnerDeed(), {
      clientNames: ['Marcus T. Ellison'],
      granteeNames: ['Marcus T. Ellison'],
      recipientNames: [],
      feeAmount: '350.00',
    });
    expect(letter.separateRepIncluded).toBe(false);
    expect(letter.text).not.toContain('the recipient of an interest in the Property');
    expect(letter.notes.some((n) => n.includes('Separate-representation clause OMITTED'))).toBe(true);
  });

  it('leaves a [[ ]] pronoun placeholder (fail-closed) for a single recipient with no pronoun supplied', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), {
      clientNames: ['Harold V. Greer'],
      granteeNames: ['Harold V. Greer', 'Marie A. Bien-Aime'],
      recipientNames: ['Marie A. Bien-Aime'],
      feeAmount: '350.00',
    });
    expect(letter.text).toContain('[[ recipient pronoun (subject) ]]');
    expect(letter.spine.unresolvedFields).toContain('recipient pronoun (subject)');
    expect(letter.spine.intact).toBe(false);
  });

  it('repeats the verbatim singular clause once per recipient (never the ungrammatical "they is")', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), {
      clientNames: ['Harold V. Greer'],
      granteeNames: ['Harold V. Greer', 'A', 'B'],
      recipientNames: ['Anna Doe', 'Ben Doe'],
      feeAmount: '350.00',
    });
    expect(letter.text).not.toContain('they is not my client');
    expect(letter.text).toContain('I do not represent Anna Doe, the recipient of an interest in the Property;');
    expect(letter.text).toContain('I do not represent Ben Doe, the recipient of an interest in the Property;');
    // each recipient's pronouns are a fail-closed placeholder (no per-recipient pronoun supplied)
    expect(letter.placeholders.filter((p) => p.field === 'recipient pronoun (subject)').length).toBe(2);
    expect(letter.spine.intact).toBe(false);
  });
});

describe('buildEngagementLetter — fee is NEVER invented (honesty floor)', () => {
  it('leaves [[ fee amount ]] and fails the spine when no fee is supplied', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), {
      clientNames: ['Harold V. Greer'],
      granteeNames: ['Harold V. Greer', 'Marie A. Bien-Aime'],
      recipientNames: ['Marie A. Bien-Aime'],
      recipientPronoun: { subject: 'she', possessive: 'her' },
    });
    expect(letter.text).toContain('The flat fee for this engagement is $[[ fee amount ]]');
    expect(letter.placeholders.some((p) => p.field === 'fee amount')).toBe(true);
    expect(letter.spine.unresolvedFields).toContain('fee amount');
    expect(letter.spine.intact).toBe(false);
  });

  it('inserts the supplied fee exactly', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), { ...FULL_INPUT, feeAmount: '1,250.00' });
    expect(letter.text).toContain('The flat fee for this engagement is $1,250.00, which covers my preparation and recording of the Deed of Gift.');
    expect(letter.text).toContain('Please provide a check for $1,250.00 payable to The Mason Law Firm, PLC.');
  });

  it('strips a leading $ the attorney typed (no doubled "$$")', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), { ...FULL_INPUT, feeAmount: '$5,000' });
    expect(letter.text).toContain('The flat fee for this engagement is $5,000,');
    expect(letter.text).not.toContain('$$');
  });
});

describe('buildEngagementLetter — survivorship tail cardinality', () => {
  it('uses the two-party form for two joint owners', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), FULL_INPUT);
    expect(letter.text).toContain('upon the death of either owner the entire fee simple interest in the Property will pass automatically to the survivor');
  });

  it('uses the count-neutral form for three or more joint owners (not "either owner")', () => {
    const deed = assembleGiftDeed(facts, {
      grantors: [{ name: 'A' }],
      grantees: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    });
    const letter = buildEngagementLetter(facts, deed, {
      clientNames: ['A'],
      granteeNames: ['A', 'B', 'C'],
      recipientNames: [],
      feeAmount: '350.00',
    });
    expect(letter.text).not.toContain('death of either owner');
    expect(letter.text).toContain("upon the death of any owner that owner's interest in the Property passes automatically to the surviving owners");
  });
});

describe('buildEngagementLetter — scope + conditional segments', () => {
  it('firm-records scope (default): "drafting and recording ... conclude upon recording"', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), FULL_INPUT);
    expect(letter.text).toContain('my representation in this matter is limited solely to drafting and recording the referenced Deed of Gift and will conclude upon recording.');
    expect(letter.conditionals.firmRecording).toBe(true);
  });

  it('not-recording variant: "drafting ... conclude upon completion of the Deed"', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), { ...FULL_INPUT, firmRecording: false });
    expect(letter.text).toContain('limited solely to drafting the referenced Deed of Gift and will conclude upon completion of the Deed.');
  });

  it('not-recording variant: the fee recital drops "recording" and the record-among-land-records sentence (no contradiction)', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), { ...FULL_INPUT, firmRecording: false });
    expect(letter.text).toContain('The flat fee for this engagement is $350.00, which covers my preparation of the Deed of Gift.');
    expect(letter.text).not.toContain('and recording of the Deed of Gift');
    expect(letter.text).not.toContain('I will have the Deed recorded among the land records');
    // a non-recording letter does not require a recording-locality slot
    expect(letter.placeholders.some((p) => p.field === 'recording locality')).toBe(false);
  });

  it('due-on-sale warning is included by default and removable', () => {
    const on = buildEngagementLetter(facts, jtwrosDeed(), FULL_INPUT);
    expect(on.text).toContain('this transfer could activate a due-on-sale clause in your loan terms');
    const off = buildEngagementLetter(facts, jtwrosDeed(), { ...FULL_INPUT, includeDueOnSale: false });
    expect(off.text).not.toContain('due-on-sale clause');
    expect(off.conditionals.dueOnSale).toBe(false);
  });

  it('basis-step-up sentence is gift-default and removable', () => {
    const on = buildEngagementLetter(facts, jtwrosDeed(), FULL_INPUT);
    expect(on.text).toContain('including the loss of any income-tax basis step-up on the gifted interest');
    const off = buildEngagementLetter(facts, jtwrosDeed(), { ...FULL_INPUT, includeBasisStepUp: false });
    expect(off.text).not.toContain('basis step-up');
  });
});

describe('buildEngagementLetter — header slots honesty floor', () => {
  it('unfilled header fields become [[ ]] placeholders (never invented)', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), {
      clientNames: ['Harold V. Greer'],
      granteeNames: ['Harold V. Greer', 'Marie A. Bien-Aime'],
      recipientNames: [],
    });
    const fields = letter.placeholders.map((p) => p.field);
    expect(fields).toContain('date');
    expect(fields).toContain('client address');
    expect(fields).toContain('salutation');
    expect(fields).toContain('property address');
    expect(fields).toContain('RE action');
    expect(fields).toContain('fee amount');
    // every placeholder carries a research lead (never a bare blank)
    expect(letter.placeholders.every((p) => p.researchLead.trim().length > 0)).toBe(true);
  });
});

describe('engagementLetterFormatter — Bien-Aime canonical', () => {
  it('letterhead is the operator-confirmed First Floor / 855-7380 (not the old 2nd Floor)', () => {
    expect(MASON_LETTERHEAD.contact).toContain('First Floor');
    expect(MASON_LETTERHEAD.contact).toContain('(703) 855-7380');
    expect(MASON_LETTERHEAD.contact).not.toContain('2nd Floor');
    expect(MASON_LETTERHEAD.firmName).toBe('THE MASON LAW FIRM, PLC');
  });

  it('routing predicate matches only the engagement_letter type', () => {
    expect(ENGAGEMENT_LETTER_DOC_TYPE).toBe('engagement_letter');
    expect(isEngagementLetterDocType('engagement_letter')).toBe(true);
    expect(isEngagementLetterDocType('deed')).toBe(false);
    expect(isEngagementLetterDocType(null)).toBe(false);
    expect(isEngagementLetterDocType(undefined)).toBe(false);
  });

  it('builds a section (letterhead + body + headers/footers) without throwing, even with placeholders', () => {
    const letter = buildEngagementLetter(facts, jtwrosDeed(), {
      clientNames: ['Harold V. Greer'],
      granteeNames: ['Harold V. Greer', 'Marie A. Bien-Aime'],
      recipientNames: ['Marie A. Bien-Aime'],
    });
    const section = buildEngagementLetterSection(letter.text, { watermarkText: 'DRAFT — NOT FINAL' });
    expect(Array.isArray(section.children)).toBe(true);
    expect(section.children.length).toBeGreaterThan(5);
    expect(section.headers?.default).toBeDefined();
    expect(section.footers?.default).toBeDefined();
  });

  it('classifier: an UNFILLED [[ salutation ]] still separates addressee from body (the disclaimer spine stays body, not addressee)', () => {
    // no salutation supplied -> the salutation block is the "[[ salutation ]]" placeholder
    const letter = buildEngagementLetter(facts, jtwrosDeed(), {
      clientNames: ['Harold V. Greer'],
      granteeNames: ['Harold V. Greer', 'Marie A. Bien-Aime'],
      recipientNames: ['Marie A. Bien-Aime'],
      recipientPronoun: { subject: 'she', possessive: 'her' },
      clientAddress: '108 Maple Avenue\nManassas, Virginia 20110',
      feeAmount: '350.00',
    });
    const classified = classifyEngagementLetterBlocks(letter.text);
    const salutation = classified.find((b) => b.role === 'salutation');
    expect(salutation?.text.trim()).toBe('[[ salutation ]]'); // anchored by position despite no "Dear …:" cue
    // the verbatim title-search disclaimer is classified as BODY (not addressee)
    const titleSearchBlock = classified.find((b) => b.text.includes('A title search was not requested or performed'));
    expect(titleSearchBlock?.role).toBe('body');
    // the addressee block (client name/address) precedes the salutation and is NOT body
    const addressee = classified.find((b) => b.role === 'addressee');
    expect(addressee?.text).toContain('Harold V. Greer');
  });
});
