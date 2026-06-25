/**
 * DEED-DRAFT-AGENT-1 — deterministic recordability gates (§2.1.6), fail-closed unit tests.
 *
 * Fixtures are SYNTHETIC — structurally faithful to the three corpus patterns (living-individual seller;
 * testate estate via executor; grantor name-change + condo) but with INVENTED names/numbers. No real client
 * data (the corpus deeds are confidential). The tests assert the FIRE-ruled fail-closed behavior: divergent
 * legal → C1 fails; missing required grantor → C2 fails; annotation/markdown leak → B6 fails; typo → format
 * fails — and that legitimate deed content (e.g. signature underscore lines) does NOT false-trip.
 */
import { describe, it, expect } from 'vitest';
import {
  checkLegalDescription,
  checkRequiredParties,
  checkAnnotationLeak,
  checkFormatLints,
  runRecordabilityGates,
  renderLocality,
} from '../deed/deedDraftGates.js';

describe('renderLocality (S2 shared locality contract)', () => {
  it('bare style (default): county -> "<Name> County", city -> "City of <Name>"', () => {
    expect(renderLocality({ type: 'county', name: 'Fairfax' })).toBe('Fairfax County');
    expect(renderLocality({ type: 'city', name: 'Alexandria' })).toBe('City of Alexandria');
  });
  it('"of" style: county -> "County of <Name>", city -> "City of <Name>"', () => {
    expect(renderLocality({ type: 'county', name: 'Prince William', style: 'of' })).toBe('County of Prince William');
    expect(renderLocality({ type: 'city', name: 'Falls Church', style: 'of' })).toBe('City of Falls Church');
  });
  it('strips an existing County / City / "County of" / "City of" affix so the form never doubles', () => {
    expect(renderLocality({ type: 'county', name: 'Fairfax County' })).toBe('Fairfax County');
    expect(renderLocality({ type: 'county', name: 'County of Fairfax' })).toBe('Fairfax County');
    expect(renderLocality({ type: 'city', name: 'City of Manassas' })).toBe('City of Manassas');
    expect(renderLocality({ type: 'county', name: 'the County of Loudoun', style: 'of' })).toBe('County of Loudoun');
  });
});

// ── SYNTHETIC fixtures ────────────────────────────────────────────────────────

const LEGAL_RIVERS =
  'Lot 17, Block C, Section 3, NEWINGTON GREEN SUBDIVISION, as the same appears duly dedicated, platted and ' +
  'recorded in Deed Book 4821 at Page 119, among the land records of Fairfax County, Virginia.';

// A clean, fully-resolved synthetic deed body (includes a signature underscore line on purpose).
const CLEAN_DEED_TEXT = [
  'THIS DEED, made this ___ day of June, 2026, by and between JORDAN A. RIVERS and CASEY L. RIVERS,',
  '(the "Grantors"), and TAYLOR M. BROOKS, (the "Grantee"),',
  'WITNESSETH: That for and in consideration of the sum of Three Hundred Fifty Thousand and 00/100 Dollars',
  '($350,000.00), the Grantors do hereby grant, bargain, sell and convey, with General Warranty and English',
  'Covenants of title, unto the said Grantee, in fee simple, all of the following parcel of real property,',
  'located in Fairfax County, Commonwealth of Virginia, to wit:',
  LEGAL_RIVERS,
  'BEING the same property conveyed unto the Grantors by Deed dated May 2, 2014, recorded in Deed Book 4821',
  'at Page 119. This conveyance is made subject to covenants, conditions, restrictions, easements and rights',
  'of way of record.',
  'WITNESS the following signature and seal:',
  '____________________________ (SEAL)',
  'JORDAN A. RIVERS',
].join('\n');

describe('C1 — two-prong legal-description verification (fail-closed)', () => {
  it('passes when the draft is verbatim from the commitment AND reconciles to the prior deed', () => {
    const r = checkLegalDescription({
      draftLegal: LEGAL_RIVERS,
      commitmentExhibitA: LEGAL_RIVERS,
      priorDeedLegal: LEGAL_RIVERS.toUpperCase(), // case differs across docs — reconciliation is case-folded
    });
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('FAILS closed when the draft legal is not verbatim from the commitment Exhibit A', () => {
    const r = checkLegalDescription({
      draftLegal: LEGAL_RIVERS.replace('Lot 17', 'Lot 18'), // a wrong lot — the catastrophic case
      commitmentExhibitA: LEGAL_RIVERS,
      priorDeedLegal: LEGAL_RIVERS,
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/prong \(a\)/);
  });

  it('FAILS closed when the commitment does not reconcile to the prior vesting deed', () => {
    const r = checkLegalDescription({
      draftLegal: LEGAL_RIVERS,
      commitmentExhibitA: LEGAL_RIVERS,
      priorDeedLegal: LEGAL_RIVERS.replace('Page 119', 'Page 200'),
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/prong \(b\)/);
  });

  it('FAILS closed when the prior deed legal is missing (cannot reconcile)', () => {
    const r = checkLegalDescription({ draftLegal: LEGAL_RIVERS, commitmentExhibitA: LEGAL_RIVERS, priorDeedLegal: '' });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/prior vesting deed legal description is missing/);
  });

  it('condo: passes on exact Declaration + Plat instrument match', () => {
    const r = checkLegalDescription({
      draftLegal: 'Unit 204, HEATHCOTE COMMONS, A CONDOMINIUM',
      commitmentExhibitA: 'Unit 204, HEATHCOTE COMMONS, A CONDOMINIUM',
      priorDeedLegal: 'Unit 204, Heathcote Commons, a Condominium',
      condo: {
        draftDeclarationInstrument: '200612150098765',
        draftPlatInstrument: '200612150098766',
        sourceDeclarationInstrument: '200612150098765',
        sourcePlatInstrument: '200612150098766',
      },
    });
    expect(r.ok).toBe(true);
  });

  it('condo: FAILS closed on a botched Plat instrument number', () => {
    const r = checkLegalDescription({
      draftLegal: 'Unit 204, HEATHCOTE COMMONS, A CONDOMINIUM',
      commitmentExhibitA: 'Unit 204, HEATHCOTE COMMONS, A CONDOMINIUM',
      priorDeedLegal: 'Unit 204, HEATHCOTE COMMONS, A CONDOMINIUM',
      condo: {
        draftDeclarationInstrument: '200612150098765',
        draftPlatInstrument: '200612150099999', // wrong
        sourceDeclarationInstrument: '200612150098765',
        sourcePlatInstrument: '200612150098766',
      },
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/Plat instrument/);
  });
});

describe('C2 — required-party / authority reconciliation (fail-closed)', () => {
  it('passes when the grantor set equals Sch. B-I Req. 4 and each carries authority', () => {
    const r = checkRequiredParties({
      draftGrantors: ['Jordan A. Rivers', 'Casey L. Rivers'],
      requiredParties: ['Casey L. Rivers', 'Jordan A. Rivers'], // order-independent
      authorityByGrantor: {
        'Jordan A. Rivers': 'prior vesting deed DB 4821 PG 119',
        'Casey L. Rivers': 'prior vesting deed DB 4821 PG 119',
      },
    });
    expect(r.ok).toBe(true);
  });

  it('FAILS closed when a required grantor is missing (Schedule-A-only without the Sch. B-I executor)', () => {
    // The Henderson trap: Sch. A vests in the devisee, but Sch. B-I Req. 4 requires the estate's executor.
    const r = checkRequiredParties({
      draftGrantors: ['Pat Devine'], // devisee only — the estate/executor grantor is missing
      requiredParties: ['Estate of Marion T. Caldwell, by Dana R. Whitfield, Executor'],
      authorityByGrantor: { 'Pat Devine': 'Schedule A' },
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/required grantor not fully present/i);
  });

  it('FAILS closed when a grantor lacks a recorded authority basis', () => {
    const r = checkRequiredParties({
      draftGrantors: ['Dana R. Whitfield, Executor of Estate of Marion T. Caldwell'],
      requiredParties: ['Dana R. Whitfield, Executor of Estate of Marion T. Caldwell'],
      authorityByGrantor: { 'Dana R. Whitfield, Executor of Estate of Marion T. Caldwell': '' }, // no Cert of Qual
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/lacks a recorded authority basis/);
  });

  it('FAILS closed when the draft adds a grantor not in the required set', () => {
    const r = checkRequiredParties({
      draftGrantors: ['Jordan A. Rivers', 'Casey L. Rivers'],
      requiredParties: ['Jordan A. Rivers'],
      authorityByGrantor: { 'Jordan A. Rivers': 'prior deed', 'Casey L. Rivers': 'prior deed' },
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/not in the required-party set/);
  });
});

describe('B6 — annotation-leak floor (deterministic, fail-closed)', () => {
  it('passes on a clean, fully-resolved deed — INCLUDING a signature underscore line', () => {
    const r = checkAnnotationLeak(CLEAN_DEED_TEXT);
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('FAILS on a NOTE: annotation leak (the 36-2026-6684 class)', () => {
    expect(checkAnnotationLeak(CLEAN_DEED_TEXT + '\nNOTE: confirm marital status before recording').ok).toBe(false);
  });

  it('FAILS on a bracketed placeholder, mustache, HTML comment, asterisk, and pipe', () => {
    expect(checkAnnotationLeak('… conveyed unto [[GRANTEE NAME]] …').ok).toBe(false);
    expect(checkAnnotationLeak('… consideration of {{price}} …').ok).toBe(false);
    expect(checkAnnotationLeak('… <!-- drafter note --> …').ok).toBe(false);
    expect(checkAnnotationLeak('… **GENERAL WARRANTY** …').ok).toBe(false);
    expect(checkAnnotationLeak('| Column | Column |').ok).toBe(false);
  });

  // ── B6 refinement (#421 disposition (a)): allowlist the legitimate statutory/condo recorded constructs ──
  it('ALLOWLISTS the §55.1-136(C) TBE-immunity NOTE and the condo LCE "*Reference to Parking Space(s)" footnote', () => {
    const tbeNote =
      'NOTE: The Grantors herein wish to retain the same immunity from the claims of their separate creditors as they would if they had continued to hold the subject property as tenants by the entirety pursuant to VA Code Section 55.1-136(C).';
    const condoFootnote =
      '*Reference to Parking Space(s) and Storage Space(s) are for identification purposes only; right to use the space(s) is subject to the terms of the governing documents, and any and all amendments thereto.';
    expect(checkAnnotationLeak(`${CLEAN_DEED_TEXT}\n${tbeNote}`).ok).toBe(true);
    expect(checkAnnotationLeak(`${CLEAN_DEED_TEXT}\n${condoFootnote}`).ok).toBe(true);
    expect(checkAnnotationLeak(`${CLEAN_DEED_TEXT}\n${tbeNote}\n${condoFootnote}`).ok).toBe(true);
  });

  it('the allowlist is NARROW — a STRAY NOTE: / asterisk (not the statutory/condo construct) still fails closed', () => {
    // A NOTE: that does NOT carry the §55.1-136 TBE-immunity construct is still a leak.
    expect(checkAnnotationLeak(`${CLEAN_DEED_TEXT}\nNOTE: confirm marital status before recording`).ok).toBe(false);
    expect(checkAnnotationLeak(`${CLEAN_DEED_TEXT}\nNOTE: see file 36-2026-6684`).ok).toBe(false);
    // An asterisk that is NOT the LCE parking/storage footnote is still markdown/markup.
    expect(checkAnnotationLeak('… *see attached schedule …').ok).toBe(false);
    expect(checkAnnotationLeak('… **GENERAL WARRANTY** …').ok).toBe(false);
    // Defensive: the distinctive phrase WITHOUT a leading asterisk is untouched (still clean, no asterisk to mask).
    expect(checkAnnotationLeak(`${CLEAN_DEED_TEXT}\nReference to Parking Space(s) and Storage Space(s) are noted.`).ok).toBe(true);
  });
});

describe('format / typo lints (fail-closed)', () => {
  it('passes clean text', () => {
    expect(checkFormatLints(CLEAN_DEED_TEXT).ok).toBe(true);
  });
  it('FAILS on a missing county-token space', () => {
    expect(checkFormatLints('located in FairfaxCounty, Virginia').ok).toBe(false);
  });
  it('FAILS on "will full powers" (should be "with full power(s)")', () => {
    expect(checkFormatLints('qualified with will full powers to sell').ok).toBe(false);
  });
  it('FAILS on "Deed form" (should be "Deed from")', () => {
    expect(checkFormatLints('by virtue of a Deed form John Smith').ok).toBe(false);
  });
});

describe('runRecordabilityGates — emission permitted only when ALL gates pass', () => {
  it('passes a fully-valid synthetic seller-side draft', () => {
    const report = runRecordabilityGates({
      legal: { draftLegal: LEGAL_RIVERS, commitmentExhibitA: LEGAL_RIVERS, priorDeedLegal: LEGAL_RIVERS },
      parties: {
        draftGrantors: ['Jordan A. Rivers', 'Casey L. Rivers'],
        requiredParties: ['Jordan A. Rivers', 'Casey L. Rivers'],
        authorityByGrantor: { 'Jordan A. Rivers': 'prior deed', 'Casey L. Rivers': 'prior deed' },
      },
      renderedDeedText: CLEAN_DEED_TEXT,
    });
    expect(report.ok).toBe(true);
  });

  it('blocks emission if ANY single gate fails (here: an annotation leak)', () => {
    const report = runRecordabilityGates({
      legal: { draftLegal: LEGAL_RIVERS, commitmentExhibitA: LEGAL_RIVERS, priorDeedLegal: LEGAL_RIVERS },
      parties: {
        draftGrantors: ['Jordan A. Rivers'],
        requiredParties: ['Jordan A. Rivers'],
        authorityByGrantor: { 'Jordan A. Rivers': 'prior deed' },
      },
      renderedDeedText: CLEAN_DEED_TEXT + '\nTODO: verify GPIN',
    });
    expect(report.ok).toBe(false);
    expect(report.results.find((r) => r.gate === 'B6')?.ok).toBe(false);
  });
});

// ── hardening regressions (adversarial review false-pass closures) ────────────
describe('hardening — false-pass closures from adversarial review', () => {
  it('B6 fails on lower/title-case note: and todo (not just ALL-CAPS) — the realistic leak form', () => {
    expect(checkAnnotationLeak('note: confirm marital status before recording').ok).toBe(false);
    expect(checkAnnotationLeak('Note: confirm marital status').ok).toBe(false);
    expect(checkAnnotationLeak('todo verify GPIN with county').ok).toBe(false);
    expect(checkAnnotationLeak('Todo: get assessed value').ok).toBe(false);
  });

  it('B6 fails on angle / single-brace / gap-marker / ??? placeholder families', () => {
    expect(checkAnnotationLeak('conveyed unto <GRANTEE NAME>').ok).toBe(false);
    expect(checkAnnotationLeak('consideration of {price}').ok).toBe(false);
    expect(checkAnnotationLeak('the following parcel (INSERT LEGAL DESCRIPTION HERE), to wit:').ok).toBe(false);
    expect(checkAnnotationLeak('Consideration: $XXX').ok).toBe(false);
    expect(checkAnnotationLeak('Tax I.D. Number: TBD').ok).toBe(false);
    expect(checkAnnotationLeak('FIXME assessed value').ok).toBe(false);
    expect(checkAnnotationLeak('recorded in Deed Book ??? at Page ???').ok).toBe(false);
  });

  it('C2 fails when one of two identically-named co-grantors is missing (multiset, not set)', () => {
    const r = checkRequiredParties({
      draftGrantors: ['John Smith'],
      requiredParties: ['John Smith', 'John Smith'], // two distinct people sharing a record name
      authorityByGrantor: { 'John Smith': 'prior deed DB 100 PG 1' },
    });
    expect(r.ok).toBe(false);
  });

  it('C2 fails when an authority basis is an unresolved placeholder, not a recorded basis', () => {
    const r = checkRequiredParties({
      draftGrantors: ['Dana R. Whitfield, Executor'],
      requiredParties: ['Dana R. Whitfield, Executor'],
      authorityByGrantor: { 'Dana R. Whitfield, Executor': 'TODO: obtain Certificate of Qualification' },
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/unresolved placeholder/);
  });

  it('C1 fails closed for a condo legal ("condominium") when the instrument data is OMITTED (was fail-open)', () => {
    const r = checkLegalDescription({
      draftLegal: 'Unit 204, HEATHCOTE COMMONS, A CONDOMINIUM',
      commitmentExhibitA: 'Unit 204, HEATHCOTE COMMONS, A CONDOMINIUM',
      priorDeedLegal: 'Unit 204, HEATHCOTE COMMONS, A CONDOMINIUM',
      // condo quartet intentionally omitted — must NOT pass
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/condo/i);
  });

  it('C1 prong (a) is case-SENSITIVE — a case-only deviation from the commitment fails (verbatim)', () => {
    const r = checkLegalDescription({
      draftLegal: LEGAL_RIVERS.toUpperCase(),
      commitmentExhibitA: LEGAL_RIVERS,
      priorDeedLegal: LEGAL_RIVERS,
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/prong \(a\)/);
  });

  it('B6 does NOT false-positive on legitimate deed content (dates, (SEAL), $ amounts, Roman numerals, and/or)', () => {
    const legit = [
      'WITNESS the following signature and seal this 2nd day of June, 2026.',
      '____________________________ (SEAL)',
      'For and in consideration of $350,000.00 (Three Hundred Fifty Thousand and 00/100 Dollars),',
      'pursuant to ARTICLE III and Section 3 of the Declaration, his and/or her heirs and assigns,',
      'BEING the same property conveyed by Deed dated 5/2/2014, recorded in Deed Book 4821, Page 119.',
    ].join('\n');
    expect(checkAnnotationLeak(legit).ok).toBe(true);
    expect(checkFormatLints(legit).ok).toBe(true);
  });

  it('fail-closed on missing inputs (C1 draft/commitment empty; C2 empty required or draft set)', () => {
    expect(checkLegalDescription({ draftLegal: '', commitmentExhibitA: LEGAL_RIVERS, priorDeedLegal: LEGAL_RIVERS }).ok).toBe(false);
    expect(checkLegalDescription({ draftLegal: LEGAL_RIVERS, commitmentExhibitA: '', priorDeedLegal: LEGAL_RIVERS }).ok).toBe(false);
    expect(checkRequiredParties({ draftGrantors: ['A Person'], requiredParties: [], authorityByGrantor: { 'A Person': 'prior deed' } }).ok).toBe(false);
    expect(checkRequiredParties({ draftGrantors: [], requiredParties: ['A Person'], authorityByGrantor: {} }).ok).toBe(false);
  });
});
