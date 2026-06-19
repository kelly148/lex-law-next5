/**
 * Deed recordability gate (FOLD-DEED-1, Inc 1 foundation) — Zod Wall + the pure, fail-closed three-gate
 * evaluator. This is the load-bearing ethics/land-records logic, reviewable in isolation.
 *
 * The disposition (docs/reviews/FOLD-DEED-1_disposition.md) splits the deed gate into THREE layers so
 * "recordable" never implies "substantively correct":
 *   1. ASSEMBLY      — enough verified data to draft (parties bound, source-of-record cited, deed-type ×
 *                      jurisdiction × locality TEMPLATE coverage confirmed — KB-sourced).
 *   2. LEGAL-REVIEW  — the high-risk legal decisions affirmatively made: the TWO-PRONG description control
 *                      (matches source of record AND describes the parcel(s) actually conveyed; OCR-only
 *                      blocked; provenance captured; locked post-confirmation), vesting from a jurisdiction-
 *                      correct controlled list (KB-validated), marital + spousal-joinder required-party
 *                      logic, grantor reconciled to the source vesting, fiduciary authority recited.
 *   3. RECORDABILITY — the recording-acceptance package for the selected locality: preparer/return-to/
 *                      grantee-tax-address present, the locality recordability KB verified, an execution
 *                      acknowledgment mode chosen (the acknowledgment must match the mode — a KB form check).
 *
 * INVARIANTS (fail-closed, the whole point):
 *   - "recordable" requires ALL THREE layers to pass; absence/null/unknown is NEVER a pass.
 *   - The model may NEVER be the source of a jurisdiction form/rate (disposition item 4): the KB-sourced
 *     checks (template coverage, vesting controlled-list, locality verification) are inputs the evaluator
 *     REQUIRES — with no KB seeded they are false, so NOTHING is recordable. "No locality KB → no recordable."
 *   - The legal description is NEVER AI-generated; it is attorney-verified text (two prongs), OCR-only blocked.
 *
 * SCOPE FENCE (Inc 1 foundation): the gate STATE + the pure evaluator + the fail-closed structure. The KB
 * SEED (the VA primer → vesting lists, locality specs, statutory/acknowledgment forms) and RON/e-recording
 * are SEPARATE, blocked/decision-gated increments. This foundation ships DORMANT behind DEED_GATE_ENABLED
 * and recordable=false for every deed until the KB is seeded.
 */

import { z } from 'zod';

export const DEED_GATE_LAYER_VALUES = ['assembly', 'legal_review', 'recordability'] as const;
export type DeedGateLayer = (typeof DEED_GATE_LAYER_VALUES)[number];

// Parcel-scope is prong (b): a single boolean cannot express it (disposition item 1).
export const DEED_PARCEL_SCOPE_VALUES = ['whole', 'partial', 'with_reservation'] as const;
// Spousal joinder is required-party logic, not a clause toggle (item 3).
export const DEED_SPOUSAL_JOINDER_VALUES = ['present', 'affirmed_not_required'] as const;
// Fiduciary authority is an affirmative determination (present / not-applicable), never a silent default.
export const DEED_FIDUCIARY_VALUES = ['present', 'not_applicable'] as const;
// Acknowledgment must match the execution mode (item §5.4). RON-specific form-building is the blocked increment.
export const DEED_EXECUTION_MODE_VALUES = ['wet_sign', 'e_notary', 'ron'] as const;

/**
 * The attorney-recorded deed-gate STATE for one deed document — a checklist of affirmative acts. Every field
 * defaults to the "not done" value so an absent/partial blob parses to "nothing affirmed" (fail-closed). The
 * description two prongs are SEPARATE fields (a single boolean cannot express parcel scope — item 1).
 */
export const DeedGateStateSchema = z.object({
  schemaVersion: z.literal(1).default(1),

  // ── Assembly ──
  // The source-of-record instrument the description is taken from (book/page or instrument #) — cited, not blank.
  sourceOfRecordInstrument: z.string().max(512).nullable().default(null),
  // The attorney-selected RECORDING LOCALITY (the clerk's office where the deed records) + the deed SUB-TYPE
  // (bargain-and-sale / gift / into-trust / confirmation / TOD / distribution). Both drive KB template coverage
  // (the recording locality must be a verified seeded locality; the sub-type a known VA deed type). Additive
  // blob fields — no migration. Null BLOCKS (fail-closed).
  recordingLocality: z.string().max(128).nullable().default(null),
  deedSubType: z.string().max(64).nullable().default(null),

  // ── Legal-review: the TWO-PRONG description control (every prong is an AFFIRMATIVE act — null BLOCKS) ──
  descriptionSourceMatch: z.boolean().nullable().default(null), // prong (a): matches the source of record
  descriptionParcelScope: z.enum(DEED_PARCEL_SCOPE_VALUES).nullable().default(null), // prong (b): what is conveyed
  // For a partial / with-reservation conveyance, WHAT is excepted/reserved (a 'whole' conveyance needs none).
  descriptionExceptionText: z.string().max(2048).nullable().default(null),
  descriptionProvenance: z.string().max(1024).nullable().default(null), // source instrument/book-page/plat ref
  // The attorney AFFIRMS the description was reviewed side-by-side against the source and is NOT OCR-only.
  // Tri-state, default null → BLOCKS: the unknown/unaffirmed case must fail closed, like every sibling field.
  // (OCR-only-clears is the disposition's #1 deed malpractice risk — a fail-OPEN default here is forbidden.)
  descriptionNotOcrOnly: z.boolean().nullable().default(null),
  // The description carries a recorded plat/subdivision/instrument reference, NOT a bare tax-ID (item 1 block).
  descriptionHasPlatOrSubdivisionRef: z.boolean().nullable().default(null),
  descriptionConfirmedAt: z.string().max(40).nullable().default(null), // ISO ts: the post-confirmation LOCK

  // ── Legal-review: hard blocks ──
  vestingSelection: z.string().max(256).nullable().default(null), // the vesting choice (validated vs the KB list)
  maritalStatusConfirmed: z.boolean().nullable().default(null), // confirmed as of the conveyance date
  spousalJoinder: z.enum(DEED_SPOUSAL_JOINDER_VALUES).nullable().default(null),
  grantorReconciledToSource: z.boolean().nullable().default(null), // grantor identity reconciled to source vesting
  fiduciaryAuthority: z.enum(DEED_FIDUCIARY_VALUES).nullable().default(null), // Letters/trust/OA/POA recited, or N/A
  // Special-instrument triggers reviewed + surfaced (item 3 final clause): trust / estate / POA / entity /
  // divorce / gift-no-consideration / correction / TOD / out-of-state-ack / RON — also the "wrong-tool" seam
  // (e.g. a death-of-joint-owner case that needs a survivorship affidavit, not a deed). Affirmative; null BLOCKS.
  specialInstrumentTriggersReviewed: z.boolean().nullable().default(null),

  // ── Recordability ──
  preparerReturnGranteeAddress: z.boolean().nullable().default(null), // preparer + return-to + grantee tax-bill address
  executionMode: z.enum(DEED_EXECUTION_MODE_VALUES).nullable().default(null), // acknowledgment must match this mode
  // For an e-notary / RON execution mode: the § 47.1-16 e-certificate recitals are affirmed (the notary's VA
  // location at the time of the act, the in-person-vs-RON indication, and the tamper-evident e-seal). Required
  // for e/RON to clear recordability; null BLOCKS. (Wet-sign deeds do not need it.)
  eCertificateRecitalsAffirmed: z.boolean().nullable().default(null),
});
export type DeedGateState = z.infer<typeof DeedGateStateSchema>;

/** The default-safe (nothing-affirmed) state — what a deed with no recorded acts resolves to. */
export const DEFAULT_DEED_GATE_STATE: DeedGateState = DeedGateStateSchema.parse({});

/**
 * KB-availability inputs the evaluator REQUIRES (disposition item 4 — the model is never the source of a
 * jurisdiction form/rate; these come from the seeded KB only). In the Inc-1 foundation NO KB is seeded, so
 * all three are false and nothing is recordable. The blocked KB-seed increment (the VA primer) flips them.
 */
export interface DeedKbAvailability {
  /** deed-type × jurisdiction × locality TEMPLATE coverage is confirmed in the KB. */
  templateCoverage: boolean;
  /** the jurisdiction-correct vesting CONTROLLED LIST is available + the selection validates against it. */
  vestingListValidated: boolean;
  /** the selected locality's recordability KB (cover sheet/GPIN/margins/e-recording specs/fees + ack form) is verified. */
  localityVerified: boolean;
  /** the selected recording locality actually OPERATES an eRecording System (e-recording is permissive) — required
   *  for an e-notary / RON execution mode to clear recordability. */
  localityERecording: boolean;
}

/** Live party binding for the deed (grantor/grantee via document_party.roleKey). */
export interface DeedPartyBinding {
  grantorCount: number;
  granteeCount: number;
}

export interface DeedLayerVerdict {
  passed: boolean;
  blockingReasons: string[];
}
export interface DeedGateEvaluation {
  assembly: DeedLayerVerdict;
  legalReview: DeedLayerVerdict;
  recordability: DeedLayerVerdict;
  /** recordable IFF all three layers pass. Never true on absence/null/unknown/no-KB. */
  recordable: boolean;
}

export interface DeedGateInput {
  state: DeedGateState;
  kb: DeedKbAvailability;
  parties: DeedPartyBinding;
}

/**
 * PURE, fail-closed evaluation of the three deed gates. Each layer passes ONLY when its affirmative acts are
 * present AND the KB-sourced inputs it depends on are verified; anything missing is a blocking reason, never
 * a silent pass. recordable requires all three.
 */
export function evaluateDeedGate(input: DeedGateInput): DeedGateEvaluation {
  const { state, kb, parties } = input;

  // 1) Assembly — enough verified data to draft.
  const assemblyReasons: string[] = [];
  if (parties.grantorCount < 1) assemblyReasons.push('no_grantor_bound');
  if (parties.granteeCount < 1) assemblyReasons.push('no_grantee_bound');
  if (!state.sourceOfRecordInstrument) assemblyReasons.push('source_of_record_not_cited');
  if (!state.recordingLocality) assemblyReasons.push('recording_locality_unselected');
  if (!state.deedSubType) assemblyReasons.push('deed_sub_type_unselected');
  // template coverage = a verified recording locality × a known VA deed sub-type (KB-sourced; null/unseeded blocks).
  if (!kb.templateCoverage) assemblyReasons.push('deed_type_jurisdiction_locality_template_uncovered');
  const assembly: DeedLayerVerdict = { passed: assemblyReasons.length === 0, blockingReasons: assemblyReasons };

  // 2) Legal-review — the high-risk legal decisions affirmatively made.
  const legalReasons: string[] = [];
  // Two-prong description control (item 1) — every prong is an affirmative act; unknown/null BLOCKS.
  if (state.descriptionSourceMatch !== true) legalReasons.push('description_source_match_unconfirmed');
  if (state.descriptionParcelScope === null) legalReasons.push('description_parcel_scope_unset');
  // A partial / with-reservation conveyance must capture WHAT is excepted/reserved (parcel-misdescription risk).
  else if (state.descriptionParcelScope !== 'whole' && !state.descriptionExceptionText) legalReasons.push('parcel_exception_text_missing');
  if (!state.descriptionProvenance) legalReasons.push('description_provenance_missing');
  // OCR-only must NOT clear (item 1, #1 malpractice risk): the attorney must affirm side-by-side review.
  if (state.descriptionNotOcrOnly !== true) legalReasons.push('description_ocr_only_or_unreviewed');
  // Bare tax-ID lacking a recorded plat/subdivision reference is insufficient (item 1).
  if (state.descriptionHasPlatOrSubdivisionRef !== true) legalReasons.push('description_bare_tax_id_no_plat_ref');
  if (!state.descriptionConfirmedAt) legalReasons.push('description_not_locked');
  // Vesting from a jurisdiction-correct controlled list (item 3) — KB-validated (fail-closed without the list).
  if (!state.vestingSelection) legalReasons.push('vesting_not_selected');
  else if (!kb.vestingListValidated) legalReasons.push('vesting_not_kb_validated');
  // Marital + spousal-joinder required-party logic (item 3).
  if (state.maritalStatusConfirmed !== true) legalReasons.push('marital_status_unconfirmed');
  if (state.spousalJoinder === null) legalReasons.push('spousal_joinder_undetermined');
  // Grantor reconciled to source vesting (item 3).
  if (state.grantorReconciledToSource !== true) legalReasons.push('grantor_not_reconciled_to_source');
  // Fiduciary authority recited or affirmed not-applicable (item 3).
  if (state.fiduciaryAuthority === null) legalReasons.push('fiduciary_authority_undetermined');
  // Special-instrument triggers reviewed (item 3 final clause) — the wrong-tool / high-risk-pattern seam.
  if (state.specialInstrumentTriggersReviewed !== true) legalReasons.push('special_instrument_triggers_unreviewed');
  const legalReview: DeedLayerVerdict = { passed: legalReasons.length === 0, blockingReasons: legalReasons };

  // 3) Recordability — the recording-acceptance package for the selected locality.
  const recordReasons: string[] = [];
  if (state.preparerReturnGranteeAddress !== true) recordReasons.push('preparer_return_grantee_address_missing');
  // The acknowledgment MUST match the execution mode (§5.4). Wet-sign clears on the verified statutory ack
  // forms. e-notary / RON (URPERA §§ 55.1-661–664: recordable on the same footing as paper) clears ONLY when
  // the recording locality actually operates an eRecording System (e-recording is permissive) AND the
  // § 47.1-16 e-certificate recitals are affirmed. The gate REFUSES, never improvises, a RON ack without those.
  if (state.executionMode === null) {
    recordReasons.push('execution_acknowledgment_mode_unset');
  } else if (state.executionMode !== 'wet_sign') {
    if (!kb.localityERecording) recordReasons.push('locality_e_recording_unavailable');
    if (state.eCertificateRecitalsAffirmed !== true) recordReasons.push('e_certificate_recitals_unaffirmed');
  }
  // KB-mandatory locality (item 4): no verified locality KB → never recordable.
  if (!kb.localityVerified) recordReasons.push('locality_kb_unverified');
  const recordability: DeedLayerVerdict = { passed: recordReasons.length === 0, blockingReasons: recordReasons };

  return {
    assembly,
    legalReview,
    recordability,
    recordable: assembly.passed && legalReview.passed && recordability.passed,
  };
}
