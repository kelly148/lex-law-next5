/**
 * deedEngagementLetter.ts — DEED-DRAFT-AGENT-1 Inc 3: the companion Mason engagement-letter GENERATOR.
 *
 * PURE + deterministic + NO-EGRESS — NO LLM. This is a TEMPLATE-FILL engine, NOT free generation: the
 * protected verbatim clauses (the send-safety + professional-responsibility spine) are string constants that
 * appear unaltered; the only fill points are the [[ ]] slots. The agent NEVER synthesizes scope, fee,
 * disclaimer, or representation language — a missing fact becomes a [[ ]] placeholder with a research lead
 * (honesty floor), never an invented value.
 *
 * Grounded on docs/deed-agent/DEED_ENGAGEMENT_LETTER_KB_SEED.md (Bien-Aime canonical). First-person-singular
 * voice ("I", "my services") per that source.
 *
 * The FIRE §7 spine, as it applies to a client-facing letter:
 *  1. VERBATIM PROTECTED CLAUSES — the opening (3.1), separate-representation (3.2, conditional), scope-
 *     limitation (3.4), title-search / "no title exam, no title insurance" disclaimer (3.5), closing (3.7),
 *     sign-off (3.8), and AGREED-AND-ACCEPTED (3.9) are emitted from constants. A missing/garbled disclaimer
 *     is fail-closed (an unresolved [[ ]] inside a spine clause drives spine.intact=false), never a paraphrase.
 *  2. NO FABRICATED FACTS — every genuinely-missing fact becomes a [[ ]] placeholder WITH a lead.
 *  3. NEVER INVENT THE FEE — [[ fee amount ]] is left as a placeholder unless the attorney supplies it.
 *  4. CROSS-LINK TO THE DEED — the deed type, vesting language, and recordation-exemption citation are read
 *     from the SAME companion GiftDeedDraft the deed assembler produced (deterministic re-derivation), so the
 *     letter and the deed can never disagree.
 *  5. ATTORNEY DECIDES — this module assembles a DRAFT only; it never finalizes, records, or sends.
 *
 * The procedure (deedDraftAgent.createEngagementLetter) re-derives the companion deed via the pure
 * buildGiftDraft helper on the SAME gift input, so crossLink is provably consistent with createGiftDraft.
 */

import type { DeedSourceFacts } from './deedSourceFacts.js';
import type { GiftDeedDraft } from './deedGiftAssembler.js';
import { VA_DEED_TYPES } from './deedKbVa.js';

/** The documentType key under which a companion engagement letter is persisted; the persisted-document export
 *  routes this type to the Bien-Aime formatter. Defined here (a pure module, no docx dep) so the procedure can
 *  reference it without importing the formatter. */
export const ENGAGEMENT_LETTER_DOC_TYPE = 'engagement_letter';

// ── verbatim protected-spine constants (the seed §3 clauses; never paraphrased) ──
const OPENING =
  'My firm is pleased to provide legal assistance regarding the matter referenced above. This engagement letter sets forth the terms, conditions, and objectives of the engagement and clarifies the nature and limitations of my services.';

const TITLE_SEARCH_DISCLAIMER =
  'Please also be aware that changes in property ownership and titling may affect liens and encumbrances against the Property. A title search of the Property and a judgment search of all persons involved in the title transfer may show how this Deed would affect the liens and encumbrances against the Property. A title search was not requested or performed in conjunction with drafting this Deed. The Mason Law Firm, PLC does not perform title searches, but I can order one if you wish. Please let me know in writing prior to proceeding if a title search is desired.';

const CLOSING =
  'If the foregoing is acceptable, please sign a copy of this letter in the space provided and return it to me. Please do not hesitate to let me know if you have any questions.';

const SIGN_OFF = [
  'Very truly yours,',
  'THE MASON LAW FIRM, PLC',
  '/s/ Kelly Satterwhite',
  'Kelly Satterwhite, Esq. (VSB #91049)',
  'Admitted in Virginia and Maryland',
].join('\n');

const AGREED_INTRO = 'This letter correctly sets forth my understanding of the terms of this engagement.';
const SIGNATURE_LINE = '____________________________________  Date: ____________';

/** Substrings that MUST appear verbatim in any assembled letter — a structural guard against a future edit
 *  accidentally paraphrasing the protected spine (the separate-rep invariant is added only when included). */
const SPINE_INVARIANTS: readonly string[] = [
  'My firm is pleased to provide legal assistance regarding the matter referenced above.',
  'clarifies the nature and limitations of my services.',
  'Please understand that my representation in this matter is limited solely to',
  'and will conclude upon',
  'as I was not retained to evaluate those matters.',
  'By signing below, you acknowledge that The Mason Law Firm, PLC cannot provide legal representation regarding these or other matters not specifically indicated.',
  'A title search was not requested or performed in conjunction with drafting this Deed.',
  'The Mason Law Firm, PLC does not perform title searches, but I can order one if you wish.',
  'If the foregoing is acceptable, please sign a copy of this letter in the space provided and return it to me.',
  'AGREED AND ACCEPTED:',
  'This letter correctly sets forth my understanding of the terms of this engagement.',
  'Kelly Satterwhite, Esq. (VSB #91049)',
];
const SEPARATE_REP_INVARIANT = 'the recipient of an interest in the Property;';

export interface EngagementLetterInput {
  /** Letter date (e.g. "June 18, 2026"); [[ ]] if absent. */
  date?: string | null;
  /** The represented client(s) — the addressee(s)/"you"/signatory(ies). The procedure defaults this to the
   *  deed's grantor(s) (the donor is the firm's client in a gift). */
  clientNames: string[];
  /** Addressee mailing address block; [[ ]] if absent. */
  clientAddress?: string | null;
  /** Salutation line, e.g. "Dear Ms. Bien-Aime:"; [[ ]] if absent. */
  salutation?: string | null;
  /** Property address for the RE: line; [[ ]] if absent. */
  propertyAddress?: string | null;
  /** RE: sub-action, e.g. "Addition of Jane Doe to Title"; [[ ]] if absent. */
  reAction?: string | null;
  /** Recording locality (County / independent City); falls back to facts.propertyLocality, else [[ ]]. */
  recordingCounty?: string | null;
  /** Flat fee — NEVER invented; [[ ]] if unset. */
  feeAmount?: string | null;
  /** Non-client recipients who take an interest (triggers the separate-rep clause). The procedure defaults
   *  this to the deed's grantee(s) NOT in clientNames. Empty -> the separate-rep clause is omitted. */
  recipientNames?: string[];
  /** Pronouns for a SINGLE recipient (he/she, his/her). Absent (or any multi-recipient case) -> a fail-closed
   *  [[ ]] pronoun placeholder; the verbatim §3.2 clause is REPEATED once per recipient (never pluralized). */
  recipientPronoun?: { subject: string; possessive: string } | null;
  /** The resulting title-holders for the §3.3 vesting sentence ("title ... held by [[grantee(s)]]"). Defaults
   *  to the deed's grantee(s). */
  granteeNames: string[];
  /** Who signs the Deed ("you" / "both of you"); derived from client count if absent. */
  signingParties?: string | null;
  /** AGREED-block signatory name(s); defaults to clientNames. */
  signatoryNames?: string[];
  /** Include the due-on-sale warning (a protective disclaimer). DEFAULT true (over-disclosure is the safe
   *  side for a draft); the attorney removes it if no mortgage/DOT encumbers the Property. */
  includeDueOnSale?: boolean;
  /** Include the gift-specific basis-step-up loss sentence. DEFAULT true for a gift. */
  includeBasisStepUp?: boolean;
  /** The firm records the Deed (Bien-Aime scope: "drafting and recording ... conclude upon recording").
   *  DEFAULT true. false -> the Pearsall variant "drafting ... conclude upon completion of the Deed". */
  firmRecording?: boolean;
}

export interface EngagementLetterPlaceholder {
  token: string;
  field: string;
  researchLead: string;
}

export interface EngagementLetterCrossLink {
  /** Deed type title (e.g. "Deed of Gift") — from the KB, same as the deed. */
  deedType: string;
  /** Vesting language — from the companion GiftDeedDraft (operator-ratified gift phrasing). */
  vesting: string;
  vestingKey: string;
  /** Full recordation-exemption citation — from the KB, same as the deed (null for a taxable deed). */
  exemptionCitation: string | null;
}

export interface EngagementLetterDraft {
  /** The assembled letter (plain text; feeds the review/finalize + Bien-Aime .docx export path). */
  text: string;
  /** Every unresolved [[ ]] placeholder + its research lead. */
  placeholders: EngagementLetterPlaceholder[];
  /** The deed type / vesting / exemption echoed from the companion deed (consistency by construction). */
  crossLink: EngagementLetterCrossLink;
  /** Whether the separate-representation clause was included (a non-client recipient exists). */
  separateRepIncluded: boolean;
  /** Which conditional segments were applied. */
  conditionals: { dueOnSale: boolean; basisStepUp: boolean; survivorshipTail: boolean; firmRecording: boolean };
  /** Protected-spine status: intact = every spine clause present verbatim AND no unresolved [[ ]] inside a
   *  spine clause (fail-closed — the letter is not sendable while a spine slot is unfilled). */
  spine: { intact: boolean; verbatimOk: boolean; unresolvedFields: string[]; missingInvariants: string[] };
  notes: string[];
  warnings: string[];
}

const GIFT_TYPE = VA_DEED_TYPES.find((t) => t.key === 'gift');

/** Fields whose [[ ]] placeholder, if unresolved, sits INSIDE a protected-spine clause (so it must drive
 *  spine.intact=false — the disclaimer/representation/fee spine is not complete). */
const SPINE_FIELDS: ReadonlySet<string> = new Set([
  'client name (separate representation)',
  'recipient name (separate representation)',
  'recipient pronoun (subject)',
  'recipient pronoun (possessive)',
  'deed type',
  'fee amount',
  'recording locality',
  'recordation-exemption citation',
  'client signatory name',
]);

/**
 * PURE: deterministically assemble the companion Mason engagement letter from the consolidated facts, the
 * companion deed draft (for the cross-link), and the attorney-provided letter input. Never throws; never
 * fabricates; the verbatim spine is emitted from constants or a slot is left [[ ]] and flagged.
 */
export function buildEngagementLetter(
  facts: DeedSourceFacts,
  deed: GiftDeedDraft,
  input: EngagementLetterInput,
): EngagementLetterDraft {
  const placeholders: EngagementLetterPlaceholder[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

  const ph = (field: string, researchLead: string): string => {
    const token = `[[ ${field} ]]`;
    placeholders.push({ token, field, researchLead });
    return token;
  };
  const resolve = (value: string | null | undefined, field: string, lead: string): string => {
    const v = (value ?? '').trim();
    return v.length > 0 ? v : ph(field, lead);
  };
  const joinNames = (names: readonly string[]): string =>
    names.map((n) => n.trim()).filter((n) => n.length > 0).join(' and ');

  // ── cross-link (from the KB + the companion deed — never a placeholder, never invented) ──
  const deedType = GIFT_TYPE?.title ?? 'Deed of Gift';
  const exemptionCitation = GIFT_TYPE?.exemptionCitation ?? null;
  const vesting = deed.vesting.language;
  const vestingKey = deed.vesting.key;
  const crossLink: EngagementLetterCrossLink = { deedType, vesting, vestingKey, exemptionCitation };

  // ── header: date, addressee, RE, salutation ──
  const date = resolve(input.date, 'date', 'Letter date (e.g. "June 18, 2026").');
  const clientLine = input.clientNames.length > 0 ? joinNames(input.clientNames) : ph('client name', 'The represented client name(s) — from the matter (the deed grantor/donor).');
  const clientAddress = resolve(input.clientAddress, 'client address', "The client's mailing address (street / city, state ZIP).");
  const reProperty = resolve(input.propertyAddress, 'property address', 'The subject property street address (for the RE: line).');
  const reAction = resolve(input.reAction, 'RE action', 'The transaction action for the RE: sub-line, e.g. "Addition of <name> to Title".');
  const salutation = resolve(input.salutation, 'salutation', 'Salutation, e.g. "Dear Ms. <last name>:".');

  const addresseeBlock = [clientLine, clientAddress].join('\n');
  const reLine = `RE:  Preparation of ${deedType} — ${reProperty}  (${reAction})`;

  // ── separate representation (3.2) — CONDITIONAL on a non-client recipient ──
  const recipients = (input.recipientNames ?? []).map((n) => n.trim()).filter((n) => n.length > 0);
  const separateRepIncluded = recipients.length > 0;
  let separateRep: string | null = null;
  if (separateRepIncluded) {
    const clientNameForRep = input.clientNames.length > 0 ? joinNames(input.clientNames) : ph('client name (separate representation)', 'The represented client name(s).');
    // The protected §3.2 clause is SINGULAR ("[he/she] is not my client"). To stay verbatim AND grammatical,
    // it is REPEATED once per non-client recipient rather than pluralized (a pluralization would paraphrase the
    // protected clause). A single recipient may carry supplied pronouns; otherwise each recipient's pronouns are
    // a fail-closed [[ ]] placeholder.
    const parts: string[] = [`I represent you, ${clientNameForRep}, alone in this matter.`];
    recipients.forEach((rName) => {
      const lead = `Subject pronoun for the recipient${recipients.length > 1 ? ` ${rName}` : ''} (he / she).`;
      const possLead = `Possessive pronoun for the recipient${recipients.length > 1 ? ` ${rName}` : ''} (his / her).`;
      let subj: string;
      let poss: string;
      if (recipients.length === 1 && input.recipientPronoun) {
        subj = input.recipientPronoun.subject.trim() || ph('recipient pronoun (subject)', lead);
        poss = input.recipientPronoun.possessive.trim() || ph('recipient pronoun (possessive)', possLead);
      } else {
        subj = ph('recipient pronoun (subject)', lead);
        poss = ph('recipient pronoun (possessive)', possLead);
      }
      parts.push(`I do not represent ${rName}, the recipient of an interest in the Property; ${subj} is not my client, and ${subj} may wish to consult ${poss} own counsel regarding this transfer.`);
    });
    separateRep = parts.join(' ');
  } else {
    notes.push('Separate-representation clause OMITTED — no non-client recipient was identified. Include it (seed §3.2) if anyone other than the client takes an interest in the Property (e.g. a gift donee).');
  }

  // ── enclosed deed + vesting (3.3) ──
  const granteeNames = input.granteeNames.length > 0 ? joinNames(input.granteeNames) : ph('grantee(s)', 'The resulting title-holder name(s) after the transfer (the deed grantee(s)).');
  const signingParties = (input.signingParties ?? '').trim() || (input.clientNames.length > 1 ? 'both of you' : 'you');
  const survivorshipTail = vestingKey === 'jtwros' || vestingKey === 'tenants_by_entirety';
  // The two-party form ("either owner ... the survivor") reads wrong for 3+ joint owners — use a count-neutral
  // survivorship explanation in that case.
  const tail = survivorshipTail
    ? input.granteeNames.length > 2
      ? ", so that upon the death of any owner that owner's interest in the Property passes automatically to the surviving owners"
      : ', so that upon the death of either owner the entire fee simple interest in the Property will pass automatically to the survivor'
    : '';
  const enclosedDeed = `Enclosed is the ${deedType} for your review. The Deed must be signed by ${signingParties}, notarized, and the original returned to me. Once this transfer is complete, title to the Property will be held by ${granteeNames}, as ${vesting}${tail}.`;

  // ── scope limitation (3.4) — verbatim spine + conditional segments ──
  const firmRecording = input.firmRecording !== false; // default true
  const scopeVerb = firmRecording ? 'drafting and recording' : 'drafting';
  const scopeConclude = firmRecording ? 'recording' : 'completion of the Deed';
  const includeDueOnSale = input.includeDueOnSale !== false; // default true (protective)
  const includeBasisStepUp = input.includeBasisStepUp !== false; // default true for gift
  const dueOnSale = includeDueOnSale
    ? ' If there are any mortgages or deeds of trust against the Property, this transfer could activate a due-on-sale clause in your loan terms allowing the lender to accelerate repayment; you may wish to obtain written consent from your lender(s) prior to completing this transfer.'
    : '';
  const basisStepUp = includeBasisStepUp ? ', including the loss of any income-tax basis step-up on the gifted interest' : '';
  const scope =
    `Please understand that my representation in this matter is limited solely to ${scopeVerb} the referenced ${deedType} and will conclude upon ${scopeConclude}.` +
    dueOnSale +
    ` You may also wish to consult a tax and estate advisor as to any income tax, gift tax, and estate implications${basisStepUp}, as I was not retained to evaluate those matters.` +
    ' By signing below, you acknowledge that The Mason Law Firm, PLC cannot provide legal representation regarding these or other matters not specifically indicated.';

  // ── fee + recordation-exemption recital (3.6) ──
  // Strip a leading "$" the attorney may have typed so the hardcoded "$" never doubles ("$$5,000").
  const feeRaw = (input.feeAmount ?? '').trim().replace(/^\$\s*/, '');
  const feeAmount = resolve(feeRaw.length > 0 ? feeRaw : null, 'fee amount', 'The flat fee for this engagement (attorney-set) — NEVER invented; leave the placeholder if unset.');
  let exemptionForRecital: string;
  if (exemptionCitation) {
    exemptionForRecital = exemptionCitation;
  } else {
    exemptionForRecital = ph('recordation-exemption citation', 'This deed type is not recordation-tax exempt — replace the exemption recital with the correct tax treatment (seed §3.6).');
    warnings.push('exemption_unresolved_non_exempt_deed');
  }
  // The recital is recording-specific (the Bien-Aime/firmRecording case). When the firm is NOT recording, drop
  // the "and recording" phrase AND the final recording sentence (omission, not paraphrase) so the letter cannot
  // contradict the scope clause; the recording-locality slot is then not required either.
  const preparationPhrase = firmRecording ? 'my preparation and recording of' : 'my preparation of';
  let recordingSentence = '';
  if (firmRecording) {
    const recordingCounty = resolve(
      input.recordingCounty ?? facts.propertyLocality.value,
      'recording locality',
      'The recording locality (County / independent City) where the Deed will be recorded.',
    );
    recordingSentence = ` Upon receipt of your check and the original signed and notarized Deed, I will have the Deed recorded among the land records of ${recordingCounty}, Virginia.`;
  }
  const feeRecital =
    `The flat fee for this engagement is $${feeAmount}, which covers ${preparationPhrase} the ${deedType}. ` +
    `This ${deedType} is exempt from Virginia state and local recordation tax pursuant to ${exemptionForRecital}. ` +
    `Please provide a check for $${feeAmount} payable to The Mason Law Firm, PLC.` +
    recordingSentence;

  // ── AGREED AND ACCEPTED (3.9) ──
  const signatoryNames = (input.signatoryNames && input.signatoryNames.length > 0 ? input.signatoryNames : input.clientNames)
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  const signatoryLines = signatoryNames.length > 0
    ? signatoryNames.map((n) => `${SIGNATURE_LINE}\n${n}`).join('\n\n')
    : `${SIGNATURE_LINE}\n${ph('client signatory name', 'The client signatory name(s) for the AGREED-AND-ACCEPTED block.')}`;
  const agreedBlock = ['AGREED AND ACCEPTED:', AGREED_INTRO, '', signatoryLines].join('\n');
  const enclosure = `Enclosure: ${deedType}`;

  // ── assemble (seed §2 skeleton; plain text, blank-line-separated paragraphs) ──
  const paragraphs: string[] = [
    date,
    addresseeBlock,
    reLine,
    salutation,
    OPENING,
    ...(separateRep ? [separateRep] : []),
    enclosedDeed,
    scope,
    TITLE_SEARCH_DISCLAIMER,
    feeRecital,
    CLOSING,
    SIGN_OFF,
    agreedBlock,
    enclosure,
  ];
  const text = paragraphs.join('\n\n');

  // ── spine integrity ──
  const requiredInvariants = separateRepIncluded ? [...SPINE_INVARIANTS, SEPARATE_REP_INVARIANT] : [...SPINE_INVARIANTS];
  const missingInvariants = requiredInvariants.filter((s) => !text.includes(s));
  const verbatimOk = missingInvariants.length === 0;
  const unresolvedFields = placeholders.map((p) => p.field).filter((f) => SPINE_FIELDS.has(f));
  const spineIntact = verbatimOk && unresolvedFields.length === 0;

  if (placeholders.length > 0) warnings.push(`unresolved_placeholders:${placeholders.length}`);
  if (!verbatimOk) warnings.push(`spine_verbatim_missing:${missingInvariants.length}`);

  notes.push(
    `Cross-linked to the companion ${deedType}: deed type, vesting ("${vesting}"), and the recordation-exemption recital are taken from the SAME deterministic assembler output as the deed, so the letter and the deed cannot disagree.`,
  );
  if (separateRepIncluded) {
    notes.push(`Separate-representation clause INCLUDED for non-client recipient(s): ${joinNames(recipients)} (professional-responsibility, seed §3.2).`);
  }
  if (includeDueOnSale) {
    notes.push('Due-on-sale warning INCLUDED by default (protective). Remove it if no mortgage or deed of trust encumbers the Property (seed §3.4).');
  }
  notes.push(
    spineIntact
      ? 'Protected spine intact and all spine slots resolved. The letter is a complete draft for attorney review (still never auto-sent).'
      : `Protected spine NOT complete: ${unresolvedFields.length} unresolved spine slot(s)${missingInvariants.length > 0 ? ` + ${missingInvariants.length} missing verbatim invariant(s)` : ''}. Fill these before sending.`,
  );

  return {
    text,
    placeholders,
    crossLink,
    separateRepIncluded,
    conditionals: { dueOnSale: includeDueOnSale, basisStepUp: includeBasisStepUp, survivorshipTail, firmRecording },
    spine: { intact: spineIntact, verbatimOk, unresolvedFields, missingInvariants },
    notes,
    warnings,
  };
}
