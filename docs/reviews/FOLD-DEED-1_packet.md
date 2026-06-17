# External Triad-Review Packet — FOLD-DEED-1 (AI-assisted deed drafting vertical)

> **§3.1 FIRE CHECKPOINT — HALT for external triad review (GPT + an independent Claude) BEFORE implementation.** Self-contained: reviewable with **no repo access**. Why it FIRES: a recordable deed is a **client-send-safety + land-records** instrument — an error in the legal description, vesting, marital rights, or tax recital is malpractice-grade and hard to unwind once recorded; CI cannot judge jurisdiction-correctness. **Note on timing:** this is a **Phase-5 add-on vertical** whose *build* depends on FOLD-PM-3 (party/entity model, not yet built). The packet is staged **ahead** so the triad can review the design while the dependency lands — but the design must be confirmed dependency-stable before build.

- **Owner:** Kelly Satterwhite — managing attorney (VA + MD); title/real-estate + T&E; **not a developer**. The deed-scope and legal/business questions in §5 are **his calls**, not the reviewers'.
- **Status:** spec → FIRE plan. No code until the triad disposition returns **and** PM-3 is built.

---

## 1. Decision under review

Add **deeds** as a document *type* in the existing matter → draft → multi-model-review → sendability workflow: generate jurisdiction-correct, recordable deeds (VA/MD residential first) from structured inputs + firm KB templates + verified authority. The leverage is real (high-volume, bounded, templated work). The danger is that a deed is **malpractice-sensitive and goes into the public land records**: the design must make the AI **assemble from verified inputs and surface decisions**, and must **forbid the AI from generating or paraphrasing the legal description, inferring vesting, or pulling tax rates from model memory**. The hard architectural question is the **recordability gate** (what must be true before a deed can be treated as send/record-ready) and the **scope/UPL line** (which seat drafts the deed relative to the title/settlement context the platform deliberately keeps out of the drafting path).

---

## 2. Ready-to-paste reviewer prompt

> You are an independent senior reviewer (one of two different models), ideally with real-estate/conveyancing exposure. You did **not** write this. I'm Kelly — a managing attorney licensed in Virginia and Maryland with a title/real-estate and trusts-&-estates practice; I am **not** a developer. This is an attorney-supervised legal-AI platform ("Whereas"). Pressure-test this plan to add **AI-assisted deed drafting** **before any code is written**. Be adversarial; deeds get recorded, so default hard to the safe option. The legal/business scope questions (§5) are mine to decide — flag them, don't resolve them for me.
>
> **The design:** deeds run as a document type in the existing matter workflow. Structured inputs (grantor/grantee, vesting/tenancy, property + **legal description carried verbatim from the source of record**, consideration/tax, title chain, warranty scope, jurisdiction, execution/acknowledgment block) feed firm templates from a knowledge base of verified per-type × per-jurisdiction clauses; every model call gets matter state (jurisdiction, parties, locked decisions); the multi-model reviewer panel runs deed-specific checks; and a **deed-specific "recordable?" gate** extends the existing sendability gate. Hard guardrails: the legal description is **never AI-generated or paraphrased** (extracted + attorney-verified); vesting, marital rights, and tax are **attorney decisions**, never inferred; tax rates/recording rules come from the verified KB, not model memory; no auto-recording.
>
> **Return, in order:**
> 1. **Top risks**, ranked — especially the ways an AI deed-drafting feature could still produce a defective recordable instrument despite the stated guardrails (e.g., a verbatim legal description that's verbatim-but-wrong-parcel; a vesting that's valid-but-not-what-the-client-intended; a stale tax exemption recital).
> 2. **The recordability gate** — is "legal description present + attorney-verified · acknowledgment correct for the state · tax computed + recital present · recording refs present · grantee tax-bill address present · warranty matches type" the right **blocking** set? What's missing, and what should be a hard block vs. a warning?
> 3. **The legal-description guardrail** — is "verbatim from source of record, extraction flagged for attorney verification" sufficient, or does it need a stronger control (e.g., require an attorney to affirmatively paste/confirm the description against the source; forbid OCR-only descriptions from clearing the gate)?
> 4. **Jurisdiction-correctness** — VA records at the locality level with local variation; how should the design avoid a model confidently producing a recording/acknowledgment form that's wrong for the specific locality? Where must "verified KB authority" be mandatory vs. advisory?
> 5. **Omissions** a production deed-drafting system needs that the plan doesn't address (RON/e-recording, correction-deed workflows, fiduciary chain-of-authority recitals, transfer-on-death statutory language, deed-of-trust in/out).
> 6. **Keep list** — what's right and I shouldn't over-engineer for a VA/MD residential-first scope.
> 7. **Bottom line:** proceed to a build plan as-is / proceed with named changes / not yet — name the prerequisites.
>
> **Constraints to respect (flag any violation):** the attorney is always the final decision-maker and signs; the AI assembles from verified inputs + templates and surfaces decisions, it does not decide vesting/marital-rights/tax; the legal description is never AI-generated; no auto-recording; verified KB authority (not model memory) governs rates/forms; scope is transactional document-assembly and the title/settlement-agent context is currently kept OUT of the drafting path (the scope-line question in §5 is the operator's).

---

## 3. Inlined design summary (from the spec — reviewable with no repo access)

**Deed types (VA/MD residential first):** general / special-limited warranty, quitclaim, bargain-and-sale, deed of gift, transfer-on-death (VA § 64.2-621 et seq.), trustee's/substitute-trustee's, fiduciary (executor/trustee/AIF), deed of distribution, inter-spousal/divorce, correction/confirmatory. *(Deed of trust — security instrument — flagged in/out as an open question.)*

**Structured inputs:** grantor(s) (name/marital/capacity/authority); grantee(s) (name/**vesting-tenancy**/tax-bill address); property (**verbatim legal description**, parcel/tax ID, situs, prior-deed recording ref, plat refs); consideration & tax (amount, basis, exemptions + recital); title source/chain; warranty scope; jurisdiction (recording locality); special clauses (easements, reservations, marital-rights release/joinder); execution (state-correct acknowledgment/notary, witnesses, preparer statement, return-to).

**Risk controls (the heart):** legal description NEVER AI-generated/paraphrased (verbatim + attorney-verify; extraction uncertainty flagged); vesting/tenancy must match the intended estate (attorney decision, never inferred); marital rights jurisdiction-specific + attorney-confirmed; transfer/recordation tax basis + exemption recital from verified KB; recording requirements jurisdiction/locality-specific; acknowledgment block = correct state statutory form (+ RON rules); warranty language matches deed type; fiduciary-authority recitals from the Letters/trust/POA chain.

**Platform reuse:** extraction (FOLD-PM-2, built) pulls legal description/parties/recording refs (extract + verify, never fabricate); party/entity model (FOLD-PM-3, **not yet built** — the build dependency); KB (FOLD-KB-1, built) holds firm templates + verified statutory clauses + current rates/rules; matter-state (FOLD-L1, built) injects jurisdiction/parties/locked decisions; reviewer panel calibrated for deed checks; sendability (FOLD-SEND-1, built) extended into the recordability gate.

**Guardrails (what it is NOT):** not an auto-recorder; not a legal-description generator; not a substitute for attorney verification of vesting/marital-rights/tax.

## 4. Build dependencies (sequencing note for the operator, not the triad)
Depends on: **FOLD-PM-3 (party/entity — NOT BUILT)**, FOLD-KB-1 (built), FOLD-L1 (built), FOLD-PM-2 (built), FOLD-SEND-1 (built). The triad can clear the *design* now; the *build* slots after PM-3. The design is dependency-stable **except** where the deed party/vesting model touches PM-3's entity shape — confirm that seam once PM-3 lands before building.

## 5. Operator legal/business questions (Kelly's calls — surfaced, not for the triad to decide)
- **Capacity / UPL / scope-line (highest priority):** which seat drafts the deed — law-firm representational vs. the title/settlement-agent context the platform keeps out of the drafting path? Deed prep is law practice in VA; this is where a *bounded* slice of title-context drafting might be deliberately brought in, or kept strictly law-firm.
- Jurisdiction granularity (VA locality-level variation); deed of trust in/out; RON/e-recording now vs. defer to FOLD-INTEG; which deed types × jurisdictions get verified KB templates seeded first.

## 6. Document manifest (inlined above)
- This packet. `docs/engagements/FOLD-DEED-1-spec.md` (full outline). FOLD-SEND-1 disposition (the gate this extends). FOLD-KB-1 (verified-authority/templates). Master-plan dependency + scope lines (E-2 transactional-only).

---

**HALT.** packet ready for FOLD-DEED-1. Awaiting the operator's external triad disposition; build additionally gated on FOLD-PM-3 and the §5 scope decision.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
