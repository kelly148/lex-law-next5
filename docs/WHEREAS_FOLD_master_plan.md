# Whereas Fold — Completion Execution Plan

**Purpose.** Controlled execution plan to extend the MR-CAL-complete `lex-law-next5` codebase into the full **Whereas** product (the "fold"). It is the post-MR-CAL successor to `docs/MR_CAL_completion_master_plan.md` and runs through the **same engagement loop** (`/next-engagement`, `MR_CAL_engagement_state.json`, `docs/engagements/`, operator-approve gates).

This document is **not** authorization to build everything at once. Claude Code treats it as a master roadmap and proceeds **one bounded engagement at a time**, plan-first, with explicit operator approval before each irreversible or scope-expanding step. The fold is an *extension* of `lex-law-next5`, not a migration to a new repo (gap map F.0); there is one codebase.

**Source of record.** Derived from gap map Appendix F (fold procedure), the post-review six-layer synthesis, and the two external reviews of 2026-06-02. The pre-fold gate checklist (`WHEREAS_PREFOLD_GATE_CHECKLIST.md`) is incorporated below as the F.1 entry conditions.

**Governance.** Every architecture engagement requires `operator approve scope:<id>` before implementation and begins with a Phase-A plan. Every engagement marked **FIRE** trips the §3.1 external triad-review checkpoint (`EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md`) — Claude Code halts for independent GPT + Claude review before implementation. `/autopilot-next` may self-approve only the reversible build-and-PR lane; a FIRE is a hard stop. The two-track split holds: the Cowork analytical loop owns the spec (WHAT/WHY); the Claude Code loop owns the build (HOW); spec changes route through Cowork first (F.2.3).

---

## Entry conditions — gate before ANY fold engagement (F.1 + pre-fold gates)

These must be cleared before the queue opens. The first two are independent of the fold and current live exposures.

**E-NOW-1 — `AUTH_BYPASS_ENABLED` off production.** [gate G1] Live exposure today; do now, independent of the fold timeline. Production requires real authentication; confirmed via the deploy check.

**E-NOW-2 — MR-CAL formally complete.** [gate G2] CAL-7B-LIVE run, results triad-reviewed, CAL-7B-CLOSEOUT committed/pushed; the AI review-and-drafting core live-verified or formally deferred; residual risks classified (not recorded as "proven").

**E-1 — Project-identity confirmed.** The product continues in `lex-law-next5` (the fold). If a new repo were ever chosen the procedure changes materially — do not assume it.

**E-2 — Scope lines confirmed.** Transactional document-assembly only. Title/settlement OUT. Litigation / M&A / pure-advisory OUT. Tenancy: single-operator now, light multi-user (1–2 attorneys) later; no RBAC/org/multi-tenant. Sharing: per-user ownership, default-not-shared for matters AND knowledge base, enable-later without rework.

**E-3 — Tier-name collision resolved.** [gate G4] Disambiguate context-priority "Tier 1/2/3" from source-of-truth "Tier 1–8" in code and schema before any F.4 schema work. (Executed as `FOLD-TIER-1` below; the *decision* is an entry condition, the *rename* is the engagement.)

**E-4 — T&E evidence-count reconciliation done.** [checklist cheap-now] One pass against `verified_rows.xlsx`; resolve the 17-vs-32 discrepancy before seeding the T&E library.

---

## Engagement queue

Naming: `FOLD-*` series, extending the MR-CAL engagement harness. Each entry: type · checkpoint class · objective · key acceptance · do-not-touch. **FIRE** = §3.1 external triad review before implementation.

### Phase 0 — Re-baseline (F.2)

**FOLD-REBASELINE-1** · Investigation · **FIRE**
Re-run the gap map at build-card granularity against the MR-CAL-complete repo: mark every layer/primitive BUILT / PARTIAL / NOT-BUILT against the **actual code** (the build already diverged from the spec's build-cards-first plan, per reviewer §2.3). Write per-primitive build cards for NOT-BUILT items (input schema / stored state / trigger / deterministic-vs-model step / output / UI affordance / audit log / override path).
*Acceptance:* current-state map verified against code; build cards written for the items the fold will build. *Do-not-touch:* no code changes; investigation only.

### Phase 1 — Production-readiness foundation (F.3; gating — nothing client-facing ships until this lands)

**FOLD-AUTH-1** · Implementation · **FIRE** · [gate G3]
Real per-user authentication for a small set of trusted attorney accounts; remove the single-operator bypass. **Owner/user key on all core objects**, every read/write filters by current user, **private-by-default**; nullable key backfilled to the operator and enforced when a 2nd account is added. Model ownership as a first-class relationship — do **not** hardcode "owner = only viewer" (latent default-off sharing layer addable later). NOT SSO/enterprise IdP/RBAC.
*Acceptance:* auth live-verified; owner key present and enforced on core objects; default access private. *Do-not-touch:* no org/RBAC/multi-tenant model; no sharing logic.

**FOLD-TIER-1** · Implementation · **FIRE** · [gate G4/E-3]
Rename the two "tier" meanings in code and schema before any matter-state schema work. Suggested: `pinned_context / explicit_context / recency_context` for context-window priority; `source_authority_tier` (operative / current-draft / counterparty / superseded …) for source-of-truth authority.
*Acceptance:* distinct names in code and schema; no query conflates the two senses. *Do-not-touch:* no behavioral change to context budgeting.

**FOLD-GOV-1** · Implementation · **FIRE** · [gate G7]
Audit logging as a **first-class Matter Record** (what each model said, what was adopted/rejected/locked/sent/withheld, what authority was verified, what required judgment), not telemetry. Model-output governance enforcement (tier + confidence + verification before pass). Instrumentation. **Privilege-egress posture:** document each provider's retention/training terms; per-matter (or per-provider) control over what *category* of material egresses; context-preview before a newly toggled lane receives matter content (RPC precondition, not a carryforward).
*Acceptance:* immutable per-matter audit record; egress control + pre-send context preview specified and built; model-only claims cannot clear the gate unverified. *Do-not-touch:* no internal-wall RPC model (single-operator scale).

**FOLD-PERSIST-1** · Implementation · **FIRE**
Complete the 14-object persistence schema for the objects MR-CAL didn't create (Source, Provision, Package, OpenItem, LibraryEntry, JurisdictionRule, SendabilityRule, AuditEvent as needed). Carry deletion/retention/client-file-return and a DR/backup posture for the matter-state spine (reviewer §3.4/§3.5).
*Acceptance:* schema complete; retention + backup posture defined. *Do-not-touch:* no destructive migration of existing tables.

### Phase 2 — Matter-State foundation (F.4; Layer 1 is the substrate — must land before Phase 3)

**FOLD-L1-1** · Implementation · **FIRE** · [gate G5]
Extend matter memory to full Layer 1: **source-of-truth tiers** (post-`FOLD-TIER-1`), disposition history, open-item registry — unifying the MR-CAL partial pieces (locked decisions, adopt ledger, evaluator, sendability) into one coherent Matter-State Engine.
*Acceptance:* engine reliably answers current-matter / operative-document / locked-decisions / adopted / unresolved / source-currency / safe-to-send.

**FOLD-L1-2** · Implementation · **FIRE**
Matter-memory injection service — every model call receives the current matter state (the "no cold reviews" precondition that makes multi-model disagreement signal, not noise).
*Acceptance:* no model call dispatches without current matter state injected.

**FOLD-L1-3** · Implementation · **FIRE**
Shared-context conversation substrate (Appendix C.6): thread + materials + state assembled into an "everyone up to speed" package per toggled-on lane (not a raw dump).
*Acceptance:* a toggled-in lane joins with coherent shared context on a fixture matter.

**FOLD-L1-4** · Implementation · **FIRE**
MM-8a reusable-template registry + MM-8b cross-matter invocation gate with anti-contamination controls (matter-only default; explicit opt-in per use).
*Acceptance:* cross-matter reference is explicit, scoped, and contamination-guarded.

**FOLD-L1-5** · Implementation · **FIRE** · [gate G6]
The **five explicit acts** as deliberate, visible, confirmable commitments (never ambient inference): (1) lock a decision, (2) tier a source, (3) disposition an item, (4) send, (5) matter identity (always-visible anchor). Plus the inspectable **matter-state dashboard**: matter-state summary, source-authority/baseline, decision log, open-items/blockers, sendability status, model-context-packet preview.
*Acceptance:* the five are explicit acts with visible surfaces; free-form holds for invocation, not for these five commitments. *Do-not-touch:* do not let any of the five be inferred from conversation.

### Phase 3 — Spec-novel layers (F.5; only after Phase 2 is solid)

**FOLD-L0-1** · Implementation · **FIRE** · [gate G8]
Layer 0 Matter Intake & Analysis: analysis-first front end producing a dispositioned assessment-and-plan (non-document closure). **Conflicts-at-intake built here** (minimum viable: parties / related / adverse / existing-matter lookup; warn + attorney disposition) — RPC-mandatory. **New-matter analysis defaults to Claude single-lane;** multi-lane is one-tap invocation (auto-suggested for high-stakes/novel/cross-jurisdictional).
*Acceptance:* a matter can open with analysis and close on a locked plan; conflicts lookup runs at intake; single-lane is the default. *Do-not-touch:* plan-only closure is exempt from the outbound sendability gate (nothing goes out) — make the exemption explicit.

**FOLD-KB-1** · Implementation · **FIRE** · [gate G9]
Practice Knowledge Base: migrate the tuned per-PA master prompts; practice-memo repository with staleness / currency / jurisdiction / privilege / abstraction metadata; retrieval + proactive surfacing. **Private-by-default; no automatic use in outbound legal assertions unless verified** — build "surface as potentially relevant, with currency/privilege warnings," not "auto-use my old memo."
*Acceptance:* KB cannot auto-inject into outbound work product; entries carry privilege + currency metadata; owner-scoped private by default.

**FOLD-ORCH-1** · Implementation · **FIRE**
Shared-context multi-model conversation: activate the MR-CAL-5B toggle; per-matter model toggle; auto-orchestration that **automates the labor, never the judgment**. **Constrain the convergent-bucket bulk-confirm** affordance — items require at least a scroll-acknowledge, not one-click bulk adopt (reviewer §1.3). Divergent items force per-item decisions.
*Acceptance:* synthesis is always proposed never applied; convergent bulk-adopt requires acknowledgment; divergent items cannot auto-close.

**FOLD-DRAFT-1** · Implementation · **FIRE**
Remaining MVP-1B drafting/audience primitives: LDD (LOI-vs-draft diff with key-term dictionaries), provision provenance, package bundle/closure, audience format/tone split (ATT-a auto-detect, ATT-b suggest-only), audience-leak filter.
*Acceptance:* per the synthesis MVP-1B acceptance criteria; attorney remains decision-maker.

**FOLD-SEND-1** · Implementation · **FIRE**
Upgrade sendability from the current **advisory classifier** to the target **block/warn/pass** deterministic gate. Blocks: wrong matter ID, stale baseline, missing required signer/open execution item, unverified statute citation in outbound legal assertion. Warnings: tone, optional package completeness, low-confidence library match. Document current-vs-target explicitly so no builder assumes the hard gate exists prematurely.
*Acceptance:* defined deterministic categories block; non-blockers warn; attorney override recorded.

### Phase 4 — Practice-management spine (F.6)

**FOLD-PM-1** Deadline / tickler engine (1031, contingencies, closing/recording, trust funding, corporate filings). · Implementation · **FIRE** (decision-authority/date-critical)
**FOLD-PM-2** PDF ingestion + extraction (text PDFs → OCR+confidence → document-type parsers for commitments/deeds/surveys/settlement statements). · Implementation · **FIRE** (new ingestion contract)
**FOLD-PM-3** Party / entity / contact model with cross-matter identity (underpins conflicts + persistent reference). · Implementation · **FIRE**
**FOLD-PM-4** Cross-matter portfolio / attention view (managing-attorney view). · Implementation · skip-triage (UI over existing data; likely score-skip unless it adds a query contract)

### Phase 5 — Integration, seeding, verification (F.7)

**FOLD-INTEG-1** External integrations — Gmail / Box / Drive / DocuSign / calendar. · Implementation · **FIRE** each (new external contract + egress surface)
**FOLD-SEED-1** Library seeding across the four STRONG practice areas; migrate the tuned per-PA master prompts. · Implementation · triage per entry
**FOLD-MIGRATE-1** Data migration if moving single-operator data into the multi-user model. · Implementation · **FIRE** (data mutation)
**FOLD-VERIFY-1** End-to-end Pattern-16 live verification against fixture matters: Adam White (advisory→draft + Layer 0), Dubin (package closure), Wios (redline/compare), Satterwhite engagement-letter chain (persistent reference). · Live verification

---

## Standing constraints (apply to every fold engagement)

1. **The five explicit acts never become ambient** — lock, tier, disposition, send, matter identity stay deliberate and visible.
2. **Automate the labor, never the judgment** — synthesis proposed, never applied; the attorney is always the final decision-maker.
3. **Build cards against actual code**, not the spec's clean slate (the build has diverged).
4. **Privilege minimization** — default to less egress (single-lane default; per-matter egress control); the shared-context mechanism is bounded by the FOLD-GOV-1 controls.
5. **Nothing client-facing** until Phase 1 (auth, owner key, governance/egress) and conflicts-at-intake (FOLD-L0-1) are live-verified.
6. All MR-CAL hard operating rules carry forward (7-command baseline, no broad staging, no destructive cleanup, no credential exposure, halt on scope expansion, evidence-class precision).

---

## Definition of fold complete

The fold is complete only when: auth + owner-key + governance/egress foundation is live-verified; the Layer 1 Matter-State Engine (tiers, injection, shared-context substrate, the five explicit acts) is solid and depended upon by the layers above it; Layer 0 intake + conflicts, the practice knowledge base, and shared-context auto-orchestration are live-verified; the sendability hard gate is live; the practice-management spine and integrations are built or formally deferred with rationale; the four fixture matters pass end-to-end Pattern-16 verification; and repo docs reflect the final state. Pre-fold gates G1–G9 are satisfied or explicitly waived with rationale.

End of fold master plan.
