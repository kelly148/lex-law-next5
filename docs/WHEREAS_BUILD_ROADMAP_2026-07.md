# WHEREAS BUILD ROADMAP — 2026-07 (operator-adopted)

**Audience: Claude Opus 4.8 in Claude Code (the sole builder). Authority: Kelly Satterwhite, operator, 2026-07-06. This document converts the ratified product thesis into a phased build order. It is intentionally exhaustive — read it fully once, then execute phase by phase. Where this roadmap and CLAUDE.md conflict, CLAUDE.md governance WINS (this roadmap orders work; it never overrides gates). The corpus rule "mapping ≠ prioritization" (R11) is satisfied: the underlying analyses are evidence maps; THIS document is the operator's build order, which is his to give.**

---

## 0. The one-paragraph mission

Whereas is a **matter-state-and-judgment system with drafting attached** — an attorney's workbench that reviews artifacts, runs multi-model critique, persists verified matter-state across a matter's life, and drafts excellently without being organized around drafting. The north-star metric, operator-stated verbatim: *"This product only provides leverage to the extent that I don't have to go back and copy and paste between models."* **Every engagement close-out in this roadmap must state which manual carry it eliminates** (handoff note, cross-model paste, reviewer round-trip, re-typed correspondence, re-assembled settled terms). If an increment eliminates no carry and serves no gate, question it before building it.

## 1. Canonical documents (read before the phase that uses them; paths are repo-relative)

| Doc | What it is | Governs |
|---|---|---|
| `docs/design/PRODUCT_THESIS_AND_ALIGNMENT_2026-07.md` | Ratified product identity + operator rulings #1–#8 | Everything |
| `docs/design/USAGE_META_ANALYSIS_2026-07.md` | 234-thread census, archetypes, failure census | Evidence base |
| `docs/design/CONV_UI_REQUIREMENTS_TRACE_RICKY_THREAD_2026-07-05.md` | 71-row behavioral trace (48 real sources) | Cited by everything; row numbers referenced below |
| `docs/design/C4-C6_IMPLEMENTATION_BRIEF_DRAFT_2026-07-05.md` | Conversational matter page: increments C.4a–C.6c, D1–D7 decisions, **D4a Express ask**, thesis-conformance section | Phase 1 |
| `docs/design/RESEARCH_LANE_DESIGN_2026-07-05.md` | Primary-source research egress design | Phase 2 (FIRE-gated) |
| `docs/design/CLIENT_CONFIG_LAYER_SKETCH_2026-07-05.md` | Firm → capacity → client → matter config inheritance | Phase 3 |
| `docs/design/PROMOTE_TO_DRAFT_DECISION_FRAMEWORK_2026-07-05.md` | Options A–D + triad questions | Phase 6 (FIRE-gated) |
| `docs/reviews/PRODUCT-THESIS-1_packet.md` | Thesis triad-review packet (out for external review) | Gate G-B |
| `docs/reviews/C1-CONV-DESIGN_packet.v1.1.md` | Triad-adopted conversation design (NC-C1-1..8) | Phase 1 binding directives |
| `docs/UAT_FIX_LIST_2026-07-05.md` | Living fix list FL-1..FL-19 + operator rulings | Phase 0 |
| `docs/engagements/OVERNIGHT_BATCH_2026-07-06_dispatch.md` | The 12-item batch (some already merged) | Phase 0 |
| `docs/deed/D3_ENFORCE_A6_RUNBOOK_2026-07-05.md` | Operator's A.6 protocol | Gate G-A |

## 2. Standing invariants (apply to every phase; violating any is a HALT, not a judgment call)

1. **LIVE-9 / NC-C1-1:** the conversation lane never drafts, previews, or reconstructs instrument text; deed text always routes to the deed agent; the generic template path never mints deeds.
2. **Automate the labor, never the judgment:** synthesis, fetches, and proposals are always *presented*; dispositions, sends, locks, capacity elections, and client-counseling calls are always the attorney's. Nothing auto-applies.
3. **Fork C:** `audit_events` is the single source of truth for attorney decisions; new decision types project over it; no parallel decision store.
4. **QA-5:** sendability is warn-only except `wrong_matter_id` (typed-confirm hard stop).
5. **Gate semantics never change in display work.** Display/UX engagements prove it: behavioral tests pass UNMODIFIED.
6. **Migrations:** additive-only, `IF NOT EXISTS`, registered in the pre-deploy allowlist + `EXPECTED_TABLES_EXTRA`. Destructive DDL = operator-gated, out-of-band, never in this roadmap.
7. **Flags:** every new feature ships behind a default-OFF flag; flag-off = byte-for-byte legacy. Deploy and flag flips are ALWAYS separate operator acts (Rule 18 DEPLOY PROMPT).
8. **Egress:** every provider send goes through the broker; new egress surfaces get their own fail-closed allowlist; NO new external egress contract without its own §3.1 FIRE (this kills any temptation to "just fetch" during Phase 1 — the research lane is Phase 2 and gated).
9. **Input parity (row 38):** any multi-lane operation carries a source-completeness manifest per lane; an arbiter/synthesizer states what each lane saw. No cross-model comparison without it.
10. **Reviewer-output screening:** reviewer/lane output is screened for citation provenance (row 56) and unverifiable authority before it reaches disposition; unverified citations cannot green.
11. **Attorney-audience UI (G1–G5 + FL rulings):** terse neutral status, no teaching prose, no supervision tone, document/conversation first, machinery collapsed. Conflicts UI stays quiet while the gate is off (FL-19).
12. **Panel composition:** Claude primary/synthesizer, GPT + Grok active, **Gemini dormant** (activation = calibration pass + policy verify — operator decision, not builder).
13. **Live provider calls in build/test:** mocked by default; live runs only where an engagement's brief explicitly authorizes them with a spend cap.
14. **Single-builder model:** you build; GPT/Grok/Cowork propose and review, never commit. Cowork lane owns docs/UAT/browser; you own code and git.

## 3. Decision authority (so you never guess)

| You (builder) decide | You HALT and ask the operator |
|---|---|
| File structure, component composition, test design, additive schema details, which increment order within a phase (honoring stated dependencies), cheapest-wins layout choices flagged as builder's choice | Anything on the CLAUDE.md hard-stop list; any FIRE trigger (§3.1 triage every engagement — say `Checkpoint triage: [FIRE/skip] — reason`); any gate-semantics or egress change; flag flips; deploys; prod data mutation; anything contradicting a prior close-out (tripwire); any place a brief says "STOP and flag" (e.g., C4-C6 D6 ephemeral-vs-durable conflict); re-litigating an operator ruling (they're listed in the thesis doc + Cowork memory — treat as settled) |

## 4. The phases

### PHASE 0 — Close the current board (no gate; start immediately)
1. Verify every item of `OVERNIGHT_BATCH_2026-07-06` merged or was properly skipped (items 1–12 incl. DEED-DOC-PAGE-LAYOUT-1/S1, TEMPLATE-PIPELINE-1, MATTER-DROP-1, COPILOT-UPLOAD-1, SESSION-UNSTICK-1, CAL-T1-2, IR-EXPORT-DOCX-1, the investigations). Anything unmerged: finish under the batch's continuous-run rules.
2. Produce/refresh the morning report + a single DEPLOY PROMPT for everything since the last prod pin.
3. Sweep the fix list: every FL item either closed (cite squash SHA) or carried with a reason.
4. **Exit criteria:** origin/main green; fix list reconciled; deploy prompt delivered; Cowork browser re-verification completed post-deploy (Cowork lane).

### GATE G-A — **DROPPED (operator decision 2026-07-06):** the deed D3/A.6 Trust-Protocol is no longer the Phase-1 gate; recordability moves behind the default-OFF `DEED_RECORDABILITY_ENABLED` flag for Stage-1 solo use (`docs/engagements/DEED-STAGE1-SIMPLE-1-dispatch.md`). GATE G-B: **SATISFIED 2026-07-06** — PRODUCT-THESIS-1 adopted 3/3 with named changes; the consolidated disposition (`docs/reviews/PRODUCT-THESIS-1_consolidated_disposition_2026-07-06.md`, NC-PT-1..12) is BINDING alongside the thesis doc. Already folded into the C4-C6 brief (phase-sensitive verbs, disposition-as-record, artifact-first intake, hardened metric). Phase 4 absorbs NC-PT-6/7/8 (state taxonomy incl. state *availability*, resurrection flags, package-as-conformance-unit). Standing duties: K/G claim register on new architecture claims; hardened north-star metric in every close-out; the Stage-2 rubber-stamping risk (NC-PT-11) needs a design answer before any second user. **Net: with G-A dropped and G-B satisfied, Phase 1 is UNBLOCKED** — C.4a may start on operator "execute C4-C6" (`docs/engagements/C4a-substrate-consolidation-dispatch.md`; its G-A precondition is void).

### PHASE 1 — The conversational matter page (C.4–C.6) — the flagship
Execute `C4-C6_IMPLEMENTATION_BRIEF_DRAFT_2026-07-05.md` exactly: increments C.4a (composer substrate consolidation, NC-C1-4) → C.4b (matter conversation page, flag `CONV_MATTER_PAGE_ENABLED` default OFF) → C.5a (rail + ambient capture proposals, additive migration) → C.5b (drops → Materials both scopes) → C.6a (draft verb routing chips + provenance) → **C.6b (verify verb: D4a Express ask — the operator's named key feature — AND D4b panel-review-of-answer)** → C.6c (flag consolidation + ChatSurface retirement + G1–G9 render assertions). The brief's thesis-conformance section is binding: review/verify/disposition are the primary verbs; connector-materials seam stubbed if not built; routing seam in the substrate; typed unverified-fact state; counsel-the-principal audience mode; per-increment carry-eliminated statement. Phase branch per Rule 17 (`fold/phase-c4c6` or continue the current convention); every increment reversible build-and-PR, auto-merge on green CI per Rule 15.
**Acceptance:** the Ricky-thread replay script (trace doc §Acceptance) passes end-to-end with mocked lanes; Express ask works ≥3 consecutive times in one thread with per-lane audit rows and input-parity manifests; flag-off is byte-identical; zero drafting affordances in the conversation lane (grep + render tests).

### PHASE 2 — Research lane (FIRE-GATED; scheduled by operator ruling #8)
1. Assemble the §3.1 packet from `RESEARCH_LANE_DESIGN_2026-07-05.md` (self-contained, per Rule 13), write to `docs/reviews/RESEARCH-LANE-1_packet.md` + Desktop mirror, announce `packet ready`, **HALT**.
2. After operator returns dispositions: build to the dispositioned design. Non-negotiables from the draft: own broker surface + fail-closed domain allowlist; **no client identifiers outbound** (structural scrubber, typed request objects); every fetch snapshots into `authority_source` (KB-PROVENANCE-1 schema, already on prod); verification = machine check against snapshot, never model self-certification; staged rollout (attorney-invoked only first); research egress visible in Supervision.
**Acceptance:** a citation greens only against a captured snapshot; a request containing a party name/address/parcel is structurally rejected; Supervision shows research events.

### PHASE 3 — Client-config layer (§3.1 triage required — privilege-adjacent; likely FIRE on the confidentiality prong)
Design engagement first from `CLIENT_CONFIG_LAYER_SKETCH_2026-07-05.md`: `client_profile` object (durable, owner-scoped, not matter-purged), **firm → capacity → client → matter** inheritance with explicit divergence flags, config-scope decision locks (Decline-&-lock reaches config; re-raised settled points auto-answered with the lock citation), live-pointers-never-live-facts staleness rule, reviewer exposure scoped per review type. Open questions in the sketch are for the operator at design acceptance.
**Acceptance:** a conversation for a configured client holds capacity posture + client standing rules without being retold (the Ricky "title hat" behavior, automatic); a locked config decision survives a reviewer re-raise.
**Rider — KB source-library ingestion:** the operator stages authoritative reference documents (VSB practice guides, ethics opinions, underwriting manuals) at `C:\Users\Kelly\Desktop\Historical_Thread_Extraction\_kb_sources\` (README there sets conventions). Ingesting that folder into the `authority_source` registry (issuer / effective-date / verified-as-of / review-by provenance per KB-PROVENANCE-1) rides THIS phase or Phase 2's snapshot machinery, whichever lands first — a document-upload path into `authority_source` with no client-data risk (reference sources only).

### PHASE 4 — Trust-boundary guardrail suite (the failure-census priorities; reversible lane; order within phase is yours)
These cover what the generator cannot catch about itself (thesis §a principle) — each its own small engagement: **(a)** cross-version diffing + "rejected-term must not reappear" locks on negotiation documents (rows 48–49); **(b)** suite/package object: document families with shared defined terms; a change re-flags siblings until conformant (rows 14, 20, 50); **(c)** typed unverified-fact objects on send-blocking checklists (if not fully landed in Phase 1); **(d)** citation-provenance + sycophancy screen on reviewer output before disposition (rows 56–57); **(e)** comparison artifacts (redline overlays) typed as VIEWS, never ingested as operative text (row 62); **(f)** materials origin-type incl. client-supplied-AI, triaged with suspicion (row 64); **(g)** pending-edits ledger: adopted-but-unapplied edits bound to document versions (row 23); **(h)** input-parity manifest generalized to every multi-lane surface if Phase 1 shipped it Express-only.
**Acceptance per item:** a seeded failure of that class (from the named trace row) is caught by the mechanism in a test, not by a reviewer.

### PHASE 5 — Deadline engine, cross-area (operator ruling: broad demand, STRONG)
Build the computation core to the 1031 capture review's spec (row 35): anchor rules, no-roll statutory days vs. rolling filing caps, entity-type/fiscal-year cap inputs, refuse-on-out-of-scope ("inputs missing" is a valid answer). **Activation per practice area is gated on attorney-verified fixtures** (the capture-interview mechanism, row 36): 1031 first (fixtures partly exist — the 3/9/2026→9/5 Saturday no-roll thread is fixture 1), then probate (4/16-month clocks), employment (final-wage, SB 170 phasing), contractual (business-day rolls, cure windows). Adversarially-dated fixtures mandatory (a "no complications" baseline proves nothing); leap-year mandatory.
**Acceptance:** the fixture grid passes; an unfixtured area REFUSES rather than computes.

### PHASE 6 — Promote-to-draft (FIRE-GATED; only after Phase 1 has soaked in real use)
Assemble the §3.1 packet from `PROMOTE_TO_DRAFT_DECISION_FRAMEWORK_2026-07-05.md` (straw position: hybrid D — correspondence promotes via deliberate confirm with provenance; instruments arrive as proposals only; LIVE-9 untouchable), **HALT** for triad + operator. Build only to the disposition.

### PARALLEL OPERATOR TRACK (never yours to execute; surface DEPLOY/flag prompts when their preconditions are met)
Title-exam activation (flag flip + first live exam — code and migrations are already on prod); async reviewer trio flips; `DOCUMENT_EXTRACTION_ENABLED` flip; synthetic-matter cleanup (bulk UI from S14 makes it painless); ops-lane decision (deferred pending absorption math — Cowork produces the math); Gemini activation gate; xAI ZDR + malpractice-carrier items; Stage-2 parity-gate planning (deferred until the operator raises it).

## 5. Working rules for the whole roadmap

Per-engagement: 7-command repo baseline → §3.1 triage line → build → 3-lens adversarial self-review → green CI → auto-merge (Rule 15 conditions) → Rule-16 state upkeep → next (Rule 14 auto-advance), stopping only at the gates marked above, FIREs, accept-gates where Rule 15 conditions fail, or hard stops. Phase boundaries produce a handoff brief. Reports append-only. Every close-out ends with the standard boundary statement. When anything here is ambiguous, the order of authority is: CLAUDE.md → the named brief → this roadmap → ask the operator. Do not re-derive strategy from the census yourself — the operator has ruled; your job is faithful execution with builder-grade judgment inside each engagement.

**Paste-to-start:** `Execute docs/WHEREAS_BUILD_ROADMAP_2026-07.md Phase 0. Report repo state, verify the overnight batch disposition, then proceed per the roadmap's working rules.`
