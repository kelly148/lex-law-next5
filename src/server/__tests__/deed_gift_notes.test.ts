/**
 * DEED-DRAFT-AGENT-1 Inc 2 — deterministic drafter's-notes tests.
 *
 * The advisory layer must (a) ground every statutory citation in the verified KB (deedKbVa) — the hard
 * no-hallucinated-citation rule — (b) spot the right issues deterministically per the gift facts, and (c) keep
 * the notes OUT of the recordable deed body. Fixtures reuse the Inc-1 synthetic gift packet.
 */
import { describe, it, expect } from 'vitest';
import { consolidateDeedSourceFacts, type DeedSourceFacts } from '../deed/deedSourceFacts.js';
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

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// Inc 4 — deepened §3.6 issue-spotting catalog: warranty (always) + the three CONDITIONAL notes (estate
// windows, cross-source name mismatch, commitment-vs-vesting legal mismatch), each surfacing a decision/
// diligence point and NEVER deciding/advising/resolving. Fixtures that TRIGGER each + fixtures that do NOT.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════

// A probate / authority document (classifies as probate_authority; surfaces a decedent + fiduciary capacity).
const PROBATE_AUTHORITY = [
  'CERTIFICATE OF QUALIFICATION',
  'Circuit Court of Prince William County, Virginia. FI-2024-001234.',
  'The Last Will and Testament of Harold V. Greer, deceased, was admitted to probate.',
  'Marcus T. Ellison qualified as Executor of the Estate of Harold V. Greer, deceased, with full power to sell and convey.',
].join('\n');

// An estate-source VESTING DEED: the grantor signs in a fiduciary capacity for a decedent's estate.
const ESTATE_VESTING_DEED = [
  'THIS DEED, made this 2nd day of May, 2022, by and between Marcus T. ELLISON, Executor of the Estate of Harold V. Greer, deceased, (the "Grantor"), and Priya ELLISON, (the "Grantee"),',
  'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with Special Warranty, unto the said Grantee, in fee simple, as sole owner, all that parcel located in',
  'Prince William County, Commonwealth of Virginia, to wit:',
  '   Lot 12, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
  '   BEING the same property conveyed unto Harold V. Greer by Deed in Deed Book 3000 at Page 100.',
  'This conveyance is made subject to covenants of record.',
  'Tax I.D. Number: 7298-44-1201',
].join('\n');

// A title commitment whose Exhibit A legal description DIFFERS from the vesting deed's (Lot 12 vs Lot 21).
const COMMITMENT_LEGAL_MISMATCH = [
  'COMMITMENT FOR TITLE INSURANCE',
  'ALTA Commitment. Commitment No: 2026-0042.',
  'Proposed Insured: Hannah R. Ellison',
  'Schedule B-I Requirements to be met:',
  '4. Deed to be executed from Marcus T. Ellison and Priya Ellison to Hannah R. Ellison.',
  'Exhibit A: Lot 21, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
].join('\n');

// A title commitment whose Exhibit A legal description MATCHES the vesting deed's (no mismatch).
const COMMITMENT_LEGAL_MATCH = [
  'COMMITMENT FOR TITLE INSURANCE',
  'ALTA Commitment. Commitment No: 2026-0043.',
  'Proposed Insured: Hannah R. Ellison',
  'Schedule B-I Requirements to be met:',
  '4. Deed to be executed from Marcus T. Ellison and Priya Ellison to Hannah R. Ellison.',
  'Exhibit A: Lot 12, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
].join('\n');

function notesForFacts(facts: DeedSourceFacts, input: GiftDeedInput): ReturnType<typeof buildGiftDrafterNotes> {
  return buildGiftDrafterNotes(facts, input, assembleGiftDeed(facts, input));
}

describe('Inc 4 — warranty note (always-on decision point; never picks)', () => {
  it('emits a warranty note flagging general-vs-special as the attorney\'s decision, with the statutory cite', () => {
    const n = notesFor(fullGift()).notes.find((x) => x.category === 'warranty');
    expect(n).toBeTruthy();
    expect(n?.text).toMatch(/General/i);
    expect(n?.text).toMatch(/Special/i);
    // grounded on the verified warranty-shorthand statute (§§ 55.1-355, 55.1-356).
    expect(n?.citations.some((c) => c.includes('55.1-355') || c.includes('55.1-356'))).toBe(true);
  });

  it('the warranty note reflects the APPLIED warranty (re-spots when the attorney overrides to Special)', () => {
    const special = notesFor({ ...fullGift(), warranty: 'Special Warranty' }).notes.find((x) => x.category === 'warranty');
    expect(special?.text).toContain('Special Warranty');
  });
});

describe('Inc 4 — estate-window note (CONDITIONAL on an estate/decedent source)', () => {
  it('DORMANT for a pure inter-vivos gift (no estate source)', () => {
    expect(FACTS.estateSource.signaled).toBe(false);
    expect(notesFor(fullGift()).notes.some((n) => n.category === 'estate_window')).toBe(false);
  });

  it('FIRES when a probate/authority document is in the packet', () => {
    const facts = consolidateDeedSourceFacts([
      { materialId: 'v', textContent: VESTING_DEED },
      { materialId: 'p', textContent: PROBATE_AUTHORITY },
    ]);
    expect(facts.estateSource.signaled).toBe(true);
    expect(facts.estateSource.signals).toContain('probate_authority_document');
    const n = notesForFacts(facts, fullGift()).notes.find((x) => x.category === 'estate_window');
    expect(n).toBeTruthy();
    expect(n?.text).toMatch(/estate/i);
    expect(n?.text).toMatch(/creditor|lien|will-contest/i);
    // grounded on EXACTLY the on-point elective-share statute (the tangential heir-affidavit cite was dropped).
    expect(n?.citations).toEqual(['Va. Code §§ 64.2-308.5 through 64.2-308.10']);
  });

  it('FIRES when the vesting deed grantor is a decedent\'s estate (fiduciary capacity)', () => {
    const facts = consolidateDeedSourceFacts([{ materialId: 'v', textContent: ESTATE_VESTING_DEED }]);
    expect(facts.estateSource.signaled).toBe(true);
    expect(facts.estateSource.signals).toContain('vesting_grantor_decedent');
    expect(notesForFacts(facts, fullGift()).notes.some((n) => n.category === 'estate_window')).toBe(true);
  });
});

describe('Inc 4 — cross-source name discrepancy note (CONDITIONAL; never resolves)', () => {
  it('DORMANT when the named Grantor(s) match the vesting-deed record owner', () => {
    // FACTS record owners are Marcus T. ELLISON / Priya ELLISON; fullGift grantors match (case/period-insensitive).
    expect(notesFor(fullGift()).notes.some((n) => n.category === 'cross_source_name')).toBe(false);
  });

  it('FIRES when a named Grantor does NOT match any record owner across sources', () => {
    const n = notesFor({ ...fullGift(), grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Sandra Q. Vance' }] }).notes.find(
      (x) => x.category === 'cross_source_name',
    );
    expect(n).toBeTruthy();
    expect(n?.severity).toBe('escalate');
    expect(n?.text).toContain('Sandra Q. Vance');
    expect(n?.text).toMatch(/never sufficient|corroboration/i); // surfaces; never resolves on similarity
  });
});

describe('Inc 4 — commitment-vs-vesting legal-description mismatch note (CONDITIONAL; never resolves)', () => {
  it('DORMANT when no title commitment is in the packet', () => {
    expect(FACTS.commitmentLegalDescription.value).toBeNull();
    expect(notesFor(fullGift()).notes.some((n) => n.category === 'legal_mismatch')).toBe(false);
  });

  it('DORMANT when the commitment legal MATCHES the vesting-deed legal', () => {
    const facts = consolidateDeedSourceFacts([
      { materialId: 'v', textContent: VESTING_DEED },
      { materialId: 'c', textContent: COMMITMENT_LEGAL_MATCH },
    ]);
    expect(facts.commitmentLegalDescription.value).toBeTruthy();
    expect(notesForFacts(facts, fullGift()).notes.some((n) => n.category === 'legal_mismatch')).toBe(false);
  });

  it('FIRES when the commitment Exhibit A legal DIFFERS from the vesting-deed legal', () => {
    const facts = consolidateDeedSourceFacts([
      { materialId: 'v', textContent: VESTING_DEED },
      { materialId: 'c', textContent: COMMITMENT_LEGAL_MISMATCH },
    ]);
    // the vesting deed still WINS as the consolidated verbatim legal; the commitment legal is surfaced separately.
    expect(facts.legalDescription.sourceDocType).toBe('vesting_deed');
    expect(facts.commitmentLegalDescription.value).toContain('Lot 21');
    const n = notesForFacts(facts, fullGift()).notes.find((x) => x.category === 'legal_mismatch');
    expect(n).toBeTruthy();
    expect(n?.text).toMatch(/discrepancy|differs/i);
    expect(n?.text).toMatch(/does NOT resolve|not silently rewritten|surfaces the discrepancy/i);
  });
});

describe('Inc 4 — guardrail batteries: surface-not-decide + no-hallucinated-cite across all catalog items', () => {
  // exercise EVERY note across all triggering fixtures (warranty, estate, cross-source name, legal mismatch).
  const allNoteSets = (): ReturnType<typeof buildGiftDrafterNotes>[] => {
    const estateFacts = consolidateDeedSourceFacts([
      { materialId: 'v', textContent: VESTING_DEED },
      { materialId: 'p', textContent: PROBATE_AUTHORITY },
    ]);
    const mismatchFacts = consolidateDeedSourceFacts([
      { materialId: 'v', textContent: VESTING_DEED },
      { materialId: 'c', textContent: COMMITMENT_LEGAL_MISMATCH },
    ]);
    return [
      notesFor(fullGift()),
      notesFor({ ...fullGift(), warranty: 'Special Warranty' }),
      notesFor({ ...fullGift(), grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Sandra Q. Vance' }] }),
      notesForFacts(estateFacts, fullGift()),
      notesForFacts(mismatchFacts, fullGift()),
    ];
  };

  it('NO note text contains a decisive/advisory/resolving pattern (the notes only SURFACE) — SEMANTIC denylist', () => {
    // The denylist targets the SEMANTIC crossings independent of exact wording — a note that DECIDES, COMPUTES,
    // or ASSERTS A RESOLUTION trips it, regardless of the precise phrasing. (Broadened per review: the old
    // keyword list would have missed "Use Special Warranty for this gift.", "The discrepancy is harmless and can
    // be treated as resolved.", "a 40% gift-tax rate applies".)
    const decisivePatterns: RegExp[] = [
      // explicit second-/first-person decision instructions
      /\byou should (?:choose|use|select|pick|adopt|record|file|send)\b/i,
      /\bwe (?:recommend|advise|conclude)\b/i,
      /\bi recommend\b/i,
      // BARE-IMPERATIVE decision verb at a sentence start over a decision noun (warranty/TODD/JTWROS/tenancy/vesting)
      /(?:^|[.;]\s+)(?:use|select|choose|adopt|apply)\s+(?:a\s+|the\s+)?(?:general\s+warranty|special\s+warranty|todd|transfer on death deed|jtwros|joint tenan\w*|tenants?\b|tenancy|the\s+\w+\s+vesting)/i,
      /\bthe correct (?:warranty|vesting|structure|description|name) is\b/i,
      // recommendation SYNONYMS (independent of "recommend")
      /\b(?:advisable|preferable|the better choice|the best (?:choice|option)|best to|ought to)\b/i,
      // RESOLUTION-assertions for the never-resolve notes (name / legal-description discrepancies)
      /\b(?:harmless|can be treated as the same|is the same (?:person|property)|no (?:real )?discrepancy)\b/i,
      // a note must never ASSERT a discrepancy is resolved/safe (it only surfaces it). NB: the notes legitimately
      // say "does NOT resolve it" / "is never silently resolved" — exclude that exact surfacing language.
      /\b(?:treated as resolved|is resolved|has been resolved|may be disregarded|can be ignored)\b/i,
      // computed figures: a $-amount OR any percentage adjacent to a tax/value/rate word (no note computes one)
      /\$\s?\d[\d,]*(?:\.\d{2})?\b/,
      /\b\d+(?:\.\d+)?\s?%[^.]*\b(?:tax|rate|value|gift)\b/i,
      /\b(?:tax|rate|value|gift)[^.]*\b\d+(?:\.\d+)?\s?%/i,
    ];
    for (const set of allNoteSets()) {
      for (const note of set.notes) {
        for (const pat of decisivePatterns) {
          expect(note.text, `note(${note.category}) must not match ${pat}`).not.toMatch(pat);
        }
      }
    }
  });

  it('POSITIVE INVARIANT: every decision-point note carries an attorney-decides / does-not-resolve disclaimer', () => {
    // The real regression guard — a decision-point note MUST explicitly hand the decision back to the attorney
    // (or state it does not resolve/decide). A future edit that quietly drops the disclaimer turns the test RED.
    const disclaimer =
      /attorney(?:'s)? decision|the attorney decides|does not pick|never picks?|does NOT resolve|not silently (?:resolved|rewritten)|surfaces the discrepancy|never sufficient|supervising[- ]attorney|it does not advise|does not advise on or resolve/i;
    const decisionCategories = new Set(['warranty', 'cross_source_name', 'estate_window', 'legal_mismatch']);
    for (const set of allNoteSets()) {
      for (const note of set.notes) {
        if (decisionCategories.has(note.category)) {
          expect(note.text, `note(${note.category}) must carry a surface-not-decide disclaimer`).toMatch(disclaimer);
        }
      }
    }
  });

  it('EVERY citation on EVERY note (all catalog items, all fixtures) is a verified KB string', () => {
    for (const set of allNoteSets()) {
      for (const note of set.notes) {
        for (const cite of note.citations) {
          expect(VERIFIED_KB_CITES.has(cite), `unverified cite: ${cite}`).toBe(true);
        }
      }
    }
  });

  it('ON-POINT cite assertion: each note category carries EXACTLY its expected, on-point citation set', () => {
    // Membership-only (the prior test) ships a wrong-row bind green (the title_caveat MAJOR was exactly that).
    // Pin the SPECIFIC expected citation set per category so a wrong-row bind becomes RED, not a silent pass.
    const estateFacts = consolidateDeedSourceFacts([
      { materialId: 'v', textContent: VESTING_DEED },
      { materialId: 'p', textContent: PROBATE_AUTHORITY },
    ]);
    const expectedCites: Record<string, string[]> = {
      exemption: ['Va. Code § 58.1-811(D)'],
      warranty: ['Va. Code §§ 55.1-355, 55.1-356'],
      estate_window: ['Va. Code §§ 64.2-308.5 through 64.2-308.10'],
      gift_tax: [], // out-of-scope tax advisory — no statutory cite
      cross_source_name: [], // reconciliation/diligence flag — ungroundable, carries none
      legal_mismatch: [], // discrepancy-surfacing diligence flag — carries none
      title_caveat: [], // FIX 2: off-point § 58.1-801 dropped — this advisory carries NO cite
      unresolved_facts: [],
      diligence: [],
    };
    const checkSet = (set: ReturnType<typeof buildGiftDrafterNotes>): void => {
      for (const note of set.notes) {
        if (note.category in expectedCites) {
          expect(note.citations, `note(${note.category}) cite set`).toEqual(expectedCites[note.category]);
        }
      }
    };
    // the warranty fixture (always-on cats), the estate fixture (estate_window), and the entity fixture:
    checkSet(notesFor(fullGift()));
    checkSet(notesForFacts(estateFacts, fullGift()));
  });

  it('the title-caveat note carries NO citation (the off-point § 58.1-801 was dropped — FIX 2)', () => {
    const n = notesFor(fullGift()).notes.find((x) => x.category === 'title_caveat');
    expect(n).toBeTruthy();
    expect(n?.citations).toEqual([]);
  });

  it('the conditional notes stay OUT of the recordable deed body (B6 clean) on a fact-complete estate-free gift', () => {
    const draft = assembleGiftDeed(FACTS, fullGift());
    expect(draft.text).not.toContain("DRAFTER'S NOTES");
    expect(draft.text).not.toContain('Cross-source name discrepancy');
    expect(draft.text).not.toContain('estate / decedent source');
    expect(checkAnnotationLeak(draft.text).ok).toBe(true);
  });
});
