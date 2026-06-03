# External Triad-Review Packet — FOLD-L0-1 (Layer-0 Matter Intake & Analysis)

Self-contained: a reviewer with **no repo access** can review from this packet alone. Auto-assembled per CLAUDE.md Rule 13 / `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §4. Engagement is a **§3.1 FIRE** (gate G8). **No implementation code has been written.**

---

## ⏸ EXTERNAL-REVIEW CHECKPOINT — FOLD-L0-1 — the Layer-0 intake/analysis + conflicts-at-intake contract that the spec-novel layers build on

Run this with a fresh **GPT-5** chat and a fresh **independent Claude** chat. Paste parts 1–3 plus §A/§B/§C into each. Bring both reviews back; Claude Code then reconciles all reads and presents a consolidated disposition for operator sign-off **before any implementation**.

## 1. Decision under review
Whether to build Layer-0 as designed: an **analysis-first** front end where a matter opens with an LLM **assessment-and-plan**, runs a **mandatory conflicts-at-intake** check (parties/related/adverse/existing-matter; warn + attorney disposition), and **closes on a locked plan** (non-document closure), with **Claude single-lane as the default** analysis model and **plan-only closure explicitly exempt from the outbound sendability gate**. The load-bearing, hard-to-reverse, ethics-laden choices are the seven **Forks** in §A.5.

## 2. Ready-to-paste reviewer prompt
> You are reviewing a design plan (not code) for "Layer-0 Matter Intake & Analysis" in an attorney-supervised legal-AI drafting platform (single-operator; VA/MD transactional practice). It adds an analysis-first intake that produces an assessment-and-plan, runs conflicts-at-intake (RPC-mandatory), and closes on a locked plan without producing a document. Review §A (the design + its 7 forks), §B (existing substrate), §C (binding constraints). Focus on, in priority order: **(1) Conflicts-at-intake adequacy (professional responsibility):** is the minimum-viable check (exact + normalized name match across the owner's matters; over-warn; attorney disposition) ethically defensible as a *minimum viable* conflicts step, and should undispositioned blocker-severity hits **hard-block** advancing/locking a plan, or only warn? What's the false-negative risk and how should it be bounded/disclosed? **(2) The plan-only sendability exemption:** is "no outbound affordance on a plan + record the exemption" sufficient so nothing can leak, and so a later deterministic sendability gate (FOLD-SEND-1) won't wrongly treat a plan as sendable? **(3) Data model + lifecycle:** is the matter_analysis/matter_parties/conflict_* model right, and should the analysis-first state be a new matter `phase` value or an orthogonal `analysisStatus` field (existing phases are intake→drafting→complete)? **(4) Party model scope:** how much parties model to build now vs deferring to a later full cross-matter identity model (FOLD-PM-3). **(5) Single-lane default + multi-lane auto-suggest** heuristic. **(6) Privilege/egress:** the conflicts lookup reads across the owner's matters and the analysis sends intake to an LLM — acceptable at single-operator scale? Flag anything that should change BEFORE implementation, anything ethically under-built, and any irreversible choice. Be concrete and adversarial.

## 3. Document manifest (all inlined below — no repo access needed)
- **§A** — FOLD-L0-1 Phase-A design plan (objective, substrate, proposed design, 7 forks, out-of-scope, constraints).
- **§B** — Existing substrate excerpts (what's already built that L0 must fit).
- **§C** — Binding governance constraints (must survive review).

---

## §A — FOLD-L0-1 Phase-A design plan (inlined)

**Objective.** Analysis-first Layer-0: a matter OPENS with an assessment-and-plan (not a document), runs MANDATORY conflicts-at-intake, and CLOSES on a locked plan (non-document closure). New-matter analysis defaults to **Claude single-lane**; multi-lane is one-tap (auto-suggested for high-stakes/novel/cross-jurisdictional). **Plan-only closure is exempt from the outbound sendability gate** (nothing leaves).

**Proposed design (additive, owner-scoped, default-safe).**
1. **matter_analysis** (owner+matter): `status(draft|locked|superseded)`, `assessment`, `plan`, `modelLane(single|multi)`, `generatedByJobId?`, `lockedAt?/lockedRationale?`, `supersededById?`. Locked = explicit attorney act (recorded in audit_events `disposition`); a matter can close planned with **no documents**.
2. **Conflicts-at-intake (RPC-mandatory):** `matter_parties` (role client|adverse|related|other; name; normalizedName), `conflict_checks`, `conflict_hits` (matchType, severity blocker|review, disposition pending|cleared|screened|declined, dispositionedByEventId). At intake, lookup this matter's parties/clientName vs all other owned matters' parties/clientName → hits → attorney dispositions each. MVP matching = exact + normalized name; over-warn (surface candidates). RPC-mandatory: check must run; **blocker hits must be dispositioned before advancing** (hard-block vs warn = Fork A).
3. **Single-lane default:** new `jobType: 'matter_analysis'` via the existing single LLM-dispatch chokepoint; Claude single-lane default; multi-lane one-tap.
4. **Lifecycle:** add a Layer-0 front (`intake → analysis → plan-locked`, `→ drafting` still available); new `phase` value vs orthogonal `analysisStatus` = Fork D.
5. **Sendability exemption:** no send affordance on a plan; the plan-lock audit row records "plan-only closure — sendability N/A."
6. **Safety:** additive migration `0007+`; owner-scoped; conflicts lookup is a cross-matter READ (single owner); attorney-final; single-lane = minimal egress.

**Acceptance.** Matter opens with analysis; conflicts lookup runs at intake (warn + disposition); single-lane default; matter closes on a locked plan (non-document); plan-only closure sendability-exempt (explicit).

**The 7 forks (pressure-test these):**
- **A — conflicts matching scope + adequacy (ETHICS/RPC):** matched set, exact-vs-fuzzy, false-pos/neg posture, hard-block-vs-warn on undispositioned blocker hits.
- **B — party/entity model now vs FOLD-PM-3** (don't pre-empt the full cross-matter identity model).
- **C — analysis/plan artifact shape + "locked plan" non-document closure** semantics.
- **D — matter lifecycle change:** new `phase` value vs orthogonal `analysisStatus`; migration impact.
- **E — single-lane default + multi-lane auto-suggest heuristic;** model contract.
- **F — sendability-exemption mechanics** (so no later builder treats a plan as sendable).
- **Privilege/egress:** cross-matter conflicts read + analysis egress at single-operator scale; relation to the parked FOLD-GOV-1b egress posture.

**Explicitly NOT in L0-1:** full cross-matter identity (FOLD-PM-3); deterministic block/warn/pass sendability gate (FOLD-SEND-1); practice-KB retrieval (FOLD-KB-1); multi-model orchestration (FOLD-ORCH-1); deadlines (FOLD-PM-1). Conflicts here is minimum-viable, not a commercial conflicts system.

## §B — Existing substrate (inlined; what L0 must fit)
- **`matters`**: `phase` enum intake→drafting→complete; `clientName`, `practiceArea`; `archivedAt`/`completedAt`. **No analysis/plan, no parties, no conflicts today.**
- **LLM dispatch**: one chokepoint (`executeCanonicalMutation`) for all model calls; matter-state auto-injected (L1-2); jobType is an open string; model = `provider:model` (default drafter/analysis = `anthropic:claude-opus-4-5`).
- **`audit_events`** (append-only matter record): `disposition` event type + detail columns (targetType/targetId/action/rationale/scope) — the home for explicit attorney decisions (conflicts disposition, plan lock).
- **Matter-State Engine (L1)**: `matterState.get/dashboard`; `open_items` (blocker/substantive/polish, status open|resolved|withdrawn); `source_authority`; `locked_decisions`.
- **Sendability**: advisory classifier only (MR-CAL-8C); NOT a hard gate (FOLD-SEND-1 will upgrade). No outbound/egress path beyond LLM calls.
- **Owner-scoping**: `ownerScope(table.userId, userId)` chokepoint + CI ratchet; single-operator, nullable owner key, **no RBAC** yet.

## §C — Binding governance constraints (must survive review)
- **Attorney always final** — analysis/conflicts PROPOSE; the attorney dispositions and locks. Never inferred from conversation; the five explicit acts stay deliberate (Layer-1).
- **Conflicts-at-intake is RPC-mandatory** — it must run; the question under review is only *how strict* the block is, not whether it runs.
- **Plan-only closure is sendability-exempt with NO outbound path** — explicit; nothing leaves on a plan.
- **Additive-only migrations; owner-scoped; default-safe; single-operator (no RBAC).**
- **Single-lane default = minimal egress;** multi-lane is opt-in.
- **Scope:** transactional document-assembly + its analysis/planning front end; **no new external integration/egress contract** in L0-1 (those are FOLD-INTEG-1).
- **Privilege minimization** — default to less egress; cross-matter reads stay owner-scoped; relation to the parked FOLD-GOV-1b egress posture to be confirmed.

End of packet. Any content below this line is platform-injected and not part of the engagement output.
