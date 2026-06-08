# MULTI-CLIENT-MATTER-SUPPORT-1 — investigation + design (bundles DOC-CLIENT-TARGET-1 + ASSESSMENT-DRAWER-1)

**Date:** 2026-06-08. **Trigger:** two 🔴 self-UAT findings on the Brown joint-EP intake (the second real
matter that ends self-use). Operator chose: bundle the two as one "multi-client matter support" workstream;
design direction **C (taxonomy-driven) with a document↔party link table**. **No code written** — this is the
investigation + design that the §3.1 triad packet will wrap.

Source findings: `_progress/UAT_FINDING_multi-client-doc-target_2026-06-09.md` (DOC-CLIENT-TARGET-1),
`_progress/UAT_FINDING_assessment-ignores-drawer_2026-06-09.md` (ASSESSMENT-DRAWER-1).

---

## 1. Honest relationship between the two findings

They share the **Brown joint-EP milestone** and the **assessment / recommended-documents** surface, but their
**cores differ**:
- **ASSESSMENT-DRAWER-1** is a **content-ingestion wiring gap** (+ misleading wording). Mostly mechanical;
  **not, by itself, a §3.1 FIRE** — it operates on the attorney's own matter materials.
- **DOC-CLIENT-TARGET-1** is a **multi-client document→principal targeting feature** with joint-representation
  **conflicts / confidentiality / client-send-safety** implications → **§3.1 FIRE** (design needs triad review).

**Shared seam (the reason to bundle):** a multi-client-aware **recommended-documents** output — the assessment
should (a) actually read the drawer, and (b) enumerate **per-client instances** ("Durable POA — Sarah", "—
Greg"). So the assessment work touches both. Recommendation: **ASSESSMENT-DRAWER-1's ingestion fix can ship
first as a non-FIRE increment** (unblocks Brown intake sooner); the **multi-client targeting + per-client
enumeration is the FIRE** that goes through triad review.

---

## 2. ASSESSMENT-DRAWER-1 — ROOT CAUSE (investigation-resolved)

**Root cause: the analysis-generation prompt context is built from `matter.title` + `parties` ONLY.**
`src/server/procedures/matterIntake.ts` `generateAnalysis` (L194–264) hand-builds its `userPrompt` from the
matter title and the party list (role + displayName, with the unconfirmed-party marker). It reads **no
material text and no document text** — it bypasses the materials drawer entirely.

- The content the assessment said was "not provided" **exists and is ingestible**: `matter_materials.textContent`
  (mediumtext — paste text OR extracted file text) with `extractionStatus` that "governs context pipeline
  inclusion" (Ch 20.2). A context-pipeline mechanism exists; `generateAnalysis` simply doesn't use it.
- Therefore: **finding's possibility #1 (NOT WIRED)** is correct. NOT OCR/parsing (files are clean digital
  PDFs with extracted text), NOT a stale cache (docs were present pre-generation), and **NOT a real
  identity-verification gate** — the "complete identity verification … no information provided" text is just
  the LLM's generic template output *given an empty context*. There is no gate in this code path suppressing
  content; there is simply no content fed in.

**Fix shape (non-FIRE increment):** assemble the matter's extraction-complete material `textContent` (and,
where relevant, document text) into the analysis `userPrompt`, **token-budgeted** (the Brown trust PDF alone is
~180k chars vs the 4096-maxTokens generation), respecting soft-delete + the unconfirmed-party/confidentiality
markers already in the prompt. Correct the wording so an empty/over-budget case reads "intake materials
received; substantive analysis deferred/summarized," never "no information provided." (Open sub-question for
the build: documents-drawer vs materials-drawer — uploaded intake PDFs land in `matter_materials`; confirm the
operator's "documents drawer" maps there, and decide whether generated `documents`/`versions` text is also in
scope.)

---

## 3. DOC-CLIENT-TARGET-1 — design (C + link table) [§3.1 FIRE]

**Data-model gap confirmed:** `documents` has `matterId`/`title`/`documentType` but **no party/principal link**.
`matter_parties` already models multiple `role='client'` parties (joint clients work). The missing piece is the
document→party association.

**Design (operator-chosen C + link table):**
1. **Data model — additive `document_party` link table** (`documentId`, `partyId`, `subjectRole` e.g.
   `'principal'`). A joint document targets **both** clients (two rows); an individual document targets **one**.
   Link-table (not a nullable scalar) so joint docs and future co-agent/co-trustee cases are first-class.
   Additive migration; nullable owner key; `ownerScope()`.
2. **Doc-type taxonomy — `individual` vs `joint` (requiresPrincipal).** Does NOT exist today (`documentType`
   is a free varchar). Add a classification: individual (durable financial POA, advance medical directive +
   HIPAA, pour-over will → requires a principal) vs joint (revocable living trust, certificate of trust,
   funding letter, deed → targets both). **Legal content — attorney-verified** (which types are individual vs
   joint is a legal call, not the builder's).
3. **Drafting UI:** when matter has >1 confirmed client AND the doc type is `individual`, **require** a
   principal selector ("for whom"); one-click "and create the matching one for the other client"; `joint`
   types skip the prompt (target both). Structural — the system refuses to draft an untargeted individual doc.
4. **Generation context:** the selected principal flows into drafting (name, agent designations, capacity).
5. **Downstream (the shared seam with ASSESSMENT-DRAWER-1):** recommended-docs/assessment enumerate **per-client
   instances** tracked individually; naming/export/provenance/**Matter Record ledger** disambiguate by principal
   ("Durable POA — Sarah Brianne Brown" vs "— Gregory Edwin Brown"); in-document header shows the principal.

**Why FIRE (all three §3.1 prongs):** (a) load-bearing + hard to reverse once documents + naming/export/ledger
data accrue; (b) not CI-catchable (whether a doc is targeted to the *right* client, and joint-representation
handling); (c) **ethics-conflicts + privilege/confidentiality + client-send-safety** — joint representation of
two spouses is the textbook conflicts/confidentiality situation, and mis-targeting a document to the wrong
principal is a confidentiality/send-safety harm. **The load-bearing decision for review is the
joint-representation handling**, e.g.: does export-safety/sendability need the principal? does the conflicts
surface treat the two co-clients correctly? is there any adversity-between-co-clients posture to encode? The
additive column + selector are mechanical; the joint-representation policy is what needs external eyes.

---

## 4. Proposed increments (after triad disposition of the FIRE design)

- **Inc 1 (non-FIRE, can ship first):** ASSESSMENT-DRAWER-1 ingestion fix + wording correction (token-budgeted
  material-text into the analysis context). Unblocks Brown intake.
- **Inc 2 (data core):** `document_party` link table (additive migration) + the individual/joint doc-type
  taxonomy (attorney-verified) + read/write queries. Flag-gated, no behavior.
- **Inc 3:** drafting-UI principal selector (taxonomy-driven C) + make-the-pair + generation-context wiring.
- **Inc 4:** downstream — per-client recommended-docs enumeration (shared with ASSESSMENT-DRAWER-1) + naming /
  export / provenance / ledger / in-document-header disambiguation by principal.
- **Inc 5:** flag-on + live-verify on the Brown matter.

---

## 5. Next step

This is a §3.1 FIRE (the DOC-CLIENT-TARGET-1 multi-client targeting). Per the checkpoint process, the next step
is to **author the self-contained triad-review packet** (`docs/reviews/MULTI-CLIENT-MATTER-SUPPORT-1_packet.md`
+ the phase2 Desktop mirror) wrapping §3's design in the four-part format (banner / decision under review /
ready-to-paste reviewer prompt / manifest + inlined design), then **halt** for external triad review before any
implementation. ASSESSMENT-DRAWER-1's ingestion fix (Inc 1) is non-FIRE and could proceed independently on
operator direction.

**Coordination note:** `main` has a PARALLEL active builder (reviewer/LLM PRs #227–#231 landed since the last
FOLD-PM-1 push). Any build here must branch from current `main` and coordinate. FOLD-PM-1 remains parked at the
operator seed-verification gate (unaffected by this finding).
