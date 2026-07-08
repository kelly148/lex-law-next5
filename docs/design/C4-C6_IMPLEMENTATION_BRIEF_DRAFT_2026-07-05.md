# C.4–C.6 — Conversational matter page: implementation brief (DRAFT — NOT DISPATCHED)

**Status: planning draft prepared by Cowork 2026-07-05 (operator-directed). DO NOT BEGIN IMPLEMENTATION. Preconditions: (1) A.6 — D3 `enforce` flip + 5 real-deed Trust Protocol pass (`docs/deed/D3_ENFORCE_A6_RUNBOOK_2026-07-05.md`); (2) operator "execute" on this brief. Design of record: `docs/reviews/C1-CONV-DESIGN_packet.v1.1.md` (triad-adopted; no new FIRE for implementing it). Inputs: `CONVERSATIONAL_MATTER_UI_MOCKUP_2026-07-05.html`, `CONV_UI_REQUIREMENTS_TRACE_RICKY_THREAD_2026-07-05.md`, the 2026-07-05 operator rulings (drag-drop→Materials; prominent Add Client; drafting mode = free conversation; conflicts quiet in Stage 1), UI-ATTORNEY-SWEEP-1 G1–G9.**

## What this builds

The matter page becomes one persistent free-form conversation (the CopilotPage substrate) with a matter-state rail; document pages keep the document center-stage with the same conversation draft-scoped in a rail. Full gamut: research questions, issue-spotting, brainstorming, and lookups are plain conversation; **verify** (panel fan-out) and **draft** (route to document) are the two wired verbs. Conversation is context, never a decision (NC-C1-7).

## Binding directives (restated so the builder never opens the packet mid-build)

- **NC-C1-1 (LOAD-BEARING):** route-never-draft enforced structurally — the conversation lane has no drafting tools, no write path to documents/versions, no instrument-formatted rendering. Deed text requests ROUTE to Quick Deed.
- **NC-C1-2:** CopilotPage is the only canonical conversation route; ChatSurface dies (temporary dev flag during migration allowed).
- **NC-C1-3:** every rail slot is read-only / route-only.
- **NC-C1-4:** ONE composer substrate. Decision proposed below (§D1).
- **NC-C1-5:** deliberate-act floor of eight (lock · tier · disposition · send · matter-identity · issuer identity · privilege status · recipient class). Open sub-question for operator: ninth express commitment for client/represented-party identity (§OQ1).
- **NC-C1-6:** gate asymmetry (conflicts fail-closed vs sendability fail-to-warn + QA-5 wrong_matter_id hard stop) recorded via decision-lock, stated once.
- **NC-C1-7:** chat content = evidence/context; routing acts get durable provenance via audit_events (Fork C — no new tables for decisions).
- **NC-C1-8:** exactly one authoritative review/disposition path; panel results land as review cards; Express launches from conversation only via deliberate confirm producing ledger + attestation (W1 E4b/E7b).
- **Operator rulings 7/5:** drops anywhere on the matter page land in Materials AND ground the conversation (drawer = view only); Add Client is a prominent header button; captured-facts rail kept as designed; drafting mode is also free conversation; conflicts UI quiet while gate off (FL-19).
- **Sweep G1–G5** apply to every new surface at build time (S10 carry-forward); G6–G9 likewise.

## Architecture decisions proposed (confirm or override at execute-time)

**D1 — Composer substrate = `chatCopilot.submitTurn`.** It is the triad-reviewed path with the egress broker, grounding, NPI minimization, citation fidelity, and per-turn gating already built (A1–A3). `chatDispatch.submitTurn` and the ChatComposer path are retired behind the migration flag and deleted at C.4 close (NC-C1-4 satisfied). The drafting-rail composer and the matter-page composer are the SAME component with a `scope` prop (matter vs document) — scope only changes grounding binding, never egress behavior.

**D2 — The matter conversation is ONE persistent conversation per matter** (auto-created, not a conversation list). The existing CopilotPage list UI collapses to "the matter's thread" per the free-form principle. Prior copilot conversations remain reachable read-only (no data loss); new turns go to the canonical thread.

**D3 — Ambient capture = server-side proposal objects, confirm = deliberate act.** A post-turn extraction pass (same LLM call or cheap follow-on, matter-scoped, no new egress surface — it rides the copilot broker) emits `proposed_party` / `proposed_fact` objects persisted additively. Rail renders proposals with Confirm/Dismiss; Confirm writes the real party/fact + an audit_event naming the source turn; Dismiss is also audited. Nothing auto-commits. (This is the mockup's "Prudence — proposed" card.)

**D4 — Verify verb, TWO modes (amended per operator ruling 2026-07-06).**

*D4a — Express ask (PRIMARY; the operator's named key feature).* A composer-level mode, available on any turn in research/general conversation: the SAME prompt (plus identical grounded context — input-parity manifest enforced per lane) auto-fans to the active panel (Claude/GPT/Grok; Gemini dormant per policy), replies return, and **Claude auto-synthesizes them into one presented answer** with per-lane attribution, disagreements surfaced (D6 taxonomy), and the raw lane replies one click away. **Repeatable without limit in the same thread** — Express is a per-turn choice, not a session mode; consecutive Express turns carry the thread context to every lane each time. Synthesis is always *presented, never applied* (auto-orchestration principle: the labor is automated, the judgment is not); nothing from an Express turn becomes a matter fact, disposition, or document content without the normal deliberate acts. Every fan-out writes per-lane egress audit rows. Operator ruling verbatim: "it auto sends the same prompt to multiple models, they send their replies back, and that's auto synthesized by Claude into something that's presented to the user... and we need the ability to do that multiple times in the same thread."

*D4b — Panel review of a prior answer (the original design).* "Send to review panel" chip on any existing assistant answer → deliberate confirm → the EXISTING multi-reviewer fan-out with the answer as subject → results as review cards in the rail + one-line summary in-thread; dispositions on the cards (NC-C1-8 — the one authoritative disposition path is untouched). New subject type only.

Cost note for the builder: Express multiplies per-turn spend by lane count — show a terse lane-count indicator on the toggle (attorney-audience: no warnings, just the fact).

**D5 — Draft verb.** Routing chips ("Open Will draft — Walter", "Engagement letter") → New Document create pre-filled from conversation context (type, title, subject party), landing on the document page. The routing act writes an audit_event (source turn → created document). Deed types route to `/matters/:id/deed` (LIVE-9).

**D6 — Drop handling.** Matter page (any zone incl. composer): full-page drop target → EXISTING materials ingest (MATTER-DROP-1 if it merged overnight; else built here) → grounded next turn. Document page rail: same drop → Materials, grounded to the draft-scoped conversation. Copilot ephemeral attachments (A2 lifecycle) remain for the copilot surface until C.4 consolidates it; at consolidation, matter-thread drops are DURABLE (Materials) per the 7/5 ruling — the ephemeral lifecycle stays available as an explicit "don't keep this" toggle on the drop, not the default. **If the builder judges this conflicts with the A2 reviewed design rather than specializes it, STOP and flag (do not choose).**

**D7 — Rail composition (matter page):** Parties (with proposals + "+ Add party"; header Add Client button routes here), Captured facts (proposals + confirmed, each with source + audit link), Documents (route-only), Open items, Deliverables (FOLD-PM-4 data). Document page rail tabs: Conversation / Review / Facts. All slots route-only (NC-C1-3).

## Increments (each reversible build-and-PR; phase branch per Rule 17)

- **C.4a — Substrate consolidation.** One composer component; chatDispatch path behind `CHAT_SURFACE_LEGACY_ENABLED` (default OFF); architecture test extended: no send path outside the broker, no second composer import. No visible product change yet.
- **C.4b — Matter conversation page.** `/matters/:id` becomes conversation-first behind `CONV_MATTER_PAGE_ENABLED` (default OFF): canonical thread (D2), composer, terse status strip (FL-19-quiet conflicts), header (title/client/PA/phase + Add Client). Old matter page reachable while flag off — byte-for-byte legacy.
- **C.5a — Rail + ambient capture.** Proposal objects + rail cards + confirm/dismiss audit trail (D3, D7). Migration: additive `matter_fact_proposal` (or reuse; builder's investigation decides — if a new table, it joins the additive allowlist).
- **C.5b — Drops.** D6 wiring both scopes.
- **C.6a — Draft verb.** Routing chips + prefilled create + audit provenance (D5).
- **C.6b — Verify verb.** Panel fan-out on conversation answers via deliberate confirm; cards in rail (D4). This is the increment most likely to surface a genuine design fork — if the "conversation answer as review subject" requires changes to review-session semantics beyond an additive subject type, STOP and flag.
- **C.6c — Flag consolidation + ChatSurface retirement** + render-test sweep (G1–G9 assertions on all new surfaces).

## Acceptance

The Ricky-thread replay script (trace doc §Acceptance): paste client email → grounded analysis → capacity posture holds (title hat reads from `engagementCapacity` — verify in C.4b) → verify chip → cards → adopt → draft chips route with provenance → memo/KB steps to the extent built. Plus: all deliberate acts reconstruct from audit_events; flag-off = byte-for-byte legacy at every increment; zero drafting affordances in the conversation lane (grep + render tests per NC-C1-1).

## Thesis conformance (operator-ratified 2026-07-06 — binding at build time)

Per `PRODUCT_THESIS_AND_ALIGNMENT_2026-07.md` (operator-ratified, triad review pending) and the adopted misalignment rulings:

- **Verb priority (ruling #1, as refined by NC-PT-2, triad-adopted 2026-07-06):** the matter page organizes around the legal work loop (intake/state → draft/analyze → review/verify → dispose/revise → export/lock) with **matter-phase-sensitive verb prominence** — a matter at intake surfaces draft/ingest first; a mid-life matter surfaces disposition; **disposition is the resting default**. Draft is first-class in every phase (never buried, never the headline identity). Artifact ingestion is a first-class entry point (NC-PT-12: parsing, versioning, candidate-fact extraction, what-changed diffs) — chips and empty-states invite artifacts as readily as instructions.
- **Disposition-as-record (NC-PT-6):** disposition events get immutability, timestamps, and export (they are the supervision/malpractice record); a rejected term reappearing in any later draft is flagged as a RESURRECTION; settled points re-raised by reviewers are suppressed-with-citation. North-star close-outs use the hardened metric (NC-PT-9): carries eliminated at constant-or-greater review coverage, plus defects-caught-before-export.
- **Connector materials (ruling #3):** the D6 drop-handling design extends to **connector-grounded materials** (a linked Drive/folder as a matter's materials source, same provenance + audit as uploads). If not built in C.5b, stub the seam; do not design it out.
- **Dispatch routing (ruling #4):** the D1 composer substrate carries a **task-difficulty routing seam** (model class per verb/task, operator-overridable) — Kelly hand-routes today; the substrate should not hard-pin one model.
- **Typed unverified-fact (ruling #6):** rail facts and proposals support an **unverified/provisional state** (the corpus's dual-token convention as a typed object), surfaced on send-blocking checklists — not bracket text in prose.
- **Counsel-the-principal (ruling #7):** the audience layer's client voice includes a **protective-counsel mode** (talk the principal down from a self-damaging act) distinct from neutral transmission.
- **North-star check:** every increment's close-out states which **manual carry** it eliminates (handoff note, cross-model paste, reviewer round-trip, re-typed correspondence) — the leverage metric, operator-stated 2026-07-05.

## Open questions for the operator at execute-time

- **OQ1 (NC-C1-5):** ninth express commitment for client/represented-party identity, or covered by matter-identity? (My read: make it express — cheap, and party confusion is the wrong_matter_id of people.)
- **OQ2:** C.4b flag flip timing — per-increment on prod (self-use) or hold all dark until C.6c completes?
- **OQ3:** does the research lane (separate design doc) need to precede C.6b so "verify" can include primary-source checking, or ship verify-with-panel first? (My read: ship panel-only first; research lane is its own gated track.)
