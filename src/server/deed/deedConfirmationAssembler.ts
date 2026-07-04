/**
 * deedConfirmationAssembler.ts — DEED-DRAFT-AGENT-1 category C1: DETERMINISTIC "Deed of Confirmation" assembler.
 *
 * PURE + deterministic + NO-EGRESS — NO LLM. Renders the Mason house-style "DEED OF CONFIRMATION" body from a
 * provided consolidated-facts field set (grounded on docs/deed/DEED_KB_CATEGORY_GROUNDING.md §C1 + the C1
 * fixture pack docs/deed/DEED_CAT_CONFIRMATION_fixture_pack.md, archetypes Exemplar-A survivorship / Exemplar-B
 * testate-devise). Output is an UNEXECUTED draft; the assembler never finalizes, records, or sends.
 *
 * A DEED OF CONFIRMATION confirms (places of record) title that has ALREADY vested by operation of law — it does
 * NOT transfer. The party of the first part (Grantor) and the party of the second part (Grantee) are the SAME
 * person. The work is entirely in the WHEREAS recital chain; the assembler is a deterministic FORMATTER of the
 * attorney-provided title-vesting facts — it surfaces, it never decides, and it never fabricates a chain link.
 *
 * Category invariants (load-bearing, from the grounded fixtures):
 *  - Exemption § 58.1-810(1) (confirmatory A-to-A deed after a tax-paid original). TWO house FACE forms, asserted
 *    verbatim per-fixture: Exemplar-A form "Exempt from recording tax pursuant to Sec 58.1-810(1), 1950 Code of
 *    Virginia"; Exemplar-B form "Exempt from recordation tax pursuant to Va. Code § 58.1-810(1)" (+ an optional
 *    parenthetical line). A supplied exemption code other than 58.1-810(1) is an EXEMPTION_MISMATCH (NEG-N4).
 *  - Title VERBATIM "DEED OF CONFIRMATION".
 *  - Warranty "General Warranty and English Covenants of title" (Exemplar-A) / "...of Title" (Exemplar-B, capital
 *    T) — reproduced per-fixture exactly. Vesting "sole owner". Parties identical (Grantor === Grantee).
 *  - TWO archetypes, byte-exact:
 *      C1-a survivorship (G1 SFH, G3 condo): granting verb "grant and convey"; 3-link WHEREAS chain
 *        (took-title-as-JTWROS -> co-owner departed this life -> by operation of law the survivor became sole owner).
 *      C1-b testate/devise (G2): granting verb "grant, confirm, and convey"; 5-link WHEREAS chain (prior deed ->
 *        TBE survivorship -> testator died testate + probate FI -> devise article vests title in the devisee ->
 *        the Grantor desires to confirm) + the BEING recital.
 *  - Legal description VERBATIM (casing, spell-outs, condo Declaration book/pages, "Also known as" preserved).
 *
 * Fail-closed contract (NEG / FIRE-watch): returns { status: 'WITHHELD', flags: [...], deed: undefined } — no
 * partial deed — on a parties mismatch (N2), a wrong exemption (N4), a truncated legal (N1), a missing/blank
 * chain-of-title fact (testate-devise N3 / survivorship), or a fabricable WHEREAS link. The assembler never
 * invents a probate Fiduciary No., a will date, a devise article, a date, or a chain link.
 *
 * STATUS: flag-dark Phase-1 infrastructure, registered in the deed-type registry; NO live caller. Cite grounded
 * via deedKbVa (the verified KB — never model memory).
 */

import { VA_EXEMPTIONS } from './deedKbVa.js';
import { renderLocality, checkAnnotationLeak, checkFormatLints } from './deedDraftGates.js';

/** The verified exemption cite for this category (validated against the KB; no-hallucinated-cite discipline). */
const C1_EXEMPTION_CODE = 'Va. Code § 58.1-810(1)';
/** The bare statutory subsection the matter facts carry (e.g. "58.1-810(1)"). The supplied code must reduce to
 *  this — a stray (A)(10)/811 etc. is an EXEMPTION_MISMATCH (NEG-N4). */
const C1_EXEMPTION_SUBSECTION = '58.1-810(1)';

const C1_TITLE = 'DEED OF CONFIRMATION';
const HEADER_RULE = '_____________________________________________________________________________'; // 77
/** Exemplar-A compact seal marker (26 underscores). */
const SEAL_A = '__________________________(seal)';

// ── Input model ─────────────────────────────────────────────────────────────────────────────────────────

/** C1-a survivorship chain-of-title facts (how the co-owners took title before the death). */
export interface ConfirmationChainSurvivorship {
  tookTitleAs: string; // "joint tenants with the common law right of survivorship"
  coOwners: string[]; // [survivor, decedent] in the matter's recited order
  vestingDeedDate: string; // "August 12, 2011"
  vestingDeedRecorded: string; // "August 15, 2011"
  vestingInstrumentNumber: string; // "201108150029471"
  recordsCounty: string; // "Prince William County, Virginia"
}

/** C1-a decedent facts (the co-owner who died, triggering survivorship). */
export interface ConfirmationDecedent {
  name: string;
  aka?: string; // "Helene Marie Quintero" (drives the "Also known as" clause)
  dateOfDeath: string;
}

/** C1-b prior-deed chain-of-title facts (the original conveyance into the testator + spouse). */
export interface ConfirmationChainTestate {
  originalGrantors: string; // "Edmund R. Hollings and Marianne T. Hollings, his wife"
  originalDeedDate: string;
  originalDeedRecorded: string;
  originalDeedBookPage: string; // "Deed Book 2204 at Page 318"
  originalGrantees: string; // "Walter S. Penhallow and Doris E. Penhallow, his wife"
  originalGranteesTenancy: string; // "tenants by the entirety with the common law right of survivorship"
}

/** C1-b first-decedent facts (the spouse who predeceased, leaving the testator as survivor). */
export interface ConfirmationFirstDecedent {
  name: string;
  dateOfDeath: string;
  survivor: string; // "Walter S. Penhallow" (the testator-to-be)
}

/** C1-b testator facts (the survivor who later died testate, devising the property). */
export interface ConfirmationTestator {
  name: string;
  diedTestateDate: string;
  willDate: string;
  probateCourt: string; // "Clerk of the Circuit Court of Fairfax County, Virginia"
  fiduciaryNumber: string; // "FI-2015-0002736"
  /** Possessive pronoun for the testator ("his"/"her"/"their") — an attorney-supplied party fact, never guessed.
   *  Renders "${possessive} Last Will and Testament". */
  possessivePronoun: string;
  /** Subject pronoun for the testator ("he"/"she"/"they") — an attorney-supplied party fact, never a literal.
   *  Renders "whereby ${subject} became sole owner by survivorship" in the BEING recital. */
  subjectPronoun: string;
}

/** C1-b devise facts (the article that vests title in the devisee). */
export interface ConfirmationDevise {
  article: string; // "Article V"
  devisee: string; // "Priya N. Abernathy"
  deviseeStatus: string; // "sole residuary beneficiary and devisee"
  /** Possessive pronoun for the devisee ("her"/"his"/"their") — renders "${possessive} title". */
  deviseePossessive: string;
  /** Object pronoun for the devisee ("her"/"him"/"them") — renders "vested in ${object} as devisee". */
  deviseeObject: string;
}

export interface DeedConfirmationInput {
  archetype: 'C1-a-survivorship' | 'C1-b-testate-devise';
  /** The supplied exemption subsection (e.g. "58.1-810(1)"); a non-matching value fails closed (N4). */
  exemptionCode: string;
  /** Optional Exemplar-B parenthetical line emitted beneath the exemption recital. */
  exemptionParenthetical?: string;
  preparer: string;
  preparedNote: string;
  /** Exactly one of taxId (Exemplar-A) / taxMap (Exemplar-B) carries the parcel identifier. */
  taxId?: string;
  taxMap?: string;
  granteeReturnAddress: string;
  assessedValue: string;
  consideration: string;
  /** The date phrase as it appears after "this _____ day of" (e.g. "March, 2026" or the fully-blank G2 form). */
  grantingDatePhrase: string;
  /** The party (identical Grantor and Grantee). */
  partyName: string;
  /** Defensive: if the matter asserts the parties are NOT the same person, fail closed (N2). */
  partyOfFirstPart?: string;
  partyOfSecondPart?: string;
  grantorGranteeSame?: boolean;
  vesting: string; // "sole owner"
  grantingVerb: string; // "grant and convey" / "grant, confirm, and convey"
  warranty: string; // "General Warranty and English Covenants of title" / "...of Title"
  locality: string; // "Prince William" / "Fairfax"
  /** Recording-locality discriminator: 'city' renders "the City of <X>" for a Virginia independent city;
   *  default/omitted 'county' renders "the County of <X>" from `locality`. (S1/F2.) */
  localityType?: 'county' | 'city';
  legalDescription: string; // verbatim

  // ── C1-a survivorship ──
  chainSurvivorship?: ConfirmationChainSurvivorship;
  decedent?: ConfirmationDecedent;
  beingRecitalPriorInstrument?: string; // the instrument number for the BEING recital
  /** Optional attorney-supplied surviving sole-owner name. When omitted, the survivor is derived as the co-owner
   *  who is NOT the decedent — and that derivation must be UNAMBIGUOUS (exactly one co-owner matches the decedent
   *  name) or the chain fails closed. Never silently defaulted to the first listed owner. */
  survivorName?: string;

  // ── C1-b testate-devise ──
  chainTestate?: ConfirmationChainTestate;
  firstDecedent?: ConfirmationFirstDecedent;
  testator?: ConfirmationTestator;
  devise?: ConfirmationDevise;
  taxMapStreetLine?: string; // the "The said property is identified as Tax Map No. … street address …" line
  beingRecitalBookPage?: string; // the BEING Deed Book/Page reference

  subjectTo: string; // verbatim subject-to body (no leading "This conveyance is made subject to")
}

export interface DeedConfirmationSegments {
  exemptionLine: string;
  title: string;
  premise: string;
  /** The joined WHEREAS block (the recital chain), exactly as it appears in the body. */
  whereasRecitals: string;
  nowTherefore: string;
  grantingClause: string;
  legalDescription: string;
  beingRecital: string;
  subjectTo: string;
  vesting: string;
  fullText: string;
}

export interface DeedConfirmationResult {
  status: 'OK' | 'WITHHELD';
  flags: string[];
  advisories: string[];
  recordableFloorOk: boolean;
  deed?: DeedConfirmationSegments;
}

function withheld(flags: string[], advisories: string[] = []): DeedConfirmationResult {
  return { status: 'WITHHELD', flags, advisories, recordableFloorOk: false };
}

/** A field is missing/blank if undefined, null, all-whitespace, or carries a "[[ … ]]" placeholder marker
 *  (the matter-file "fact not captured" convention). A placeholder is never rendered as if it were a fact. */
function isBlank(v: string | undefined | null): boolean {
  if (v === undefined || v === null) return true;
  const t = v.trim();
  if (t === '') return true;
  if (/\[\[/.test(t)) return true; // unresolved "[[ MISSING … ]]" placeholder
  return false;
}

/** S5-Q2: does `tookTitleAs` recite a SURVIVORSHIP tenancy? A "sole owner by operation of law" recital is
 *  legally true ONLY for a joint tenancy with the right of survivorship (JTWROS) or a tenancy by the entirety
 *  (which carries the common-law right of survivorship in Virginia). A tenancy in common has NO survivorship —
 *  the decedent's share passes by will/intestacy, not to the co-owner. Deterministic keyword test (no fuzzy
 *  matching); fails closed on a non-survivorship or self-contradictory ("in common … with survivorship")
 *  formulation. */
function hasSurvivorshipFormulation(tookTitleAs: string): boolean {
  const t = tookTitleAs.toLowerCase();
  const survivorship = /survivorship/.test(t) || /tenan(?:ts?|cy|cies)\s+by\s+the\s+entirety/.test(t);
  const tenantsInCommon = /tenants?\s+in\s+common/.test(t);
  return survivorship && !tenantsInCommon;
}

/**
 * A legal description is truncated/missing if absent, lacks a recordable terminus (a period optionally + a
 * closing quote/paren), or ends on a dangling connective/preposition or a bare instrument-number fragment.
 * Condo-aware (mirrors the C3 condo-terminus idea): a Declaration/Amendment legal must terminate in the closing
 * land-records clause. The realistic OCR truncation (ending mid-instrument-number with no period) is caught. */
function isLegalTruncated(legal: string | undefined): boolean {
  const t = (legal ?? '').trim();
  if (t === '') return true;
  if (!/(?:[.]["')\]]?|\))\s*$/.test(t)) return true;
  const core = t.replace(/(?:[.]["')\]]?|\))\s*$/, '').trim();
  if (/\b(among|in|of|to|the|and|a|an|at|on|with|by|as|for|page|book|no|number)$/i.test(core)) return true;
  // A condo legal reciting a Declaration / amendment(s) must close in the land-records clause.
  if (/\b(Declaration|Amendment|Condominium)\b/i.test(t) &&
      !/among the (?:land records|Land Records) of .+ (?:County|City), Virginia\.?["')\]]?\s*$/i.test(t)) {
    return true;
  }
  return false;
}

/** The supplied exemption code reduces to 58.1-810(1) (whitespace/§/"Va. Code" stripped). Anything else (e.g. a
 *  stray 58.1-811(A)(10) into-LLC code) is an EXEMPTION_MISMATCH. */
function exemptionMatches(supplied: string | undefined): boolean {
  if (supplied === undefined) return false;
  const norm = supplied.replace(/va\.?\s*code/i, '').replace(/§/g, '').replace(/sec\b/i, '').replace(/\s+/g, '').trim();
  return norm === C1_EXEMPTION_SUBSECTION;
}

/**
 * PURE: assemble a Mason "Deed of Confirmation". Returns a fail-closed WITHHELD result (no deed) on any NEG /
 * FIRE-watch trigger; otherwise an OK result with the assembled segments + fullText.
 */
export function assembleConfirmationDeed(input: DeedConfirmationInput): DeedConfirmationResult {
  // Cite must be grounded in the verified KB (no-hallucinated-cite discipline) — mirrors C3/C5 UNVERIFIED_EXEMPTION_CITE.
  if (!VA_EXEMPTIONS.some((e) => e.citation === C1_EXEMPTION_CODE)) {
    return withheld(['UNVERIFIED_EXEMPTION_CITE']);
  }

  const flags: string[] = [];
  const advisories: string[] = [];

  // ── N4: wrong exemption — the recital is attorney-load-bearing; never silently substitute or emit a wrong cite. ──
  if (!exemptionMatches(input.exemptionCode)) {
    flags.push('EXEMPTION_MISMATCH');
  }

  // ── N2: parties mismatch — a confirmation REQUIRES party of the first part === party of the second part. An
  // explicit grantor_grantee_same:false, or a distinct first/second part, fails closed (never normalized). ──
  const first = (input.partyOfFirstPart ?? input.partyName ?? '').trim();
  const second = (input.partyOfSecondPart ?? input.partyName ?? '').trim();
  if (input.grantorGranteeSame === false || first !== second) {
    flags.push('PARTIES_NOT_IDENTICAL');
  }

  // ── N1: truncated / incomplete legal description — withhold, never silently cut or fabricate a terminus. ──
  if (isLegalTruncated(input.legalDescription)) {
    flags.push('LEGAL_DESCRIPTION_INCOMPLETE');
  }

  // ── FIRE-watch: chain-of-title completeness (fail closed; never fabricate a vesting chain) ──
  if (input.archetype === 'C1-b-testate-devise') {
    // Testate-devise: every probate / devise fact must be present and non-placeholder.
    const t = input.testator;
    const d = input.devise;
    const deviseChainMissing =
      !t || isBlank(t.name) || isBlank(t.diedTestateDate) || isBlank(t.fiduciaryNumber) ||
      !d || isBlank(d.article) || isBlank(d.devisee);
    if (deviseChainMissing) {
      flags.push('INCOMPLETE_DEVISE_CHAIN');
    }
    // The prior-deed / first-decedent / will / probate links must each be complete (no dropped or fabricated link).
    const c = input.chainTestate;
    const fd = input.firstDecedent;
    const supportingMissing =
      !c || isBlank(c.originalGrantors) || isBlank(c.originalDeedDate) || isBlank(c.originalDeedRecorded) ||
      isBlank(c.originalDeedBookPage) || isBlank(c.originalGrantees) || isBlank(c.originalGranteesTenancy) ||
      !fd || isBlank(fd.name) || isBlank(fd.dateOfDeath) || isBlank(fd.survivor) ||
      !t || isBlank(t.willDate) || isBlank(t.probateCourt) || isBlank(t.possessivePronoun) || isBlank(t.subjectPronoun) ||
      !d || isBlank(d.deviseeStatus) || isBlank(d.deviseePossessive) || isBlank(d.deviseeObject) ||
      isBlank(input.beingRecitalBookPage) || isBlank(input.taxMapStreetLine);
    if (supportingMissing && !flags.includes('INCOMPLETE_DEVISE_CHAIN')) {
      flags.push('INCOMPLETE_DEVISE_CHAIN');
    }
  } else {
    // Survivorship: prior-deed / took-title facts + decedent name + death date must be present.
    const c = input.chainSurvivorship;
    const dec = input.decedent;
    const nonBlankOwners = (c?.coOwners ?? []).filter((x) => !isBlank(x)).map((x) => x.trim());
    const survivorshipMissing =
      !c || isBlank(c.tookTitleAs) || nonBlankOwners.length < 2 ||
      isBlank(c.vestingDeedDate) || isBlank(c.vestingDeedRecorded) || isBlank(c.vestingInstrumentNumber) ||
      isBlank(c.recordsCounty) ||
      !dec || isBlank(dec.name) || isBlank(dec.dateOfDeath) ||
      isBlank(input.beingRecitalPriorInstrument);

    // S5-Q1: the survivorship recital names a SINGLE survivor who became the SOLE owner — legally true ONLY for
    // exactly two co-owners (one dies -> one survivor). With 3+ co-owners the death leaves MULTIPLE survivors
    // (not a sole owner) and the two-name recital (owners[0]/owners[1]) would silently DROP the extra owners ->
    // a false statement of title. Fail closed for manual drafting rather than emit a false "sole owner" chain.
    const survivorshipTooManyOwners = !survivorshipMissing && nonBlankOwners.length !== 2;

    // S5-Q2: `tookTitleAs` drives the "by operation of law … became the sole owner" recital, which is legally
    // TRUE only for a survivorship tenancy. A tenancy-in-common vesting has NO survivorship, so the recital would
    // fabricate a legal conclusion. Require a survivorship formulation; fail closed otherwise.
    const survivorshipTenancyInvalid = !survivorshipMissing && !hasSurvivorshipFormulation(c!.tookTitleAs);

    // Survivor must be UNAMBIGUOUS (surface-not-decide).
    let survivorAmbiguous = false;
    if (!survivorshipMissing) {
      const decName = dec!.name.trim();
      const decedentMatches = nonBlankOwners.filter((o) => o === decName).length;
      if (isBlank(input.survivorName)) {
        // Derived path: EXACTLY ONE co-owner string-equals the decedent (so the OTHER is the survivor). Zero or
        // >1 matches is ambiguous — fail closed rather than silently naming owners[0] (which could be the
        // decedent).
        if (decedentMatches !== 1) survivorAmbiguous = true;
      } else {
        // S5-Q3: an explicit survivorName no longer BYPASSES the coherence check. It must string-equal one of
        // the co-owners (so a wrong-matter / typo'd name cannot render straight into the operative "sole owner"
        // recital) and must not equal the decedent. It intentionally STILL tolerates a decedent-name variant the
        // exact-match derived path cannot resolve — resolving that variant is the explicit path's whole purpose.
        const survName = input.survivorName!.trim();
        const survivorMatches = nonBlankOwners.filter((o) => o === survName).length;
        if (survivorMatches < 1 || survName === decName) survivorAmbiguous = true;
      }
    }

    if (survivorshipMissing || survivorAmbiguous) flags.push('INCOMPLETE_SURVIVORSHIP_CHAIN');
    if (survivorshipTooManyOwners) flags.push('SURVIVORSHIP_UNSUPPORTED_OWNER_COUNT');
    if (survivorshipTenancyInvalid) flags.push('SURVIVORSHIP_TENANCY_NOT_SURVIVORSHIP');
  }

  if (flags.length > 0) return withheld(flags, advisories);

  // ── Assemble per archetype ──
  if (input.archetype === 'C1-b-testate-devise') {
    return assembleTestateDevise(input, advisories);
  }
  return assembleSurvivorship(input, advisories);
}

/** Render the "This conveyance is made subject to …" closing clause. */
function subjectToClause(input: DeedConfirmationInput): string {
  return `This conveyance is made subject to ${input.subjectTo.trim()}.`;
}

// ── Exemplar-A: C1-a survivorship (G1 SFH / G3 condo) ───────────────────────────────────────────────────
function assembleSurvivorship(input: DeedConfirmationInput, advisories: string[]): DeedConfirmationResult {
  const c = input.chainSurvivorship!;
  const dec = input.decedent!;
  // Non-blank co-owners (the gate has proven there are EXACTLY two — S5-Q1); never index a blank into a recital.
  const owners = c.coOwners.map((o) => o.trim()).filter((o) => o !== '');
  // The survivor is the explicit attorney-supplied name, else the co-owner who is NOT the decedent. The
  // completeness guard has already proven this is UNAMBIGUOUS (exactly one co-owner matches the decedent) — so
  // there is no silent owners[0] default; an ambiguous chain failed closed before reaching here.
  const survivor = !isBlank(input.survivorName)
    ? input.survivorName!.trim()
    : owners.find((o) => o !== dec.name.trim())!;
  const party = input.partyName.trim();

  const exemptionLine = `Exempt from recording tax pursuant to Sec ${C1_EXEMPTION_SUBSECTION}, 1950 Code of Virginia`;

  const premise =
    `THIS DEED OF CONFIRMATION made and entered this _____ day of ${input.grantingDatePhrase.trim()}, ` +
    `by and between ${party}, party of the first part, and ${party}, party of the second part;`;

  // The 3-link WHEREAS chain — each link is built ONLY from non-blank facts (guarded above).
  const aka = !isBlank(dec.aka) ? `, Also known as ${dec.aka!.trim()},` : ',';
  const whereas1 =
    `WHEREAS, ${owners[0]} and ${owners[1]} took title to the subject property as ${c.tookTitleAs.trim()} ` +
    `by deed dated ${c.vestingDeedDate.trim()}, and recorded on ${c.vestingDeedRecorded.trim()} as Instrument ` +
    `Number ${c.vestingInstrumentNumber.trim()} among the land records of ${c.recordsCounty.trim()}, AND`;
  const whereas2 =
    `WHEREAS ${dec.name.trim()}${aka} departed this life on or about ${dec.dateOfDeath.trim()}, AND`;
  const whereas3 =
    `WHEREAS, by operation of law ${survivor} became the sole owner of the subject property upon the death of ${dec.name.trim()},`;
  const whereasRecitals = [whereas1, '', whereas2, '', whereas3].join('\n');

  const nowTherefore = 'NOW, THEREFORE, WITNESSETH:';
  const grantingClause =
    `For good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, ` +
    `the Grantor does hereby ${input.grantingVerb.trim()}, with ${input.warranty.trim()}, unto the said Grantee, ` +
    `in fee simple, as ${input.vesting.trim()}, all of the following parcel of real property, with improvements ` +
    `thereon, located in the ${renderLocality({ type: input.localityType ?? 'county', name: input.locality, style: 'of' })}, Commonwealth of Virginia, to wit:`;

  const beingRecital =
    `BEING the same property conveyed unto ${owners[0]} and ${owners[1]}, as ${c.tookTitleAs.trim()} by Deed ` +
    `recorded as Instrument Number ${input.beingRecitalPriorInstrument!.trim()} among the aforesaid land records.`;

  const subjectTo = subjectToClause(input);
  const taxLine = `Tax ID No.: ${(input.taxId ?? '').trim()}`;

  const lines: string[] = [
    exemptionLine,
    input.preparedNote.trim(),
    '',
    `This Deed was prepared by: ${input.preparer.trim()}`,
    '',
    taxLine,
    '',
    `Grantee Address and return to: ${input.granteeReturnAddress.trim()}`,
    '',
    `Assessed Value:${input.assessedValue.trim()}`, // Exemplar-A quirk: NO space after the colon
    '',
    `Consideration: ${input.consideration.trim()}`,
    HEADER_RULE,
    '',
    C1_TITLE,
    '',
    premise,
    '',
    whereas1,
    '',
    whereas2,
    '',
    whereas3,
    '',
    '',
    nowTherefore,
    '',
    grantingClause,
    '',
    input.legalDescription,
    '',
    beingRecital,
    '',
    subjectTo,
    '',
    '',
    'Witness the following signatures and seals:',
    '',
    '',
    SEAL_A,
    party,
    '',
    '',
    '',
    '',
    'State of VIRGINIA',
    '',
    'County/City of _____________________________, to wit:',
    '',
    `I, the undersigned, a Notary Public for the jurisdiction aforesaid, do certify that ${party} , who signed the aforesaid document acknowledged the same before me in my jurisdiction aforesaid, this _____ day of ${input.grantingDatePhrase.trim()}.`,
    '',
    'My commission expires: ______________',
    '',
    '____________________________',
    'Notary Public',
  ];

  const fullText = lines.join('\n');
  const recordableFloorOk = checkAnnotationLeak(fullText).ok && checkFormatLints(fullText).ok;
  return {
    status: 'OK',
    flags: [],
    advisories,
    recordableFloorOk,
    deed: {
      exemptionLine,
      title: C1_TITLE,
      premise,
      whereasRecitals,
      nowTherefore,
      grantingClause,
      legalDescription: input.legalDescription,
      beingRecital,
      subjectTo,
      vesting: input.vesting.trim(),
      fullText,
    },
  };
}

// ── Exemplar-B: C1-b testate / devise (G2) ──────────────────────────────────────────────────────────────
function assembleTestateDevise(input: DeedConfirmationInput, advisories: string[]): DeedConfirmationResult {
  const c = input.chainTestate!;
  const fd = input.firstDecedent!;
  const t = input.testator!;
  const d = input.devise!;
  const party = input.partyName.trim();

  // Surface-not-decide advisory: this instrument records title that vested by will at death — not estate
  // administration. The attorney has confirmed the devise and that confirmation is the appropriate instrument.
  advisories.push(
    'DEED_OF_CONFIRMATION_DEVISE_ADVISORY: Deed of Confirmation records title that vested in the devisee by will ' +
      "at the Testator's death (no executor's deed / no power of sale); the attorney has confirmed the devise and " +
      'that confirmation — not estate administration — is the appropriate instrument.',
  );

  const exemptionLine = `Exempt from recordation tax pursuant to Va. Code § ${C1_EXEMPTION_SUBSECTION}`;

  const premise =
    `THIS DEED OF CONFIRMATION is made and entered into this ${input.grantingDatePhrase.trim()}, by and between ` +
    `${party}, party of the first part ("Grantor"), and ${party}, party of the second part ("Grantee").`;

  // The 5-link WHEREAS chain — each link built ONLY from non-blank facts (guarded above).
  const whereas1 =
    `WHEREAS, by Deed dated ${c.originalDeedDate.trim()}, and recorded ${c.originalDeedRecorded.trim()}, in ` +
    // S5-Q5: independent-city safe — 'bare' renders "<X> County" for a county (byte-identical to the prior
    // hardcoding) and "City of <X>" for a Virginia independent city (never a nonexistent "<City> County").
    `${c.originalDeedBookPage.trim()} among the land records of ${renderLocality({ type: input.localityType ?? 'county', name: input.locality, style: 'bare' })}, Virginia, ` +
    `${c.originalGrantors.trim()}, conveyed the hereinafter-described real property unto ${c.originalGrantees.trim()}, ` +
    `as ${c.originalGranteesTenancy.trim()}; AND`;
  const whereas2 =
    `WHEREAS, ${fd.name.trim()} departed this life on or about ${fd.dateOfDeath.trim()}, whereupon, by operation ` +
    `of the common law right of survivorship, ${fd.survivor.trim()} became the sole owner of the said real property; AND`;
  const whereas3 =
    `WHEREAS, ${t.name.trim()} departed this life testate on ${t.diedTestateDate.trim()}, and ${t.possessivePronoun.trim()} ` +
    `Last Will and Testament dated ${t.willDate.trim()}, was duly admitted to probate before the ${t.probateCourt.trim()}, ` +
    `as Fiduciary No. ${t.fiduciaryNumber.trim()}; AND`;
  const whereas4 =
    `WHEREAS, under ${d.article.trim()} of the said Last Will and Testament, ${d.devisee.trim()}, having survived ` +
    `the Testator, is the ${d.deviseeStatus.trim()} of the said real property, and title thereto vested in ` +
    `${d.deviseeObject.trim()} as devisee upon the death of the Testator; AND`;
  const whereas5 =
    `WHEREAS, the Grantor desires by this Deed of Confirmation to confirm, and to place of record, ` +
    `${d.deviseePossessive.trim()} title to the said real property;`;
  const whereasRecitals = [whereas1, whereas2, whereas3, whereas4, whereas5].join('\n');

  const nowTherefore = 'NOW, THEREFORE, WITNESSETH:';
  const grantingClause =
    `For good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, ` +
    `the Grantor does hereby ${input.grantingVerb.trim()}, with ${input.warranty.trim()}, unto the said Grantee, ` +
    `in fee simple, as ${input.vesting.trim()}, all of the following described real property, with the improvements ` +
    `thereon and the appurtenances thereunto belonging, situate, lying and being in the ${renderLocality({ type: input.localityType ?? 'county', name: input.locality, style: 'of' })}, ` +
    `Commonwealth of Virginia, to wit:`;

  const beingRecital =
    `BEING the same real property conveyed unto ${c.originalGrantees.trim()}, as ${c.originalGranteesTenancy.trim()}, ` +
    `by Deed recorded in ${input.beingRecitalBookPage!.trim()} among the aforesaid land records; the said ${fd.name.trim()} ` +
    `having predeceased the said ${t.name.trim()}, whereby ${t.subjectPronoun.trim()} became sole owner by survivorship; and the said ${t.name.trim()} ` +
    `having thereafter died testate, devising the said real property to the Grantor, ${d.devisee.trim()}, under ${d.article.trim()} ` +
    // S5-Q5: independent-city safe — the probate Circuit Court is named "the Circuit Court of <X> County"
    // (county, byte-identical) or "the Circuit Court of City of <X>" (independent city), never a false county.
    `of ${t.possessivePronoun.trim()} Last Will and Testament admitted to probate in the Circuit Court of ` +
    `${renderLocality({ type: input.localityType ?? 'county', name: input.locality, style: 'bare' })}, Virginia (Fiduciary No. ${t.fiduciaryNumber.trim()}).`;

  const subjectTo = subjectToClause(input);
  const taxLine = `Tax Map No.: ${(input.taxMap ?? '').trim()}`;

  const lines: string[] = [
    exemptionLine,
    ...(input.exemptionParenthetical ? [input.exemptionParenthetical.trim()] : []),
    input.preparedNote.trim(),
    '',
    `This Deed was prepared by: ${input.preparer.trim()}`,
    taxLine,
    `Grantee Address and return to: ${input.granteeReturnAddress.trim()}`,
    `Assessed Value: ${input.assessedValue.trim()}`, // Exemplar-B: WITH a space after the colon
    `Consideration: ${input.consideration.trim()}`,
    '',
    C1_TITLE,
    premise,
    whereas1,
    whereas2,
    whereas3,
    whereas4,
    whereas5,
    nowTherefore,
    grantingClause,
    input.legalDescription,
    input.taxMapStreetLine!.trim(),
    beingRecital,
    subjectTo,
    'WITNESS the following signature and seal:',
    '\t_______________________________ (SEAL)',
    `\t${party}`,
    'COMMONWEALTH OF VIRGINIA',
    'CITY/COUNTY OF _______________________, to wit:',
    `I, the undersigned, a Notary Public in and for the jurisdiction aforesaid, do hereby certify that ${d.devisee.trim()}, whose name is signed to the foregoing and annexed Deed of Confirmation, has acknowledged the same before me in my jurisdiction aforesaid this ${input.grantingDatePhrase.trim()}.`,
    'My commission expires: __________________',
    'Registration No.: __________________',
    '\t_______________________________',
    '\tNotary Public',
  ];

  const fullText = lines.join('\n');
  const recordableFloorOk = checkAnnotationLeak(fullText).ok && checkFormatLints(fullText).ok;
  return {
    status: 'OK',
    flags: [],
    advisories,
    recordableFloorOk,
    deed: {
      exemptionLine,
      title: C1_TITLE,
      premise,
      whereasRecitals,
      nowTherefore,
      grantingClause,
      legalDescription: input.legalDescription,
      beingRecital,
      subjectTo,
      vesting: input.vesting.trim(),
      fullText,
    },
  };
}
