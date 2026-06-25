/**
 * deedOutOfLlcAssembler.ts — DEED-DRAFT-AGENT-1 category C4: DETERMINISTIC "Deed Out of an LLC" assembler.
 *
 * PURE + deterministic + NO-EGRESS — NO LLM. Renders the Mason house-style "DEED OUT OF AN LLC" body from a
 * provided consolidated-facts field set (grounded on the C4 fixture pack
 * docs/deed/DEED_CAT_OUT_OF_LLC_fixture_pack.md + the verified KB cite § 58.1-811(A)(11), the OUT-of-LLC /
 * grantees->=50% direction). Output is an UNEXECUTED draft; the assembler never finalizes, records, or sends.
 *
 * Category invariants (load-bearing, from the grounded fixtures):
 *  - Exemption recital VERBATIM (GOLD face form): "Exempt from recording tax pursuant to Sec. § 58.1-811(A)(11),
 *    1950 Code of Virginia, amended". The "Sec. §" double designator and "(A)(11)" subsection are corpus quirks
 *    reproduced byte-for-byte. The cite is gated on the verified KB (no-hallucinated-cite guard); a malformed
 *    raw cite ("58-1-811(A)(11)", hyphen-for-dot) is FLAGGED (EXEMPTION_CITE_MALFORMED) and normalized — the
 *    typo is NEVER emitted (the rendered cite is derived from the KB-verified CODE, not from raw input).
 *  - Title plain "DEED". Pre-title banner "THIS DEED PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION – NO
 *    TITLE INSURANCE" (en-dash U+2013).
 *  - Premise = name-before-parenthetical-label: "<LLC>, A Virginia Limited Liability Company, (the \"Grantor\"),
 *    and <members joined>, collectively being the members of the Grantor LLC, (the \"Grantees\"),". The labels
 *    and the bridge fragment are TEMPLATE-assembled — never part of a captured name (NEG-A name-bleed guard).
 *  - Granting: "the Grantor does hereby grant and convey, with Special Warranty of title, unto the said
 *    Grantees, in fee simple, as tenants in common, ...". SPECIAL warranty (never General; NEG-D). Members take
 *    as tenants in common. Consideration $0.00.
 *  - Legal description carried VERBATIM. A truncated legal is WITHHELD (NEG-C), never padded/guessed.
 *  - LLC-by-members signature block (each member). Notary pluralizes "Member"/"Members" by count.
 *  - HOUSE-STYLE INVARIANTS carried verbatim regardless of member count (the assembler does NOT grammar-"fix" —
 *    that would be a substantive rewrite): a SINGLE member still reads "collectively being the members of the
 *    Grantor LLC" and the granting clause still says "as tenants in common".
 *
 * Fail-closed contract (NEG / FIRE-watch): returns { status: 'WITHHELD', flags: [...], deed: undefined } — no
 * partial deed. Triggers: party-name label/bridge bleed (NEG-A), truncated legal (NEG-C), warranty mismatch
 * (NEG-D), and the defensive guards (missing/blank LLC name; empty members).
 *
 * STATUS: flag-dark Phase-1 infrastructure, registered in the deed-type registry; NO live caller. Cite grounded
 * via deedKbVa (the verified KB — never model memory).
 */

import { VA_EXEMPTIONS } from './deedKbVa.js';
import { checkAnnotationLeak, checkFormatLints } from './deedDraftGates.js';

/** The verified exemption CODE for this category (validated against the KB; the GOLD face form is rendered). */
const C4_EXEMPTION_CODE = 'Va. Code § 58.1-811(A)(11)';
/**
 * Mason house FACE form of the exemption recital (the GOLD verbatim line). DERIVED from the KB-verified CODE so
 * the rendered subsection can never drift from the verified cite: the "Va. Code § " prefix is rewritten to the
 * corpus "Sec. § " double-designator, and the "1950 Code of Virginia, amended" tail is appended.
 */
const C4_EXEMPTION_FACE = `Exempt from recording tax pursuant to ${C4_EXEMPTION_CODE.replace('Va. Code § ', 'Sec. § ')}, 1950 Code of Virginia, amended`;

const C4_TITLE = 'DEED';
const C4_BANNER = 'THIS DEED PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION – NO TITLE INSURANCE';
const C4_PREPARED_BY = 'Prepared by: Kelly Satterwhite, Esquire, VSB #91049';
const C4_FIRM = 'The Mason Law Firm, PLC';
/** The house granting verb/warranty (SPECIAL, never General). Used as the canonical guard target for NEG-D. */
const C4_WARRANTY_TOKEN = 'grant and convey, with Special Warranty of title';
const C4_SUBJECT_TO = 'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.';

const SIG_RULE = '______________________________'; // 30 underscores — the "By:" / notary signature rule
const SHORT_RULE = '______________'; // 14 underscores — registration / commission lines

// ── Input model ─────────────────────────────────────────────────────────────────────────────────────────

export interface OutOfLlcMemberInput {
  name: string;
  signatureTitle?: string; // defaults to "Member"
}

export interface OutOfLlcReturnTo {
  company: string;
  line1: string;
  line2?: string;
  cityStateZip: string;
  phone: string;
}

export interface DeedOutOfLlcInput {
  grantorLlc: string; // bare entity name only (the "(the \"Grantor\")" label is template-assembled)
  members: OutOfLlcMemberInput[]; // bare member names only
  fileNumber: string;
  granteeAddress: string;
  taxId: string;
  assessedValue: string;
  consideration: string;
  executionMonth: string;
  executionYear: string;
  localityType: string; // "County" | "City"
  localityName: string;
  legalDescription: string; // verbatim
  derivationInstrumentNumber: string;
  notaryLocality: string; // e.g. "COUNTY OF LOUDOUN" (emitted verbatim)
  returnTo: OutOfLlcReturnTo;
  /** NEG-B: a caller-supplied raw exemption cite — if malformed it is FLAGGED + normalized (never emitted raw). */
  exemptionCiteRaw?: string;
  /** NEG-D: a caller-supplied granting/warranty token — rejected if it injects General (non-Special) warranty. */
  warrantyToken?: string;
}

export interface DeedOutOfLlcSegments {
  exemptionLine: string;
  preparedBy: string;
  banner: string;
  title: string;
  premise: string;
  captionParties: string; // alias of premise (the §3 note names "premise/captionParties")
  witnesseth: string;
  grantingClause: string;
  legalDescription: string;
  derivationLine: string;
  subjectTo: string;
  signatureBlocks: string[]; // the LLC line + each "By: ____ <member>, <title>" line
  notaryBlock: string;
  fullText: string;
}

export interface DeedOutOfLlcResult {
  status: 'OK' | 'WITHHELD';
  flags: string[];
  advisories: string[];
  recordableFloorOk: boolean;
  deed?: DeedOutOfLlcSegments;
}

function withheld(flags: string[], advisories: string[] = []): DeedOutOfLlcResult {
  return { status: 'WITHHELD', flags, advisories, recordableFloorOk: false };
}

/**
 * Name-bleed guard (the OCR-B1 / NEG-A failure class). A captured LLC/member name is the BARE proper name only;
 * the parenthetical labels, the descriptor clause, the bridge fragment (both the parenthesized "\"), and" and
 * the bare "\", and" list-join form), and any interior control whitespace are template-assembled and NEVER part
 * of a captured name. Returns the matching error code, or null if the name is clean.
 *
 * Mirrors C3's NAME_BLEED idea, adapted to the C4 labels/bridge. The bridge fragment is checked first so the
 * NEG-A2 "...\"), and" case (and the bare "\", and" variant) is classified PARTY_NAME_BRIDGE_FRAGMENT (not the
 * generic label code).
 */
function partyNameBleedCode(name: string): 'PARTY_NAME_BRIDGE_FRAGMENT' | 'PARTY_NAME_LABEL_BLEED' | null {
  const s = name ?? '';
  // Bridge fragment: the assembled list-join, in BOTH the parenthesized form ("\"), and") and the bare paren-LESS
  // form ("\", and") — straight- AND smart-quote variants. The close-paren is OPTIONAL so the bare variant
  // (enumerated as a POISON fragment in the pack §3.2) also fails closed; a captured name never carries a
  // quote-then-", and" bridge. NB: the quote is REQUIRED, so a clean entity name merely containing the word "and"
  // (e.g. "Sand & Stone Holdings LLC") never false-trips.
  if (/["”]\)?\s*,\s*and\b/.test(s)) return 'PARTY_NAME_BRIDGE_FRAGMENT';
  // Parenthetical labels / entity descriptor / collective descriptor clause / interior control whitespace
  // (newline / carriage return / tab — a captured name never carries interior control whitespace).
  if (
    /\(the\s*"/.test(s) ||
    /\(the\s*[“"]/.test(s) ||
    /collectively being the members of the Grantor LLC/i.test(s) ||
    /A Virginia Limited Liability Company/i.test(s) ||
    /[\r\n\t]/.test(s)
  ) {
    return 'PARTY_NAME_LABEL_BLEED';
  }
  return null;
}

/** The known corpus typo: the section designator with a hyphen for the dot ("58-1-811" instead of "58.1-811"). */
function isMalformedExemptionCite(raw: string | undefined): boolean {
  if (!raw) return false;
  return /58-1-811/.test(raw) || /\b58-\d/.test(raw);
}

/**
 * A legal description is truncated/missing if absent, lacks a recordable terminus (period optionally + closing
 * quote/paren), or ends on a dangling connective/preposition (e.g. "...at page"). Condo-aware (reused from the
 * C3 guard): a legal reciting a Declaration / amendment(s) must terminate in the closing land-records clause,
 * otherwise it is a mid-amendment cut even if it ends on a period.
 */
function isLegalTruncated(legal: string | undefined): boolean {
  const t = (legal ?? '').trim();
  if (t === '') return true;
  if (!/(?:[.]["')\]]?|\))\s*$/.test(t)) return true;
  const core = t.replace(/(?:[.]["')\]]?|\))\s*$/, '').trim();
  if (/\b(among|in|of|to|the|and|a|an|at|on|with|by|as|for|page|book)$/i.test(core)) return true;
  if (/\b(Declaration|Amendment|Condominium)\b/i.test(t) &&
      !/among the (?:land records|Land Records) of .+ (?:County|City), Virginia\.?["')\]]?\s*$/i.test(t)) {
    return true;
  }
  return false;
}

/** Join member names house-style: "A" | "A and B" | "A, B and C" (no Oxford comma before the final "and"). */
function joinMemberNames(names: string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * PURE: assemble a Mason "Deed Out of an LLC". Returns a fail-closed WITHHELD result (no deed) on any NEG/FIRE-
 * watch trigger; otherwise an OK result with the assembled segments + fullText.
 */
export function assembleOutOfLlcDeed(input: DeedOutOfLlcInput): DeedOutOfLlcResult {
  // Cite must be grounded in the verified KB (no-hallucinated-cite discipline).
  if (!VA_EXEMPTIONS.some((e) => e.citation === C4_EXEMPTION_CODE)) {
    return withheld(['UNVERIFIED_EXEMPTION_CITE']);
  }

  const flags: string[] = [];
  const advisories: string[] = [];

  // ── NEG-A: party-name label/bridge bleed (the LLC grantor name + every member grantee name) ──
  const llcBleed = partyNameBleedCode(input.grantorLlc ?? '');
  if (llcBleed) flags.push(llcBleed);
  for (const m of input.members ?? []) {
    const code = partyNameBleedCode(m?.name ?? '');
    if (code && !flags.includes(code)) flags.push(code);
  }

  // ── FIRE-watch: missing/blank LLC name; empty members ──
  if ((input.grantorLlc ?? '').trim() === '') flags.push('GRANTOR_LLC_MISSING');
  const members = (input.members ?? []).filter((m) => (m?.name ?? '').trim() !== '');
  if (members.length === 0 && (input.members ?? []).length === 0) flags.push('NO_MEMBER_DESIGNATED');
  // A members array that contained ONLY blank entries (after the filter) is also no-member.
  if (members.length === 0 && (input.members ?? []).length > 0 && flags.indexOf('NO_MEMBER_DESIGNATED') < 0) {
    flags.push('NO_MEMBER_DESIGNATED');
  }

  // ── NEG-D: warranty mismatch — a caller-supplied token asserting General (non-Special) warranty is rejected. ──
  if (input.warrantyToken !== undefined && input.warrantyToken !== C4_WARRANTY_TOKEN) {
    if (/general warranty/i.test(input.warrantyToken) || !/special warranty/i.test(input.warrantyToken)) {
      flags.push('WARRANTY_MISMATCH');
    }
  }

  // ── NEG-C / FIRE-watch: truncated legal description ──
  if (isLegalTruncated(input.legalDescription)) flags.push('LEGAL_DESCRIPTION_TRUNCATED');

  // ── NEG-B: a malformed raw exemption cite is FLAG_AND_NORMALIZE (non-blocking): flag it, but the rendered cite
  // is always derived from the KB-verified CODE, so the typo can never reach the output. ──
  if (isMalformedExemptionCite(input.exemptionCiteRaw)) {
    flags.push('EXEMPTION_CITE_MALFORMED');
    advisories.push(
      `EXEMPTION_CITE_MALFORMED: input exemption cite '${(input.exemptionCiteRaw ?? '').trim()}' is the known corpus typo (hyphen for dot). Normalized to the KB-verified form '${C4_EXEMPTION_FACE}'; the raw form is NOT emitted. Flag for attorney confirmation.`,
    );
  }

  // Any fail-closed flag (everything EXCEPT the non-blocking EXEMPTION_CITE_MALFORMED) withholds the deed.
  const blockingFlags = flags.filter((f) => f !== 'EXEMPTION_CITE_MALFORMED');
  if (blockingFlags.length > 0) return withheld(flags, advisories);

  // ── premise (name-before-parenthetical-label) ──
  const llc = input.grantorLlc.trim();
  const memberNames = members.map((m) => m.name.trim());
  const joinedMembers = joinMemberNames(memberNames);
  const exemptionLine = C4_EXEMPTION_FACE;
  const premise =
    `THIS DEED, made this _____ day of ${input.executionMonth.trim()}, ${input.executionYear.trim()}, by and between ` +
    `${llc}, A Virginia Limited Liability Company, (the "Grantor"), and ${joinedMembers}, ` +
    `collectively being the members of the Grantor LLC, (the "Grantees"),`;

  const witnesseth = 'Witnesseth, that:';
  const grantingClause =
    `the Grantor does hereby ${C4_WARRANTY_TOKEN}, unto the said Grantees, in fee simple, as tenants in common,`;
  const grantingParagraph =
    `For and in consideration of valuable consideration, the receipt and sufficiency of which are hereby acknowledged, ` +
    `${grantingClause} all of the following parcel of real property, with improvements thereon, ` +
    `located in the ${input.localityType.trim()} of ${input.localityName.trim()}, Commonwealth of Virginia, to wit:`;

  const derivationLine =
    `For derivation of title see Deed recorded as instrument number ${input.derivationInstrumentNumber.trim()} among the aforesaid land records.`;
  const subjectTo = C4_SUBJECT_TO;

  // ── LLC-by-members signature block ──
  const llcSigLine = `${llc}, A Virginia Limited Liability Company`;
  const memberSigLines = members.map(
    (m) => `By: ${SIG_RULE}     ${m.name.trim()}, ${(m.signatureTitle ?? 'Member').trim()}`,
  );
  const signatureBlocks = [llcSigLine, ...memberSigLines];

  // ── notary block (pluralize Member/Members by count) ──
  const memberWord = members.length > 1 ? 'Members' : 'Member';
  const notaryLines = [
    'COMMONWEALTH OF VIRGINIA',
    input.notaryLocality.trim(),
    `The foregoing instrument was subscribed and sworn before me this _____ day of ${input.executionMonth.trim()}, ${input.executionYear.trim()}, by ${joinedMembers}, ${memberWord} of ${llc}.`,
    SIG_RULE,
    "Notary Public's signature",
    `Notary registration number: ${SHORT_RULE}`,
    `My commission expires: ${SHORT_RULE}`,
  ];
  const notaryBlock = notaryLines.join('\n');

  // ── return block ──
  const returnLines = [
    'After recording return to:',
    input.returnTo.company.trim(),
    input.returnTo.line1.trim(),
    ...(input.returnTo.line2 && input.returnTo.line2.trim() !== '' ? [input.returnTo.line2.trim()] : []),
    input.returnTo.cityStateZip.trim(),
    input.returnTo.phone.trim(),
  ];

  // ── full document (Mason C4 house layout) ──
  const lines: string[] = [
    exemptionLine,
    '',
    C4_PREPARED_BY,
    C4_FIRM,
    '',
    `File Number: ${input.fileNumber.trim()}`,
    '',
    `Grantee's Address: ${input.granteeAddress.trim()}`,
    '',
    `Tax I.D. Number: ${input.taxId.trim()}`,
    '',
    `Assessed value: $${input.assessedValue.trim()}`,
    '',
    `Consideration: $${input.consideration.trim()}`,
    '',
    C4_BANNER,
    '',
    C4_TITLE,
    '',
    premise,
    '',
    witnesseth,
    '',
    grantingParagraph,
    '',
    input.legalDescription.trim(),
    '',
    derivationLine,
    '',
    subjectTo,
    '',
    'WITNESS the following signatures and seals:',
    '',
    ...signatureBlocks,
    '',
    ...notaryLines,
    '',
    ...returnLines,
  ];

  const fullText = lines.join('\n');
  const recordableFloorOk = checkAnnotationLeak(fullText).ok && checkFormatLints(fullText).ok;

  return {
    status: 'OK',
    flags,
    advisories,
    recordableFloorOk,
    deed: {
      exemptionLine,
      preparedBy: C4_PREPARED_BY,
      banner: C4_BANNER,
      title: C4_TITLE,
      premise,
      captionParties: premise,
      witnesseth,
      grantingClause,
      legalDescription: input.legalDescription.trim(),
      derivationLine,
      subjectTo,
      signatureBlocks,
      notaryBlock,
      fullText,
    },
  };
}
