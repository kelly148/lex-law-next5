# DEED-DRAFT-AGENT-1 — Virginia real-estate document drafting agent (build-ready spec)

Author: Cowork lane · 2026-06-22 · Supersedes/absorbs DEED-QUICKDRAFT-1. **§3.1 FIRE — triad review of this design required before implementation** (recordable legal instruments, reduced gating, professional-responsibility / send-safety). *(Worked examples reference real client files — confidential.)*

---

## 1. What it is

Given a **document packet** (vesting deed; will/probate; tax record; death certs; prior deeds; **title commitment** for seller-side), a **firm house-style template**, and a **short free-text instruction**, the agent produces:

1. a **recordable Virginia instrument** — across deed types (v1: **deed of gift**) — in the firm's house style, with the **legal description verbatim**, **chain-of-title recitals synthesized from the packet**, the **correct statutory exemption** (or computed tax for taxable seller-side), and **`[[ ]]` placeholders + research leads** for genuinely-missing facts;
2. a **"Drafter's Notes — delete before recording" page** surfacing legal decision points, **template-defect corrections**, statutory-cite alternatives, and pre-recording diligence — *the attorney decides*;
3. optionally, a **companion engagement letter** (scope carve-outs, fee, firm-entity/conflict logic).

This is the **agentic-drafter / copilot-with-KB** architecture, not a form with dropdowns. **Acceptance bar = the worked examples** (Bien-Aime/Dume gift; Ray + Spears confirmations; the seller-side GW deeds).

## 2. Why this shape (operator direction)

The value isn't data-entry UI ("I could type it faster than that") — it's the **drafting intelligence + the notes page**. The dropdowns/sliders are stripped; the conflicts-at-intake gate is kept. The output must be good enough that a managing attorney edits and records it.

---

## 3. The pipeline (stages)

1. **Intake + conflicts gate (KEPT).** New matter / open matter → the FOLD-L0-1 conflicts-at-intake gate runs as today. The only retained gate; no capacity/party/recordability data-entry forms.
2. **Packet upload + multi-doc extraction.** Upload the vesting deed, will/probate, tax record, death cert(s), prior deeds, title commitment. **Extract:** legal description (VERBATIM), current owner/parties, parcel/tax-map ID, prior-instrument reference, property address, consideration/assessed value; from a **will**: the operative devise article, devisee, executor, fiduciary number, probate date, survivorship/contingency clauses; dates of death; from a **title commitment**: Schedule A legal description + grantee vesting, Schedule B-I requirements. **Depends on OCR for scanned PDFs (B1) — most of these are scans.**
3. **Chain-of-title synthesis.** Reconstruct the chain across the packet (e.g., grantor→grantee deed → spouse death/survivorship → testate death+probate → devise) and **draft the "WHEREAS … NOW THEREFORE" recitals from it** — synthesized, not template-filled.
4. **House-style match + template-defect correction.** Match the firm template for the deed type; correct only true mechanical defects; **match settled drafting conventions, do not "correct" them** (§11.3).
5. **Statutory authority verification + exemption selection.** Verify the controlling cites against authority (§5) and **select the right exemption** per category (§ 58.1-811(D) gift; (A)(10) into-LLC; (A)(11) out-LLC; (A)(12) into-trust; (J) TODD; (K) distribution; § 58.1-810(1) confirmation), OR for **seller-side, compute the recordation/grantor's tax** (taxable, no exemption).
6. **Legal issue-spotting → drafter's notes.** Spot decision points + diligence (warranty general/special; gift-tax/Form 709/step-up + TODD alternative; estate-lien/creditor/will-contest windows; survivorship-clause scope; name/scrivener discrepancies; commitment-vs-vesting-deed legal-description mismatch). Each becomes a numbered note.
7. **Assembly.** Recordable instrument (verbatim legal description, synthesized recitals, exemption/tax recital, signature/notary, return-to) + **`[[ ]]` placeholders + research leads** + the **drafter's-notes page**.
8. **Companion engagement letter (optional).** Conform to the matter; fee + breakdown; the **"not a title exam / opinion / insurance" carve-out**; firm-entity logic; iterative-review support.
9. **Attorney review → finalize/export.** Lands in the review/finalize path; exports in **house-style .docx** (depends on EXPORT-FORMAT-FIX-1). Attorney edits/approves; **never auto-records, files, or sends.**

---

## 4. KB / content (operator-provided — attorney work product, NOT auto-generated)

- **House templates** per deed type — the format/conventions to match.
- **A VA deed + recordation-exemption authority guide** — § 58.1-810/811 family, § 55.1-134/135/136 survivorship/TBE-trust-immunity, TODD § 64.2-621, PD 93-212 — with the firm's preferred treatment per category.
- **Engagement-letter templates** + Mason letterhead/style, with the standard scope carve-outs.

The operator assembles/maintains these. The agent grounds on them; it does not invent legal content.

## 5. Authority-verification layer — DECIDED (curated → live → hybrid)

**v1 = Curated authority KB.** Attorney-maintained store of recurring citations/exemptions with verified current text + treatment notes. The agent cites **only** from it and **always shows the citation for attorney verification — never relied on blind.** No live-egress, no hallucination surface.
**Secondary (later) = live primary-source lookup** (law.lis.virginia.gov) behind egress controls, for edge/novel cites. **Ultimate = hybrid.**
**Surface is small + stable:** the whole exemption family lives in **§ 58.1-811** (by subsection) + **§ 58.1-810**, plus § 55.1-134/135/136, § 64.2-621, PD 93-212.
**Hard rule (all phases):** **no hallucinated citations** — a cite that can't be grounded/verified is flagged, not asserted.

## 6. Architecture

Build on the **chat-copilot-with-KB-grounding** substrate (grounded generation + provenance + the egress/holdFlag controls already built), not the deed-gate form. Reuse: the materials/OCR **extraction pipeline**, **KB grounding**, the **conflicts-at-intake gate**, the **review/finalize + house-style export**. The **new core** is the legal-reasoning layer: chain-of-title synthesis, exemption selection, issue-spotting → notes. Flag-gated; default OFF; ships dark.

## 7. Legal-safety guardrails (the spine — non-negotiable)

1. **Legal description verbatim** from the vesting deed — never paraphrased/regenerated.
2. **No fabricated facts** — genuinely-missing info becomes a `[[ ]]` placeholder **with a research lead**, never a guess.
3. **No hallucinated citations** — cites only from grounded/verified authority (§5).
4. **Attorney is the final decision-maker** — the agent surfaces options/issues in the notes page; never picks warranty/exemption/structure; never treats a settled business/legal choice as a defect.
5. **Conflicts gate retained**; **never auto-record, e-file, or send.**
6. **Honesty floor on extraction** — low-confidence OCR (esp. the legal description) is withheld for attorney paste/confirm.

## 8. Increment plan

- **Inc 1 — extraction + chain-of-title + deed of gift, no advisory.** Packet → extract (verbatim legal description, parties, parcel, prior instrument) → assemble in house style with placeholders+leads. Conflicts gate kept; export house-style docx.
- **Inc 2 — authority + exemption + drafter's-notes page.** The legal-reasoning layer on the curated authority KB.
- **Inc 3 — companion engagement letter** (Mason; scope carve-outs, fee).
- **Inc 4 — issue-spotting depth + iterative review.** (Then the next deed category — likely seller-side, given volume.)

Each flag-gated, default OFF.

## 9. Dependencies

- **OCR for scanned PDFs (UAT fix B1)** — hard prerequisite.
- **EXPORT-FORMAT-FIX-1 (A1–A4)** — house-style .docx output.
- **KB content (§4)** — operator-assembled (corpus in hand; Cowork distilled the seed).
- **The copilot-with-KB substrate** (built, flag-dark).

## 10. Triad (required before build)

Establishes a load-bearing, hard-to-reverse decision with professional-responsibility / client-send-safety risk (an agent producing recordable legal instruments with reduced gating). **All three §3.1 prongs hold → FIRE.** A self-contained triad packet (GPT + independent Claude) reviews this design before implementation; the verbatim-legal-description rule, the no-hallucinated-citation rule, the honesty-floor placeholders, the attorney-decides notes model, and "which gates stay" are exactly what reviewers should pressure-test.

## 11. v1 decisions — RESOLVED (operator, 2026-06-22)
- **v1 deed type: DEED OF GIFT.**
- **Firm entity: ALWAYS Mason Law Firm.**
- **Authority layer: curated KB (v1) → live (secondary) → hybrid (ultimate).** Seed: § 58.1-811 + § 58.1-810 (+ § 55.1-134/135/136, § 64.2-621, PD 93-212).
- **One-glance verbatim confirm: YES** (legal description + parties + vesting; not a form).
- **Engagement letter: immediate fast-follow** (Inc 3), Mason letterhead.
- **KB seed: operator-provided corpus**; Cowork distilled it → `DEED_KB_SEED.md`.

### 11.1 Deed-type roadmap (operator taxonomy)
All Mason. Categories: **(1) Deed of Gift [v1]** → Deed of Confirmation, Deed Into Trust, Deed Into an LLC, Deed Out of an LLC, Deed Out of a Trust, and **Seller-side conveyance (sale closing)**. Architecture generalizes across all from the start; v1 ships gift only.
- "Deed Into Trust" is its own category (usually NOT a § 58.1-811(D) gift).
- **Seller-side conveyance is structurally distinct + high-volume**: driven by the **title commitment** (new input type), **taxable** (grantor's/recordation tax, no exemption), needs **legal-description reconciliation across the title commitment + vesting deed**. See `DEED_KB_SEED.md` §2.1. **Strong build-candidate right after gift.**

### 11.2 Distilled Mason gift house structure
Caption (§ 58.1-811(D) recital · Prepared by Kelly Satterwhite VSB #91049 / Mason Law Firm PLC · File 36-YYYY-NNNN · Grantee address · Tax ID · Assessed value · Consideration $0.00 · "PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION — NO TITLE INSURANCE") → "DEED of GIFT" → "THIS DEED OF GIFT, made this ___ day of [Month], [Year], by and between [Grantor(s)+marital status] and [Grantees+relationship]" → "Witnesseth" → granting clause ("For good and valuable consideration… grant and convey, with General Warranty and English Covenants… in fee simple, as [VESTING]…") → legal description (verbatim) → "For derivation of title see Deed recorded…" → subject-to → signatures/seals → notary → "After recording return to: Universal Title…". **Vesting:** JTWROS for non-spouses; tenants by the entirety for married couples.

### 11.3 RESOLVED — consideration recital: KEEP THE TRADITION
The agent **uses the traditional recital verbatim** — "for good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged" — and **does NOT flag it.** Operator decision (2026-06-22): tradition kept; the PD 93-212 point is known and deliberately not adopted. **General lesson: the attorney's settled drafting conventions are matched, not "corrected."**
