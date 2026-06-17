# FOLD-DEED-1 — AI-Assisted Deed Drafting (broad-outline spec)

**Status:** OUTLINE / exploratory. Operator-requested 2026-06-16 (Kelly). An **add-on practice-area vertical**, queued **further back** (Phase 5-ish) — depends on the foundation + KB + matter-state + party model landing first. This is WHAT/WHY only (Cowork spec lane); HOW/build is later.

## 1. Objective
Generate jurisdiction-correct, recordable **deeds** from structured matter inputs + firm templates + verified authority, under the **same attorney-supervised draft → review → sendability** discipline as every other document. Deeds run as a document *type* in the existing matter/document workflow (like the POA), not a separate app.

## 2. Why deeds fit AI especially well
The work is **bounded and templated**: a finite set of deed types, and the variability lives in a bounded set of variables (parties, legal description, vesting, consideration, covenants, jurisdiction clauses). The *hard* parts are **precision and jurisdiction-correctness**, not creativity — exactly where structured inputs, verified templates, and multi-model review beat freehand drafting. It's also high-volume and repetitive in a title/real-estate practice, so the leverage is large.

## 3. Deed types (VA/MD residential first)
General warranty · special/limited warranty (resale/REO) · quitclaim · bargain-and-sale · deed of gift · transfer-on-death (VA § 64.2-621 et seq.) · trustee's / substitute-trustee's · fiduciary (executor / trustee / attorney-in-fact) · deed of distribution (estate) · inter-spousal / divorce transfer · correction/confirmatory.
*Open:* deed of trust (security instrument) is a different animal (lender doc) — in or out?

## 4. Structured input matrix (the "proper inputs" that make this safe)
- **Grantor(s):** legal name(s), marital status, capacity/authority (individual / entity / fiduciary / AIF), signing authority.
- **Grantee(s):** legal name(s), **vesting/tenancy** (TBE, JTWROS, TIC, sole, entity), grantee tax-bill address.
- **Property:** **legal description (verbatim from the source of record)**, parcel/tax ID, situs address, prior-deed recording reference (book/page or instrument #), subdivision/plat refs.
- **Consideration & tax:** amount; transfer/recordation tax basis; exemptions (gift, spousal, parent-child, trust, etc.) + recital language.
- **Title source / chain:** vesting deed reference; encumbrances/exceptions to carry forward.
- **Warranty scope:** set by deed type (general vs. special vs. none).
- **Jurisdiction:** recording locality (county/city — VA is locality-level), state.
- **Special clauses:** easements, reservations, restrictions, mineral/water rights, marital-rights release/joinder.
- **Execution:** state-correct acknowledgment/notary block; witnesses (if required); preparer statement; return-to.

Most of these are already producible by existing platform pieces (see §6).

## 5. Deed-specific risk controls (where the AI must NOT freelance)
This is the heart of the spec — the gotchas that make deeds malpractice-sensitive:
- **Legal description: NEVER AI-generated or paraphrased.** Carry **verbatim** from the source of record (prior deed / survey / plat); any OCR/extraction uncertainty is flagged for attorney verification. #1 deed malpractice risk.
- **Vesting/tenancy must match the intended estate** (TBE requires marriage; JTWROS survivorship; entity capacity) — surfaced as an **attorney decision**, never inferred.
- **Marital rights** — non-titled-spouse joinder / rights release; VA (dower abolished, elective share) vs. MD differences — jurisdiction-specific, attorney-confirmed.
- **Transfer/recordation tax** — correct basis + exemption recitals; **current rates from the KB (verified authority), not model memory.**
- **Recording requirements** — format/margin rules, preparer statement, return-to, grantee tax-bill address, e-recording specs — jurisdiction-specific (locality-level in VA).
- **Acknowledgment/notary block** — correct state statutory form; RON (remote online notarization) rules.
- **Warranty language must match the deed type** (general vs. special covenants vs. quitclaim).
- **Fiduciary authority recitals** — Letters / trust / POA chain-of-authority for fiduciary deeds.

## 6. Platform integration (reuse, don't rebuild)
- **Document extraction (FOLD-PM-2, built):** pull legal description, parties, and recording refs from the prior deed / title commitment / survey — **extract + attorney-verify, never fabricate the legal description.**
- **Party/entity model (FOLD-PM-3):** grantor/grantee identities + entity vesting.
- **Knowledge base (FOLD-KB-1):** firm deed templates per type × jurisdiction; verified statutory clauses (acknowledgment forms, TOD-deed statutory language, tax-exemption recitals); current rates/recording rules. *This is the "background/templates" that makes it work.*
- **Matter-state (FOLD-L1):** jurisdiction, parties, locked decisions injected into every model call.
- **Reviewer panel:** deeds are a **strong** multi-model-review candidate — calibrate reviewers for deed-specific checks (legal-description match, vesting, tax, recording-readiness, jurisdiction clauses).
- **Sendability → a deed-specific "recordable?" gate** (extends FOLD-SEND-1): legal description present + attorney-verified · acknowledgment correct for the state · tax computed + recital present · recording refs present · grantee tax-bill address present · warranty matches type.

## 7. Queue position & dependencies
**Add-on vertical; further back.** Depends on: FOLD-KB-1 (templates/authority), FOLD-PM-3 (party/entity), FOLD-L1 (matter state), FOLD-PM-2 (extraction — done), FOLD-SEND-1 (recordability gate). Best slotted as a **Phase-5 practice-area vertical**, after the foundation + KB are live. Not before.

## 8. Open questions for the operator (legal/business — Kelly's calls)
- **Capacity / UPL / scope-line:** which seat drafts the deed — law-firm representational vs. the title/settlement-agent context the platform currently keeps OUT of the master/chat path? Deed prep is law practice in VA; this is the key interaction with the conflicts/capacity election, and may be where a **bounded** slice of title-context drafting is deliberately brought in (or kept strictly law-firm). **Highest-priority design question.**
- **Jurisdiction scope:** VA + MD first; how granular on VA locality-level recording variation?
- **Deed of trust (security instrument):** in or out?
- **RON / e-recording:** support now, or defer to FOLD-INTEG?
- **Seed scope:** which deed types × jurisdictions get verified KB templates first.

## 9. What this is NOT (guardrails)
Not an auto-recorder; not a legal-description generator; not a substitute for attorney verification of vesting, marital rights, or tax. The AI assembles from verified inputs + templates and surfaces decisions; the attorney decides and signs.

---
*Outline only. Promote to a FIRE Phase-A plan when it reaches the queue (it carries client-send-safety + records risk). Placement adjustable.*
