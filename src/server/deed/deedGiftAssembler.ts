/**
 * deedGiftAssembler.ts — DEED-DRAFT-AGENT-1 Inc 1: DETERMINISTIC house-style Deed of Gift assembler.
 *
 * PURE + deterministic + NO-EGRESS — NO LLM in the gift path (Inc 1 architecture, operator-confirmed). Takes
 * the consolidated DeedSourceFacts (property facts from the packet) + an attorney-provided GiftDeedInput
 * (the donor/donee identities and matter facts the document text cannot supply) and assembles the Mason
 * house-style Deed of Gift (DEED_KB_SEED §11.2 / spec §11.2/§11.3), grounded on the verified VA KB
 * (deedKbVa.ts — never model memory).
 *
 * The FIRE §7 spine, enforced structurally:
 *  1. LEGAL DESCRIPTION VERBATIM — the legal description is inserted EXACTLY as extracted; it is never
 *     paraphrased or regenerated. A withheld/absent legal becomes a [[ ]] placeholder, never a guess.
 *     EXCEPTION — ATTORNEY-ENTERED VERBATIM (DEED-MANUAL-LEGAL-GIFT-1; operator EXPRESS re-ratification
 *     2026-07-07, disposition docs/reviews/DEED-MANUAL-LEGAL-DESC-1_triad_disposition_2026-07-07.md, G1):
 *     when the extracted legal is WITHHELD/absent, the attorney may supply it VERBATIM by paste — used ONLY
 *     under the full three-prong G3 affirmation and inserted BYTE-FOR-BYTE (G8). The system still never
 *     AUTHORS a legal description; this admits attorney-as-source as a fourth path, it does NOT relax the
 *     no-generation red line. The paste carries field-level provenance `attorney_entered` (G4), is surfaced
 *     as a DISTINCT pending-verification state (G6), is protected from any Express revise/regenerate pass
 *     (G10), and its paste+affirmation events are captured in the audit log (G12). Absent or unaffirmed ->
 *     the [[ ]] placeholder stays.
 *  2. NO FABRICATED FACTS — every genuinely-missing fact becomes a [[ ]] placeholder WITH a research lead.
 *  3. EXEMPTION-SAFE — the granting verb is hardcoded "grant and convey" (NOT "grant, bargain, sell, and
 *     convey") and the instrument states it is a "Deed of Gift" on its face; both are required for the
 *     § 58.1-811(D) exemption (P.D. 93-212). These are NOT parameterized.
 *  4. ATTORNEY DECIDES — the warranty is parameterized (default = Mason house §11.2; B1 override-able); the
 *     draft is a starting point the attorney edits/approves; this module never finalizes, records, or sends.
 *  5. HONESTY FLOOR — a withheld legal description is surfaced as withheld -> placeholder.
 *
 * The output uses NO markdown syntax (no hash, asterisk, or pipe): a fact-complete deed therefore passes the B6 annotation-leak
 * gate (deedDraftGates.checkAnnotationLeak), while a placeholder-bearing draft FAILS B6 on the [[ ]] tokens —
 * i.e. a draft with unresolved facts is fail-closed and not yet recordable, by design. Execution fields (date,
 * notary, signatures) intentionally remain blank "___" (a draft is not executed); underscores legitimately
 * pass B6.
 */

import type { DeedSourceFacts } from './deedSourceFacts.js';
import { VA_DEED_TYPES, isVaVestingValidated } from './deedKbVa.js';
import { checkAnnotationLeak } from './deedDraftGates.js';

/** Mason house-style warranty for a gift deed — OPERATOR-RATIFIED 2026-06-23 as the authoritative gift form
 *  (DEED_KB_SEED §11.2). The general VA training-guide norm (deedKbVa: "gift = typically no warranty") is the
 *  generic state-level fallback; the firm's settled gift convention controls here. Parameterized per the B1
 *  default+override ruling. */
export const DEFAULT_GIFT_WARRANTY = 'General Warranty and English Covenants of title';

/**
 * GIFT-SPECIFIC vesting language — OPERATOR-RATIFIED phrasings (2026-06-23): joint tenants take "the common
 * law right of survivorship"; tenants by the entirety take "the full common law right of survivorship". These
 * are the authoritative Mason gift forms for this agent (the generic state-level deedKbVa VA_VESTING_OPTIONS is
 * the fallback for other features). The canonical language omits the leading "as " (added uniformly by
 * vestingPhrase). Keys match VA_VESTING_OPTIONS so an override validated against that KB resolves.
 */
const GIFT_VESTING: Record<string, { key: string; language: string }> = {
  sole_owner: { key: 'sole_owner', language: 'sole owner' },
  jtwros: { key: 'jtwros', language: 'joint tenants with the common law right of survivorship and not as tenants in common' },
  tenants_by_entirety: { key: 'tenants_by_entirety', language: 'tenants by the entirety with the full common law right of survivorship' },
  tenants_in_common: { key: 'tenants_in_common', language: 'tenants in common' },
};

export interface GiftDeedPartyInput {
  /** Full current legal name as the attorney wants it on the instrument (attorney-provided; B4 evidence rule). */
  name: string;
  /** Optional descriptor — grantor marital status ("an unmarried man", "husband and wife") or grantee
   *  relationship to the Grantor (gift convention, "the Grantor's son"). Placed verbatim after the name. */
  descriptor?: string | undefined;
}

export interface GiftDeedInput {
  /** Donor(s) — the new deed's grantor(s). Attorney-provided. */
  grantors: GiftDeedPartyInput[];
  /** Donee(s) — the new deed's grantee(s). Attorney-provided. */
  grantees: GiftDeedPartyInput[];
  /** Married-couple grantees -> TBE default; otherwise (multiple) -> JTWROS (the §11.2 gift vesting rule). */
  granteesAreMarriedCouple?: boolean | undefined;
  /** Explicit vesting override (a VA_VESTING_OPTIONS key); validated, else the derived default is used. */
  vestingOverride?: string | null | undefined;
  /** Warranty phrase; default = Mason house §11.2. B1 override-able. */
  warranty?: string | undefined;
  /** Mason file number (36-YYYY-NNNN); [[ ]] if absent. */
  fileNumber?: string | null | undefined;
  /** Grantee mailing / return address; [[ ]] if absent. */
  granteeAddress?: string | null | undefined;
  /** Recording locality (County / independent City); falls back to facts.propertyLocality, else [[ ]]. */
  locality?: string | null | undefined;
  /** Derivation-of-title reference (where the donor's vesting deed is recorded); [[ ]] (with candidates) if absent. */
  derivationReference?: string | null | undefined;
  /** After-recording return-to; defaults to Universal Title. */
  returnTo?: string | null | undefined;
  /**
   * DEED-MANUAL-LEGAL-GIFT-1 (G2/G3): an OPTIONAL attorney-pasted VERBATIM legal description, used ONLY on the
   * gift path when the extracted legal is WITHHELD/absent AND `legalDescriptionAffirmation` is fully affirmed
   * (G3). Never edited (G8): inserted exactly as entered. Approved as an EXPRESS re-ratified exception to the
   * extraction-only invariant (G1; disposition DEED-MANUAL-LEGAL-DESC-1_triad_disposition_2026-07-07). Absent or
   * unaffirmed -> ignored, the [[ ]] placeholder stays.
   */
  legalDescription?: string | null | undefined;
  /** G5 source capture: the cited source of a pasted legal (instrument + book/page or recording ref), or an
   *  explicit "no recorded source" affirmation. Recorded for auditability alongside the attorney-entered legal. */
  legalDescriptionSource?: string | null | undefined;
  /** G3 per-instance affirmation gating a pasted legal. All three prongs required, non-pre-checked. */
  legalDescriptionAffirmation?: GiftLegalAffirmation | undefined;
}

/**
 * G3 affirmation for an attorney-pasted gift legal description. The paste is used ONLY when ALL THREE prongs are
 * affirmed: verbatim-from-identified-source, personal responsibility for accuracy, and the subject-property
 * cross-check ("this legal describes the property conveyed by THIS deed"). Non-pre-checked (the caller must set
 * each true from an un-checked control). `affirmedAt` is an ISO timestamp for the audit log (G12).
 */
export interface GiftLegalAffirmation {
  verbatimFromSource: boolean;
  responsibleForAccuracy: boolean;
  describesSubjectProperty: boolean;
  affirmedAt?: string | undefined;
}

/** PURE (G3): a pasted gift legal may be used ONLY when every affirmation prong is true. */
export function isGiftLegalAffirmationValid(a: GiftLegalAffirmation | undefined | null): boolean {
  return !!a && a.verbatimFromSource === true && a.responsibleForAccuracy === true && a.describesSubjectProperty === true;
}

/** Field-level provenance of the legal description in the assembled gift draft (G4). Document-level provenance
 *  stays `agent_assembled` — this is the FIELD origin only, distinct from the LIVE-9 doc latch. */
export type GiftLegalProvenance = 'ocr_extracted' | 'attorney_entered' | null;

export interface GiftDeedPlaceholder {
  /** The literal [[ ... ]] token as it appears in the draft. */
  token: string;
  /** The field key the placeholder stands for. */
  field: string;
  /** A concrete research lead for resolving it. */
  researchLead: string;
}

export interface GiftDeedDraft {
  /** The assembled house-style Deed of Gift (plain text; feeds the review/finalize + .docx export path). */
  text: string;
  /** Every unresolved [[ ]] placeholder + its research lead. */
  placeholders: GiftDeedPlaceholder[];
  /** The exact verbatim legal description inserted, or null when withheld/absent (-> placeholder). */
  verbatimLegalUsed: string | null;
  /** G4 field-level provenance of the inserted legal: 'ocr_extracted' (from the packet), 'attorney_entered'
   *  (an affirmed paste), or null (withheld -> placeholder). Distinct from the LIVE-9 document-level latch. */
  legalDescriptionProvenance: GiftLegalProvenance;
  /** G6: true when the legal was attorney-entered (affirmed paste) -> the draft is in the DISTINCT
   *  "attorney-entered legal, attorney verification required" state and the client shows the persistent banner.
   *  A pasted legal clears the [[ ]] placeholder but never silently: it is surfaced as pending verification. */
  attorneyEnteredLegalPendingVerification: boolean;
  /** G5: the cited source recorded for an attorney-entered legal (or null). */
  legalDescriptionSource: string | null;
  /** The applied vesting key + canonical language. */
  vesting: { key: string; language: string };
  /** The applied warranty phrase. */
  warranty: string;
  /** false while ANY [[ ]] placeholder remains, the legal description is withheld/absent, OR the assembled text
   *  fails the B6 annotation-leak floor — fail-closed: the draft is not fact-complete and not recordable.
   *  (Execution fields stay blank "___" by design even when true.) Binds to the SAME recordability floor the
   *  gate enforces, so factsResolved and checkAnnotationLeak agree. */
  factsResolved: boolean;
  /** The B6 annotation-leak verdict over the assembled text (the recordability floor): ok=false lists every
   *  stray marker/markup char (including the [[ ]] placeholders themselves, and any stray char in a value). */
  b6: { ok: boolean; failures: string[] };
  /** Reconciliation / divergence notes the attorney should resolve (NOT the Inc-2 advisory layer — just facts). */
  notes: string[];
  warnings: string[];
}

const GIFT_TYPE = VA_DEED_TYPES.find((t) => t.key === 'gift');

function vestingByKey(key: string): { key: string; language: string } {
  // GIFT_VESTING carries every key used below; the fallback is defensive only.
  return GIFT_VESTING[key] ?? { key, language: key };
}

/** Map an override (a VA vesting key OR its canonical language, any case — validated against the verified KB
 *  via isVaVestingValidated) to a GIFT_VESTING key. Returns null if it is not a verified VA option at all. */
function resolveOverrideKey(override: string): string | null {
  if (!isVaVestingValidated(override)) return null;
  const norm = override.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;]/g, '').trim();
  const byKey = norm.replace(/ /g, '_');
  if (GIFT_VESTING[byKey]) return byKey;
  // match by canonical language (either the gift form or the generic deedKbVa form the validator accepts)
  for (const [k, v] of Object.entries(GIFT_VESTING)) {
    if (v.language.toLowerCase().replace(/[.,;]/g, '') === norm || `as ${v.language}`.toLowerCase().replace(/[.,;]/g, '') === norm) return k;
  }
  // a validated VA option whose language we don't gift-map (e.g. "as joint tenants ...") -> fall back by keyword
  if (/joint\s+tenant/.test(norm)) return 'jtwros';
  if (/entiret/.test(norm)) return 'tenants_by_entirety';
  if (/tenants\s+in\s+common/.test(norm)) return 'tenants_in_common';
  if (/sole\s+owner/.test(norm)) return 'sole_owner';
  return null;
}

/** Derive the vesting per the §11.2 gift rule: single grantee -> sole owner; married couple -> TBE; otherwise
 *  (multiple non-spouse donees) -> JTWROS. A validated override wins (key OR canonical language). */
function resolveVesting(input: GiftDeedInput, warnings: string[]): { key: string; language: string } {
  const override = input.vestingOverride;
  if (override) {
    const key = resolveOverrideKey(override);
    if (key) return vestingByKey(key);
    warnings.push(`vesting_override_unrecognized:${override}`);
  }
  // A "married couple" supplied as a SINGLE grantee entry (e.g. one entry "Owen and Jenna Park") must still
  // vest TBE — the cardinality short-circuit must NOT silently drop the explicit marital flag (the wrong
  // sole_owner default). Honor the flag and surface the shape for human confirmation.
  if (input.granteesAreMarriedCouple === true && input.grantees.length < 2) {
    warnings.push('married_couple_flag_with_single_grantee_entry');
    return vestingByKey('tenants_by_entirety');
  }
  if (input.grantees.length <= 1) return vestingByKey('sole_owner');
  if (input.granteesAreMarriedCouple === true) return vestingByKey('tenants_by_entirety');
  return vestingByKey('jtwros');
}

/** "in fee simple, <vesting>" — prefix "as " when the canonical language omits it (sole owner). */
function vestingPhrase(language: string): string {
  return language.startsWith('as ') ? language : `as ${language}`;
}

function partyClause(parties: GiftDeedPartyInput[]): string {
  // DEED-INTAKE-POLISH-1 (YELLOW-6): shared-couple descriptor dedup. When EVERY party in the set carries the
  // SAME non-empty descriptor (e.g. two spouses both "husband and wife"), attach it ONCE to the pair —
  // "A and B, husband and wife" — instead of per-person ("A, husband and wife and B, husband and wife"). A
  // single party, or parties with differing/empty descriptors, render per-party unchanged.
  const descs = parties.map((p) => (p.descriptor ?? '').trim());
  const shared = descs[0] ?? '';
  if (parties.length > 1 && shared.length > 0 && descs.every((d) => d === shared)) {
    return `${parties.map((p) => p.name.trim()).join(' and ')}, ${shared}`;
  }
  return parties
    .map((p) => {
      const name = p.name.trim();
      const desc = (p.descriptor ?? '').trim();
      return desc ? `${name}, ${desc}` : name;
    })
    .join(' and ');
}

function signatureName(p: GiftDeedPartyInput): string {
  return p.name.trim();
}

/**
 * PURE: deterministically assemble a house-style Deed of Gift from the consolidated facts + attorney input.
 * Never throws; never fabricates; the verbatim legal is inserted exactly or withheld -> placeholder.
 */
export function assembleGiftDeed(facts: DeedSourceFacts, input: GiftDeedInput): GiftDeedDraft {
  const placeholders: GiftDeedPlaceholder[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

  /** Emit a [[ ]] placeholder token and record it. */
  const ph = (field: string, researchLead: string): string => {
    const token = `[[ ${field} ]]`;
    placeholders.push({ token, field, researchLead });
    return token;
  };
  /** Use `value` if present/non-empty, else a placeholder. */
  const resolve = (value: string | null | undefined, field: string, lead: string): string => {
    const v = (value ?? '').trim();
    return v.length > 0 ? v : ph(field, lead);
  };

  // ── exemption-critical KB constants (NOT parameterized) ──
  const gift = GIFT_TYPE;
  const exemptionCitation = gift?.exemptionCitation ?? 'Va. Code § 58.1-811(D)';
  const grantingVerb = 'grant and convey'; // P.D. 93-212: NOT "grant, bargain, sell, and convey"
  const warranty = (input.warranty ?? '').trim() || DEFAULT_GIFT_WARRANTY;

  // ── parties ──
  const grantorCount = input.grantors.length;
  const granteeCount = input.grantees.length;
  if (grantorCount === 0) warnings.push('no_grantor_provided');
  if (granteeCount === 0) warnings.push('no_grantee_provided');
  const grantorLabel = grantorCount > 1 ? 'Grantors' : 'Grantor';
  const granteeLabel = granteeCount > 1 ? 'Grantees' : 'Grantee';
  const grantorVerb = grantorCount > 1 ? 'do' : 'does';

  const grantorClause =
    grantorCount > 0
      ? partyClause(input.grantors)
      : ph('Grantor (donor)', 'Grantor (donor) full current legal name(s) + marital status — from the matter; reconcile against the vesting-deed grantee of record (the current owner): ' + (facts.granteeOfRecord.value ?? (facts.granteeOfRecord.values.join(', ') || 'not surfaced from the packet')));
  const granteeClause =
    granteeCount > 0
      ? partyClause(input.grantees)
      : ph('Grantee (donee)', "Grantee (donee) full legal name(s) + relationship to the Grantor — from the matter.");

  // ── vesting ──
  const vesting = resolveVesting(input, warnings);

  // ── property facts ──
  const locality = resolve(
    input.locality ?? facts.propertyLocality.value,
    'Recording locality',
    'Recording locality (County / independent City) where the property sits.',
  );
  const parcelId = resolve(
    facts.parcelId.value,
    'Tax I.D. (GPIN/Map) number',
    'Tax map / parcel (GPIN) number — copy EXACTLY from the locality tax record; do not normalize (KB §8). OCR did not surface it.',
  );
  const assessedValue = resolve(
    facts.assessedValue.value,
    'Assessed value',
    'Current assessed value from the locality assessment record (recordation-tax basis, Va. Code § 58.1-801) — include even on exempt deeds.',
  );
  const fileNumber = resolve(input.fileNumber, 'File number', 'Assign the Mason file number (format 36-YYYY-NNNN).');
  // Quick Deed Layer 1: the grantee's mailing address DEFAULTS to the property (situs) address when the attorney
  // supplied none (operator rule) — attorney-override-able. A defaulted address is surfaced as a confirm/override
  // note below; absent both the input and the situs -> [[ ]] placeholder (no fabrication).
  const granteeAddressDefaulted =
    (input.granteeAddress ?? '').trim().length === 0 && (facts.propertyAddress.value ?? '').trim().length > 0;
  const granteeAddress = resolve(
    input.granteeAddress ?? facts.propertyAddress.value,
    "Grantee's address",
    "Grantee's mailing address for tax bills/notices (Va. Code § 17.1-223 indexing).",
  );
  const returnTo = (input.returnTo ?? '').trim() || 'Universal Title';

  // Legal description — VERBATIM or withheld -> placeholder. Never regenerated. The honesty floor is gated on
  // the WITHHELD flag (not just nullness): a withheld legal becomes a placeholder even if a low-confidence
  // value were present, so the honesty floor holds structurally, independent of the upstream value coupling.
  // Extraction-VERBATIM by default. On a WITHHELD/absent extraction, an AFFIRMED attorney paste may supply the
  // legal VERBATIM (DEED-MANUAL-LEGAL-GIFT-1, the operator-re-ratified G1 exception) — used ONLY under the full G3
  // affirmation, inserted EXACTLY as entered (G8, no normalization), and surfaced as a distinct attorney-entered
  // pending-verification state (G6). Extraction always wins over a paste; an unaffirmed paste is ignored and the
  // [[ ]] placeholder stays (G3). Field-level provenance is recorded (G4); the LIVE-9 document latch is untouched.
  const extractedLegal = facts.legalDescription.withheld ? null : facts.legalDescription.value;
  const pastedLegalRaw = input.legalDescription ?? null;
  const pastedLegalPresent = pastedLegalRaw !== null && pastedLegalRaw.trim().length > 0;
  const legalAffirmed = isGiftLegalAffirmationValid(input.legalDescriptionAffirmation);
  let verbatimLegalUsed: string | null;
  let legalDescriptionProvenance: GiftLegalProvenance;
  let attorneyEnteredLegalPendingVerification = false;
  let legalDescriptionSource: string | null = null;
  let legalBlock: string;
  if (extractedLegal !== null) {
    verbatimLegalUsed = extractedLegal;
    legalDescriptionProvenance = 'ocr_extracted';
    legalBlock = extractedLegal;
  } else if (pastedLegalPresent && legalAffirmed) {
    verbatimLegalUsed = pastedLegalRaw; // G8: inserted EXACTLY as entered — no cleanup of calls/metes-and-bounds/lot-block/tax-map
    legalDescriptionProvenance = 'attorney_entered';
    attorneyEnteredLegalPendingVerification = true; // G6: distinct state, persistent banner (client)
    legalDescriptionSource = (input.legalDescriptionSource ?? '').trim() || null; // G5
    legalBlock = pastedLegalRaw;
    notes.push(
      'Legal description is ATTORNEY-ENTERED (pasted verbatim by the attorney; not machine-compared to an extracted source). Attorney verification required before finalize/record — confirm it against the source instrument (G6/G7).',
    );
  } else {
    verbatimLegalUsed = null;
    legalDescriptionProvenance = null;
    if (pastedLegalPresent && !legalAffirmed) warnings.push('legal_paste_unaffirmed'); // G3: paste ignored without the full affirmation
    legalBlock = ph(
      'Legal description (VERBATIM)',
      facts.legalDescription.withheld
        ? 'Legal description — OCR WITHHELD it (low-confidence/truncated). Paste it VERBATIM from the prior vesting deed (the short tax-record legal is a fallback only, KB §8).'
        : 'Legal description — not found in the packet. Paste it VERBATIM from the prior vesting deed.',
    );
  }
  const legalResolved = verbatimLegalUsed !== null;

  // Derivation reference — attorney-confirmed, with packet candidates as a lead (never auto-used).
  const derivCandidate = facts.derivationCandidates.value ?? facts.derivationCandidates.values.join(', ');
  const derivationReference = resolve(
    input.derivationReference,
    'Derivation (Being) reference',
    `Derivation ("Being") reference — the Deed Book/Page or Instrument No. where the prior vesting deed (into the Grantor) is recorded; from the recording stamp or a chain-of-title source. Candidate(s) surfaced from the packet: ${derivCandidate || 'none'}.`,
  );

  // ── reconciliation notes (facts the attorney should confirm — not advisory) ──
  if (grantorCount > 0 && (facts.granteeOfRecord.value || facts.granteeOfRecord.values.length > 0)) {
    notes.push(
      `Confirm the Grantor(s) match the vesting-deed grantee of record (current owner): ${facts.granteeOfRecord.value ?? facts.granteeOfRecord.values.join(', ')} (B4: assert any name change only with affirmative corroboration).`,
    );
  }
  if (facts.legalDescription.flags.includes('truncated')) {
    notes.push('The packet legal description was flagged truncated — verify it is complete and verbatim against the prior vesting deed before finalizing.');
  }
  if (granteeAddressDefaulted) {
    notes.push(
      `Grantee's address defaulted to the property (situs) address ("${(facts.propertyAddress.value ?? '').trim()}") from the tax record — confirm it is the donee's correct mailing address for tax notices, or override (Va. Code § 17.1-223).`,
    );
  }
  notes.push(
    `Warranty applied: "${warranty}" — the Mason house gift convention (§11.2), operator-ratified 2026-06-23 as the authoritative gift form. B1 override-able on instruction.`,
  );
  notes.push(
    `Vesting applied: "${vesting.language}" (key ${vesting.key}) — operator-ratified Mason gift phrasing (2026-06-23). Survivorship is expressly stated (Va. Code § 55.1-135).`,
  );

  // ── assemble (DEED_KB_SEED §11.2 structure; plain text, no markdown) ──
  const paragraphs: string[] = [
    `Exempt from recordation tax pursuant to ${exemptionCitation}, 1950 Code of Virginia, as amended.`,
    `Prepared by: Kelly Satterwhite, Esq. (VSB #91049), The Mason Law Firm, PLC.`,
    [
      `File Number: ${fileNumber}`,
      `Grantee's Address: ${granteeAddress}`,
      `Tax I.D. Number: ${parcelId}`,
      `Assessed Value: ${assessedValue}`,
      `Consideration: $0.00`,
    ].join('\n'),
    `THIS DEED PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION — NO TITLE INSURANCE.`,
    `DEED OF GIFT`,
    `THIS DEED OF GIFT, made this ___ day of ____________, 20___, by and between ${grantorClause}, (the "${grantorLabel}"), and ${granteeClause}, (the "${granteeLabel}"),`,
    `WITNESSETH:`,
    `That for and in consideration of good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the ${grantorLabel} ${grantorVerb} hereby ${grantingVerb}, with ${warranty}, unto the said ${granteeLabel}, in fee simple, ${vestingPhrase(vesting.language)}, all of the following described real property, together with the improvements thereon and the appurtenances thereunto belonging, located in ${locality}, Commonwealth of Virginia, to wit:`,
    legalBlock,
    `For derivation of title see Deed recorded ${derivationReference}.`,
    `This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record, to the extent the same lawfully apply.`,
    `WITNESS the following signature(s) and seal(s):`,
    ...(grantorCount > 0
      ? input.grantors.map((g) => `_______________________________ (SEAL)\n${signatureName(g)}`)
      : ['_______________________________ (SEAL)']),
    `COMMONWEALTH OF VIRGINIA\nCITY/COUNTY OF ____________________, to-wit:`,
    `The foregoing instrument was acknowledged before me this ___ day of ____________, 20___, by ${grantorCount > 0 ? input.grantors.map(signatureName).join(' and ') : 'the Grantor(s)'}.`,
    `My commission expires: ____________________\n_______________________________\nNotary Public`,
    `After recording, return to: ${returnTo}.`,
  ];

  const text = paragraphs.join('\n\n');

  // Bind factsResolved to the SAME B6 recordability floor the gate enforces, so the assembler's "resolved"
  // claim cannot disagree with checkAnnotationLeak: a stray denylist char / marker word in the verbatim legal
  // OR any attorney-provided value (an address "[Unit B]", a "TBD", a "???") drives factsResolved=false too —
  // not just the [[ ]] placeholders. (The [[ ]] placeholders themselves also trip B6, so a placeholder-bearing
  // draft is doubly fail-closed.)
  const b6 = checkAnnotationLeak(text);
  const factsResolved = placeholders.length === 0 && legalResolved && b6.ok;

  if (!legalResolved) warnings.push('legal_description_unresolved');
  if (placeholders.length > 0) warnings.push(`unresolved_placeholders:${placeholders.length}`);
  // A B6 failure NOT explained by the [[ ]] placeholders means a stray char/marker leaked from a value or the
  // legal — surface it explicitly so the offending content is corrected before finalize.
  if (!b6.ok && placeholders.length === 0) warnings.push(`annotation_leak_in_values:${b6.failures.length}`);

  return {
    text,
    placeholders,
    verbatimLegalUsed,
    legalDescriptionProvenance,
    attorneyEnteredLegalPendingVerification,
    legalDescriptionSource,
    vesting,
    warranty,
    factsResolved,
    b6: { ok: b6.ok, failures: b6.failures },
    notes,
    warnings,
  };
}
