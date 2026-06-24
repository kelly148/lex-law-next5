/**
 * deedIntoTrustAssembler.ts — DEED-DRAFT-AGENT-1 category C2: DETERMINISTIC "Deed Into Trust" assembler.
 *
 * PURE + deterministic + NO-EGRESS — NO LLM. Renders the Mason house-style "DEED INTO TRUST" body from a provided
 * consolidated-facts field set (grounded on the C2 fixture pack docs/deed/DEED_CAT_INTO_TRUST_fixture_pack.md +
 * the verified KB cites § 58.1-811(A)(12) / § 58.1-811(A)(15)). A Deed Into Trust transfers the property to the
 * grantors-as-trustees of their revocable living trust(s). Output is an UNEXECUTED draft; the assembler never
 * finalizes, records, or sends.
 *
 * THREE variant archetypes (byte-exact, the most variant-heavy deed category):
 *  - Exemplar-A (GOLDEN-1): a married couple -> ONE joint revocable trust; condo. Granting verb "quitclaim,
 *    release and convey"; warranty "with General Warranty and English covenants of title"; exemption recital
 *    "Exempt from recording tax pursuant to Sec 58.1-811(A)(12) 1950 Code of Virginia"; the §55.1-136(C) TBE-
 *    immunity NOTE in the Exemplar-A phrasing; derivation-of-title line ("Deed intended to be recorded
 *    immediately prior hereto").
 *  - Exemplar-C (GOLDEN-2): a married couple -> his-and-hers DUAL trusts; SFH. Granting verb "grant, bargain,
 *    sell and convey"; the NELSON-header exemption ("EXEMPT FROM COUNTY AND STATE RECORDING TAXES PURSUANT TO VA
 *    CODE SECTION 58.1-811(A)(12)"); the §55.1-136(C) note in the Exemplar-C phrasing ("NOTE: The Grantors herein
 *    wish to retain..."); dual-trustees recital; the After-recording-return block.
 *  - Exemplar-B (GOLDEN-3): DIVORCED, not remarried -> one spouse as trustee; SFH (both former spouses still
 *    sign). Exemption basis BOTH § 58.1-811(A)(15) AND (A)(12); granting verb "quitclaim, release and convey";
 *    NO §55.1-136(C) note; a BEING recital reciting the divorce Order + the Marital Separation Agreement
 *    relinquishment.
 *
 * Category invariants (load-bearing, from the grounded fixtures):
 *  - The exemption cite(s) — (A)(12) and (A)(15) — are GATED on the verified KB (no-hallucinated-cite guard;
 *    mirrors the siblings' UNVERIFIED_EXEMPTION_CITE). The rendered FACE form is derived per house style.
 *  - The §55.1-136(C) TBE-immunity note text is emitted VERBATIM from the canonical corpus phrasings (Exemplar-A /
 *    Exemplar-C), NOT computed; the note is REQUIRED for a (married/TBE)->trust transfer and OMITTED only in the
 *    divorced/single case.
 *  - The trustee-powers (IN TRUST) block is a single canonical verbatim standard clause supplied whole by the
 *    assembler — any inbound partial/garbled version is REJECTED (NEG-4), never patched or completed by inference.
 *  - The legal description, BEING recital, derivation line, and trustees recital are carried VERBATIM (the corpus
 *    spacing/punctuation quirks — e.g. the space before the comma in "Nathaniel O. VOSS ,", the double space
 *    before the MSA sentence, the immunity NOTE with no terminal period — are reproduced byte-for-byte).
 *  - Notary-block names derive solely from the structured `grantors` list (NEG-2: a stray free-text token such as
 *    the corpus "Zqxborn" is NEVER reproduced).
 *
 * Fail-closed contract (NEG / FIRE-watch): returns { status: 'WITHHELD', flags: [...], deed: undefined } — no
 * partial deed. Triggers: truncated legal (NEG-1; condo-aware, reused from the C3 idea), a stray notary token
 * (NEG-2), a (married/TBE)->trust transfer missing the §55.1-136(C) note (NEG-3), a garbled trustee-powers block
 * (NEG-4), plus the FIRE-watch guards (missing/blank trustees recital or trust name; the divorce variant missing
 * the divorce Order / MSA facts; a §55.1-136(C) note requested for a non-married/divorced grantor set, or omitted
 * when required). Never fabricate a cite, date, FI, trust name, or divorce fact.
 *
 * STATUS: flag-dark Phase-1 infrastructure, registered in the deed-type registry; NO live caller. Cite grounded
 * via deedKbVa (the verified KB — never model memory).
 */

import { VA_EXEMPTIONS } from './deedKbVa.js';

/** The verified exemption CODEs for this category (validated against the KB; the house FACE forms are rendered). */
const C2_EXEMPTION_CODE_12 = 'Va. Code § 58.1-811(A)(12)';
const C2_EXEMPTION_CODE_15 = 'Va. Code § 58.1-811(A)(15)';

const C2_TITLE = 'DEED INTO TRUST';
const HEADER_RULE = '_____________________________________________________________________________'; // 77
/** Exemplar-A/B compact seal marker (26 underscores). */
const SEAL_AB = '__________________________(seal)';
/** Exemplar-C signature rule (30 underscores) — the name is appended directly (corpus quirk). */
const SIG_RULE_C = '______________________________';
/** Exemplar-C notary-jurisdiction blank (27 underscores) — a FIXED template blank in the mashed acknowledgment,
 *  distinct from the header's jurisdiction field; carried verbatim. */
const NOTARY_BLANK_C = '___________________________';
/** Exemplar-C registration/commission short blank (14 underscores). */
const SHORT_RULE_C = '______________';

/** The §55.1-136(C) TBE creditor-immunity note — the two canonical corpus phrasings, emitted VERBATIM (grounded
 *  attorney text). Exemplar-A intentionally has NO terminal period (corpus quirk). */
const TBE_NOTE_EXEMPLAR_A =
  'The GRANTORS herein wish to preserve the protection from creditors afforded to property held as tenants by the entirety pursuant to Virginia Code § 55.1-136(C). After this transfer, this property shall have the same immunity from the claims of their separate creditors as it would if it had remained a tenancy by the entirety';
const TBE_NOTE_EXEMPLAR_C =
  'NOTE: The Grantors herein wish to retain the same immunity from the claims of their separate creditors as they would if they had continued to hold the subject property as tenants by the entirety pursuant to VA Code Section 55.1-136(C).';

/** The canonical trustee-powers (IN TRUST) standard clause — supplied WHOLE; any inbound partial is rejected. */
const TRUSTEE_POWERS_BLOCK =
  'This conveyance is made to the Trustees to have and to hold the above described tract or parcel of land together with all rights, ways, privileges, and/or appurtenances thereto (the "Property"), IN TRUST, with the full power, right and authority to sell, lease, exchange, encumber and/or convey the Property, either in whole or in part, upon such terms and conditions and for such consideration as may, to the Trustees in the sole discretion of the Trustees, seem proper or advantageous.  The Trustees are hereby empowered and authorized to subdivide and resubdivide the Property, to dedicate such portions thereof for public use and the Trustees may deem desirable, and to grant licenses and/or easements for utility or other purposes across, over or under the Property.  The Trustees are also hereby empowered and authorized to execute, acknowledge and deliver such deeds, deeds of trust, leases, contracts, settlement statements and other instruments necessary to carry out the foregoing powers, and there shall be no obligation or liability upon any purchaser or lessee of the Property, or any part thereof, or upon any party dealing with the Trustees to inquire as to the terms of the Trust or the application and/or disposition of any proceeds or funds resulting from any transaction dealing with the Property.';

/** The estate-planning consideration opener (the lowercase segment the pack asserts as `considerationOpener`). */
const CONSIDERATION_OPENER =
  'for estate planning purposes, and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged,';

/** The condo limited-common-element identification footnote (emitted only when `lceIdentificationFootnote`). */
const LCE_FOOTNOTE =
  '*Reference to Parking Space(s) and Storage Space(s) are for identification purposes only; right to use the space(s) is subject to the terms of the governing documents, and any and all amendments thereto.';

// ── Input model ─────────────────────────────────────────────────────────────────────────────────────────

export interface IntoTrustPreparer {
  name: string;
  vsb: string;
  firm: string;
}

export interface IntoTrustGrantorInput {
  full: string;
}

export interface IntoTrustInstrumentDate {
  day: string; // "9th" | "_____"
  month: string;
  year: string;
}

export interface IntoTrustNotaryJurisdiction {
  type: string; // "CITY" | "COUNTY"
  name: string;
}

export interface IntoTrustBeingRecital {
  priorConveyance: string;
  divorceOrder: string;
  msa: string;
}

export interface IntoTrustReturnBlock {
  lines: string[];
}

export interface DeedIntoTrustInput {
  /** Exemplar template: 'A' (Exemplar-A), 'B' (Exemplar-B divorce), 'C' (Exemplar-C NELSON-header dual-trust). */
  exemplar: 'A' | 'B' | 'C';
  /** The KB-verified subsection basis: ['58.1-811(A)(12)'] or ['58.1-811(A)(15)','58.1-811(A)(12)'] (divorce). */
  exemptionBasis: string[];
  titleSearchPerformed: boolean;
  preparer: IntoTrustPreparer;
  taxId: string;
  granteeReturnAddress: string;
  /** Exemplar-A/B carry a consideration line; Exemplar-C carries a file number instead. */
  consideration?: string;
  fileNumber?: string;
  assessedValue: string;
  instrumentDate: IntoTrustInstrumentDate;
  grantors: IntoTrustGrantorInput[];
  grantorMaritalStatus: string; // verbatim ("a married couple" / "both divorced and not remarried")
  heldAs: string;
  trustStructure: string;
  /** The trustees recital — carried VERBATIM (drives the GRANTEES party block). */
  trusteesRecital: string;
  granteeObjectPlurality?: string; // "GRANTEES" | "GRANTEE" (the granting-clause object); default "GRANTEES"
  grantingVerb: string;
  jurisdictionSitus: string; // verbatim situs phrase
  legalDescription: string; // verbatim
  lceIdentificationFootnote?: boolean;
  /** Exemplar-A/C: the derivation-of-title line (verbatim). */
  derivation?: string;
  /** Exemplar-B (divorce): the BEING recital facts (verbatim). */
  beingRecital?: IntoTrustBeingRecital;
  /** §55.1-136(C) TBE-note selector: 'Exemplar-A' | 'Exemplar-C' | null (divorced/omit). */
  tbeImmunityNote: string | null;
  notaryJurisdiction: IntoTrustNotaryJurisdiction;
  /** Exemplar-C: the After-recording-return block lines. */
  returnBlock?: IntoTrustReturnBlock;
  /** NEG-2: a caller-supplied free-text notary block — names must derive from `grantors`, never this passthrough. */
  notaryBlockRaw?: string;
  /** NEG-4: a caller-supplied trustee-powers block — rejected unless it equals the canonical block exactly. */
  trusteePowersClauseRaw?: string;
}

export interface DeedIntoTrustSegments {
  exemptionLine: string;
  title: string;
  premise: string;
  considerationOpener: string;
  grantingVerb: string;
  granteeObject: string;
  grantingClause: string;
  legalDescription: string;
  derivationLine: string | null;
  beingRecital: string | null;
  tbeImmunityNote: string | null;
  trusteePowersBlock: string;
  subjectTo: string;
  notaryBlock: string;
  fullText: string;
}

export interface DeedIntoTrustResult {
  status: 'OK' | 'WITHHELD';
  flags: string[];
  advisories: string[];
  deed?: DeedIntoTrustSegments;
}

function withheld(flags: string[], advisories: string[] = []): DeedIntoTrustResult {
  return { status: 'WITHHELD', flags, advisories };
}

/** A field is missing/blank if undefined, null, all-whitespace, or carries an unresolved "[[ … ]]" placeholder. */
function isBlank(v: string | undefined | null): boolean {
  if (v === undefined || v === null) return true;
  const t = v.trim();
  if (t === '') return true;
  if (/\[\[/.test(t)) return true;
  return false;
}

/**
 * A legal description is truncated/missing if absent, lacks a recordable terminus (period optionally + closing
 * quote/paren), or ends on a dangling connective/preposition. Condo-aware (reused from the C3 guard): a legal
 * reciting a Declaration / amendment(s) must terminate in the closing land-records clause — otherwise it is a
 * mid-amendment cut even if it ends on a period. Also catches the NEG-1 mid-LCE cut ("...parking space(s)").
 */
function isLegalTruncated(legal: string | undefined): boolean {
  const t = (legal ?? '').trim();
  if (t === '') return true;
  if (!/(?:[.]["')\]]?|\))\s*$/.test(t)) return true;
  const core = t.replace(/(?:[.]["')\]]?|\))\s*$/, '').trim();
  if (/\b(among|in|of|to|the|and|a|an|at|on|with|by|as|for|page|book|including)$/i.test(core)) return true;
  if (/\bspace\(s\)$/i.test(core)) return true; // mid-LCE cut: "...parking space(s)"
  // A condo legal reciting a Declaration / amendment(s) must terminate in the closing land-records clause
  // ("among the land records of <jurisdiction>, Virginia."). A mid-amendment cut (even ending on a period) fails.
  if (/\b(Declaration|Amendment|Condominium|Unit)\b/i.test(t)) {
    if (!/among the (?:land records|Land Records) of .+,\s*Virginia\.?["')\]]?\s*$/i.test(t)) {
      return true;
    }
    // PROBE-A hardening: a condo legal can END on a valid land-records clause while the recorded-Declaration /
    // instrument recital was CUT out of the middle. Require a recorded-Declaration / instrument-number anchor IN
    // ADDITION to the terminus. GOLDEN-1 carries "Instrument No. 080014507 (\"Declaration\")" + "...recorded...";
    // a Unit+Condominium+terminus string with no such anchor is a mid-Declaration cut -> WITHHELD.
    if (!CONDO_DECLARATION_ANCHOR.test(t)) return true;
  }
  return false;
}

/** Recorded-Declaration / instrument-number anchor that a complete condo legal must carry (PROBE-A guard): an
 *  explicit "Instrument No. <n>", or a "Declaration" adjacent to a recorded/Instrument/Deed Book reference. */
const CONDO_DECLARATION_ANCHOR =
  /\bInstrument No\.\s*\w|\bDeclaration\b[^.]*?\b(?:recorded|Instrument|Deed Book)\b|\b(?:recorded|Instrument|Deed Book)\b[^.]*?\bDeclaration\b/i;

/** Join grantor full names house-style ("A" | "A and B" | "A, B and C"). */
function joinNames(names: string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Render the house FACE exemption recital per exemplar, derived from the KB-verified subsection(s). */
function exemptionFace(input: DeedIntoTrustInput): string {
  if (input.exemplar === 'C') {
    // Exemplar-C NELSON header (single (A)(12) basis).
    return 'EXEMPT FROM COUNTY AND STATE RECORDING TAXES PURSUANT TO VA CODE SECTION 58.1-811(A)(12)';
  }
  if (input.exemplar === 'B') {
    // Exemplar-B divorce: BOTH cites, (A)(15) first, with the corpus's space inside "(A) (15)".
    return 'Exempt from recording tax pursuant to Sec 58.1-811(A) (15) and (A)(12) 1950 Code of Virginia';
  }
  // Exemplar-A: single (A)(12) basis.
  return 'Exempt from recording tax pursuant to Sec 58.1-811(A)(12) 1950 Code of Virginia';
}

/** The valid exemplar template ids. */
const VALID_EXEMPLARS = ['A', 'B', 'C'] as const;

/** The exemption-basis SET each exemplar's house FACE literal is allowed to render (cite-integrity coupling). */
const EXEMPLAR_EXPECTED_BASIS: Record<'A' | 'B' | 'C', readonly string[]> = {
  A: ['58.1-811(A)(12)'],
  C: ['58.1-811(A)(12)'],
  B: ['58.1-811(A)(15)', '58.1-811(A)(12)'],
};

/** The `trust_structure` fact each exemplar template corresponds to (exemplar<->facts cross-validation). */
const EXEMPLAR_EXPECTED_TRUST_STRUCTURE: Record<'A' | 'B' | 'C', string> = {
  A: 'single_joint_trust',
  C: 'dual_his_and_hers_trusts',
  B: 'single_spouse_trust_both_sign',
};

/** The accepted §55.1-136(C) note SELECTORs (closed set; any other non-null value is rejected). */
const VALID_TBE_NOTE_SELECTORS = new Set(['Exemplar-A', 'Exemplar-C']);

/** The accepted grantee-object plurality values (closed set). */
const VALID_GRANTEE_OBJECTS = new Set(['GRANTEE', 'GRANTEES']);

/** Normalize a `heldAs` value (lowercase; strip spaces / underscores / hyphens) for robust phrase matching. */
function normHeldAs(v: string | undefined | null): string {
  return (v ?? '').toLowerCase().replace(/[\s_-]+/g, '');
}

/** Accepted tenants-by-the-entirety phrasings for the MARRIED (non-divorce) TBE detection (normalized forms). */
const TBE_HELD_AS_FORMS = new Set([
  'tenantsbytheentirety',
  'tenantsbyentirety',
  'tenancybytheentirety',
  'tenancybyentirety',
  'tenantsbytheentiretywiththecommonlawrightofsurvivorship',
  'tenantsbytheentiretywiththecommonlawrightofsurvivorship.',
]);

/** Compare two basis lists as SETS (order-independent, duplicate-insensitive). */
function sameBasisSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a.map((x) => x.trim()));
  const sb = new Set(b.map((x) => x.trim()));
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/**
 * PURE: assemble a Mason "Deed Into Trust". Returns a fail-closed WITHHELD result (no deed) on any NEG / FIRE-
 * watch trigger; otherwise an OK result with the assembled segments + fullText.
 */
export function assembleIntoTrustDeed(input: DeedIntoTrustInput): DeedIntoTrustResult {
  // ── Guard 1: UNKNOWN_EXEMPLAR — a malformed pipeline value fails closed before ANY work (never silently
  // renders A-style). This is the first gate so an out-of-band exemplar can't slip into a default branch. ──
  if (!(VALID_EXEMPLARS as readonly string[]).includes(input.exemplar)) {
    return withheld(['UNKNOWN_EXEMPLAR']);
  }
  const exemplar = input.exemplar; // narrowed to 'A' | 'B' | 'C'

  // ── Cite gating: every claimed exemption subsection must be in the verified KB (no-hallucinated-cite). ──
  const basisToCode: Record<string, string> = {
    '58.1-811(A)(12)': C2_EXEMPTION_CODE_12,
    '58.1-811(A)(15)': C2_EXEMPTION_CODE_15,
  };
  for (const basis of input.exemptionBasis ?? []) {
    const code = basisToCode[basis];
    if (!code || !VA_EXEMPTIONS.some((e) => e.citation === code)) {
      return withheld(['UNVERIFIED_EXEMPTION_CITE']);
    }
  }

  // ── Guard 2: EXEMPTION basis<->face coupling. The per-exemplar house FACE literal is house style (byte-exact),
  // but the ONLY path to emitting it is a SUPPLIED basis that (a) is non-empty, and (b) as a SET equals the
  // exemplar's expected cite set — so an exemplar can never render a FACE whose cites the caller didn't supply.
  // The KB-presence loop above is ANDed in (both must hold). ──
  const suppliedBasis = input.exemptionBasis ?? [];
  if (suppliedBasis.length === 0) {
    return withheld(['EXEMPTION_BASIS_MISSING']);
  }
  if (!sameBasisSet(suppliedBasis, EXEMPLAR_EXPECTED_BASIS[exemplar])) {
    return withheld(['EXEMPTION_BASIS_EXEMPLAR_MISMATCH']);
  }
  // The divorce exemplar's BOTH cites must additionally be present in the KB (verified, not just supplied).
  if (exemplar === 'B') {
    const haveBoth =
      VA_EXEMPTIONS.some((e) => e.citation === C2_EXEMPTION_CODE_15) &&
      VA_EXEMPTIONS.some((e) => e.citation === C2_EXEMPTION_CODE_12);
    if (!haveBoth) return withheld(['UNVERIFIED_EXEMPTION_CITE']);
  }

  const flags: string[] = [];
  const advisories: string[] = [];

  // ── NEG-4: a caller-supplied trustee-powers block must equal the canonical block EXACTLY (never patched). ──
  if (input.trusteePowersClauseRaw !== undefined && input.trusteePowersClauseRaw !== TRUSTEE_POWERS_BLOCK) {
    flags.push('TRUSTEE_POWERS_CLAUSE_INCOMPLETE');
  }

  // ── NEG-2: a stray free-text token in the notary block (names must derive from the structured grantor list). ──
  // NOTE (best-effort lint): this substring check only SURFACES a known stray-token defect in a caller-supplied
  // raw notary block. Non-reproduction is structurally guaranteed regardless — the emitted notary block is ALWAYS
  // rebuilt from the structured `grantors` list (see assembleExemplar*), so a stray token such as "Zqxborn" can
  // never reach output even if this lint did not fire. Left as best-effort.
  const grantorNames = (input.grantors ?? []).map((g) => (g?.full ?? '').trim()).filter((n) => n !== '');
  if (input.notaryBlockRaw !== undefined) {
    const canonicalAck = `by ${joinNames(grantorNames)}.`;
    // A token immediately before the first grantor name that is not part of any grantor name is a stray token.
    if (grantorNames.length > 0 && !input.notaryBlockRaw.includes(canonicalAck)) {
      flags.push('STRAY_TOKEN_IN_NOTARY_BLOCK');
    }
  }

  // ── NEG-1 / FIRE-watch: truncated / incomplete legal description. ──
  if (isLegalTruncated(input.legalDescription)) flags.push('LEGAL_DESCRIPTION_TRUNCATED');

  // ── FIRE-watch: missing/blank trustees recital or trust name. The trust identity is load-bearing; never blank. ──
  if (isBlank(input.trusteesRecital)) flags.push('TRUSTEES_RECITAL_MISSING');

  // ── FIRE-watch: grantor set must be present (the parties + notary derive from it). ──
  if (grantorNames.length === 0) flags.push('GRANTOR_MISSING');

  // ── Guard 7: GRANTEE-object plurality must be present and one of the closed set {GRANTEE, GRANTEES}. The
  // silent 'GRANTEES' default is removed — an absent/unknown value fails closed (never guess the party label). ──
  if (!input.granteeObjectPlurality || !VALID_GRANTEE_OBJECTS.has(input.granteeObjectPlurality.trim())) {
    flags.push('UNKNOWN_GRANTEE_OBJECT');
  }

  // ── Divorce / married-TBE classification (robust, off marital-status + a NORMALIZED held-as set). ──
  const normalizedHeldAs = normHeldAs(input.heldAs);
  const isDivorceVariant =
    exemplar === 'B' ||
    /divorced/i.test(input.grantorMaritalStatus ?? '') ||
    /postdivorce/.test(normalizedHeldAs);
  const isMarried = !isDivorceVariant && /married/i.test(input.grantorMaritalStatus ?? '');
  const heldAsTbe = TBE_HELD_AS_FORMS.has(normalizedHeldAs);
  const isMarriedTbe = isMarried && heldAsTbe;

  // ── Guard 4: divorce-variant contradiction — any input classified as divorce MUST be exemplar B, so the
  // divorce-recital completeness guard below always runs for divorce cases (never a divorce rendered A/C-style). ──
  if (isDivorceVariant && exemplar !== 'B') {
    flags.push('EXEMPLAR_VARIANT_MISMATCH');
  }

  // ── Guard 6: EXEMPLAR <-> facts cross-validation (makes trust_structure + marital status load-bearing). The
  // supplied exemplar must match the structure derived from trust_structure, AND exemplar B <=> divorced. ──
  const structureExemplar = (
    Object.keys(EXEMPLAR_EXPECTED_TRUST_STRUCTURE) as Array<'A' | 'B' | 'C'>
  ).find((k) => EXEMPLAR_EXPECTED_TRUST_STRUCTURE[k] === (input.trustStructure ?? '').trim());
  const maritalConsistent = exemplar === 'B' ? isDivorceVariant : !isDivorceVariant;
  if (structureExemplar !== exemplar || !maritalConsistent) {
    flags.push('EXEMPLAR_FACTS_MISMATCH');
  }

  // ── NEG-3 / FIRE-watch / Guard 3: the §55.1-136(C) TBE immunity note. ──
  // A NON-divorce MARRIED grantor set conveying into trust REQUIRES the note. A blank/unrecognized held-as for
  // such a couple is NOT a license to omit it — it fails closed (TBE_IMMUNITY_NOTE_REQUIRED) rather than silently
  // emitting a married deed without the creditor-immunity note. The divorced/single case omits it.
  // The note SELECTOR is validated against the closed set; any other non-null value -> required (a malformed
  // selector resolves to a null note, and a married/TBE deed must never carry a null note).
  const selectorValid =
    input.tbeImmunityNote === null ||
    input.tbeImmunityNote === undefined ||
    VALID_TBE_NOTE_SELECTORS.has(input.tbeImmunityNote);
  if (isMarried) {
    // Married (non-divorce): the note is mandatory. Missing/blank/unrecognized held-as for a married couple still
    // requires it (we do not silently emit without it); an invalid or null selector also fails closed.
    if (!selectorValid || input.tbeImmunityNote === null || input.tbeImmunityNote === undefined) {
      flags.push('TBE_IMMUNITY_NOTE_REQUIRED');
    }
    // Defensive: a married couple whose held-as is unrecognized (not a TBE form) still must carry the note; if a
    // (valid) selector was somehow supplied but the couple is not TBE-classified, surface rather than emit blind.
    if (selectorValid && (input.tbeImmunityNote === 'Exemplar-A' || input.tbeImmunityNote === 'Exemplar-C') && !isMarriedTbe && !flags.includes('TBE_IMMUNITY_NOTE_REQUIRED')) {
      flags.push('TBE_IMMUNITY_NOTE_REQUIRED');
    }
  }
  if (isDivorceVariant && input.tbeImmunityNote !== null && input.tbeImmunityNote !== undefined) {
    // A divorced/single grantor set must NOT carry a §55.1-136(C) note — surface (never silently emit it).
    flags.push('TBE_IMMUNITY_NOTE_NOT_PERMITTED');
  }

  // ── Guard 5: DERIVATION_MISSING (exemplar A/C) — a missing derivation line must fail closed here, BEFORE the
  // chokepoint, rather than throwing a TypeError at `input.derivation!.trim()` downstream. ──
  if ((exemplar === 'A' || exemplar === 'C') && isBlank(input.derivation)) {
    flags.push('DERIVATION_MISSING');
  }

  // ── FIRE-watch: the divorce variant must carry the full BEING recital (divorce Order + MSA). Never fabricate. ──
  if (exemplar === 'B') {
    const b = input.beingRecital;
    if (!b || isBlank(b.priorConveyance) || isBlank(b.divorceOrder) || isBlank(b.msa)) {
      flags.push('DIVORCE_RECITAL_INCOMPLETE');
    }
  }

  if (flags.length > 0) return withheld(flags, advisories);

  // ── Post-resolution backstop (Guard 3): resolve the note SELECTOR -> text; a married/TBE deed must NEVER reach
  // assembly with a null note (defence-in-depth behind the flag above). ──
  if (isMarriedTbe) {
    const resolved =
      input.tbeImmunityNote === 'Exemplar-A'
        ? TBE_NOTE_EXEMPLAR_A
        : input.tbeImmunityNote === 'Exemplar-C'
          ? TBE_NOTE_EXEMPLAR_C
          : null;
    if (resolved === null) return withheld(['TBE_IMMUNITY_NOTE_REQUIRED'], advisories);
  }

  // ── resolve the §55.1-136(C) note text (verbatim from the corpus phrasing). ──
  let tbeNote: string | null = null;
  if (input.tbeImmunityNote === 'Exemplar-A') tbeNote = TBE_NOTE_EXEMPLAR_A;
  else if (input.tbeImmunityNote === 'Exemplar-C') tbeNote = TBE_NOTE_EXEMPLAR_C;

  return input.exemplar === 'C'
    ? assembleExemplarC(input, grantorNames, tbeNote, advisories)
    : assembleExemplarAB(input, grantorNames, tbeNote, advisories);
}

// ── Exemplar-A / Exemplar-B layout (the "Satterwhite A-style" deed) ───────────────────────────────────────
function assembleExemplarAB(
  input: DeedIntoTrustInput,
  grantorNames: string[],
  tbeNote: string | null,
  advisories: string[],
): DeedIntoTrustResult {
  const isB = input.exemplar === 'B';
  const d = input.instrumentDate;
  const exemptionLine = exemptionFace(input);
  // granteeObjectPlurality is guaranteed present + valid by the UNKNOWN_GRANTEE_OBJECT guard (no silent default).
  const granteeObject = input.granteeObjectPlurality!.trim();

  // Premise — Exemplar-B carries a DOUBLE space after the (blank) day value (corpus quirk).
  const daySep = isB ? `${d.day}  day` : `${d.day} day`;
  // Exemplar-B (single-trustee divorce) renders the trustee recital with a space before the ", Trustee" title-
  // comma ("Nathaniel O. VOSS , Trustee...") — a documented corpus quirk of the GOLDEN-3 exemplar, introduced by
  // the template (the inbound recital is clean). Scoped to Exemplar-B; the clean recital is used elsewhere.
  const trusteesRecital = isB
    ? input.trusteesRecital.trim().replace(/,\s*Trustee\b/, ' , Trustee')
    : input.trusteesRecital.trim();
  const premise =
    `THIS DEED INTO TRUST, made and entered this ${daySep} of ${d.month}, ${d.year}, by and between ` +
    `${joinNames(grantorNames)}, ${input.grantorMaritalStatus.trim()}, GRANTORS, and ${trusteesRecital}, GRANTEES;`;

  const grantingClause =
    `That, ${CONSIDERATION_OPENER} the GRANTORS do hereby ${input.grantingVerb.trim()} unto the ${granteeObject}, ` +
    `in fee simple, with General Warranty and English covenants of title, all of the Grantors' right, title and ` +
    `interest in and to the following described property, together with improvements thereon, situate, lying and ` +
    `being in the ${input.jurisdictionSitus.trim()}, to-wit:`;

  // Derivation / TBE note line (Exemplar-A) OR BEING recital (Exemplar-B).
  let derivationLine: string | null = null;
  let beingRecitalText: string | null = null;
  if (isB) {
    const b = input.beingRecital!;
    // prior_conveyance + ' ' + divorce_order + '  ' (double space, corpus quirk) + msa.
    beingRecitalText = `${b.priorConveyance.trim()} ${b.divorceOrder.trim()}  ${b.msa.trim()}`;
  } else {
    // Exemplar-A: derivation line, then (same paragraph) the §55.1-136(C) note when present.
    derivationLine = tbeNote ? `${input.derivation!.trim()} ${tbeNote}` : input.derivation!.trim();
  }

  const subjectTo = 'This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.';

  // ── full document (Mason A-style layout) ──
  const lines: string[] = [
    exemptionLine,
    input.titleSearchPerformed ? '' : 'Prepared without benefit of title search',
    '',
    `This Deed was prepared by: ${input.preparer.name.trim()} VSB# ${input.preparer.vsb.trim()}, ${input.preparer.firm.trim()}`,
    '',
    `Tax ID No: ${input.taxId.trim()}`,
    '',
    `Grantee Address and return to: ${input.granteeReturnAddress.trim()}`,
    `Consideration: ${(input.consideration ?? '').trim()}`,
    '',
    `Assessed Value: ${input.assessedValue.trim()}`,
    HEADER_RULE,
    '',
    C2_TITLE,
    '',
    premise,
    '',
    'W I T N E S S E T H',
    '',
    grantingClause,
    '',
    input.legalDescription,
  ];

  // Condo LCE identification footnote (Exemplar-A condo).
  if (input.lceIdentificationFootnote) {
    lines.push('', LCE_FOOTNOTE);
  }

  // Derivation+TBE (Exemplar-A) or BEING recital (Exemplar-B).
  lines.push('');
  lines.push(isB ? beingRecitalText! : derivationLine!);

  // Trustee-powers block.
  lines.push('', TRUSTEE_POWERS_BLOCK, '');

  // Subject-to, then the execution block. Exemplar-B inserts a blank before "Witness" and an extra blank before
  // the first seal (corpus quirks); Exemplar-A runs the "Witness" line directly under the subject-to line.
  lines.push(subjectTo);
  if (isB) {
    lines.push('', 'Witness the following signatures and seals:', '', '', '');
  } else {
    lines.push('Witness the following signatures and seals:', '', '');
  }

  // Seal blocks — one per grantor. Exemplar-B carries a LEADING SPACE on the second seal rule (corpus quirk).
  grantorNames.forEach((n, i) => {
    if (i > 0) lines.push('', '');
    const sealRule = isB && i > 0 ? ` ${SEAL_AB}` : SEAL_AB;
    lines.push(sealRule, n);
  });

  // Notary block.
  const jurisLine = `${input.notaryJurisdiction.type.trim()} OF ${input.notaryJurisdiction.name.trim()}, to wit:`;
  const notaryNames = joinNames(grantorNames);
  const ackDate = `${d.day} day of ${d.month}, ${d.year}`;
  const notaryLines = [
    'COMMONWEALTH OF VIRGINIA',
    '',
    jurisLine,
    '',
    `I, the undersigned, a Notary Public for the jurisdiction aforesaid, do certify that ${notaryNames}, who signed the aforesaid document acknowledged the same before me in my jurisdiction aforesaid, this ${ackDate}.`,
    '',
    'My commission expires: ______________',
    '',
    '____________________________',
    'Notary Public',
  ];
  lines.push('', '', ...notaryLines);

  const fullText = lines.join('\n');
  const notaryBlock = notaryLines.join('\n');

  return {
    status: 'OK',
    flags: [],
    advisories,
    deed: {
      exemptionLine,
      title: C2_TITLE,
      premise,
      considerationOpener: CONSIDERATION_OPENER,
      grantingVerb: input.grantingVerb.trim(),
      granteeObject,
      grantingClause,
      legalDescription: input.legalDescription,
      derivationLine,
      beingRecital: beingRecitalText,
      tbeImmunityNote: tbeNote,
      trusteePowersBlock: TRUSTEE_POWERS_BLOCK,
      subjectTo,
      notaryBlock,
      fullText,
    },
  };
}

// ── Exemplar-C layout (the NELSON-header / dual-trust deed) ────────────────────────────────────────────────
function assembleExemplarC(
  input: DeedIntoTrustInput,
  grantorNames: string[],
  tbeNote: string | null,
  advisories: string[],
): DeedIntoTrustResult {
  const d = input.instrumentDate;
  const exemptionLine = exemptionFace(input);
  // granteeObjectPlurality is guaranteed present + valid by the UNKNOWN_GRANTEE_OBJECT guard (no silent default).
  const granteeObject = input.granteeObjectPlurality!.trim();

  const premise =
    `THIS DEED INTO TRUST, made this ${d.day} day of ${d.month}, ${d.year}, by and between ` +
    `${joinNames(grantorNames)}, ${input.grantorMaritalStatus.trim()}, (the "Grantors"), and ` +
    `${input.trusteesRecital.trim()},  (the "Grantees"),`; // DOUBLE space before (the "Grantees") (corpus quirk)

  const grantingClause =
    `${CONSIDERATION_OPENER.charAt(0).toUpperCase()}${CONSIDERATION_OPENER.slice(1)} ` +
    `the Grantors do hereby ${input.grantingVerb.trim()}, with General Warranty and English Covenants of title, ` +
    `unto the said Grantees, in fee simple, all of the following parcel of real property, with improvements ` +
    `thereon, located in the ${input.jurisdictionSitus.trim()}, to wit:`;

  // Derivation + §55.1-136(C) note (Exemplar-C phrasing), same paragraph.
  const derivationLine = tbeNote ? `${input.derivation!.trim()} ${tbeNote}` : input.derivation!.trim();

  const subjectTo = 'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.';

  const lines: string[] = [
    exemptionLine,
    '',
    `Prepared by:${input.preparer.name.trim()} VSB# ${input.preparer.vsb.trim()}`,
    input.preparer.firm.trim(),
    '',
    `File Number:${(input.fileNumber ?? '').trim()}`,
    '',
    `Grantee's Address:${input.granteeReturnAddress.trim()}`,
    '',
    `Tax I.D. Number:${input.taxId.trim()}`,
    '',
    `Assessed Value:${input.assessedValue.trim()}`,
    '',
    'PREPARED WITHOUT THE BENEFIT OF A TITLE EXAMINATION',
    '',
    '',
    '',
    C2_TITLE,
    '',
    premise,
    '',
    'Witnesseth, that:',
    '',
    grantingClause,
    '',
    input.legalDescription,
    '',
    derivationLine,
    '',
    TRUSTEE_POWERS_BLOCK,
    '',
    '',
    subjectTo,
    '',
    'WITNESS the following signatures and seals:',
    '',
    '',
    '',
  ];

  // Signature lines — the name is appended directly to the 30-underscore rule (corpus quirk).
  grantorNames.forEach((n, i) => {
    if (i > 0) lines.push('', '');
    lines.push(`${SIG_RULE_C}${n}`);
  });

  // Notary block — a single mashed line (corpus quirk). The jurisdiction blank is a FIXED 27-underscore template
  // blank (NOT the header's jurisdiction field); names + date are interpolated from the structured facts.
  const notaryNames = joinNames(grantorNames);
  const notaryMashed =
    `${input.notaryJurisdiction.type.trim()} OF${NOTARY_BLANK_C}` +
    `The foregoing instrument was subscribed and sworn before me this ${d.day} day of ${d.month}, ${d.year}, by ${notaryNames}.` +
    `${SIG_RULE_C}Notary SignatureNotary's Registration Number: ${SHORT_RULE_C}My Commission Expires:`;
  const notaryBlock = ['COMMONWEALTH OF VIRGINIA', notaryMashed].join('\n');
  lines.push('', '', 'COMMONWEALTH OF VIRGINIA', notaryMashed);

  // After-recording-return block.
  const returnLines = input.returnBlock?.lines ?? [];
  lines.push('', '', 'After recording return to:', ...returnLines);

  const fullText = lines.join('\n');

  return {
    status: 'OK',
    flags: [],
    advisories,
    deed: {
      exemptionLine,
      title: C2_TITLE,
      premise,
      considerationOpener: CONSIDERATION_OPENER,
      grantingVerb: input.grantingVerb.trim(),
      granteeObject,
      grantingClause,
      legalDescription: input.legalDescription,
      derivationLine,
      beingRecital: null,
      tbeImmunityNote: tbeNote,
      trusteePowersBlock: TRUSTEE_POWERS_BLOCK,
      subjectTo,
      notaryBlock,
      fullText,
    },
  };
}
