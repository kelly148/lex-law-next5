# FOLD-L0-1 — Phase-A Design Plan: Layer-0 Matter Intake & Analysis

Engagement: FOLD-L0-1 (Whereas fold Phase 3 / F.5). Type: Implementation (design artifact — pre-implementation). Checkpoint: **§3.1 FIRE** (gate G8 — introduces conflicts-at-intake [RPC-mandatory ethics], an analysis-first intake/closure model, and a plan-only sendability exemption; hard to reverse, not CI-caught, ethics/client-send-safety risk). Status: **plan drafted; auto-assembled into `docs/reviews/FOLD-L0-1_packet.md`; HALTED for external triad review before any implementation.**
Date: 2026-06-03. Repo: `fold/phase-3` branched from `main` `9edfef8`.

> This is a **design proposal for review**, not a built artifact. No code is written until the triad disposition returns and the operator directs adopt/reject/blend. The attorney is the final decision-maker; **conflicts disposition and plan closure are explicit attorney acts, never inferred.**

---

## 1. Objective

Add an **analysis-first Layer-0 front end**: a matter can OPEN with an *assessment-and-plan* (not a document), run a **mandatory conflicts-at-intake** check, and CLOSE on a **locked plan** (non-document closure). New-matter analysis **defaults to Claude single-lane**; multi-lane is one-tap (auto-suggested for high-stakes / novel / cross-jurisdictional). **Plan-only closure is explicitly exempt from the outbound sendability gate** (nothing leaves).

Per the master plan, FOLD-L0-1 builds the Layer-0 intake/analysis + conflicts contract. The practice knowledge base is FOLD-KB-1; the full cross-matter party/entity identity model is FOLD-PM-3; the deterministic block/warn/pass sendability gate is FOLD-SEND-1; multi-model orchestration is FOLD-ORCH-1.

## 2. Current substrate (code map, 2026-06-03)

- **`matters`**: lifecycle `phase` intake→drafting→complete (+ `archivedAt`/`completedAt`); `clientName`, `practiceArea`. **No analysis/plan artifact, no parties model, no conflicts check.**
- **LLM jobs**: all dispatch through `executeCanonicalMutation` (single chokepoint; matter-state injected per L1-2). Job types are an open set (`jobs.jobType`); model selection via `provider:model` strings.
- **`audit_events`** (L1-1, append-only matter record) — `disposition` event type + detail columns; the home for explicit attorney decisions.
- **Matter-State Engine** (L1) — `matterState.get`/`dashboard`; `locked_decisions` ("do not re-raise"); `open_items` registry; `source_authority`.
- **Sendability**: advisory classifier only (MR-CAL-8C) — **not** a hard gate yet (FOLD-SEND-1 upgrades it). No outbound/egress contract beyond LLM provider calls.
- **No party/entity table** (only `matters.clientName`); **no conflicts mechanism**.

## 3. Proposed design (additive, owner-scoped, default-safe)

### 3.1 Intake/analysis + plan artifact (Fork C)
New owner+matter-scoped table **`matter_analysis`**: the assessment-and-plan. Sketch: `id, userId, matterId, status('draft'|'locked'|'superseded'), assessment (JSON/text — issue-spotting, posture, risks, jurisdiction), plan (structured recommended steps), modelLane('single'|'multi'), modelsUsed, generatedByJobId?, lockedAt?, lockedRationale?, supersededById?, timestamps`. **"Close on a locked plan"** = `status='locked'` via an explicit attorney act (recorded in `audit_events` as a `disposition`). A matter can reach a planned/closed state with **no documents** (non-document closure).

### 3.2 Conflicts-at-intake — RPC-mandatory (Fork A + Fork B)
New owner-scoped tables:
- **`matter_parties`** (minimum-viable party representation): `id, userId, matterId, role('client'|'adverse'|'related'|'other'), name, normalizedName, notes?`.
- **`conflict_checks`**: `id, userId, matterId, runAt, status('clear'|'hits_pending'|'dispositioned')`.
- **`conflict_hits`**: `id, userId, checkId, matterId(this), matchedMatterId, matchedPartyId?, matchType('client_name'|'party_exact'|'party_normalized'|'adverse'), severity('blocker'|'review'), disposition('pending'|'cleared'|'screened'|'declined'), dispositionRationale?, dispositionedByEventId?`.

At intake, a check runs: **this matter's parties (and `clientName`) vs every other owned matter's parties/`clientName`** → produces hits → the attorney **dispositions each** (warn + disposition). **RPC-mandatory** posture (Fork A): the check MUST run at intake, and the matter cannot advance past intake / cannot lock a plan while **blocker-severity hits are undispositioned**. Matching (MVP): exact + normalized (case/whitespace/punctuation) name match; **fuzzy is a fork**. False-positive posture: **over-warn** (surface candidates; the attorney clears) — under-warning is the ethics risk.

### 3.3 Single-lane default analysis (Fork E)
Analysis runs via `executeCanonicalMutation` as a new `jobType: 'matter_analysis'`, **Claude single-lane by default**. Multi-lane is one-tap (the MR-CAL-5B multi-reviewer toggle pattern), **auto-suggested** when the intake is flagged high-stakes / novel / cross-jurisdictional (the heuristic is a fork). Single-lane default = minimal egress.

### 3.4 Matter lifecycle (Fork D)
Add a Layer-0 front to the phase model: `intake → (analysis) → plan-locked`, with `→ drafting` still available. Two candidate shapes (fork): (a) a new `phase` value (`'analysis'`/`'planning'`) + a plan-closure terminal, or (b) a separate `analysisStatus` field orthogonal to `phase` (lower blast radius on existing phase logic). Migration must leave existing matters valid.

### 3.5 Sendability exemption — do-not-touch (Fork F)
Plan-only closure is **EXEMPT** from the outbound sendability gate, made explicit: there is **no outbound/send affordance on a plan**, and the plan-lock `audit_events` row records "plan-only closure — sendability N/A." This is documented so no later builder (esp. FOLD-SEND-1) assumes a plan can be sent.

### 3.6 Scope, migrations, safety
- **Additive only.** New migration `0007+` (matter_analysis, matter_parties, conflict_checks, conflict_hits). No destructive/altering migration of existing tables' data; lifecycle change (3.4) additive. Out-of-band prod apply (now via the Rule-18 pre-deploy runner; **additive-only** path — these qualify).
- **Owner-scoped** via `ownerScope`/`assertOwned`; the conflicts lookup is a **cross-matter READ** (all within one owner at single-operator scale) — same privilege-concentration consideration as L1-4; confirm owner-scoping is sufficient (Fork / privilege).
- **Attorney-final / default-safe**: conflicts disposition and plan lock are **explicit attorney acts** (audit_events `disposition`), never inferred. Analysis proposes; the attorney decides.
- **Scope line**: Layer-0 is analysis/planning (the front end to transactional document-assembly); no new external/egress contract beyond the single-lane LLM analysis call.

## 4. Acceptance (from the master plan)
A matter can **open with analysis** and **close on a locked plan** (non-document); **conflicts lookup runs at intake** (parties / related / adverse / existing-matter; warn + attorney disposition); **single-lane is the default**. **Do-not-touch:** plan-only closure is exempt from the outbound sendability gate — the exemption is explicit.

## 5. Forks for the triad (the load-bearing decisions to pressure-test)
- **FORK A — conflicts matching scope + adequacy (ETHICS / RPC):** what is matched (parties/related/adverse/existing-matter), exact-vs-fuzzy, false-positive/negative posture, and **whether undispositioned blocker hits HARD-BLOCK proceeding** vs warn-only. This is the professional-responsibility core.
- **FORK B — party/entity model now vs FOLD-PM-3:** how much of a parties model to build to make conflicts real **without pre-empting** PM-3's full cross-matter identity model.
- **FORK C — analysis/plan artifact shape + "locked plan" closure** semantics (non-document closure).
- **FORK D — matter lifecycle change:** new `phase` value vs orthogonal `analysisStatus`; migration impact on existing matters.
- **FORK E — single-lane default + multi-lane auto-suggest heuristic** (high-stakes/novel/cross-jurisdictional); the model contract.
- **FORK F — sendability-exemption mechanics:** how the exemption is recorded/enforced so no later builder assumes a plan is sendable.
- **Privilege/egress:** cross-matter conflicts read + analysis egress (single-lane default) — confirm owner-scoping sufficient at single-operator scale; relation to the parked FOLD-GOV-1b egress posture.

## 6. Explicitly NOT in FOLD-L0-1 (deferred)
Full party/entity model + cross-matter identity (FOLD-PM-3); the deterministic block/warn/pass sendability gate (FOLD-SEND-1); practice-KB retrieval (FOLD-KB-1); multi-model orchestration beyond the one-tap toggle (FOLD-ORCH-1); deadline/tickler (FOLD-PM-1). Conflicts here is **minimum-viable** (parties/related/adverse/existing-matter lookup + disposition), not a commercial conflicts system.

## 7. Constraints honored
Additive-only; owner-scoped chokepoint; attorney always final (conflicts disposition + plan lock are explicit acts); default-safe; conflicts-at-intake RPC-mandatory; plan-only closure sendability-exempt with no outbound path; single-lane default = minimal egress; transactional-document-assembly scope respected (Layer-0 is the analysis/planning front end).

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
