/**
 * deedTodAssembler.ts — DEED-DRAFT-AGENT-1 category C5: DETERMINISTIC "Revocable Transfer on Death Deed" (TOD).
 *
 * PURE + deterministic + NO-EGRESS — NO LLM. Renders the Mason house-style "REVOCABLE TRANSFER ON DEATH DEED"
 * body from a provided consolidated-facts field set (grounded on the C5 TOD fixture pack
 * docs/deed/DEED_CAT_TOD_fixture_pack.md + the verified KB cites § 58.1-811(J) / § 64.2-621). Output is an
 * UNEXECUTED draft; the assembler never finalizes, records, or sends.
 *
 * Category invariants (load-bearing, from the grounded fixtures):
 *  - Exemption line VERBATIM: "THIS DEED IS EXEMPT FROM RECORDATION TAXES PURSUANT TO § 58.1-811(J) Va. Code."
 *  - Title VERBATIM: "REVOCABLE TRANSFER ON DEATH DEED".
 *  - The Act recital (Uniform Real Property Transfer on Death Act, Va. Code § 64.2-621 et seq.) and the ENTIRE
 *    RIGHT-TO-REVOKE block are canonical statutory constants emitted by the assembler byte-for-byte (curly
 *    apostrophes + the triple space in "clerk's office   of the circuit court" preserved).
 *  - Consideration: none (death-effective). Warranty: none. Signature: SINGLE transferor + single-acknowledgment
 *    notary block.
 *  - The legal description, being-recital, condo subject-to + legal preamble, and derivation are carried VERBATIM.
 *
 * Fail-closed contract (NEG): returns { status: 'WITHHELD', flags: [...], deed: undefined } — no partial deed.
 *  - N1 truncated condo legal (no page number / no terminus) → LEGAL_DESCRIPTION_TRUNCATED (+ CONDO_SUBJECT_TO_MISSING).
 *  - N2 a caller-supplied revocation_block that does NOT match the canonical block EXACTLY → REVOCATION_BLOCK_INCOMPLETE
 *    (we never silently splice the canonical over a garbled source). When no revocation_block is supplied (the
 *    GOLDs), the canonical block is emitted.
 *  - N3 a malformed ZIP carrying a stray period ("VA 2230.1") → ADDRESS_ZIP_MALFORMED (with a suggested
 *    normalization advisory "22301"); withheld — the malformed value is never propagated to an authoritative deed.
 *  - N4 (positive) a hyphenated beneficiary surname must survive intact (no split / truncation).
 *  - Defensive guards (in-contract-shaped but under-specified input): a missing/blank transferor name →
 *    TRANSFEROR_MISSING (never throws); an empty/blank beneficiary set (empty persons list, or a
 *    primary_beneficiary with neither a non-blank person nor a non-blank designation+trust) →
 *    NO_BENEFICIARY_DESIGNATED. Both fail closed with no deed.
 *
 * STATUS: flag-dark Phase-1 infrastructure, registered in the deed-type registry; NO live caller. Cite grounded
 * via deedKbVa (the verified KB — never model memory).
 */

import { VA_EXEMPTIONS } from './deedKbVa.js';
import { checkAnnotationLeak, checkFormatLints } from './deedDraftGates.js';

/** The verified exemption cite for this category (validated against the KB; the face form is rendered verbatim). */
const C5_EXEMPTION_CODE = 'Va. Code § 58.1-811(J)';
/** The Mason house FACE form of the exemption recital (the GOLD verbatim line). */
const C5_EXEMPTION_FACE = 'THIS DEED IS EXEMPT FROM RECORDATION TAXES PURSUANT TO § 58.1-811(J) Va. Code.';
const C5_TITLE = 'REVOCABLE TRANSFER ON DEATH DEED';

/** Canonical Act recital (verbatim; identical across every GOLD). */
const ACT_RECITAL =
  'This Revocable Transfer on Death Deed is made pursuant to the provisions of the Uniform Real Property Transfer on Death Act, Virginia Code § 64.2-621 et seq. In accordance with the provisions of the Uniform Real Property Transfer on Death Act, at my death, I transfer and convey my interest in the below described property to my designated beneficiaries as follows:';

/**
 * Canonical RIGHT-TO-REVOKE block (verbatim, LOAD-BEARING). Curly apostrophes (transferor’s / clerk’s) and the
 * triple space inside "office   of the circuit court" are intentional and preserved byte-for-byte. Emitted as a
 * line array so the blank-line structure is unambiguous; the joined string is the canonical segment value.
 */
const REVOCATION_BLOCK_LINES: readonly string[] = [
  'RIGHT TO REVOKE AND METHOD TO REVOKE DEED:',
  '',
  'Before my death, I have the right to revoke this deed.',
  '',
  'Under the Uniform Real Property Transfer on Death Act, an instrument is effective to revoke a recorded transfer on death deed, or any part of it, only if the instrument:',
  '',
  '1. Is one of the following: (a). A transfer on death deed that revokes the transfer on death deed or part of the transfer on death deed expressly; (b). A transfer on death deed that names a designated beneficiary that is inconsistent with the designated beneficiary in a prior transfer on death deed; (c). An instrument of revocation that expressly revokes the transfer on death deed or part of the transfer on death deed; or (d). An inter vivos deed that expressly revokes the transfer on death deed or part of the transfer on death deed.',
  '',
  '2. Is acknowledged by the transferor after the acknowledgment of the transfer on death deed being revoked and recorded before the transferor’s death in the land records of the clerk’s office   of the circuit court where the deed is recorded.',
  '',
  'After this transfer on death deed is recorded, it can be revoked only by an effective revocatory instrument recorded prior to the death of the transferor and may not be revoked by a revocatory act taken against or on the original or a copy of the recorded transfer on death deed.',
  '',
  'The execution and recordation of this transfer on death deed does not limit the effect of an inter vivos transfer of the property.',
  '',
  'At my death, a beneficiary takes the property subject to all conveyances, encumbrances, assignments, contracts, mortgages, liens, and other interests to which the property is subject at my death.',
];
/** The canonical revocation block as one string (the segment value the tests assert). */
const REVOCATION_BLOCK = REVOCATION_BLOCK_LINES.join('\n');

// ── Input model ─────────────────────────────────────────────────────────────────────────────────────────

export interface TodTransferorInput {
  name: string;
  capacity: string;
}

/** G1 form — multiple (or a list of) individual persons. */
export interface TodPrimaryBeneficiariesInput {
  persons: string[];
  vesting: string;
  relationship?: string | null;
}

/** G2/G3 form — a single beneficiary object. Either an individual `person` (G2, with a relationship) or a
 *  trust/successor-trustee `designation` + `trust` (G3). */
export interface TodPrimaryBeneficiaryInput {
  person?: string;
  relationship?: string;
  designation?: string; // e.g. "the Successor Trustee of my revocable trust"
  trust?: string;
  vesting: string;
  commonlyKnownAs?: string; // G3 supplies its own "commonly known as" address
}

export interface DeedTodInput {
  preparer: string;
  returnTo: string;
  taxId: string;
  deedDatePhrase: string;
  transferor: TodTransferorInput;
  /** Optional signature/acknowledgment name; defaults to transferor.name (carried verbatim). */
  signatoryName?: string;
  granteeNamedInPremise?: boolean;
  granteePremiseName?: string;
  /** G1 form. */
  primaryBeneficiaries?: TodPrimaryBeneficiariesInput;
  /** G2/G3 form. */
  primaryBeneficiary?: TodPrimaryBeneficiaryInput;
  propertyAddress: string;
  taxMapReference: string;
  legalDescriptionPreamble?: string; // G2 inlines a preamble before the legal
  legalDescription: string;
  condoSubjectTo?: string | null; // G2
  derivationOfTitle?: string; // G2
  beingRecital?: string; // G1
  /** Optional assessed-value / no-title-exam banner (G2). */
  assessedValue?: string;
  preparedWithoutTitleExam?: boolean;
  /** Notary layout selector. notaryCountyBlank → compact "CITY/COUNTY OF ____" block (G1/G3). */
  notaryCountyBlank?: boolean;
  notaryCity?: string; // expanded layout (G2): "CITY OF ARLINGTON"
  acknowledgmentMonthYear: string;
  /** N2 — a caller-supplied revocation block; must match the canonical block exactly or fail closed. */
  revocationBlock?: string;
}

export interface DeedTodSegments {
  exemptionLine: string;
  title: string;
  premise: string;
  actRecital: string;
  beneficiaryHeading: string;
  beneficiaryDesignation: string;
  propertyParagraph: string;
  legalDescription: string;
  condoSubjectTo: string | null; // G2
  beingRecital: string | null; // G1
  derivationOfTitle: string | null; // G2
  revocationBlock: string;
  vesting: string;
  /** The designated beneficiaries, order-preserving (the person/trust tokens). */
  beneficiaries: string[];
  fullText: string;
}

export interface DeedTodResult {
  status: 'OK' | 'WITHHELD';
  flags: string[];
  advisories: string[];
  recordableFloorOk: boolean;
  deed?: DeedTodSegments;
}

const SEAL_COMPACT = '________________________________(seal)'; // 32 underscores (G1/G3)
const SEAL_EXPANDED = '___________________________________(seal)'; // 35 underscores (G2)
const NOTARY_LINE = '____________________________Notary Public';
const COMMISSION_LINE =
  'My commission expires: _____________________Registration number: _______________________';

function withheld(flags: string[], advisories: string[] = []): DeedTodResult {
  return { status: 'WITHHELD', flags, advisories, recordableFloorOk: false };
}

/** A legal description is truncated/missing if absent, lacks a recordable terminus (period optionally + closing
 *  quote/paren), or ends on a dangling connective/preposition (e.g. "...Deed Book 5207 at page"). Mirrors the
 *  C3 condo-terminus idea. */
function isLegalTruncated(legal: string | undefined): boolean {
  const t = (legal ?? '').trim();
  if (t === '') return true;
  if (!/(?:[.]["')\]]?|\))\s*$/.test(t)) return true;
  const core = t.replace(/(?:[.]["')\]]?|\))\s*$/, '').trim();
  if (/\b(among|in|of|to|the|and|a|an|at|on|with|by|as|for|page|book)$/i.test(core)) return true;
  return false;
}

/** A 5-digit ZIP carrying a stray period (the "VA 2230.1" OCR/typo class). Returns the suggested normalization
 *  (period removed) or null when no malformed ZIP is present. */
function malformedZipNormalization(value: string | undefined): string | null {
  if (!value) return null;
  const m = value.match(/\b(\d{2,4}\.\d{1,3})\b/);
  if (!m) return null;
  const digits = m[1]!.replace(/\./g, '');
  if (digits.length !== 5) return null;
  return digits;
}

/**
 * PURE: assemble a Mason "Revocable Transfer on Death Deed". Returns a fail-closed WITHHELD result (no deed) on
 * any NEG trigger; otherwise an OK result with the assembled segments + fullText.
 */
export function assembleTodDeed(input: DeedTodInput): DeedTodResult {
  // Cite must be grounded in the verified KB (no-hallucinated-cite discipline).
  if (!VA_EXEMPTIONS.some((e) => e.citation === C5_EXEMPTION_CODE)) {
    return withheld(['UNVERIFIED_EXEMPTION_CITE']);
  }

  const flags: string[] = [];
  const advisories: string[] = [];

  // ── Transferor guard: a TOD deed has no operative grantor without a named transferor. A missing/blank name
  // would otherwise throw downstream (buildPremise / the signature line). Fail closed on in-contract-shaped
  // input rather than throwing. ──
  if (!input.transferor || (input.transferor.name ?? '').trim() === '') {
    return withheld(['TRANSFEROR_MISSING'], advisories);
  }

  // ── N1: truncated legal description (no terminus / dangling "at page") ──
  if (isLegalTruncated(input.legalDescription)) {
    flags.push('LEGAL_DESCRIPTION_TRUNCATED');
    // A condo legal that is cut also loses its subject-to (Chapter 4.2) block.
    if (/\b(CONDOMINIUM|Declaration)\b/i.test(input.legalDescription ?? '') && !input.condoSubjectTo) {
      flags.push('CONDO_SUBJECT_TO_MISSING');
    }
  }

  // ── N2: a caller-supplied revocation block must match the canonical block EXACTLY (never silently spliced) ──
  if (input.revocationBlock !== undefined && input.revocationBlock !== REVOCATION_BLOCK) {
    flags.push('REVOCATION_BLOCK_INCOMPLETE');
  }

  // ── N3: a malformed ZIP (stray period) anywhere in the address-bearing fields — flag + suggest, never emit.
  // Scans every field that can carry an address to output: the header return-line, the premise (transferor
  // capacity + a named grantee), the property address, and the trust "commonly known as". ──
  const zipFix =
    malformedZipNormalization(input.propertyAddress) ??
    malformedZipNormalization(input.transferor?.capacity) ??
    malformedZipNormalization(input.returnTo) ??
    malformedZipNormalization(input.granteePremiseName) ??
    malformedZipNormalization(input.primaryBeneficiary?.commonlyKnownAs);
  if (zipFix) {
    flags.push('ADDRESS_ZIP_MALFORMED');
    advisories.push(`ADDRESS_ZIP_MALFORMED: a malformed ZIP carrying a stray period was detected; suggested normalization ${zipFix} — attorney confirmation required before the normalized value becomes authoritative (the malformed value is not emitted).`);
  }

  // Any N1/N2/N3 trigger is blocking — fail closed before building the (possibly under-specified) body.
  if (flags.length > 0) return withheld(flags, advisories);

  // ── beneficiary form + the order-preserving beneficiaries array, heading, and designation sentence ──
  const beneficiaries: string[] = [];
  let heading = '';
  let designation = '';
  let vesting = '';
  let beneficiaryFormBlanksAfter = 2; // blanks after the designation before the property paragraph

  if (input.primaryBeneficiaries) {
    // G1 form — a list of individual persons. Drop blank/whitespace tokens; an empty list fails closed.
    const b = input.primaryBeneficiaries;
    beneficiaries.push(...(b.persons ?? []).map((p) => (p ?? '').trim()).filter((p) => p !== ''));
    vesting = (b.vesting ?? '').trim();
    if (beneficiaries.length === 0) {
      flags.push('NO_BENEFICIARY_DESIGNATED');
    } else {
      // Heading: PRIMARY BENEFICIARY iff exactly one INDIVIDUAL person; else plural.
      heading = beneficiaries.length === 1 ? 'PRIMARY BENEFICIARY' : 'PRIMARY BENEFICIARIES';
      const names = formatNameList(beneficiaries);
      const known = input.propertyAddress.trim();
      designation =
        `I hereby designate as my ${heading === 'PRIMARY BENEFICIARY' ? 'Primary Beneficiary' : 'Primary Beneficiaries'} ${names}, ` +
        `as the ${heading === 'PRIMARY BENEFICIARY' ? 'Primary Beneficiary' : 'Primary Beneficiaries'} of the property described, below, ` +
        `and which is commonly known as ${known}, in fee simple, as ${vesting}.`;
    }
    beneficiaryFormBlanksAfter = 1; // G1 uses a single blank after the designation
  } else if (input.primaryBeneficiary) {
    const b = input.primaryBeneficiary;
    vesting = (b.vesting ?? '').trim();
    const designationToken = (b.designation ?? '').trim();
    const trustToken = (b.trust ?? '').trim();
    const personToken = (b.person ?? '').trim();
    if (designationToken !== '' && trustToken !== '') {
      // G3 form — trust / successor-trustee. Heading is the plural form even with one beneficiary (corpus quirk).
      heading = 'PRIMARY BENEFICIARIES';
      beneficiaries.push(trustToken);
      const known = (b.commonlyKnownAs ?? input.propertyAddress).trim();
      designation =
        `I hereby designate as my Primary Beneficiary as ${designationToken}, ${trustToken}, ` +
        `as the Primary Beneficiary of the property described, below, ` +
        `and which is commonly known as ${known}, in fee simple, as ${vesting}.`;
    } else if (personToken !== '') {
      // G2 form — a single individual with a relationship. Heading is singular; "commonly known" WITHOUT "as".
      heading = 'PRIMARY BENEFICIARY';
      beneficiaries.push(personToken);
      const known = (b.commonlyKnownAs ?? input.propertyAddress).trim();
      const rel = b.relationship ? `${b.relationship.trim()}, ` : '';
      designation =
        `I hereby designate ${rel}${personToken}, as the Primary Beneficiary of the property described, below, ` +
        `and which is commonly known ${known}, in fee simple, as ${vesting}.`;
    } else {
      // A primary_beneficiary object with neither a non-blank person nor a non-blank designation+trust.
      flags.push('NO_BENEFICIARY_DESIGNATED');
    }
    beneficiaryFormBlanksAfter = 2; // G2/G3 use two blanks after the designation
  } else {
    flags.push('NO_BENEFICIARY_DESIGNATED');
  }

  // Hyphenated-name integrity (N4): beneficiary tokens are carried VERBATIM (never split on a hyphen or space),
  // so a hyphenated surname like "HOLLOWAY-MERCER" survives intact as a single beneficiary token.

  if (flags.length > 0) return withheld(flags, advisories);

  // ── header region ──
  const exemptionLine = C5_EXEMPTION_FACE;
  const lines: string[] = [
    exemptionLine,
    '',
    `This Deed was prepared by ${input.preparer.trim()}`,
    '',
    `Return to: ${input.returnTo.trim()}`,
    '',
    `TAX ID NO: ${input.taxId.trim()}`,
    '',
  ];
  if (input.assessedValue || input.preparedWithoutTitleExam) {
    if (input.assessedValue) {
      lines.push(`Assessed Value:  ${input.assessedValue.trim()}`, '');
    }
    if (input.preparedWithoutTitleExam) {
      lines.push('PREPARED WITHOUT THE BENEFIT OF A TITLE EXAMINATION', '');
    }
  } else {
    lines.push(''); // G1/G3: a second blank line before the title
  }

  // ── title + premise ──
  const title = C5_TITLE;
  const premise = buildPremise(input);
  lines.push(title, '', premise, '');

  // ── act recital ──
  const actRecital = ACT_RECITAL;
  lines.push(actRecital, '');

  // ── beneficiary heading + designation ──
  lines.push(heading, '', designation);
  for (let i = 0; i < beneficiaryFormBlanksAfter; i++) lines.push('');

  // ── property paragraph + legal + (condo subject-to / being / derivation) ──
  const propertyParagraph = buildPropertyParagraph(input);
  lines.push(propertyParagraph, '');
  lines.push(input.legalDescription.trim(), '');

  const condoSubjectTo = input.condoSubjectTo ? input.condoSubjectTo.trim() : null;
  const beingRecital = input.beingRecital ? input.beingRecital.trim() : null;
  const derivationOfTitle = input.derivationOfTitle ? input.derivationOfTitle.trim() : null;

  if (condoSubjectTo) {
    // G2: condo subject-to, then derivation, then revocation.
    lines.push(condoSubjectTo, '');
    if (derivationOfTitle) lines.push(derivationOfTitle, '');
  } else if (beingRecital) {
    // G1: BEING recital, then a blank, then a second blank before the revocation block.
    lines.push(beingRecital, '', '');
  }
  // G3 (no condo subject-to, no being): the single blank already pushed after the legal closes the gap.

  // ── revocation block (then a single blank before the execution block) ──
  lines.push(...REVOCATION_BLOCK_LINES, '');

  // ── execution + notary block ──
  const signatory = (input.signatoryName ?? input.transferor.name).trim();
  if (input.notaryCountyBlank) {
    // Compact layout (G1/G3).
    lines.push(
      'Witness the following signature and seals:',
      SEAL_COMPACT,
      signatory,
      '',
      'COMMONWEALTH OF VIRGINIA',
      'CITY/COUNTY OF _________________, to wit:',
      `The foregoing instrument was acknowledged before me this ______ day of ${input.acknowledgmentMonthYear.trim()} by ${signatory}.`,
      NOTARY_LINE,
      COMMISSION_LINE,
    );
  } else {
    // Expanded layout (G2): named city, extra execution whitespace, 35-underscore seal.
    lines.push(
      'Witness the following signature and seals:',
      '',
      '',
      '',
      SEAL_EXPANDED,
      signatory,
      '',
      'COMMONWEALTH OF VIRGINIA',
      `${(input.notaryCity ?? '').trim()}, to wit:`,
      '',
      `The foregoing instrument was acknowledged before me this ______ day of ${input.acknowledgmentMonthYear.trim()} by ${signatory}.`,
      '',
      '',
      NOTARY_LINE,
      COMMISSION_LINE,
    );
  }

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
      premise,
      actRecital,
      beneficiaryHeading: heading,
      beneficiaryDesignation: designation,
      propertyParagraph,
      legalDescription: input.legalDescription.trim(),
      condoSubjectTo,
      beingRecital,
      derivationOfTitle,
      revocationBlock: REVOCATION_BLOCK,
      vesting,
      beneficiaries,
      fullText,
    },
  };
}

/** Build the premise ("THIS REVOCABLE TRANSFER ON DEATH DEED, dated …, is made by …") with the corpus-faithful
 *  terminal punctuation: a grantee-bearing premise ends "…, and <grantee>, Grantee."; a no-grantee premise ends
 *  with a period UNLESS the capacity terminates in an inline address (a 5-digit ZIP with no closing punctuation
 *  — the G3 exemplar quirk). */
function buildPremise(input: DeedTodInput): string {
  const lead = `THIS REVOCABLE TRANSFER ON DEATH DEED, dated as of the ${input.deedDatePhrase.trim()}, is made by ${input.transferor.name.trim()}, ${input.transferor.capacity.trim()}`;
  if (input.granteeNamedInPremise && input.granteePremiseName) {
    return `${lead}, and ${input.granteePremiseName.trim()}, Grantee.`;
  }
  // No grantee: append a period unless the capacity ends with an inline address (ends in a 5-digit ZIP).
  if (/\bwhose address is\b/i.test(input.transferor.capacity) && /\d{5}\s*$/.test(input.transferor.capacity.trim())) {
    return lead;
  }
  return `${lead}.`;
}

/** Build the property paragraph. The tax-map reference is followed by a comma UNLESS it is "as stated above".
 *  G2 inlines a legal-description preamble (ending "…as follows:"); G1/G3 use "as follows:". */
function buildPropertyParagraph(input: DeedTodInput): string {
  const taxRef = input.taxMapReference.trim();
  const taxClause = taxRef === 'as stated above' ? `${taxRef} ` : `${taxRef}, `;
  const tail = input.legalDescriptionPreamble ? input.legalDescriptionPreamble.trim() : 'as follows:';
  return (
    `The street address of the real property is ${input.propertyAddress.trim()}, ` +
    `and the tax map reference is ${taxClause}and the legal description of the real property that shall be ` +
    `transferred at my death pursuant to this Revocable Transfer on Death Deed is ${tail}`
  );
}

/** Format an Oxford-comma "A, B, and C" name list (a single name is returned unchanged). */
function formatNameList(names: string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}
