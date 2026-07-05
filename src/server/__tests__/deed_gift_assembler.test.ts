/**
 * DEED-DRAFT-AGENT-1 Inc 1 — deterministic deed-of-gift assembly tests.
 *
 * Fixtures are SYNTHETIC deed-packet text (a prior vesting deed + a tax record), structurally faithful to the
 * Mason form (invented names/values; the real corpus is confidential). The acceptance bar (spec §6 / dispatch
 * §6) is that the agent reproduces the known-good §11.2 gift structure with the legal description VERBATIM,
 * correct vesting (JTWROS non-spouse / TBE married / sole owner), the § 58.1-811(D) exemption recital, and
 * [[ ]] placeholders + leads for genuinely-missing facts. Assertions are exact where it matters (the verbatim
 * legal block, the exemption-critical granting verb, the vesting phrase).
 */
import { describe, it, expect } from 'vitest';
import { consolidateDeedSourceFacts, type DeedMaterialInput } from '../deed/deedSourceFacts.js';
import { assembleGiftDeed, DEFAULT_GIFT_WARRANTY, type GiftDeedInput } from '../deed/deedGiftAssembler.js';
import { checkAnnotationLeak } from '../deed/deedDraftGates.js';
import { isDeedDraftAgentEnabled } from '../config/featureFlags.js';

// ── synthetic gift-packet fixtures ──────────────────────────────────────────────

// The prior vesting deed that gave the donors (the Ellisons) title (Greer -> Ellison couple).
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

const TAX_RECORD = [
  'REAL ESTATE ASSESSMENT',
  'Parcel No: 7298-44-1201',
  'Land Value: $120,000.00',
  'Improvement Value: $468,400.00',
  'Total Assessed Value: $588,400.00',
].join('\n');

// The exact verbatim legal description the extractor should surface (whitespace-normalized block).
const GIFT_LEGAL =
  'Lot 12, Section 3, CEDAR RUN ESTATES, as the same appears duly dedicated, platted and recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.';

const PACKET: DeedMaterialInput[] = [
  { materialId: 'mat-vesting', textContent: VESTING_DEED },
  { materialId: 'mat-tax', textContent: TAX_RECORD },
];

// A fully-specified gift: the Ellison couple gift to their daughter (single donee -> sole owner).
function fullGiftInput(): GiftDeedInput {
  return {
    grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Priya Ellison', descriptor: 'husband and wife' }],
    grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantors' daughter" }],
    fileNumber: '36-2026-7777',
    granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
    derivationReference: 'in Deed Book 5500 at Page 12',
  };
}

// ── consolidation ───────────────────────────────────────────────────────────────

describe('consolidateDeedSourceFacts — packet -> typed facts with provenance + honesty floor', () => {
  const facts = consolidateDeedSourceFacts(PACKET);

  it('surfaces the VERBATIM legal description from the vesting deed (EXACT) with provenance', () => {
    expect(facts.legalDescription.value).toBe(GIFT_LEGAL);
    expect(facts.legalDescription.withheld).toBe(false);
    expect(facts.legalDescription.sourceMaterialId).toBe('mat-vesting');
    expect(facts.legalDescription.sourceDocType).toBe('vesting_deed');
  });

  it('surfaces parties of record (reconciliation), parcel, assessed value, locality (EXACT)', () => {
    expect(facts.grantorOfRecord.values).toEqual(['Harold V. GREER']);
    expect(facts.granteeOfRecord.values).toEqual(['Marcus T. ELLISON', 'Priya ELLISON']);
    expect(facts.parcelId.value).toBe('7298-44-1201');
    expect(facts.parcelId.sourceDocType).toBe('tax_record'); // tax record preferred for the id
    expect(facts.assessedValue.value).toBe('588400.00');
    expect(facts.propertyLocality.value).toBe('Prince William County');
  });

  it('surfaces a derivation CANDIDATE (the BEING ref) as a lead, not an asserted value', () => {
    expect(facts.derivationCandidates.value).toBe('Deed Book 3000 at Page 100');
  });

  it('an empty / garbled packet yields absent facts + a no-vesting-deed warning (no throw)', () => {
    const r = consolidateDeedSourceFacts([{ materialId: 'x', textContent: '   ' }, { materialId: 'y', textContent: null }]);
    expect(r.legalDescription.value).toBeNull();
    expect(r.warnings).toContain('no_vesting_deed_in_packet');
  });
});

// ── assembly: the §11.2 gift structure ──────────────────────────────────────────

describe('assembleGiftDeed — house-style §11.2 Deed of Gift', () => {
  const facts = consolidateDeedSourceFacts(PACKET);
  const draft = assembleGiftDeed(facts, fullGiftInput());

  it('inserts the legal description VERBATIM as a standalone paragraph (C1-safe, never regenerated)', () => {
    expect(draft.verbatimLegalUsed).toBe(GIFT_LEGAL);
    expect(draft.text.split('\n\n')).toContain(GIFT_LEGAL); // exact paragraph, byte-for-byte
  });

  it('is exemption-safe: states "DEED OF GIFT", uses "grant and convey" (NOT bargain/sell), cites § 58.1-811(D)', () => {
    expect(draft.text).toContain('DEED OF GIFT');
    expect(draft.text).toContain('THIS DEED OF GIFT, made this');
    expect(draft.text).toContain('grant and convey');
    expect(draft.text).not.toMatch(/grant,\s*bargain,\s*sell/i); // would kill the § 58.1-811(D) exemption (P.D. 93-212)
    expect(draft.text).toContain('Exempt from recordation tax pursuant to Va. Code § 58.1-811(D), 1950 Code of Virginia, as amended.');
  });

  it('renders the parties premise with grantor descriptor + grantee relationship + correct labels (EXACT)', () => {
    expect(draft.text).toContain('by and between Marcus T. Ellison and Priya Ellison, husband and wife, (the "Grantors"), and Hannah R. Ellison, the Grantors\' daughter, (the "Grantee"),');
  });

  it('applies the Mason house warranty (§11.2) and the default consideration recital (§11.3, verbatim)', () => {
    expect(draft.warranty).toBe(DEFAULT_GIFT_WARRANTY);
    expect(draft.text).toContain('with General Warranty and English Covenants of title');
    expect(draft.text).toContain('for and in consideration of good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged');
  });

  it('carries the prep-block facts (file no., grantee address, parcel, assessed value, $0.00 consideration)', () => {
    expect(draft.text).toContain('File Number: 36-2026-7777');
    expect(draft.text).toContain("Grantee's Address: 123 Cedar Run Lane, Manassas, Virginia 20109");
    expect(draft.text).toContain('Tax I.D. Number: 7298-44-1201');
    expect(draft.text).toContain('Assessed Value: 588400.00');
    expect(draft.text).toContain('Consideration: $0.00');
    expect(draft.text).toContain('THIS DEED PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION — NO TITLE INSURANCE.');
  });

  it('all facts resolved -> factsResolved true, no placeholders, and PASSES the B6 annotation gate', () => {
    expect(draft.placeholders).toEqual([]);
    expect(draft.factsResolved).toBe(true);
    expect(checkAnnotationLeak(draft.text).ok).toBe(true); // no [[ ]] / stray markup in a fact-complete deed
  });

  it('execution fields remain blank "___" by design (a draft is not executed) — underscores pass B6', () => {
    expect(draft.text).toContain('made this ___ day of ____________, 20___');
    expect(draft.text).toContain('Notary Public');
    expect(draft.text).toMatch(/_{10,} \(SEAL\)/);
  });

  it('is deterministic — byte-identical on repeated assembly', () => {
    const a = assembleGiftDeed(facts, fullGiftInput());
    const b = assembleGiftDeed(facts, fullGiftInput());
    expect(a.text).toBe(b.text);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ── vesting rule ─────────────────────────────────────────────────────────────────

describe('vesting rule (§11.2): single -> sole owner; married -> TBE; multiple non-spouse -> JTWROS; override', () => {
  const facts = consolidateDeedSourceFacts(PACKET);
  const base = fullGiftInput();

  it('single grantee -> sole owner', () => {
    const d = assembleGiftDeed(facts, base);
    expect(d.vesting.key).toBe('sole_owner');
    expect(d.text).toContain('in fee simple, as sole owner,');
  });
  it('married-couple grantees -> tenants by the entirety (Mason gift form, §4/§11.2)', () => {
    const d = assembleGiftDeed(facts, {
      ...base,
      grantees: [{ name: 'Owen Park' }, { name: 'Jenna Park' }],
      granteesAreMarriedCouple: true,
    });
    expect(d.vesting.key).toBe('tenants_by_entirety');
    expect(d.text).toContain('as tenants by the entirety with the full common law right of survivorship'); // operator-ratified 2026-06-23
  });
  it('multiple non-spouse grantees -> JTWROS with the operator-ratified phrasing ("the common law")', () => {
    const d = assembleGiftDeed(facts, { ...base, grantees: [{ name: 'Owen Park' }, { name: 'Jenna Park' }] });
    expect(d.vesting.key).toBe('jtwros');
    expect(d.text).toContain('as joint tenants with the common law right of survivorship and not as tenants in common');
  });
  it('a married couple supplied as ONE grantee entry still vests TBE (flag not dropped), with a surfaced warning', () => {
    const d = assembleGiftDeed(facts, {
      ...base,
      grantees: [{ name: 'Owen Park and Jenna Park', descriptor: 'husband and wife' }],
      granteesAreMarriedCouple: true,
    });
    expect(d.vesting.key).toBe('tenants_by_entirety'); // NOT silently sole_owner
    expect(d.warnings).toContain('married_couple_flag_with_single_grantee_entry');
  });
  it('an override validated by KEY or CANONICAL LANGUAGE wins; an unverified override warns + falls back', () => {
    const byKey = assembleGiftDeed(facts, { ...base, vestingOverride: 'tenants_in_common' });
    expect(byKey.vesting.key).toBe('tenants_in_common');
    // canonical-language override (was previously discarded) now wins — and on a 2-donee deed this prevents a
    // silent flip to JTWROS:
    const byLang = assembleGiftDeed(facts, {
      ...base,
      grantees: [{ name: 'Owen Park' }, { name: 'Jenna Park' }],
      vestingOverride: 'as tenants in common',
    });
    expect(byLang.vesting.key).toBe('tenants_in_common');
    const bad = assembleGiftDeed(facts, { ...base, vestingOverride: 'nonsense' });
    expect(bad.vesting.key).toBe('sole_owner');
    expect(bad.warnings).toContain('vesting_override_unrecognized:nonsense');
  });
});

// ── fail-closed: missing facts -> placeholders + leads; never fabricated ─────────

describe('fail-closed: a genuinely-missing fact becomes a [[ ]] placeholder + lead, never a guess', () => {
  it('missing file number / grantee address -> placeholders, factsResolved false, FAILS B6', () => {
    const facts = consolidateDeedSourceFacts(PACKET);
    const d = assembleGiftDeed(facts, { ...fullGiftInput(), fileNumber: null, granteeAddress: undefined });
    expect(d.factsResolved).toBe(false);
    expect(d.placeholders.map((p) => p.field)).toEqual(expect.arrayContaining(['File number', "Grantee's address"]));
    d.placeholders.forEach((p) => {
      expect(p.researchLead.length).toBeGreaterThan(10); // every placeholder carries a concrete lead
      expect(d.text).toContain(p.token);
    });
    expect(checkAnnotationLeak(d.text).ok).toBe(false); // [[ ]] placeholders -> not yet recordable (B6 blocks)
  });

  it('a WITHHELD legal description (honesty floor) becomes a placeholder; the legal is NEVER fabricated', () => {
    // POISON-1-style truncated legal -> deedIngest withholds it.
    const truncated = [
      'THIS DEED, made this 2nd day of May, 2019, by and between Harold V. GREER, an unmarried man, (the "Grantor"), and Marcus T. ELLISON, (the "Grantee"),',
      'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with General Warranty, unto the said Grantee, in fee simple, as sole owner, all that parcel located in Prince William County, Commonwealth of Virginia, to wit:',
      '   Lot 12, Section 3, CEDAR RUN ESTATES,',
    ].join('\n');
    const facts = consolidateDeedSourceFacts([{ materialId: 'm', textContent: truncated }, { materialId: 't', textContent: TAX_RECORD }]);
    expect(facts.legalDescription.withheld).toBe(true);
    const d = assembleGiftDeed(facts, fullGiftInput());
    expect(d.verbatimLegalUsed).toBeNull();
    expect(d.factsResolved).toBe(false);
    expect(d.placeholders.some((p) => p.field === 'Legal description (VERBATIM)')).toBe(true);
    // the legal paragraph is the placeholder, NOT any guessed text:
    expect(d.text).toContain('[[ Legal description (VERBATIM) ]]');
    expect(d.text).not.toContain('CEDAR RUN ESTATES'); // never fabricated from the truncated fragment
  });

  it('an empty matter (no packet, no input) yields all-placeholder draft, factsResolved false, no throw', () => {
    const facts = consolidateDeedSourceFacts([]);
    const d = assembleGiftDeed(facts, { grantors: [], grantees: [] });
    expect(d.factsResolved).toBe(false);
    expect(d.placeholders.length).toBeGreaterThan(0);
    expect(d.warnings).toContain('no_grantor_provided');
  });
});

// ── factsResolved <-> B6 agreement (the recordability floor) ─────────────────────

describe('factsResolved agrees with the B6 annotation-leak floor (no false "ready" signal)', () => {
  const facts = consolidateDeedSourceFacts(PACKET);

  it('an attorney value carrying a B6 denylist char drives factsResolved=false AND b6.ok=false (they agree)', () => {
    for (const addr of ['123 Main St [Unit B]', 'c/o <agent>', 'Lot 5 * see note', '123 Main {ste 4}', '123 Main | rear']) {
      const d = assembleGiftDeed(facts, { ...fullGiftInput(), granteeAddress: addr });
      expect(d.placeholders).toEqual([]); // the value is present, just dirty
      expect(d.b6.ok).toBe(false);
      expect(d.factsResolved).toBe(false); // must NOT read as recordable-ready
      expect(d.factsResolved).toBe(checkAnnotationLeak(d.text).ok); // the invariant: the two always agree
    }
  });

  it('a marker word (TBD / ???) in an attorney value also blocks factsResolved', () => {
    const d = assembleGiftDeed(facts, { ...fullGiftInput(), fileNumber: '36-2026-???' });
    expect(d.b6.ok).toBe(false);
    expect(d.factsResolved).toBe(false);
    expect(d.warnings.some((w) => w.startsWith('annotation_leak_in_values'))).toBe(true);
  });

  it('a stray "*" inside the VERBATIM legal blocks factsResolved (the legal is still inserted verbatim, not stripped)', () => {
    const dirtyVesting = VESTING_DEED.replace('CEDAR RUN ESTATES,', 'CEDAR RUN ESTATES*,');
    const f = consolidateDeedSourceFacts([{ materialId: 'm', textContent: dirtyVesting }, { materialId: 't', textContent: TAX_RECORD }]);
    const d = assembleGiftDeed(f, fullGiftInput());
    expect(d.verbatimLegalUsed).toContain('CEDAR RUN ESTATES*'); // verbatim — NOT altered to remove the artifact
    expect(d.b6.ok).toBe(false);
    expect(d.factsResolved).toBe(false);
    expect(d.factsResolved).toBe(checkAnnotationLeak(d.text).ok);
  });

  it('the clean fact-complete deed: factsResolved=true AND b6.ok=true (they agree)', () => {
    const d = assembleGiftDeed(facts, fullGiftInput());
    expect(d.factsResolved).toBe(true);
    expect(d.b6.ok).toBe(true);
    expect(d.factsResolved).toBe(checkAnnotationLeak(d.text).ok);
  });
});

// ── consolidation determinism + honesty-floor preservation ───────────────────────

describe('consolidation is order-independent + preserves the honesty-floor withheld signal', () => {
  it('consolidateDeedSourceFacts is deep-equal regardless of material input order', () => {
    const a = consolidateDeedSourceFacts(PACKET);
    const b = consolidateDeedSourceFacts([...PACKET].reverse());
    expect(JSON.stringify(b.legalDescription)).toBe(JSON.stringify(a.legalDescription));
    expect(JSON.stringify(b.parcelId)).toBe(JSON.stringify(a.parcelId));
    expect(JSON.stringify(b.assessedValue)).toBe(JSON.stringify(a.assessedValue));
  });

  it('when every candidate for a fact is withheld, the consolidated fact preserves withheld=true (not absent)', () => {
    // a truncated legal -> deedIngest withholds it; consolidation must surface withheld, not silently absent.
    const truncated = [
      'THIS DEED, made this 2nd day of May, 2019, by and between Harold V. GREER, an unmarried man, (the "Grantor"), and Marcus T. ELLISON, (the "Grantee"),',
      'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with General Warranty, unto the said Grantee, in fee simple, as sole owner, all that parcel located in Prince William County, Commonwealth of Virginia, to wit:',
      '   Lot 12, Section 3, CEDAR RUN ESTATES,',
    ].join('\n');
    const f = consolidateDeedSourceFacts([{ materialId: 'm', textContent: truncated }]);
    expect(f.legalDescription.withheld).toBe(true);
    expect(f.legalDescription.value).toBeNull();
    expect(f.warnings).toContain('legal_description_withheld');
  });
});

// ── flag default ─────────────────────────────────────────────────────────────────

describe('feature flag', () => {
  it('DEED_DRAFT_AGENT_ENABLED defaults OFF (env unset in tests)', () => {
    expect(isDeedDraftAgentEnabled()).toBe(false);
  });
});

describe('DEED-INTAKE-POLISH-1 (YELLOW-6) — shared-couple grantor descriptor dedup', () => {
  const facts = consolidateDeedSourceFacts(PACKET);

  it('two grantors both "husband and wife" render as "A and B, husband and wife" (deduped to the pair)', () => {
    const draft = assembleGiftDeed(facts, {
      ...fullGiftInput(),
      grantors: [
        { name: 'Walter Testvendor', descriptor: 'husband and wife' },
        { name: 'Prudence Testvendor', descriptor: 'husband and wife' },
      ],
    });
    expect(draft.text).toContain('Walter Testvendor and Prudence Testvendor, husband and wife');
    expect(draft.text).not.toContain('Walter Testvendor, husband and wife and Prudence Testvendor');
  });

  it('a descriptor on one grantor only is unchanged (per-party render)', () => {
    const draft = assembleGiftDeed(facts, {
      ...fullGiftInput(),
      grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Priya Ellison', descriptor: 'husband and wife' }],
    });
    expect(draft.text).toContain('Marcus T. Ellison and Priya Ellison, husband and wife');
  });

  it('a single grantor with a descriptor renders per-party', () => {
    const draft = assembleGiftDeed(facts, {
      ...fullGiftInput(),
      grantors: [{ name: 'Solo Grantor', descriptor: 'an unmarried man' }],
    });
    expect(draft.text).toContain('Solo Grantor, an unmarried man');
  });
});
