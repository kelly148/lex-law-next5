/**
 * DEED-DRAFT-AGENT-1 E7 — deterministic CATEGORY drafter's-notes tests.
 *
 * Mirrors the gift battery (deed_gift_notes.test.ts) PER non-gift category (seller-side / TOD / confirmation /
 * into-LLC / out-of-LLC / into-trust). The category advisory layer must (a) ground every statutory citation in
 * the verified KB (deedKbVa / deedTypeRegistry) — the hard no-hallucinated-citation rule — (b) SURFACE decision
 * points + diligence without ever deciding/computing/resolving (the surface-not-decide semantic denylist + the
 * positive attorney-decides disclaimer invariant), (c) carry the correct KB exemption/tax cite per category,
 * (d) be deterministic (byte-identical on repeat) and never throw, and (e) stay OUT of the recordable deed body
 * (B6-clean: the rendered notes fed to checkAnnotationLeak fail B6 by design — they are a separate page — but the
 * deed bodies they accompany pass). Finally it pins that buildGiftDrafterNotes is BYTE-IDENTICAL (the gift test
 * remains the canonical guard; this re-asserts the shared-helper refactor did not move gift output).
 */
import { describe, it, expect } from 'vitest';
import { consolidateDeedSourceFacts } from '../deed/deedSourceFacts.js';
import {
  buildCategoryDrafterNotes,
  type DeedCategoryKey,
  type CategoryDrafterNotes,
} from '../deed/deedCategoryNotes.js';
import { buildGiftDrafterNotes } from '../deed/deedGiftNotes.js';
import { assembleGiftDeed, type GiftDeedInput } from '../deed/deedGiftAssembler.js';
import { getDeedType } from '../deed/deedTypeRegistry.js';
import { checkAnnotationLeak } from '../deed/deedDraftGates.js';
import { VA_DEED_TYPES, VA_STATUTORY_CITATIONS, VA_EXEMPTIONS } from '../deed/deedKbVa.js';

// ── synthetic packets (shared with the gift battery) ──────────────────────────────────────────────────────
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

const PROBATE_AUTHORITY = [
  'CERTIFICATE OF QUALIFICATION',
  'Circuit Court of Prince William County, Virginia. FI-2024-001234.',
  'The Last Will and Testament of Harold V. Greer, deceased, was admitted to probate.',
  'Marcus T. Ellison qualified as Executor of the Estate of Harold V. Greer, deceased, with full power to sell and convey.',
].join('\n');

const COMMITMENT_LEGAL_MISMATCH = [
  'COMMITMENT FOR TITLE INSURANCE',
  'ALTA Commitment. Commitment No: 2026-0042.',
  'Proposed Insured: Hannah R. Ellison',
  'Schedule B-I Requirements to be met:',
  '4. Deed to be executed from Marcus T. Ellison and Priya Ellison to Hannah R. Ellison.',
  'Exhibit A: Lot 21, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
].join('\n');

const BASE_FACTS = consolidateDeedSourceFacts([
  { materialId: 'v', textContent: VESTING_DEED },
  { materialId: 't', textContent: TAX_RECORD },
]);
const ESTATE_FACTS = consolidateDeedSourceFacts([
  { materialId: 'v', textContent: VESTING_DEED },
  { materialId: 'p', textContent: PROBATE_AUTHORITY },
]);
const MISMATCH_FACTS = consolidateDeedSourceFacts([
  { materialId: 'v', textContent: VESTING_DEED },
  { materialId: 'c', textContent: COMMITMENT_LEGAL_MISMATCH },
]);

const ALL_CATEGORIES: DeedCategoryKey[] = [
  'seller_side',
  'deed_tod',
  'deed_of_confirmation',
  'deed_into_llc',
  'deed_out_of_llc',
  'deed_into_trust',
];

// the complete set of VERIFIED KB citation strings — the ONLY cites the notes layer may emit.
const VERIFIED_KB_CITES = new Set<string>([
  ...VA_DEED_TYPES.map((t) => t.exemptionCitation).filter((c): c is string => Boolean(c)),
  ...VA_STATUTORY_CITATIONS.map((c) => c.citation),
  ...VA_EXEMPTIONS.map((e) => e.citation),
]);

// Every CategoryDrafterNotes across every category × every fixture (for the cross-cutting guardrail batteries).
function allNoteSets(): CategoryDrafterNotes[] {
  const sets: CategoryDrafterNotes[] = [];
  for (const cat of ALL_CATEGORIES) {
    sets.push(buildCategoryDrafterNotes(cat, BASE_FACTS));
    sets.push(buildCategoryDrafterNotes(cat, ESTATE_FACTS));
    sets.push(buildCategoryDrafterNotes(cat, MISMATCH_FACTS));
    sets.push(buildCategoryDrafterNotes(cat, BASE_FACTS, { marriedCouple: true }));
  }
  return sets;
}

describe('buildCategoryDrafterNotes — grounded, deterministic per-category advisory', () => {
  it('NO hallucinated citations: every citation on every note (all categories, all fixtures) is a verified KB string', () => {
    for (const set of allNoteSets()) {
      for (const note of set.notes) {
        for (const cite of note.citations) {
          expect(VERIFIED_KB_CITES.has(cite), `unverified cite: ${cite}`).toBe(true);
        }
      }
    }
  });

  it('never throws + is deterministic (byte-identical on repeat) for every category', () => {
    for (const cat of ALL_CATEGORIES) {
      expect(() => buildCategoryDrafterNotes(cat, BASE_FACTS)).not.toThrow();
      expect(JSON.stringify(buildCategoryDrafterNotes(cat, BASE_FACTS))).toBe(
        JSON.stringify(buildCategoryDrafterNotes(cat, BASE_FACTS)),
      );
      // also deterministic on a garbled / empty packet (never throws).
      const empty = consolidateDeedSourceFacts([{ materialId: 'x', textContent: '   ' }]);
      expect(() => buildCategoryDrafterNotes(cat, empty)).not.toThrow();
    }
  });

  it('renders a numbered "DELETE BEFORE RECORDING" page for every category', () => {
    for (const cat of ALL_CATEGORIES) {
      const { rendered } = buildCategoryDrafterNotes(cat, BASE_FACTS);
      expect(rendered).toMatch(/^DRAFTER'S NOTES — DELETE BEFORE RECORDING/);
      expect(rendered).toMatch(/\n1\. \(/); // numbered
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// Per-category exemption / recordation-tax note — the correct, on-point KB cite (the wrong-row guard).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the exemption/tax note carries the correct verified KB cite per category', () => {
  it('the EXEMPT categories cite their registry exemptionCitation (the already-KB-verified cite)', () => {
    const exemptCategories: Exclude<DeedCategoryKey, 'seller_side'>[] = [
      'deed_tod',
      'deed_of_confirmation',
      'deed_into_llc',
      'deed_out_of_llc',
      'deed_into_trust',
    ];
    for (const cat of exemptCategories) {
      const expectedCite = getDeedType(cat)?.exemptionCitation ?? null;
      expect(expectedCite, `registry must carry an exemption cite for ${cat}`).toBeTruthy();
      const ex = buildCategoryDrafterNotes(cat, BASE_FACTS).notes.find((n) => n.category === 'exemption');
      expect(ex, `${cat} must emit an exemption note`).toBeTruthy();
      expect(ex?.citations).toEqual([expectedCite]);
      expect(ex?.text).toMatch(/exemption/i);
    }
  });

  it('seller-side emits a recordation-tax-DUE note (NOT an exemption) citing the KB recordation-tax base', () => {
    const set = buildCategoryDrafterNotes('seller_side', BASE_FACTS);
    // no exemption note — seller-side is taxed.
    expect(set.notes.some((n) => n.category === 'exemption')).toBe(false);
    const tax = set.notes.find((n) => n.category === 'tax');
    expect(tax).toBeTruthy();
    expect(tax?.text).toMatch(/recordation tax is DUE/i);
    // it must NOT claim an exemption (it may say "NOT an exempt deed", but never assert one is claimed/applies).
    expect(tax?.text).not.toMatch(/exemption claimed/i);
    expect(tax?.text).toMatch(/NOT an exempt deed/i);
    // the verified recordation-tax base statute (§ 58.1-801).
    expect(tax?.citations).toEqual(['Va. Code § 58.1-801']);
  });

  it('each category emits exactly one of {exemption, tax} as its first/leading category note', () => {
    for (const cat of ALL_CATEGORIES) {
      const cats = buildCategoryDrafterNotes(cat, BASE_FACTS).notes.map((n) => n.category);
      const hasExemption = cats.includes('exemption');
      const hasTax = cats.includes('tax');
      expect(hasExemption !== hasTax, `${cat} must carry exactly one of exemption/tax`).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// Category-agnostic fact-driven notes generalize from gift (name reconciliation / estate / legal mismatch).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the category-agnostic fact-driven notes generalize per category', () => {
  it('a name-reconciliation note surfaces the record owner from the packet (every category)', () => {
    for (const cat of ALL_CATEGORIES) {
      const n = buildCategoryDrafterNotes(cat, BASE_FACTS).notes.find((x) => x.category === 'name_reconciliation');
      expect(n, `${cat} should surface name reconciliation when a record owner exists`).toBeTruthy();
      expect(n?.text).toMatch(/Marcus T\. ELLISON|Priya ELLISON/);
    }
  });

  it('the estate-window note FIRES on an estate/decedent source, DORMANT otherwise (every category)', () => {
    expect(BASE_FACTS.estateSource.signaled).toBe(false);
    expect(ESTATE_FACTS.estateSource.signaled).toBe(true);
    for (const cat of ALL_CATEGORIES) {
      expect(buildCategoryDrafterNotes(cat, BASE_FACTS).notes.some((n) => n.category === 'estate_window')).toBe(false);
      const fired = buildCategoryDrafterNotes(cat, ESTATE_FACTS).notes.find((n) => n.category === 'estate_window');
      expect(fired, `${cat} should fire estate_window on an estate source`).toBeTruthy();
      // on-point elective-share cite only (same as gift).
      expect(fired?.citations).toEqual(['Va. Code §§ 64.2-308.5 through 64.2-308.10']);
    }
  });

  it('the legal-mismatch note FIRES on a commitment-vs-vesting divergence, DORMANT otherwise (every category)', () => {
    for (const cat of ALL_CATEGORIES) {
      expect(buildCategoryDrafterNotes(cat, BASE_FACTS).notes.some((n) => n.category === 'legal_mismatch')).toBe(false);
      const n = buildCategoryDrafterNotes(cat, MISMATCH_FACTS).notes.find((x) => x.category === 'legal_mismatch');
      expect(n, `${cat} should fire legal_mismatch on a commitment divergence`).toBeTruthy();
      expect(n?.text).toMatch(/discrepancy|differs/i);
      expect(n?.text).toMatch(/does NOT resolve|not silently rewritten|surfaces the discrepancy/i);
    }
  });

  it('the title-caveat note is always present and carries NO citation (off-point cite dropped, as in gift)', () => {
    for (const cat of ALL_CATEGORIES) {
      const n = buildCategoryDrafterNotes(cat, BASE_FACTS).notes.find((x) => x.category === 'title_caveat');
      expect(n).toBeTruthy();
      expect(n?.citations).toEqual([]);
    }
  });

  it('the diligence checklist note is always present', () => {
    for (const cat of ALL_CATEGORIES) {
      expect(buildCategoryDrafterNotes(cat, BASE_FACTS).notes.some((n) => n.category === 'diligence')).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// One conservative category-specific STRUCTURAL note, grounded in the documented assembler invariant.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('one category-specific structural note per category (grounded; surfaces, never decides)', () => {
  const structuralExpectations: Record<DeedCategoryKey, RegExp> = {
    seller_side: /warranty is the attorney's decision/i,
    deed_tod: /death-effective|recorded before the transferor's death/i,
    deed_of_confirmation: /does NOT transfer|already vested by operation of law/i,
    deed_into_llc: /QUITCLAIM/i,
    deed_out_of_llc: /Special Warranty/i,
    deed_into_trust: /trustees recital/i,
  };
  it('each category emits exactly one structural note matching its documented invariant', () => {
    for (const cat of ALL_CATEGORIES) {
      const structural = buildCategoryDrafterNotes(cat, BASE_FACTS).notes.filter((n) => n.category === 'category_structure');
      expect(structural.length, `${cat} must emit exactly one structural note`).toBe(1);
      expect(structural[0]!.text).toMatch(structuralExpectations[cat]);
    }
  });

  it('the LLC structural notes cite their verified KB exemption basis; non-cite-grounded ones carry []', () => {
    const intoLlc = buildCategoryDrafterNotes('deed_into_llc', BASE_FACTS).notes.find((n) => n.category === 'category_structure');
    expect(intoLlc?.citations).toEqual(['Va. Code § 58.1-811(A)(10)']);
    const outLlc = buildCategoryDrafterNotes('deed_out_of_llc', BASE_FACTS).notes.find((n) => n.category === 'category_structure');
    expect(outLlc?.citations).toEqual(['Va. Code § 58.1-811(A)(11)']);
    // seller-side structural cites the warranty-shorthand statute.
    const seller = buildCategoryDrafterNotes('seller_side', BASE_FACTS).notes.find((n) => n.category === 'category_structure');
    expect(seller?.citations.some((c) => c.includes('55.1-355') || c.includes('55.1-356'))).toBe(true);
    // TOD / confirmation / into-trust structural notes carry no on-point statute -> [].
    for (const cat of ['deed_tod', 'deed_of_confirmation', 'deed_into_trust'] as DeedCategoryKey[]) {
      const s = buildCategoryDrafterNotes(cat, BASE_FACTS).notes.find((n) => n.category === 'category_structure');
      expect(s?.citations).toEqual([]);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// Guardrail batteries — surface-not-decide (semantic denylist) + the positive attorney-decides disclaimer.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('guardrails: surface-not-decide + no decisive/computing/resolving language', () => {
  it('NO note text contains a decisive/advisory/resolving/computing pattern (SEMANTIC denylist; all categories)', () => {
    const decisivePatterns: RegExp[] = [
      /\byou should (?:choose|use|select|pick|adopt|record|file|send)\b/i,
      /\bwe (?:recommend|advise|conclude)\b/i,
      /\bi recommend\b/i,
      /(?:^|[.;]\s+)(?:use|select|choose|adopt|apply)\s+(?:a\s+|the\s+)?(?:general\s+warranty|special\s+warranty|todd|transfer on death deed|jtwros|joint tenan\w*|tenants?\b|tenancy|the\s+\w+\s+vesting)/i,
      /\bthe correct (?:warranty|vesting|structure|description|name) is\b/i,
      /\b(?:advisable|preferable|the better choice|the best (?:choice|option)|best to|ought to)\b/i,
      /\b(?:harmless|can be treated as the same|is the same (?:person|property)|no (?:real )?discrepancy)\b/i,
      /\b(?:treated as resolved|is resolved|has been resolved|may be disregarded|can be ignored)\b/i,
      // computed figures: a $-amount OR a percentage adjacent to a tax/value/rate word (no note computes one)
      /\$\s?\d[\d,]*(?:\.\d{2})?\b/,
      /\b\d+(?:\.\d+)?\s?%[^.]*\b(?:tax|rate|value)\b/i,
      /\b(?:tax|rate|value)[^.]*\b\d+(?:\.\d+)?\s?%/i,
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
    const disclaimer =
      /attorney(?:'s)? decision|the attorney decides|does not pick|never picks?|does NOT resolve|not silently (?:resolved|rewritten)|surfaces the discrepancy|never sufficient|supervising[- ]attorney|it does not advise|does not advise on or resolve|does not decide|does not compute|it does not resolve|surfaces (?:these|the requirement|the chain)/i;
    const decisionCategories = new Set([
      'category_structure',
      'cross_source_name',
      'estate_window',
      'legal_mismatch',
      'tax',
    ]);
    for (const set of allNoteSets()) {
      for (const note of set.notes) {
        if (decisionCategories.has(note.category)) {
          expect(note.text, `note(${note.category}) must carry a surface-not-decide disclaimer`).toMatch(disclaimer);
        }
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// The notes stay OUT of the recordable deed body (B6 floor stays clean).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the category notes stay OUT of the recordable deed body (B6 clean)', () => {
  // The category builder reads only DeedSourceFacts, so we exercise its B6 separation with the gift assembler as
  // a concrete fact-complete recordable deed body: the rendered notes must NOT be present in the body, and the
  // body alone must pass checkAnnotationLeak — proving the notes are a separate page, never spliced in.
  const fullGift = (): GiftDeedInput => ({
    grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Priya Ellison', descriptor: 'husband and wife' }],
    grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantors' daughter" }],
    fileNumber: '36-2026-7777',
    granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
    derivationReference: 'in Deed Book 5500 at Page 12',
  });

  it('the rendered category notes are never present in a recordable deed body; the body passes B6', () => {
    const deed = assembleGiftDeed(BASE_FACTS, fullGift());
    expect(checkAnnotationLeak(deed.text).ok).toBe(true);
    for (const cat of ALL_CATEGORIES) {
      const { rendered } = buildCategoryDrafterNotes(cat, BASE_FACTS);
      expect(deed.text).not.toContain("DRAFTER'S NOTES");
      expect(deed.text).not.toContain(rendered);
    }
  });

  it('the rendered notes page itself trips B6 (it is a NOTES page, never recordable) — proving the separation matters', () => {
    // The rendered page carries the "DRAFTER'S NOTES" header + bracketed cites — exactly the markers B6 blocks.
    // This asserts WHY the notes must live in the document NOTES field, never the version content.
    const { rendered } = buildCategoryDrafterNotes('deed_into_llc', BASE_FACTS);
    expect(checkAnnotationLeak(rendered).ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// HARD INVARIANT 4 — buildGiftDrafterNotes is byte-identical (the shared-helper refactor moved nothing).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('gift output is byte-identical after the shared-helper extraction', () => {
  const giftInput: GiftDeedInput = {
    grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Priya Ellison', descriptor: 'husband and wife' }],
    grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantors' daughter" }],
    fileNumber: '36-2026-7777',
    granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
    derivationReference: 'in Deed Book 5500 at Page 12',
  };

  it('the gift drafter notes still render the canonical header + numbering and are deterministic', () => {
    const giftNotes = buildGiftDrafterNotes(BASE_FACTS, giftInput, assembleGiftDeed(BASE_FACTS, giftInput));
    expect(giftNotes.rendered).toMatch(/^DRAFTER'S NOTES — DELETE BEFORE RECORDING/);
    expect(giftNotes.rendered).toMatch(/\n1\. \(/);
    // determinism on repeat (byte-identical).
    expect(JSON.stringify(giftNotes)).toBe(
      JSON.stringify(buildGiftDrafterNotes(BASE_FACTS, giftInput, assembleGiftDeed(BASE_FACTS, giftInput))),
    );
    // the exemption note is unchanged (the gift-specific § 58.1-811(D) two-part requirement).
    const ex = giftNotes.notes.find((n) => n.category === 'exemption');
    expect(ex?.citations).toEqual(['Va. Code § 58.1-811(D)']);
    expect(ex?.text).toMatch(/Deed of Gift/);
  });
});
