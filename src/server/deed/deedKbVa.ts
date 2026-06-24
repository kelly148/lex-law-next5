/**
 * Verified Virginia state-level deed KB (FOLD-DEED-1 Inc 2 — KB seed).
 *
 * SOURCE OF TRUTH — the model is NEVER the source (disposition item 4). Every datum here is transcribed
 * VERBATIM from the operator-supplied, verified primer committed at
 * docs/Deed_Drafting_Training_Guide_Virginia.docx ("Deed Drafting in Virginia — A Training Guide", The
 * Satterwhite Law Firm, PLLC). Nothing here is generated from model memory: deed types, statutory citations,
 * the recordation-tax exemption table, the deed-must-haves checklist, the vesting controlled-list, the
 * recital/derivation structure, and the escalation off-ramp all come straight from that document. Verify the
 * citation against the Virginia Code in force before relying (the primer's own caveat).
 *
 * TIER = STATE-LEVEL ONLY. The primer is Virginia state-level training content. It does NOT contain the
 * per-locality recordability / e-recording acceptance specs (cover-sheet/GPIN format, margins, e-recording
 * portals, fees) for the five v1 localities, and it contains NO RON / e-notary acknowledgment FORM (it
 * mentions remote online notarization once as a notarization mode, with no form text). Per the fabricate-
 * nothing invariant, those are NOT seeded here — they stay fail-closed (see VA_SEED_LOCALITIES, all
 * verified:false) until a verified LOCALITY/RON source is supplied. "No locality KB → no recordable."
 */

export const DEED_KB_PROVENANCE = {
  source: 'docs/Deed_Drafting_Training_Guide_Virginia.docx',
  sourceTitle: 'Deed Drafting in Virginia — A Training Guide for Associates and Law Clerks',
  sourceOrg: 'The Satterwhite Law Firm, PLLC',
  jurisdiction: 'VA',
  tier: 'state', // state-level only; locality-level + RON forms are NOT in this primer
  asOf: 'Virginia Code as currently in force per the primer; statutes change — verify before relying on a citation',
} as const;

// ── Deed types — the controlled list (primer §3 + the §9 exemption table) ───────────────────────────────
export interface VaDeedType {
  key: string;
  title: string; // the operative deed title that must appear on the instrument
  grantingLanguage: string; // the granting clause matched to the type
  warranty: string; // the warranty norm for this type
  exemptionCitation: string | null; // the recordation-tax exemption Va. Code citation, or null (taxable)
  mustStateTitleInDeed: boolean; // the exemption requires the deed to STATE this title on its face
  notes: string;
}
export const VA_DEED_TYPES: readonly VaDeedType[] = [
  {
    key: 'bargain_and_sale',
    title: 'Deed of Bargain and Sale',
    grantingLanguage: 'grant, bargain, sell, and convey',
    warranty: 'general or special warranty (Va. Code §§ 55.1-355, 55.1-356)',
    exemptionCitation: null,
    mustStateTitleInDeed: false,
    notes: 'Standard sale deed for consideration. Recordation tax on the GREATER of consideration or assessed value (Va. Code § 58.1-801).',
  },
  {
    key: 'gift',
    title: 'Deed of Gift',
    grantingLanguage: 'grant and convey', // NOT "grant, bargain, sell, and convey" — those imply consideration
    warranty: 'typically no warranty',
    exemptionCitation: 'Va. Code § 58.1-811(D)',
    mustStateTitleInDeed: true,
    notes: 'No consideration. TWO-PART exemption (P.D. 93-212): (i) the deed must STATE on its face that it is a Deed of Gift, and (ii) the body must use "grant and convey", not "grant, bargain, sell, and convey". Failing either kills the exemption. Run any non-individual grantor/grantee by a supervising attorney.',
  },
  {
    key: 'into_trust',
    title: 'Deed Into Trust',
    grantingLanguage: 'grant and convey',
    warranty: 'typically no warranty',
    exemptionCitation: 'Va. Code § 58.1-811(A)(12)',
    mustStateTitleInDeed: true,
    notes: 'Transfer to trustees of a revocable inter vivos trust where the grantors are also beneficiaries and no consideration passes. Other named beneficiaries do not by themselves defeat the exemption; it fails only if a grantor is not a beneficiary at all. Review the trust before recordation.',
  },
  {
    key: 'confirmation',
    title: 'Deed of Confirmation',
    grantingLanguage: 'grant and convey',
    warranty: 'typically no warranty',
    exemptionCitation: 'Va. Code § 58.1-810(1)',
    mustStateTitleInDeed: false,
    notes: 'A-to-A confirmatory deed after a transfer by operation of law (death + survivorship, or recorded heir affidavit). The work is in the recitals. Exemption requires that recordation tax was PAID on the original deed — confirm before relying.',
  },
  {
    key: 'transfer_on_death',
    title: 'Transfer on Death Deed',
    grantingLanguage: 'per the statutory optional form (Va. Code § 64.2-635)',
    warranty: 'n/a — statutory TOD form',
    exemptionCitation: 'Va. Code § 58.1-811(J)',
    mustStateTitleInDeed: true,
    notes: 'Uniform Real Property Transfer on Death Act, Va. Code § 64.2-621 et seq. (authorization § 64.2-624). CRITICAL: NOT effective unless RECORDED BEFORE the transferor’s death (§ 64.2-625) — no exception, no substantial-compliance. Follow the statutory optional form (§ 64.2-635) strictly.',
  },
  {
    key: 'distribution',
    title: 'Deed of Distribution',
    grantingLanguage: 'grant and convey',
    warranty: 'typically no warranty',
    exemptionCitation: 'Va. Code § 58.1-811(K)',
    mustStateTitleInDeed: true,
    notes: 'Transfer from an estate or trust to ORIGINAL beneficiaries when no consideration passes. Must state on the front page that it is a "Deed of Distribution".',
  },
  {
    key: 'into_llc',
    title: 'Deed Into an LLC',
    grantingLanguage: "quitclaim release and convey (all of the Grantor's right, title and interest)",
    warranty: 'none (quitclaim)',
    exemptionCitation: 'Va. Code § 58.1-811(A)(10)',
    mustStateTitleInDeed: false,
    notes: 'Transfer TO a Virginia partnership/LLC where the GRANTORS are entitled to >=50% of profits and surplus (§ 58.1-811(A)(10)); not a precursor to a control transfer to avoid recordation tax. Plain "DEED" title; quitclaim, NO warranty. Cite verified verbatim against Va. Code § 58.1-811(A)(10) (operator-supplied 2026-06-24); grounded §C3.',
  },
  {
    key: 'out_of_llc',
    title: 'Deed Out of an LLC',
    grantingLanguage: 'grant and convey, with Special Warranty',
    warranty: 'special warranty',
    exemptionCitation: 'Va. Code § 58.1-811(A)(11)',
    mustStateTitleInDeed: false,
    notes: 'Transfer FROM a Virginia partnership/LLC to its members where the GRANTEES are entitled to >=50% of profits and surplus (§ 58.1-811(A)(11)); not subsequent to a control transfer to avoid recordation tax. Special Warranty; members take as tenants in common. Cite verified verbatim against Va. Code § 58.1-811(A)(11) (operator-supplied 2026-06-24); grounded §C4.',
  },
];

// ── Vesting / tenancy — the controlled list (primer §4 vesting + §§ 55.1-134/135/136) ───────────────────
export interface VaVestingOption {
  key: string;
  language: string; // the canonical vesting language to use verbatim in the deed
  appliesTo: string;
  statute: string;
  notes: string;
}
export const VA_VESTING_OPTIONS: readonly VaVestingOption[] = [
  {
    key: 'jtwros',
    language: 'as joint tenants with right of survivorship and not as tenants in common',
    appliesTo: 'multiple grantees who intend survivorship',
    statute: 'Va. Code §§ 55.1-134, 55.1-135',
    notes: 'Common-law joint-tenancy survivorship is ABOLISHED in VA (§ 55.1-134); survivorship arises only if the deed EXPRESSLY says so (§ 55.1-135). "to A and B jointly" / "as joint tenants" alone creates a tenancy in common.',
  },
  {
    key: 'tenants_by_entirety',
    language: 'as tenants by the entirety with the common-law right of survivorship',
    appliesTo: 'married grantees',
    statute: 'Va. Code § 55.1-136',
    notes: 'TBE carries survivorship by its nature, but the explicit recital prevents future ambiguity. Even married grantees do NOT automatically take TBE — it must be written in (§ 55.1-135 moieties default otherwise).',
  },
  {
    key: 'tenants_in_common',
    language: 'as tenants in common',
    appliesTo: 'multiple grantees who do NOT intend survivorship',
    statute: 'Va. Code § 55.1-135',
    notes: 'The default for multiple grantees absent express survivorship language. An interest passes through the deceased tenant’s estate, not to the co-tenant.',
  },
  {
    key: 'sole_owner',
    language: 'sole owner',
    appliesTo: 'a single grantee',
    statute: 'n/a',
    notes: 'Single grantee; no survivorship designation needed.',
  },
];

// ── Recordation-tax exemptions — the §9 table (verbatim citations + watch-outs) ──────────────────────────
export interface VaExemption {
  citation: string;
  transferType: string;
  watchOuts: string;
}
export const VA_EXEMPTIONS: readonly VaExemption[] = [
  { citation: 'Va. Code § 58.1-811(A)(10)', transferType: 'To a partnership or limited liability company, when the grantors are entitled to receive not less than 50 percent of the profits and surplus of such partnership or limited liability company, provided that the transfer to a limited liability company is not a precursor to a transfer of control of the assets of the company to avoid recordation taxes.', watchOuts: 'INTO-entity direction (the GRANTORS receive >=50%). Mason "Deed Into an LLC": title "DEED", quitclaim, NO warranty. The anti-avoidance proviso bars using it as a precursor to a control transfer. Verbatim from Va. Code § 58.1-811(A)(10) (operator-supplied 2026-06-24); grounded §C3.' },
  { citation: 'Va. Code § 58.1-811(A)(11)', transferType: 'From a partnership or limited liability company, when the grantees are entitled to receive not less than 50 percent of the profits and surplus of such partnership or limited liability company, provided that the transfer from a limited liability company is not subsequent to a transfer of control of the assets of the company to avoid recordation taxes.', watchOuts: 'OUT-of-entity direction (the GRANTEES receive >=50%) — CORRECTED 2026-06-24 from a prior entry that mis-stated the direction as "to a partnership or LLC where grantees"; now verbatim from Va. Code § 58.1-811(A)(11) (operator-supplied). Mason "Deed Out of an LLC": Special Warranty; members take as tenants in common. Grounded §C4.' },
  { citation: 'Va. Code § 58.1-811(A)(12)', transferType: 'Transfer to trustees of a revocable inter vivos trust where the grantors are also beneficiaries, regardless of whether other beneficiaries may also be named, with no consideration passing.', watchOuts: 'Title "Deed Into Trust." Review the trust before recordation; fails only if a grantor is not a beneficiary at all.' },
  { citation: 'Va. Code § 58.1-811(D)', transferType: 'Deed of gift where no consideration has passed between grantor(s) and grantee(s).', watchOuts: 'Two parts: (i) the deed must state on its face it is a Deed of Gift, and (ii) the body must use "grant and convey". Both required (P.D. 93-212). Run any non-individual party by a supervising attorney.' },
  { citation: 'Va. Code § 58.1-811(J)', transferType: 'Transfer-on-death deeds and revocations under the Uniform Real Property Transfer on Death Act.', watchOuts: 'Title as "Transfer on Death Deed" or "Revocation." See Va. Code § 64.2-621 et seq. for form requirements.' },
  { citation: 'Va. Code § 58.1-811(K)', transferType: 'Deeds of distribution from an estate or trust to original beneficiaries when no consideration passes.', watchOuts: 'Deed must state on the front page that it is a "Deed of Distribution."' },
  { citation: 'Va. Code § 58.1-810', transferType: 'Various administrative and corrective re-recording exemptions (e.g., recording an already-taxed deed in a different jurisdiction; deeds correcting prior tax-paid recordings).', watchOuts: 'Cite the specific subsection. The "already paid" theory requires proof of the original tax payment.' },
  { citation: 'Va. Code § 58.1-810(1)', transferType: 'Deed of confirmation, where recordation tax was paid when the original deed was recorded.', watchOuts: 'The correct citation for confirmatory "A-to-A" deeds following operation-of-law transfers. Confirm the original deed was tax-paid; if the predicate transfer was itself exempt, additional analysis is needed.' },
];

// ── Deed must-haves — the §8 desk-reference checklist ────────────────────────────────────────────────────
export const VA_DEED_MUST_HAVES: readonly string[] = [
  'Preparer block (name + Virginia State Bar number) — statutory for residential deeds of not more than four dwelling units (Va. Code § 17.1-223); office practice on all deeds.',
  'Grantee mailing address — where the locality sends tax bills and notices; ask the client where notices should go for non-owner-occupied property.',
  'Tax map / parcel ID number — copy EXACTLY from the locality’s tax record; do not normalize or abbreviate.',
  'Current assessed value — recordation tax is on the GREATER of consideration or assessed value (Va. Code § 58.1-801); include on every deed, including exempt deeds.',
  'Title insurance disclosure (or absence statement) — for residential ≤4-unit deeds, § 17.1-223 requires the insurer name or the statutory phrase "the existence of title insurance is unknown to the preparer".',
  'Exemption citation (for tax-exempt deeds) — recite the EXACT subsection of Va. Code § 58.1-810 or § 58.1-811; wrong/no citation means tax charged or rejection.',
  'Operative deed title — must match the substance and the claimed exemption (e.g., a § 58.1-811(D) gift must state it is a Deed of Gift).',
  'Granting language — § 55.1-300 minimally requires "grant" or "grant and convey"; office form "grant, bargain, sell, and convey" for sale deeds, "grant and convey" for gifts.',
  'Warranty designation — "with general warranty", "with special warranty", or no warranty; statutory shorthand (§§ 55.1-355, 55.1-356) — do not paraphrase.',
  'Vesting / tenancy language — for multiple grantees, state how they take title; survivorship is NOT implied (§§ 55.1-134, 55.1-135) — write "with right of survivorship" explicitly or they take as tenants in common.',
  'Legal description — pull from the prior vesting deed and copy VERBATIM (subdivision or metes-and-bounds); the short tax-record legal is a fallback only.',
  'Derivation ("Being") clause — cites the immediate prior deed so the chain is followable; most clerks reject deeds that lack it.',
  'Execution and acknowledgment — all grantors sign; grantees generally do not; notary acknowledgment required for recordation (§ 55.1-600 et seq.); minimum font size 10.',
];

// ── Recital / derivation structure — the deed paragraph anatomy (§4) ─────────────────────────────────────
export const VA_RECITAL_STRUCTURE: readonly string[] = [
  'Recitals — the "Whereas" paragraphs: tell the story of how the parties got here (prior deed, death + survivorship, heir affidavit, name/marital change, curative purpose). "Whereas, this happened. ... Now therefore, this is what we are doing."',
  'Consideration paragraph — the actual price for a sale; "good and valuable consideration" for a gift; "for estate-planning purposes" or "for good and valuable consideration" for a deed into trust. Match the recital to the deed type and the exemption.',
  'Granting language — the operative transfer clause, matched to the deed type.',
  'Warranty designation — general / special / none (statutory shorthand).',
  'Vesting / tenancy designation — explicit survivorship language for multiple grantees.',
  'Property paragraph + legal description — the locality (County/independent City) + the verbatim legal description.',
  'Derivation ("Being") clause — ties the deed to the immediate prior recorded instrument.',
  'Execution and acknowledgment — grantor signatures + notary acknowledgment.',
];

// ── Escalation off-ramp — the "when to escalate / wrong-tool" triggers ("Before you start drafting") ─────
// Feeds the special-instrument / wrong-tool detector (deed-gate item 3): a routine deed must NOT proceed
// when one of these is present without supervising-attorney review.
export const VA_ESCALATION_TRIGGERS: readonly string[] = [
  'Deceased grantor without a clean survivorship path (no recorded survivorship, heir affidavit, qualified will, or estate qualification supporting the transfer) — often needs a survivorship affidavit, not a deed.',
  'Property titled in a trust, estate, LLC, partnership, or other entity (authority, exemption, and tenancy questions).',
  'Divorce, separation, or former spouses (marital interests, equitable distribution, property settlement agreement).',
  'A non-titled spouse refuses to sign (elective-share / title-underwriting consequences; engagement-letter language).',
  'Trust beneficiaries do not clearly support the § 58.1-811(A)(12) exemption claim.',
  'Defective prior legal description or missing derivation in the prior vesting deed — do not copy the defect forward.',
  'Mortgaged property with a transfer that may trigger lender consent / due-on-sale (e.g., natural person to LLC).',
  'Client requests for tax, Medicaid, creditor-protection, or estate-tax advice (out of scope on a deed engagement).',
  'Anything else that feels wrong — under-escalation is the more common error.',
];

// ── Statutory backbone — the verified citations referenced by the gate/composition ──────────────────────
export const VA_STATUTORY_CITATIONS: readonly { citation: string; subject: string }[] = [
  { citation: 'Va. Code § 55.1-300', subject: 'Minimum statutory deed form; granting "grant" or "grant and convey".' },
  { citation: 'Va. Code § 17.1-223', subject: 'Preparer name + VSB number, and title-insurance disclosure, for residential deeds of not more than four dwelling units.' },
  { citation: 'Va. Code § 17.1-227.1', subject: 'Cover sheets carrying indexing data, consideration/actual value, exemption authority, parcel ID, parties, return address.' },
  { citation: 'Va. Code § 58.1-801', subject: 'Recordation tax computed on the greater of consideration paid or actual (assessed) value.' },
  { citation: 'Va. Code §§ 55.1-134, 55.1-135', subject: 'Common-law joint-tenancy survivorship abolished; survivorship only if expressly stated; spouses take by moieties absent designation.' },
  { citation: 'Va. Code § 55.1-136', subject: 'Tenants by the entirety carry the common-law right of survivorship.' },
  { citation: 'Va. Code §§ 55.1-355, 55.1-356', subject: 'Warranty phrases are statutory shorthand for the full covenants — do not paraphrase.' },
  { citation: 'Va. Code § 55.1-600 et seq.', subject: 'Acknowledgment before a notary required for recordation.' },
  { citation: 'Va. Code § 64.2-301', subject: 'Common-law dower and curtesy abolished effective January 1, 1991.' },
  { citation: 'Va. Code §§ 64.2-308.5 through 64.2-308.10', subject: 'Augmented-estate / elective-share rights of a surviving spouse.' },
  { citation: 'Va. Code § 20-107.3', subject: 'Equitable distribution on divorce.' },
  { citation: 'Va. Code § 64.2-621 et seq. (§§ 64.2-624, 64.2-625, 64.2-635)', subject: 'Uniform Real Property Transfer on Death Act — authorization, record-before-death rule, statutory optional form.' },
  { citation: 'Va. Code § 64.2-200', subject: 'Intestate succession.' },
  { citation: 'Va. Code § 64.2-510', subject: 'Real-estate (heir) affidavit / small-estate procedure.' },
];

// The five v1 localities' VERIFIED per-locality recordability specs now live in deedKbLocalitiesVa.ts (seeded
// from the verified locality+RON source). This state-level KB no longer carries a locality placeholder.

// ── KB lookups (the composition-chokepoint allowlist) ───────────────────────────────────────────────────
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;]/g, '').trim();

/** Is the vesting selection one of the verified VA controlled-list options? (Matches the canonical language
 *  or the option key, normalized.) The KB — never model memory — is the authority. */
export function isVaVestingValidated(selection: string | null | undefined): boolean {
  if (!selection) return false;
  const n = norm(selection);
  return VA_VESTING_OPTIONS.some((o) => norm(o.language) === n || o.key === norm(selection).replace(/ /g, '_'));
}

/** Is the deed type one of the verified VA controlled-list types? */
export function isVaDeedTypeKnown(deedType: string | null | undefined): boolean {
  if (!deedType) return false;
  const n = norm(deedType);
  return VA_DEED_TYPES.some((t) => t.key === n.replace(/ /g, '_') || norm(t.title) === n);
}

