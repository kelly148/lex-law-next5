# C1-CONV-DESIGN — conversation-first design brief, v1.1 (triad-adopted)

**Supersedes for build purposes** `C1-CONV-DESIGN_packet.md` (v1.0, the reviewed packet). Append-only: v1.0 is
the record the triad reviewed; this v1.1 incorporates the adopted named changes. **Disposition adopted
2026-07-03** (`C1-CONV-DESIGN_consolidated_disposition_2026-07-03.md`): **PROCEED-WITH-NAMED-CHANGES**, unanimous
on direction. **OQ1 → CopilotPage is the base. OQ2 → strictly route (no promote-to-draft affordance from
conversation).**

## Sequencing (unchanged, load-bearing)

This clearance does **NOT** open C.4–C.6. Order: C.1 disposition (adopted) → **A.6 deed Trust Protocol passes**
→ C.4–C.6 open. No deed routing from conversation is implemented before A.6 passes. C.2 closes; **C.3 (E4b/E7b)
continues unaffected** (it shipped as ULTRABUILD-1 W1, PR #470).

## The v1.0 brief answers (as adopted) — the five scope-guard questions

Primary surface = **CopilotPage** (persisted, grounded, hard-exclusions enforced); ChatSurface's zone layout
migrates in. Invocable = analyze / ground / **route** only ("do the deed" ROUTES to Quick Deed, never drafts —
LIVE-9). Out of free-form = the two fixed gates (conflicts fail-closed + sendability fail-to-warn) + the
deliberate-act floor. Durable records build on W1's E4b/E7b + audit_events (Fork C). *(Full text in v1.0.)*

## Named changes (NC-C1-1 .. NC-C1-8) — the binding build directives

**NC-C1-1 (LOAD-BEARING) — Structural LIVE-9 enforcement + No-Shadow-Instrument rule.** Route-never-draft is
enforced **structurally**, not by intent classification: the conversation lane exposes **no drafting tools, no
write path to documents/versions, and no instrument-formatted rendering**. Intent classification is a routing
convenience only. Content rule: conversation may explain deed mechanics, identify inputs, and route to Quick
Deed, but must **not generate, preview, reconstruct, or supply** executable deed text — granting clauses,
legal-description language, signature/notary blocks, or exemption recitals. Any request for deed text ROUTES.
Any future sample-language surface must be non-durable / non-instrument.

**NC-C1-2 — CopilotPage is the ONLY canonical conversation route.** ChatSurface contributes UI patterns but
must not remain an independently reachable matter-thread surface after consolidation, **except behind a
temporary development flag during migration**.

**NC-C1-3 — The focused-deliverable slot is read-only / route-only.** A display slot that can edit is a
promote-to-draft affordance by another name. The posture/provenance zones are first-class migration items.

**NC-C1-4 — One composer substrate post-fold.** CopilotPage's dispatch path and `ChatComposer→chatDispatch`
must not both survive — two egress behaviors is a new seam. Pick one.

**NC-C1-5 — Deliberate-act floor set at EIGHT, with an expansion conditional.** The floor is: lock · tier ·
disposition · send · matter-identity · **issuer identity · privilege status · recipient class** (the v2 posture
trio promoted from parenthetical). Conditional: any future promote-to-draft affordance from conversation joins
the floor **before** it ships. **OPEN SUB-QUESTION for the operator (NC-C1-5):** is client / represented-party
identity a **ninth** express commitment, or covered by matter-identity? — flagged, not resolved here.

**NC-C1-6 — Record the gate asymmetry as an accepted-risk decision.** Conflicts fail-closed vs sendability
fail-to-warn: record the rationale (send is itself a deliberate act with confirm — two layers) and **lock it via
the decision-lock act**, not as commentary. State it together with the **QA-5 amendment (2026-07-03)**, which
already hard-stops `wrong_matter_id` within the otherwise-warn posture (ULTRABUILD-1 W4).

**NC-C1-7 — Chat content is evidence/context, never an authoritative decision; routing events get durable
provenance.** No chat message alone constitutes an attorney decision, approval, adoption, send authorization,
tiering, matter-identity confirmation, or finalization. Routing acts initiated from conversation must be durably
attributable so decisions reconstruct **without elevating chat content to record status** (Fork C preserved).

**NC-C1-8 — Exactly one authoritative review/disposition path.** Where multiple review surfaces exist, only one
path is authoritative for adoption into the matter record; conversation may summarize or route but never creates
a parallel adoption channel. **Express launches from conversation only via a deliberate confirm path producing
the durable ledger + approval attestation** (W1's E4b/E7b).

## What the CLI recorded on adoption

Brief amended to v1.1 (this doc); disposition + OQ answers recorded in STATE; C.2 closed; C.3 unaffected;
C.4–C.6 remain gated on A.6. **No C.4–C.6 implementation begins here.**
