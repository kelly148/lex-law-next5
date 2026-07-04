# External triad-review packet — D3-SIGNOFF (source-anchored deed sign-off, Phase-A plan)

> **BANNER — §3.1 FIRE checkpoint. HALT.** Self-contained review packet for an external triad review (GPT + an
> independent Claude), reviewable with **no repo access**. Do **NOT** self-run, self-review, or self-approve;
> no implementation code is written past this checkpoint until the operator returns a triad disposition.
> Assembled by Claude Code (ULTRABUILD-1 W10b), 2026-07-03, against `origin/main` `2cc7ecc`.

---

## Part 1 — Decision under review

**Whether to build a fail-closed, source-anchored sign-off gate for deeds at the export moment** — a structural
side-by-side comparison of the high-stakes fields (**legal description / parties / parcel**) against the source
of record before a deed can be exported/downloaded (run-sheet A.1; Fable audit **D3 / Top-5 #3**). This is a
§3.1 **FIRE on all three prongs**: (a) hard to reverse (a signed/recorded wrong deed clouds title for years),
(b) not caught by CI (it is a human-in-the-loop verification design), and (c) it is the system's #1
**client-send-safety** control plus a **records-management** decision.

**NC-1 RED LINE (restated, non-negotiable):** **NO operative string on the instrument face is ever
model-composed.** Every operative string is either a **verified fragment** or an **extraction-verbatim value**.
The sign-off comparator must reuse the already-extracted source facts + the deterministically-assembled version
fields and introduce **no LLM step**. (This is already the assembler invariant — verbatim-or-`[[ ]]`-placeholder
— and the plan must not weaken it.)

---

## Part 2 — The Phase-A plan (the substance under review)

### The problem (confirmed by code inspection)

Today the deed sign-off moment is the **Download-DOCX** click on `DocumentDetail`, framed by an **advisory-only**
pre-flight strip whose own comment says it *"never gates Finalize/Download."* The surface shows **only the
assembled deed** — it never displays the source instrument beside the draft, and never structurally forces a
field comparison. The existing `DeedGatePanel` has a single **unaided** attestation checkbox ("Reviewed
side-by-side against the source — NOT OCR-only") with **no source shown**, and it is **decoupled from export**
(the export route never consults deed-gate state). Deeds do **not** flow through the generic `document.finalize`
gate chain (blocked by `enforceNotDeedLike`), so the real enforcement seam is the **export route**, not finalize.

### THE PIVOTAL FORK (the plan's central design decision — operator/triad must choose)

The audit's phrase is *"vs the source-document **image**."* **The source-document image is NOT stored today.**
Uploads use in-memory processing; `storageKey` is a **placeholder path** and **no blob bytes are ever
persisted** — only the **extracted OCR/text** is retained (`matter_materials.textContent`), consolidated into
typed `DeedSourceFacts` (verbatim legal description, grantor/grantee-of-record, parcel id, with honesty-floor
`withheld` flags).

- **Fork A — compare against the source TEXT / consolidated `DeedSourceFacts` (buildable NOW, no migration).**
  Display the verbatim extracted source legal description / parties-of-record / parcel **beside** the assembled
  deed's fields, and run the dormant deterministic comparators (below) fail-closed. *Pro:* buildable now,
  honest about OCR provenance, no new storage. *Con:* it compares against the *extraction*, not the original
  image — an OCR error in the source text is not caught by a text-vs-text diff (the attorney's eyes on the
  displayed source text are the backstop).
- **Fork B — require the actual source IMAGE side-by-side (needs real blob storage FIRST).** *Pro:* matches the
  audit phrasing; the attorney compares against the true document. *Con:* a larger, separate, migration-touching
  effort (introduce blob storage; retention/PII implications) before D3 can ship.

**RECOMMENDED SEQUENCE (for the triad to accept or reject): ship Fork A now** (it directly attacks the
catastrophic failure mode and is buildable), and record Fork B (source-image retention) as a **named
follow-on** — the two are additive, and Fork A does not preclude Fork B. *This is the pivotal question — see
Open Question 1.*

### The plan (Fork A), fail-closed, NC-1-safe

1. **Retrieval seam.** Add a document-scoped read that surfaces the **verbatim** source `legalDescription` /
   `parcelId` / grantor+grantee-of-record **values** (not merely the resolution boolean the current
   `previewFacts` returns) for the deed being exported. Extraction-only; **no LLM** (reuses
   `consolidateDeedSourceFacts`).
2. **Deterministic comparator (reuse dormant code).** Wire the already-written but **dormant** field-level
   comparators — `checkLegalDescription` (C1: draft legal vs source, verbatim/normalized, **fail-closed on any
   missing input**) and `checkRequiredParties` (C2: grantor/grantee multiset + authority basis) — fed by
   (source = consolidated facts) vs (draft = the assembled version fields). **No new operative string is
   composed** (NC-1). These comparators currently run in tests only; wiring them live is net-new enforcement
   and needs its own coverage.
3. **Structurally-forced UI.** On `DocumentDetail`, for `documentType==='deed'`, render the **side-by-side**
   source-vs-draft comparison (source legal/parties/parcel next to the assembled fields) and require an
   **affirmative per-field confirmation** — upgrading the current unaided checkbox into a comparison the
   attorney cannot skip. Mirror the `DeedGatePanel` lock-integrity pattern (a field cannot be confirmed unless
   its comparison is shown and affirmed).
4. **Fail-closed export block.** At the **export route** (`GET /api/documents/:id/export`), **hard-block** a
   deed (409, mirroring the existing fail-closed **conflicts** gate — NOT the sendability fail-to-warn) until a
   **source-anchored sign-off record** exists for the exact version + content hash. Absence/null **never**
   passes. Extend or add a sibling to the pure `evaluateDeedGate` (fail-closed AND) so `descriptionConfirmedAt`
   cannot be set unless the deterministic source-vs-draft comparison passed.
5. **Durable record.** The sign-off is an attorney decision → an **`audit_events` disposition row** (Fork-C
   consistent) + the deed-gate state carrying the comparison result + content-hash binding (supersede on
   version change, like the sendability/gate overrides).

### Guardrails the plan must honor

- **NC-1:** no LLM in the comparator; verbatim extracted facts vs deterministically-assembled fields only.
- **Fail-closed default-block for deeds** is a **behavior change** (today export is not deed-gated) — weigh the
  activation (flag-dark first; the gate must not silently depend on a dark flag being *off* to allow export).
- **Deeds attach at export, not `document.finalize`** (they are excluded from it).
- **Source is TEXT-only today** — do not claim image comparison until Fork B lands.

---

## Part 3 — Ready-to-paste reviewer prompt

> You are one lane of an external triad review (GPT + an independent Claude). Review the **D3-SIGNOFF Phase-A
> plan** (Part 2) — a fail-closed, source-anchored sign-off gate for deeds at export — for a solo Virginia
> attorney's platform. Return **PROCEED / PROCEED-WITH-NAMED-CHANGES / DO-NOT-PROCEED** with reasons. Judge:
> 1. **The pivotal fork:** ship Fork A (compare vs extracted source TEXT/facts, buildable now) and defer Fork B
>    (source IMAGE, needs blob storage), or hold for Fork B? What catastrophic case does text-vs-text miss, and
>    is the displayed-source-text-to-attorney backstop enough?
> 2. **NC-1 preservation:** does the comparator design keep every operative string extraction-verbatim or a
>    verified fragment, with no LLM step? Any seam where a model value could reach the instrument face?
> 3. **Fail-closed correctness:** is blocking export via a 409 (mirroring the conflicts gate, not the
>    sendability fail-to-warn) correct? Does null/absence/withheld never pass?
> 4. **Reusing dormant C1/C2 comparators:** sound, or should the comparator be purpose-built? What coverage is
>    required before wiring dormant code into a live export block?
> 5. **The behavior change:** default-blocking deed export is new — is the flag-dark→activation sequence safe,
>    and does it avoid a "dark flag OFF silently allows export" trap?
> 6. **Records:** is the audit_events disposition + content-hash-bound deed-gate state the right durable record?
> Assume no repo access; everything you need is in this packet.

---

## Part 4 — Document manifest (for the reviewer)

Everything needed is inlined. Supporting repo references (path:line, for the operator; reviewer needs nothing
external):
- Finalize/export UI: `src/client/pages/DocumentDetail.tsx:1174-1183` (Download-DOCX), `:1198-1228` (advisory
  strip, "never gates"), `:995-998` (DeedGatePanel mount); `src/client/components/DeedGatePanel.tsx:240`
  (unaided attestation).
- Export enforcement seam: `src/server/index.ts:452-611` (export route), `:524-542` (fail-closed conflicts 409
  to mirror), `:544-567` (sendability fail-to-warn — the anti-pattern here), `:576` (deed scan skipped for real
  deeds), `:169-172,251` (storageKey placeholder — **no blob image stored**).
- Comparators to reuse: `src/server/deed/deedDraftGates.ts:80-125` (C1 checkLegalDescription), `:154+` (C2),
  `:310-318` (runner) — **dormant, tests only**.
- Source facts: `src/server/deed/deedSourceFacts.ts:37-105,171` (verbatim legal/parties/parcel + consolidate);
  `src/server/procedures/deedDraftAgent.ts:2355-2395` (previewFacts — returns only a boolean today).
- Gate pattern: `src/shared/schemas/deedGate.ts:64-75,147-211` (description prongs + fail-closed evaluator);
  `src/server/procedures/deedGate.ts:107-123` (lock-integrity guard).
- NC-1 invariant already held: `src/server/deed/deedGiftAssembler.ts:11-22` (verbatim-or-placeholder,
  never model-composed).

## Part 5 — Open questions for the triad

1. **Text vs image (the pivotal fork):** ship Fork A (source TEXT/consolidated facts, buildable now) and defer
   the source-IMAGE requirement to a follow-on that first adds blob storage — or hold D3 until the image path
   exists? *Load-bearing; determines whether D3 ships in weeks or after a storage build.*
2. **Activation posture:** should the fail-closed deed-export block ship default-ON for deeds immediately
   (behavior change) or flag-dark with an explicit activation gate after the Trust Protocol (A.6)?

---
End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
