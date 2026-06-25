/**
 * deedIntoLlcAssembler.ts — DEED-DRAFT-AGENT-1 category C3: DETERMINISTIC "Deed Into an LLC" assembler.
 *
 * PURE + deterministic + NO-EGRESS — NO LLM. Renders the Mason house-style "DEED INTO AN LLC" body from a
 * provided §2.1.2-style field set (grounded on docs/deed/DEED_KB_CATEGORY_GROUNDING.md §C3 + the C3 fixture
 * pack). Output is an UNEXECUTED draft; the assembler never finalizes, records, or sends.
 *
 * Category invariants (load-bearing, from the grounded fixtures):
 *  - QUITCLAIM, NO WARRANTY. The granting verb is "quitclaim release and convey … all of the Grantor's right,
 *    title and interest"; ANY warranty token ("General/Special Warranty", "English Covenants", "covenants of
 *    title") is a fail-closed bleed (NEG-4).
 *  - Exemption § 58.1-811(A)(10) (Virginia-LLC). A grantee entity lacking ", a Virginia Limited Liability
 *    Company" (or asserting a non-Virginia LLC) fails closed (NEG-3) — the exemption basis requires a VA LLC.
 *  - Legal description VERBATIM (casing preserved); a truncated legal (e.g. a condo amendment list cut mid-item)
 *    is WITHHELD (NEG-1), never padded/guessed.
 *  - Count agreement: GRANTOR/GRANTORS, "does/do hereby", one seal block per grantor, all names in the notary.
 *    The body possessive stays the firm-standard singular "all of the Grantor's right, title and interest" even
 *    for two grantors — surfaced as a non-blocking ADVISORY, never silently rewritten; a defective input that
 *    marks a singular-possessive body AUTHORITATIVE for two grantors fails closed (NEG-2).
 *
 * Fail-closed contract (NEG): returns { status: 'WITHHELD', flags: [...], deed: undefined } — no partial deed.
 * STATUS: flag-dark Phase-1 infrastructure, registered in the deed-type registry; NO live caller (wiring is
 * domino #7). Cite grounded via deedKbVa (the verified KB — never model memory).
 */

import { VA_EXEMPTIONS } from './deedKbVa.js';
import { checkAnnotationLeak, checkFormatLints } from './deedDraftGates.js';

/** The verified exemption cite for this category (validated against the KB; the house FACE form is rendered). */
const C3_EXEMPTION_CODE = 'Va. Code § 58.1-811(A)(10)';
/** Mason house FACE form of the exemption recital (grounded GOLD form: "Sec …"). DERIVED from the KB-verified
 *  CODE so the rendered cite can never drift from the verified subsection. */
const C3_EXEMPTION_FACE = C3_EXEMPTION_CODE.replace('Va. Code § ', 'Sec ');

export interface IntoLlcGrantorInput {
  name: string;
  maritalStatus: string; // "unmarried" | "married" (rendered per-member for single; group form for a couple)
}

export interface DeedIntoLlcInput {
  preparedBy: string;
  titleSearch: string;
  taxId: string;
  granteeAddressReturn: string;
  assessedValue: string;
  consideration: string;
  instrumentDatePhrase: string; // "____ day of April, 2026"
  grantors: IntoLlcGrantorInput[];
  grantorCardinality: 'single' | 'married_couple';
  granteeLlc: string; // e.g. "Marlowe Glen Holdings LLC, a Virginia Limited Liability Company"
  propertyJurisdiction: string; // "County of Fairfax, Virginia"
  legalDescription: string; // verbatim
  derivationOfTitle: string; // verbatim slot
  subjectTo: string; // verbatim
  notaryJurisdiction: { commonwealth: string; locality: string };
  /** NEG-2: a caller-supplied granting body marked authoritative — passed through ONLY if it agrees. */
  sourceGrantingBodyOverride?: string;
  overrideMarkedAuthoritative?: boolean;
  /** NEG-4: a caller-supplied granting-verb override — rejected if it injects warranty language. */
  grantingVerbOverride?: string;
}

export interface DeedIntoLlcSegments {
  exemptionLine: string;
  title: string;
  captionParties: string;
  witnesseth: string;
  grantingClause: string;
  legalDescription: string;
  derivationLine: string;
  subjectTo: string;
  paginationMarker: string;
  sealBlocks: string[];
  fullText: string;
}

export interface DeedIntoLlcResult {
  status: 'OK' | 'WITHHELD';
  flags: string[];
  /** Non-blocking lint advisories (e.g. the singular-possessive-with-two-grantors firm-standard note). */
  advisories: string[];
  recordableFloorOk: boolean;
  deed?: DeedIntoLlcSegments;
}

const SEAL_LINE = '__________________________(seal)';
const HEADER_RULE = '_____________________________________________________________________________';
/** Any warranty/covenant token forbidden in a quitclaim-into-LLC (NEG-4). Includes the operative warranty-
 *  covenant verbs ("warrant generally/specially"). NOT applied to the derivation slot, where a prior-instrument
 *  reference may legitimately name a "General Warranty Deed". */
const WARRANTY_BLEED_RE = /general warranty|special warranty|english covenants|covenants of title|with warranty|\bwarrant(?:s|ed)? (?:generally|specially)\b/i;

/** A legal description is truncated/missing if absent, or it lacks a recordable terminus (period optionally +
 *  closing quote/paren), or ends on a dangling connective/preposition. Mirrors the seller-side NEG-6 guard. */
function isLegalTruncated(legal: string | undefined): boolean {
  const t = (legal ?? '').trim();
  if (t === '') return true;
  if (!/(?:[.]["')\]]?|\))\s*$/.test(t)) return true;
  const core = t.replace(/(?:[.]["')\]]?|\))\s*$/, '').trim();
  if (/\b(among|in|of|to|the|and|a|an|at|on|with|by|as|for|page|book)$/i.test(core)) return true;
  // A condo legal reciting a Declaration / amendment(s) must terminate in the closing land-records clause —
  // otherwise it is a mid-amendment cut even if it ends on a period (the realistic OCR truncation).
  if (/\b(Declaration|Amendment|Condominium)\b/i.test(t) &&
      !/among the (?:land records|Land Records) of .+ (?:County|City), Virginia\.?["')\]]?\s*$/i.test(t)) {
    return true;
  }
  return false;
}

/** The grantee LLC string must carry the Virginia LLC designator and assert no other jurisdiction (NEG-3). */
function llcDesignatorValid(granteeLlc: string | undefined): boolean {
  const s = (granteeLlc ?? '').trim();
  if (s === '') return false;
  if (!/,\s*a Virginia Limited Liability Company\s*$/i.test(s)) return false;
  // A foreign jurisdiction anywhere in the entity string is inconsistent with the (A)(10) VA-LLC basis.
  if (/\ba\s+(?!Virginia\b)[A-Z][A-Za-z]+\s+Limited Liability Company/i.test(s)) return false;
  return true;
}

function withheld(flags: string[]): DeedIntoLlcResult {
  return { status: 'WITHHELD', flags, advisories: [], recordableFloorOk: false };
}

/**
 * PURE: assemble a Mason "Deed Into an LLC". Returns a fail-closed WITHHELD result (no deed) on any NEG trigger;
 * otherwise an OK result with the assembled segments + fullText.
 */
export function assembleDeedIntoLlc(input: DeedIntoLlcInput): DeedIntoLlcResult {
  // Cite must be grounded in the verified KB (no-hallucinated-cite discipline).
  if (!VA_EXEMPTIONS.some((e) => e.citation === C3_EXEMPTION_CODE)) {
    return withheld(['UNVERIFIED_EXEMPTION_CITE']);
  }

  const flags: string[] = [];
  const advisories: string[] = [];

  // ── NEG-3: LLC designator ──
  if (!llcDesignatorValid(input.granteeLlc)) flags.push('INVALID_LLC_DESIGNATOR');

  // ── NEG-4: warranty bleed — scan the granting-verb override AND the verbatim passthrough slots that reach the
  // recordable face (legal description, subject-to). The derivation slot is EXEMPT (a prior-instrument reference
  // legitimately names a "General Warranty Deed"). A quitclaim-into-LLC carries NO warranty anywhere. ──
  if (
    (input.grantingVerbOverride && WARRANTY_BLEED_RE.test(input.grantingVerbOverride)) ||
    WARRANTY_BLEED_RE.test(input.legalDescription ?? '') ||
    WARRANTY_BLEED_RE.test(input.subjectTo ?? '')
  ) {
    flags.push('WARRANTY_BLEED_INTO_QUITCLAIM');
  }

  // ── NEG-1: truncated legal ──
  if (isLegalTruncated(input.legalDescription)) flags.push('TRUNCATED_LEGAL_DESCRIPTION');

  // ── NEG-2: an authoritative granting-body override carrying a cardinality typo ──
  const grantorCount = (input.grantors ?? []).length;
  if (input.sourceGrantingBodyOverride && input.overrideMarkedAuthoritative) {
    const body = input.sourceGrantingBodyOverride;
    const usesPlural = /\bGRANTORS\b|\bdo hereby\b/.test(body);
    const singularPossessive = /\ball of the Grantor's right\b/.test(body) && !/\bGrantors'\b/.test(body);
    if (grantorCount > 1 && usesPlural && singularPossessive) {
      flags.push('GRANTOR_CARDINALITY_MISMATCH');
    }
  }

  // ── Cardinality guard: only the grounded 1 (single) or 2 (married couple) grantors render. 0 or 3+ fail
  // closed (rather than throwing, or mislabeling a non-married multi-grantor as "a married couple"). ──
  if (grantorCount === 0 || grantorCount > 2) flags.push('UNSUPPORTED_GRANTOR_CARDINALITY');

  if (flags.length > 0) return withheld(flags);

  // ── parties ──
  const plural = grantorCount > 1;
  const grantorLabel = plural ? 'GRANTORS' : 'GRANTOR';
  const grantorVerb = plural ? 'do' : 'does';
  const names = input.grantors.map((g) => g.name.trim());
  const grantorPhrase = plural
    ? `${names.join(' and ')}, a married couple, ${grantorLabel}`
    : `${names[0]}, ${input.grantors[0]!.maritalStatus.trim()}, ${grantorLabel}`;
  const captionParties = `${grantorPhrase}, and ${input.granteeLlc.trim()}, GRANTEE;`;

  // Firm-standard granting body keeps the singular possessive; surface (never silently rewrite) for 2 grantors.
  if (plural) advisories.push('GRANTOR_CARDINALITY_ADVISORY: two grantors with the firm-standard singular possessive "all of the Grantor\'s right, title and interest" — confirm or normalize before recording (not auto-rewritten).');

  const exemptionLine = `Exempt from recording tax pursuant to ${C3_EXEMPTION_FACE}, 1950 Code of Virginia`;
  const title = 'DEED';
  const witnesseth = 'W I T N E S S E T H';
  const paginationMarker = 'SIGNATURES AND SEALS TO APPEAR ON THE FOLLOWING PAGE';
  const grantingClause =
    `the ${grantorLabel} ${grantorVerb} hereby quitclaim release and convey unto the GRANTEE, in fee simple, ` +
    `all of the Grantor's right, title and interest in and to the following described property, together with ` +
    `improvements thereon, situate, lying and being in the  ${input.propertyJurisdiction.trim()}, to-wit:`;
  const sealBlocks = names.map((n) => `${SEAL_LINE}\n${n}`);
  const notaryNames = names.join(' and ');

  // ── full document (Mason C3 house layout; the signature area is a fixed-height execution block) ──
  const lines: string[] = [
    exemptionLine,
    input.titleSearch.trim(),
    '',
    `This Deed was prepared by: ${input.preparedBy.trim()}`,
    '',
    `Tax ID No.: ${input.taxId.trim()}`,
    '',
    `Grantee Address and return to:  ${input.granteeAddressReturn.trim()}`,
    '',
    `Assessed Value: ${input.assessedValue.trim()}`,
    '',
    `Consideration: ${input.consideration.trim()}`,
    '',
    HEADER_RULE,
    '',
    title,
    '',
    `THIS DEED made and entered this ${input.instrumentDatePhrase.trim()}, by and between ${captionParties}`,
    '',
    witnesseth,
    '',
    `That, for a good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, ${grantingClause}`,
    '',
    input.legalDescription,
    '',
    input.derivationOfTitle.trim(),
    '',
    input.subjectTo.trim(),
    '',
    '',
    paginationMarker,
    'Witness the following signatures and seals:',
    '',
    '',
  ];
  // Seal blocks, separated by a blank line.
  sealBlocks.forEach((b, i) => {
    if (i > 0) lines.push('');
    lines.push(...b.split('\n'));
  });
  // Execution gap before the acknowledgment (tuned to the grounded GOLDs: 7 blanks for one grantor, 5 for two).
  const gap = Math.max(2, 9 - 2 * grantorCount);
  for (let i = 0; i < gap; i++) lines.push('');
  lines.push(
    input.notaryJurisdiction.commonwealth.trim(),
    input.notaryJurisdiction.locality.trim(),
    '',
    `I, the undersigned, a Notary Public for the jurisdiction aforesaid, do certify that ${notaryNames}, who signed the aforesaid document acknowledged the same before me in my jurisdiction aforesaid, this ${input.instrumentDatePhrase.trim()}.`,
    '',
    'My commission expires: ______________',
    '',
    '____________________________',
    'Notary Public',
  );

  const fullText = lines.join('\n');
  const recordableFloorOk = checkAnnotationLeak(fullText).ok && checkFormatLints(fullText).ok;

  return {
    status: 'OK',
    flags: [],
    advisories,
    recordableFloorOk,
    deed: {
      exemptionLine,
      title,
      captionParties,
      witnesseth,
      grantingClause,
      legalDescription: input.legalDescription,
      derivationLine: input.derivationOfTitle.trim(),
      subjectTo: input.subjectTo.trim(),
      paginationMarker,
      sealBlocks,
      fullText,
    },
  };
}
