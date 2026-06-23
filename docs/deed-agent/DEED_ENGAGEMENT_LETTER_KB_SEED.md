# Engagement-Letter KB Seed — Mason deed engagement letter (distilled for Inc 3)

**Status:** GROUNDED — **Bien-Aime canonical** (content + formatting) · **Date:** 2026-06-23 · Cowork (propose lane).
**Primary source (canonical):** `Engagement_Letter_Bien-Aime_REVIEW.pdf` (Marie A. Bien-Aime; Deed of Gift, JTWROS addition; June 18, 2026) — operator-designated **best formatting**, and a true Deed of Gift (the v1 deed type). Read in full.
**Secondary (variant):** `Engagement letter - Deed of Gift (3).pdf` (Pearsall/Simmons; co-owner removal; June 10, 2026) — shows the **plural-client / "our firm-we" voice** and the **ALTA-settlement fee-collection** variant.
**Voice:** **first-person singular** ("I", "my services", "I represent you") per Bien-Aime. (Pearsall's "our firm / we" is the secondary multi-client variant.)
**Letterhead address:** **OPERATOR-CONFIRMED 2026-06-23** — "108 N. Columbus Street, First Floor" is correct. The phone in the canonical Bien-Aime source is "(703) 855-7380" (used as the canonical pairing; the Pearsall "(703) 354-2100" is the variant). See §7.

This file is the in-repo grounding source the DEED-DRAFT-AGENT-1 Inc 3 engagement-letter generator fills. It is committed so the generator grounds on a tracked source, not model memory.

---

## 1. Purpose
The grounded template the Inc 3 generator fills. **Template-fill only** — the verbatim clauses (§3) are the protected, send-safety + professional-responsibility spine and appear unaltered; `[[ ]]` slots (§5) are the only fill points; the agent never synthesizes scope, fee, disclaimer, or representation language.

## 2. Skeleton (Bien-Aime order)
1. **Letterhead** (firm block, centered — §4).
2. **Date** (left).
3. **Addressee** — name + street + city/state/ZIP.
4. **RE:** (bold) — "Preparation of [[deed type]] — [[property address]]" + indented 2nd line "([[action — e.g., Addition of [name] to Title]])".
5. **Salutation** — "Dear [[honorific + last name]]:".
6. **Opening** (verbatim, §3.1).
7. **Separate-representation clause** (verbatim, CONDITIONAL — when a non-client party takes an interest; §3.2).
8. **Enclosed-Deed + vesting** — signing/notarize/return + bold vesting sentence (§3.3).
9. **Scope limitation** (verbatim spine + conditional warnings, §3.4).
10. **Title-search disclaimer** (verbatim, §3.5).
11. **Fee + recordation-exemption recital** (§3.6).
12. **Closing** (verbatim, §3.7).
13. **Sign-off block** (§3.8).
14. **AGREED AND ACCEPTED block** (§3.9).

## 3. Clauses

### 3.1 Opening (VERBATIM — protected)
> My firm is pleased to provide legal assistance regarding the matter referenced above. This engagement letter sets forth the terms, conditions, and objectives of the engagement and clarifies the nature and limitations of my services.

### 3.2 Separate representation (VERBATIM — protected; CONDITIONAL on a non-client recipient)
> I represent you, [[client name]], alone in this matter. I do not represent [[other party]], the recipient of an interest in the Property; [[he/she]] is not my client, and [[he/she]] may wish to consult [[his/her]] own counsel regarding this transfer.

*Professional-responsibility clause — include whenever someone other than the client receives an interest (e.g., a gift donee). Omit only in a true single-party / all-clients matter.*

### 3.3 Enclosed Deed + vesting (template; vesting + survivorship are matter facts)
> Enclosed is the [[deed type]] for your review. The Deed must be signed by [[you / both of you]], notarized, and the original returned to me. Once this transfer is complete, title to the Property will be held by **[[grantee(s)]], as [[vesting — e.g., joint tenants with the right of survivorship as at common law and not as tenants in common]]**[[, so that upon the death of either owner the entire fee simple interest in the Property will pass automatically to the survivor]].

*Vesting phrasing must match the deed (pull from the same vesting source the deed assembler uses). The survivorship-explanation tail is included for JTWROS; omit for non-survivorship vesting. The vesting clause is bold.*

### 3.4 Scope limitation (VERBATIM spine; bracketed = CONDITIONAL)
> Please understand that my representation in this matter is limited solely to drafting and recording the referenced [[deed type]] and will conclude upon recording. [[IF a mortgage/DOT may exist:]] If there are any mortgages or deeds of trust against the Property, this transfer could activate a due-on-sale clause in your loan terms allowing the lender to accelerate repayment; you may wish to obtain written consent from your lender(s) prior to completing this transfer. You may also wish to consult a tax and estate advisor as to any income tax, gift tax, and estate implications[[, including the loss of any income-tax basis step-up on the gifted interest]], as I was not retained to evaluate those matters. By signing below, you acknowledge that The Mason Law Firm, PLC cannot provide legal representation regarding these or other matters not specifically indicated.

*Spine verbatim. The basis-step-up clause is gift-specific (include for gifts). "limited solely to drafting and recording ... conclude upon recording" is the Bien-Aime scope; the Pearsall variant is "drafting ... conclude upon completion of the Deed" (use when the firm is not recording).*

### 3.5 Title-search disclaimer (VERBATIM — protected; the "no title exam / no title insurance" carve-out)
> Please also be aware that changes in property ownership and titling may affect liens and encumbrances against the Property. A title search of the Property and a judgment search of all persons involved in the title transfer may show how this Deed would affect the liens and encumbrances against the Property. A title search was not requested or performed in conjunction with drafting this Deed. The Mason Law Firm, PLC does not perform title searches, but I can order one if you wish. Please let me know in writing prior to proceeding if a title search is desired.

*Load-bearing. Verbatim or withhold-and-flag — never paraphrased or dropped.*

### 3.6 Fee + recordation-exemption recital (template; amount/cite/county are `[[ ]]`)
> The flat fee for this engagement is $[[fee amount]], which covers my preparation and recording of the [[deed type]]. This [[deed type]] is exempt from Virginia state and local recordation tax pursuant to Va. Code § [[exemption cite]]. Please provide a check for $[[fee amount]] payable to The Mason Law Firm, PLC. Upon receipt of your check and the original signed and notarized Deed, I will have the Deed recorded among the land records of [[recording county]], Virginia.

*Fee amount NEVER invented (`[[ ]]`). The **exemption cite must equal the deed's exemption** — pull from the same per-category source the deed assembler uses (gift = § 58.1-811(D)); for a taxable seller-side deed, replace this recital with the tax treatment, not an exemption. Pearsall variant collects "on the ALTA settlement statement for your upcoming refinance" instead of a direct check — use when collection rides a settlement.*

### 3.7 Closing (VERBATIM — protected)
> If the foregoing is acceptable, please sign a copy of this letter in the space provided and return it to me. Please do not hesitate to let me know if you have any questions.

### 3.8 Sign-off (VERBATIM structure)
> Very truly yours,
>
> THE MASON LAW FIRM, PLC
>
> /s/ Kelly Satterwhite
> Kelly Satterwhite, Esq. (VSB #91049)
> Admitted in Virginia and Maryland

### 3.9 Agreed and accepted (VERBATIM structure)
> AGREED AND ACCEPTED:
> This letter correctly sets forth my understanding of the terms of this engagement.
>
> ____________________________________  Date: ____________
> [[Client signatory name]]
>
> Enclosure: [[deed type]]

## 4. Formatting (Bien-Aime — CANONICAL)
- **Letterhead, centered:** "THE MASON LAW FIRM, PLC" — large, **bold, dark-blue, letter-spaced (wide tracking)** serif; beneath it "ATTORNEYS AT LAW" in smaller letter-spaced caps. Then a **thick dark-blue horizontal rule** and, just below, a **thin gold/tan rule**. Then a centered contact line: "108 N. Columbus Street, First Floor • Alexandria, Virginia 22314 • (703) 855-7380".
- **Date** left-aligned; blank line; **addressee** block (name / street / city, state ZIP).
- **RE:** bold; multi-line if there's a parenthetical sub-description (indented under the RE text).
- **Body:** justified, **first-line indented**, single-spaced, blank line between paragraphs.
- **Vesting** sentence: bold inline.
- **Sign-off block** indented to center-right: "Very truly yours," / "THE MASON LAW FIRM, PLC" (**bold dark-blue**) / "/s/ Kelly Satterwhite" (italic) / name + VSB / admissions.
- **AGREED AND ACCEPTED:** bold heading, left-aligned; signature line with "Date: ____" inline to the right; client name beneath; "Enclosure: [[deed type]]" italic at foot.
- Two pages typical; no page-2 letterhead repeat (a plain continuation).

## 5. `[[ ]]` variable slots (the fill set)
`[[date]]` · `[[client name]]` · `[[client address]]` · `[[deed type]]` · `[[property address]]` · `[[RE action]]` · `[[salutation]]` · `[[other party + pronouns]]` (separate-rep; omit if none) · `[[grantee(s)]]` · `[[vesting (+ survivorship tail if JTWROS)]]` · `[[fee amount]]` · `[[exemption cite]]` (= the deed's) · `[[recording county]]` · `[[client signatory name(s)]]`. Everything else is the protected verbatim spine.

## 6. Inc 3 build notes
- Fill `[[ ]]` from matter facts + the deed being drafted; **never invent** fee, scope, disclaimer, or representation language.
- **Cross-link to the deed:** `[[deed type]]`, `[[vesting]]`, and `[[exemption cite]]` should be pulled from the SAME values the deed assembler used for the companion deed — so the letter and the deed never disagree.
- The §3.2 separate-rep, §3.4 scope, and §3.5 title-search clauses are the protected spine: verbatim or withhold+flag (a missing/garbled disclaimer is fail-closed, never a paraphrase).
- Generates a **draft** into the existing review/finalize/`.docx` path; never auto-sent.
- Formatting target = Bien-Aime (§4).

## 7. Open item for operator
- **Letterhead discrepancy — RESOLVED (floor):** Bien-Aime shows "108 N. Columbus Street, **First Floor** … **(703) 855-7380**"; the Pearsall letter shows "**2nd Floor** … **(703) 354-2100**". Both June 2026. The operator **CONFIRMED 2026-06-23 that "First Floor" is correct.** The address and phone are implemented as a single config constant (`MASON_LETTERHEAD`) in the formatter — "First Floor / (703) 855-7380" (the canonical Bien-Aime pairing). Only the floor was explicitly confirmed; if the operator wants a different phone the constant is a one-line change.
