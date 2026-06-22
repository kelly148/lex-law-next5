# Deed KB Seed — Mason house library (distilled from the corpus)

Cowork distillation of the operator's real Mason deeds. Feeds DEED-DRAFT-AGENT-1 (build) + the triad packet. *(Patterns/IP captured; specific client facts left in the source files.)* All deed drafting = **Mason Law Firm**; prepared by Kelly Satterwhite, Esq. VSB #91049.

## 1. The shared Mason deed skeleton (all categories)

1. **Exemption recital** — "Exempt from recording tax pursuant to [§ cite], 1950 Code of Virginia, amended" (cite varies by category, §3).
2. **Prepared by** — Kelly Satterwhite, Esq. VSB #91049, The Mason Law Firm, PLC.
3. **Caption block** — File No. (`36-YYYY-NNNN` or `19-…`), Grantee's address / return-to, Tax ID, Assessed Value, Consideration `$0.00`.
4. **No-title notice** — "THIS DEED PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION — NO TITLE INSURANCE."
5. **Title** — "DEED of GIFT" / "DEED INTO TRUST" / "DEED" / "DEED OF CONFIRMATION" / "REVOCABLE TRANSFER ON DEATH DEED".
6. **Premise** — "THIS [DEED TYPE], made this ___ day of [Month], [Year], by and between [GRANTOR(S) + descriptor] and [GRANTEE(S) + descriptor]".
7. **Witnesseth** → **granting clause** ("[consideration recital], the Grantor(s) does/do hereby [verb], with [warranty] … in fee simple, as [vesting] … located in the County/City of [X], Commonwealth of Virginia, to wit:").
8. **Legal description (VERBATIM from the vesting deed).**
9. **Derivation of title** — "For derivation of title see Deed recorded in Deed Book X at Page Y / as Instrument No. Z."
10. **Subject-to** — "subject to covenants, conditions, restrictions, easements and rights of way of record."
11. **Signatures/seals → notary acknowledgment → "After recording return to: Universal Title…".**

## 2. Per-category profile map (the slots that vary)

| Category | Exemption cite | Parties framing | Granting verb / warranty | Default vesting | Category-specific clauses |
| :-- | :-- | :-- | :-- | :-- | :-- |
| **Deed of Gift** [v1] | **§ 58.1-811(D)** | Grantor(s)+marital status → Grantees+relationship | "grant and convey," **General Warranty** + English Covenants | JTWROS (non-spouse) / **TBE** (married) | — |
| **Deed Into Trust** | **§ 58.1-811(A)(12)** | Grantors → same persons "Trustees under THE [NAME] LIVING TRUST dated [date]" | "grant, bargain, sell and convey," General Warranty | to the Trustees | **Trustee-powers clause**; the **§ 55.1-136(C)** tenancy-by-entirety creditor-immunity NOTE; "For estate planning purposes, and other good and valuable consideration…" |
| **Deed Into an LLC** | **§ 58.1-811(A)(10)** | Grantor(s) → "[LLC], a Virginia Limited Liability Company, GRANTEE" | "**quitclaim**, release and convey," (no warranty) | (LLC takes fee) | members→entity |
| **Deed Out of an LLC** | **§ 58.1-811(A)(11)** | "[LLC], a Virginia LLC, Grantor" → "[members], collectively being the members of the Grantor LLC, Grantees" | "grant and convey," **Special Warranty** | **tenants in common** | entity→members |
| **Deed of Confirmation** | **§ 58.1-810(1)** (or **§ 58.1-811(K)** distribution alt) | "[Person], party of the first part" → same "party of the second part" | "grant, confirm, and convey," General Warranty | sole owner | **chain-of-title WHEREAS recitals** (synthesized from packet); confirms record title, doesn't transfer |
| **Revocable TOD Deed** | **§ 58.1-811(J)** | Grantor → designated beneficiaries (often a trust) | TOD transfer (not a present conveyance) | per beneficiary designation | full **TOD structure**: § 64.2-621 et seq. recital, primary/contingent beneficiaries, right-to-revoke + method-of-revocation |
| **Seller-side conveyance** (sale closing) | **NONE — taxable** (recordation + grantor's tax on actual price) | Seller (current owner, vesting deed) → Buyer (title commitment Schedule A) | "grant and convey," **General Warranty** (or Special) | per buyer's instruction (commitment) | **driven by the title commitment**; real **Consideration = sale price** in caption (not $0.00) |

### 2.1 Seller-Side Conveyance Profile (v2 — FIRE-ruled, grounded)

*Grounded against corpus deeds: Mason files 36-2026-6276, 36-2026-6635, 36-2026-6684 (all VA General Warranty Deeds, The Mason Law Firm). Incorporates FIRE §3.1 rulings B1–B6 + recordability gates C1/C2 — see `docs/reviews/DEED-DRAFT-AGENT-1_FIRE_disposition.md`. Supersedes the prior PROVISIONAL §2.1.*

#### 2.1.0 Category definition
Seller-side conveyance: our office holds the seller's side and drafts the deed **out of the current owner** — a living individual / couple, or a decedent's **estate via its qualified fiduciary** — to a third-party purchaser, grounded on a **title commitment** produced by the buyer's settlement agent. Always on the Mason skeleton (§2.1.1).

**Warranty default (B1, supervising-attorney ruling):** `warranty_type` defaults to **General Warranty** (incl. testate-estate-with-power-of-sale), overridable to **Special/Fiduciary Warranty** on explicit instruction (commitment, contract, fiduciary authority, seller counsel, or attorney reviewer). Standing risk note for fiduciary grantors: *general warranty from a fiduciary exposes the estate to pre-existing (pre-decedent) title defects and a claims-tail surviving distribution; confirm risk tolerance and select special/fiduciary warranty where the fiduciary or counsel requires it.* When overridden, the granting clause + authority recital switch to the special/fiduciary variant.

#### 2.1.1 Mason deed skeleton (fixed field order)
1. **Preparer/recording block:** `Prepared by:` Kelly Satterwhite, Esq. (VSB# 91049), The Mason Law Firm, PLC · `File Number:` **[settlement-agent file] / [Mason file 36-YYYY-####]** · `Grantee's Address:` · `Title Insurer:` · `Tax I.D. Number:` · `Consideration:` · `Assessed Value:`
2. **Title line:** `THIS DEED, made this ___ day of [Month], [Year], by and between [GRANTOR], (the "Grantor[s]"), and [GRANTEE], (the "Grantee[s]"),`
3. **Granting clause:** actual consideration spelled + figures → `…and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantor[s] do hereby grant, bargain, sell and convey, with [WARRANTY: "General Warranty" (default) | "Special Warranty"] and English Covenants of title, unto the said Grantee[s], in fee simple, [TENANCY], all of the following parcel of real property, with improvements thereon, located in [County], Commonwealth of Virginia, to wit:` *(special/fiduciary override also conforms the authority recital per §2.1.5.)*
4. **Legal description** — verbatim, block-indented.
5. **Vesting recital** — `BEING the same property conveyed unto [grantor of record] by [Deed], dated …, recorded … in [DB/PG or Instr. #]…` (+ estate-authority recital per §2.1.5 when fiduciary).
6. **Subject-to:** `This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.`
7. **Signature block** — grantor lines; estate adds `The Estate of [decedent] / By: ____ [Fiduciary], [Capacity]`.
8. **Acknowledgment** — `subscribed and sworn before me this ___ day of …`, Commonwealth of Virginia, **County/City of [signing venue]**.
9. **After recording return to:** settlement agent.

Output is a **draft only** — date, notary, and registration fields remain blank for execution.

#### 2.1.2 Source-field map (authoritative source per field)
| Field | Primary source | Reconcile / cross-check |
|------|----------------|-------------------------|
| Grantor name | Prior vesting deed (name of record) → current legal name | Marriage → "formerly of record as"; death → Certificate of Qualification. **Not** the commitment caption. |
| Grantee name + marital status | Sales contract / commitment **Sch. B-I Req. 4** | Sch. A "Proposed Insured" confirms |
| Grantee tenancy | Grantee marital status + Sch. B-I | Married → TBE w/ survivorship; otherwise sole owner / TIC as specified |
| Legal description | **Commitment Exhibit A** (controls) | Prior deed; condo = Declaration + Plat instrument #s |
| Tax I.D. (GPIN/Map) | Commitment Sch. A txn data | County tax card |
| Consideration | Contract price = Sch. A 2(a) owner amount | Actual price; never $10 nominal on a sale |
| Assessed Value | County assessment record | |
| Vesting recital (prior deed) | Commitment Chain of Title / prior deed | "last deed into grantor" |
| Estate-authority recital | Will + **Certificate of Qualification** + death certificate | Probate FI#, death date, power of sale |
| Title insurer + return address | Commitment Sch. A issuing agent/underwriter | |
| Signing venue | Closing-location field; else blank for execution | Agent must **not infer** venue at draft time |
| Warranty type | `warranty_type` (default General; override per §2.1.0) | Special/fiduciary on explicit instruction only |

**Tax (B5):** the agent owns accurate **Consideration + Assessed Value** only. It does **not** compute or print VA grantor tax (§58.1-802) or the NoVA regional add-on (§58.1-802.3) on the recordable face. An optional, clearly-labeled **off-deed advisory estimate** is permitted solely as a cross-check against the settlement statement — never on the deed or in closing figures. Final tax treatment/allocation stays with the settlement agent.

#### 2.1.3 Commitment → deed flow
1. Property & legal from commitment **Exhibit A** (verbatim).
2. Record owner from Sch. A Item 4 + Chain of Title.
3. **Who must sign** from **Sch. B-I Req. 4** ("Deed from ___") — *controlling for the grantor*, and may differ from Item 4 (§2.1.4a).
4. Pull last vesting deed for the "BEING" recital reference.
5. Reconcile grantor identity (§2.1.4).
6. Build grantee block (names, marital status, tenancy).
7. Pull consideration (contract / Sch. A) + assessed value (tax record).
8. Assemble on skeleton; set **signing venue** to closing location.
9. Add estate/authority recital if fiduciary (§2.1.5).
10. QA pass (§2.1.6); emit draft.

#### 2.1.4 Reconciliation rules
**(a) Vesting party ≠ signing party (devisee vs. fiduciary) — B2 fail-closed scope.** Automated drafting is permitted for the **grounded branch only: testate estate + qualified fiduciary + express power of sale + estate-as-seller.** There, the **fiduciary conveys on behalf of the Estate**; the devisee is not a grantor — even if Sch. A vests title in the devisee. Recite death + probate + power of sale (§2.1.5). **All other branches are blocked and fail closed** (refuse + escalate; never improvise a grantor block): no power of sale → devisees convey, PR joinder per VA Code §64.2 debt-subjection; intestate → administrator authority + heirs (§64.2-200); estate distributed/closed → heirs convey directly; co-fiduciary / successor / non-qualified PR; foreign will / ancillary administration. Each remains blocked until separately authority-mapped and cleared.

**(b) Record name ≠ current legal name (B4 evidence rule).** Caption the grantor by **current legal name + "formerly of record as [name of record]."** Assert the link **only** with affirmative corroboration, in order: (1) marriage certificate or court order (name-change/divorce/restoration); (2) commitment/underwriter **expressly reciting** the name-change requirement; (3) explicit client/settlement-agent confirmation. **Name similarity alone is never sufficient**, and the link may not be inferred from the commitment caption alone. Absent corroboration → "name reconciliation — verification required," fail-closed to human review.

**(c) Name resolution — two separate tracks (B3).**
- *Fiduciary signer name (capacity):* **Certificate of Qualification > prior deed > commitment**; carry every material variant via `a/k/a`; commitment caption not authoritative. On detecting an estate matter, the Certificate of Qualification is a **mandatory ingest** — if absent, force a human-review gate before finalizing the grantor block.
- *Decedent / estate-caption name:* **prior vesting deed controls**; death-cert/probate variants carried via `a/k/a`. The "Estate of [decedent]" caption must stay on the chain of title.

**(d) Legal-description priority.** Commitment **Exhibit A controls**; cross-check prior deed. Condos: cite Declaration instrument # + Plat instrument #, plus the "TOGETHER WITH an undivided interest in the common elements" tag.

**(e) Consideration basis.** Actual contract price (= Sch. A owner amount), spelled + figures. The nominal "$10" recital is reserved for the gift category, not sales.

#### 2.1.5 Authority & signature block by seller type
| Seller type | Caption | Authority recital | Signature block |
|-------------|---------|-------------------|-----------------|
| Living individual(s) | Full legal name(s); "+ formerly of record as ___" if changed | none beyond "BEING the same property…" | individual lines |
| Testate estate, power of sale | `[Fiduciary], a/k/a [variant], Executor of Estate of [decedent]` | prior vesting deed → decedent died testate [date] → will admitted to probate, **see FI-####** → fiduciary qualified **with full power to sell and convey on behalf of the Estate** | `The Estate of [decedent] / By: ____ [Fiduciary], Executor`; acknowledgment names fiduciary in capacity |

Estate row is the **only** automated estate branch (B2 fail-closed, §2.1.4(a)); all other estate fact patterns escalate. On a special/fiduciary `warranty_type` override (B1), the granting clause uses "Special Warranty" and the authority recital conforms (warranty limited to acts by, through, or under the fiduciary/decedent only).

#### 2.1.6 QA / recordability gates (hard — fail-closed before emission)

##### Recordability gates — these decide whether a deed records and insures
- **C1 — Two-prong legal-description verification.** The legal description must be (a) taken **verbatim** from commitment Exhibit A **and** (b) reconciled to the prior vesting deed. Any divergence forces human resolution before emission. Condos: Declaration + Plat instrument numbers must match **exactly**. **Fail-closed.**
- **C2 — Required-party / authority reconciliation.** Assert **{grantor set on the draft} == {required-party set from Sch. B-I Req. 4}**, each grantor carrying a recorded authority basis, before emission. A missing required grantor = void/unrecordable deed or chain gap. **Fail-closed.**

##### Annotation-leak gate (B6) — deterministic, reproducible (no LLM-as-judge)
- **Allowlist render gate:** only known-good deed sections/tokens render.
- **Denylist floor** (must at minimum fail on): `NOTE:`, `TODO`, `[bracketed]`/unresolved placeholders, `{{ }}`, `<!-- -->`, residual markdown (pipes, asterisks). Any unresolved token → **fail-closed**. Cross-filed to EXPORT-FORMAT-FIX-1 as the single chokepoint assertion for **every** deed category.

##### Format / typo lints
- **County token spacing** — "Fairfax County", not "FairfaxCounty".
- **Authority-recital wording** — "with full power(s)", not "will full powers".
- **Vesting-recital wording** — "by virtue of a Deed from [grantor]", not "form".
- **Grantee order** normalized to contract / Sch. A order.

##### Draft-state + minors
- Output is an **unexecuted draft** (date / notary / registration blank).
- **Signing venue** pulled from the closing-location field, else left blank — never inferred or auto-filled to the property county.
- **Grantee TBE** requires a valid marriage between named grantees — confirm from Sch. B-I; do not infer from a shared surname (B4 evidence-discipline, grantee side).

#### 2.1.7 Grounding provenance
- Living individual seller(s): **36-2026-6276** (Couchoud → Otofat, Newington Forest SFH, Fairfax).
- Testate estate via executor (power of sale): **36-2026-6635** (Est. of C.A. Henderson, by Leatherwood Exec. → Devine, TBE).
- Living couple w/ grantor name-change + condo: **36-2026-6684** (Halbach f/k/a Beaudreau → Smith, Heathcote Commons condo, Prince William).

## 3. Curated authority KB seed (the statute map)

The whole surface really is **§ 58.1-811 + § 58.1-810**, by subsection, plus survivorship/trust support:
- **§ 58.1-811(D)** — deed of gift (no consideration; state it's a deed of gift). + **PD 93-212** (the "good and valuable consideration" recital point — *noted, deliberately not adopted per operator; tradition kept*).
- **§ 58.1-811(A)(10)** — into LLC · **(A)(11)** — out of LLC · **(A)(12)** — into trust · **(J)** — TODD · **(K)** — deed of distribution (confirmation alt).
- **§ 58.1-810(1)** — deed of confirmation.
- **§ 55.1-134 / 55.1-135** — common-law survivorship (abolished by default / restored by "with survivorship" language; JTWROS).
- **§ 55.1-136(C)** — tenancy-by-the-entirety creditor immunity preserved into a trust (the Into-Trust NOTE).
- **§ 64.2-621 et seq.** — Uniform Real Property Transfer on Death Act (TODD).
Each entry: current verified text + the firm's preferred recital/treatment. **Agent cites only from here; always shows the cite; never hallucinates.**

## 4. Gift v1 detail (build target)

**Template = the shared skeleton + the Gift row of §2.** Consideration recital: **traditional "for good and valuable consideration…" verbatim, unflagged** (operator decision, spec §11.3).
**Scenarios in corpus:** add-child JTWROS (Qader; Bien-Aime mother→son), add-spouse TBE (Torres, Pavlicek). **Vesting rule:** non-spouse → JTWROS ("joint tenants with the full common law right of survivorship and not as tenants in common"); married → tenants by the entirety.
**Still useful for gift coverage:** a clean parent→child JTWROS (the Qader copy has a `[SPOUSE]` gap), individual→individual, gift to multiple children, retained-life-estate gift (if done).
**Eval set:** hold back 1–2 gift deeds; feed the agent their inputs (vesting deed + tax record + the instruction), check it reproduces the known-good output (esp. verbatim legal description, correct vesting, § 58.1-811(D) recital).

## 5. Corpus coverage
**Have:** Gift (3 + Bien-Aime), Confirmation (BEKELE template + Ray + Spears), TODD (4), Into-LLC (3), Into-Trust (3), Out-of-LLC (1), **Seller-side (GROUNDED v2 — read + distilled from 3 GW deeds: 36-2026-6276 / 6635 / 6684; see §2.1, FIRE-ruled)**. **Missing:** **Deed Out of a Trust**. Engagement letters: Mason gift + Ray/Spears in hand.
