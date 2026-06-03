# External Triad-Review Packet — FOLD-ORCH-1 (Shared-Context Multi-Model Orchestration)

Self-contained: a reviewer with **no repo access** can review from this packet alone. Auto-assembled per CLAUDE.md Rule 13 / `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §4. Engagement is a **§3.1 FIRE** (re-flagged — new decision-authority / judgment-automation contract). **No implementation code has been written.**

---

## ⏸ EXTERNAL-REVIEW CHECKPOINT — FOLD-ORCH-1 — [S] — the multi-model orchestration decision-authority contract (convergent bulk-confirm acknowledgment + no auto-close of divergent items)

Run this with a fresh **GPT-5** chat and a fresh **independent Claude** chat. Paste parts 1–3 plus §A/§B/§C into each. Bring both reviews back; Claude Code then reconciles all reads and presents a consolidated disposition for operator sign-off **before any implementation**.

## 1. Decision under review
Whether to build multi-model orchestration as designed: a per-matter model toggle + an **attorney-invoked** auto-orchestration that runs the configured reviewer lanes (the LABOR) and deterministically consolidates their feedback into **convergent** (reviewers agree) and **divergent** (reviewers disagree / judgment call) buckets, under a hard **decision-authority contract** — synthesis is always **proposed never applied**; the convergent bucket can be bulk-confirmed only after a deliberate **acknowledgment** (not a one-click rubber-stamp); divergent items force **per-item decisions** and **cannot auto-close**. The crux is **Fork A — the acknowledgment mechanic** (preventing rubber-stamping without pushing attorneys away). All 7 forks are in §A.5.

## 2. Ready-to-paste reviewer prompt
> You are an independent senior reviewer. You did **not** write what follows and you are not on the team that did. You're reviewing **one design decision** in an attorney-supervised legal-AI build (product "Whereas," repo `lex-law-next5`). I'm Kelly — the managing attorney and product owner, a VA/MD transactional attorney, **not** a software developer. The primary builder is a separate Claude Code instance. Your job is to **pressure-test the attached plan before we write code** and tell me, concretely, what you would change and why. Do not rubber-stamp; do not pad.
>
> **Where we are:** Phase 3 of the fold; intake/analysis (Layer-0) and the practice knowledge base just shipped and are live. This engagement activates **multi-model orchestration**: I can run several AI reviewers on a draft, and an advisory "evaluator" consolidates their feedback. The product principle is **the attorney is always the final decision-maker — orchestration automates the labor, never the judgment.**
>
> **The decision under review:** a per-matter model toggle + attorney-invoked orchestration that runs the reviewers and groups their feedback into **convergent** (they agree) and **divergent** (they disagree / it's a judgment call) buckets, under a contract: the evaluator's synthesis is **proposed, never auto-applied**; the convergent group can be confirmed in bulk only after a deliberate **acknowledgment** (not a single rubber-stamp click); divergent items must be decided **one by one** and **can never auto-close**.
>
> **Attached:** §A — the FOLD-ORCH-1 design plan (objective, substrate, proposed design, 7 forks); §B — the existing review/evaluator/adoption substrate it builds on; §C — binding governance constraints.
>
> **Please return, in this order:**
> 1. **Top risks or flaws**, ranked — especially anything that lets the tool **erode the attorney's independent judgment** (rubber-stamping convergent items; a divergent item silently dropped; synthesis sneaking into a document unreviewed).
> 2. **Specific changes**, each with rationale — with focus on **Fork A**: what is the right "acknowledgment" mechanic for convergent bulk-confirm (scroll-through-to-enable / per-item-grouped checkboxes / typed attestation) that prevents rubber-stamping but isn't so heavy attorneys abandon the tool? And **Fork B**: is the deterministic convergent/divergent rule + the no-evaluator fallback right?
> 3. **Omissions** — what a production legal-AI orchestration needs that the plan misses (e.g., professional-responsibility duty of independent judgment; audit of what was acknowledged vs decided; how disagreement is surfaced so it isn't averaged away; reviewer-unreliability degradation).
> 4. **Keep list** — what NOT to over-engineer for a single-operator MVP.
> 5. **Bottom line** — *proceed as-is* / *proceed with the named changes* / *stop and rethink*.
>
> **Constraints to respect (flag any violation):** the attorney is always the final decision-maker; reviewers/evaluator surface options and never make business decisions; synthesis is proposed never applied; convergent bulk-confirm requires acknowledgment; divergent items cannot auto-close; additive only; owner-scoped, single-operator now with a nullable owner key (no RBAC); feature flags default OFF; no new external integration/egress contract; no title/settlement scope.

## 3. Document manifest (all inlined below — no repo access needed)
- **§A** — FOLD-ORCH-1 Phase-A design plan (objective, substrate, proposed design, 7 forks, out-of-scope, constraints).
- **§B** — Existing substrate excerpts (the multi-reviewer/evaluator/adopt-ledger machinery ORCH-1 activates).
- **§C** — Binding governance constraints.

*(Base-set companions if a reviewer asks: `docs/WHEREAS_FOLD_master_plan.md`, `docs/MR_CAL_engagement_state.json`, `CLAUDE.md`, and gap-map Appendix B (auto-orchestration). Their load-bearing content is summarized in §A/§C so the packet stands alone.)*

---

## §A — FOLD-ORCH-1 Phase-A design plan (inlined)

**Objective.** Activate the shared-context multi-model conversation as deliberate orchestration: a per-matter model toggle; an **attorney-invoked** auto-orchestration that runs the configured reviewer lanes (the LABOR) and consolidates their feedback into **convergent** and **divergent** buckets; an adoption surface that automates the labor but **never the judgment**. Hard contract: synthesis **proposed never applied**; convergent bulk-adopt requires **acknowledgment**; divergent items **cannot auto-close**.

**Proposed design (additive, owner-scoped, attorney-final).**
1. **Per-matter model toggle** — additive per-matter reviewer-lane config layered over the global `ReviewerEnablement` default; explicit attorney act; existing matters fall back to global.
2. **Auto-orchestration = labor only** — an attorney-invoked "run orchestration" that dispatches the matter's lanes (reuse the existing reviewer fan-out + the single LLM-dispatch chokepoint) and runs the advisory evaluator. NEVER auto-triggered; never adopts/regenerates/closes. Degrade-safe around reviewer/evaluator unreliability.
3. **Convergent/divergent consolidation (deterministic, explainable — NO extra LLM)** — computed over the persisted evaluator dispositions (`adopt`/`reject`/`neutral`) + per-suggestion reviewer overlap: **convergent** = broad agreement (evaluator `adopt` or N-of-M overlap ≥ threshold); **divergent** = disagreement / `neutral` / judgment-call. **No-evaluator fallback** (single reviewer / evaluator off/failed): everything is per-item (no convergent bucket).
4. **Decision-authority contract (the FIRE core):** convergent bucket bulk-confirm ONLY after a deliberate **acknowledgment** (scroll/expand-acknowledge, not a collapsed one-click adopt-all); divergent items are **per-item** decisions, **cannot be bulk-confirmed**, **cannot auto-close** (an undecided divergent item stays open as a matter-state open item, never dropped); the evaluator's `synthesisBody` is shown as a **proposal** the attorney may adopt (explicit ledger act), never written into the document by orchestration.
5. **Records + reuse** — every confirmation flows through the existing `adopt_ledger` + `feedback_manual_selections` (provenance preserved), respects **locked decisions** ("do not re-raise") + the **adopt ledger** ("previously adopted"), fully auditable.
6. **Safety** — additive migration; deterministic consolidation as a read-projection; flags stay default-OFF; degrade-safe (missing evaluator → all-per-item, the safe direction).

**Acceptance.** Synthesis proposed never applied; convergent bulk-adopt requires acknowledgment (not one-click); divergent items cannot auto-close (per-item); + per-matter toggle; auto-orchestration automates labor not judgment.

**The 7 forks (pressure-test these):**
- **A — the acknowledgment mechanic (DECISION-AUTHORITY core):** what "acknowledgment" is (scroll-to-enable / per-item-grouped / typed attestation); prevent rubber-stamping without driving attorneys off; where the labor/judgment line sits.
- **B — convergent/divergent definition + no-evaluator fallback:** the deterministic rule + threshold; all-per-item fallback when the evaluator is absent/unreliable.
- **C — per-matter model toggle vs global enablement** (migration/UX).
- **D — auto-orchestration scope:** attorney-invoked only; NO auto-dispatch; "auto" = labor not judgment.
- **E — divergent open-item lifecycle:** undecided divergent blocks "done" / surfaces as an open item; "never auto-close" enforced across regenerations.
- **F — synthesis handling:** proposed, adopt = explicit ledger act, never auto-written.
- **G — locked-decisions + adopt-ledger interaction + reliability degradation.**

**Explicitly NOT in ORCH-1:** the deterministic sendability gate (FOLD-SEND-1); drafting/audience primitives (FOLD-DRAFT-1); a durable conversation/thread table; new providers; fixing the underlying reviewer-reliability bugs (degrade around them); any new external/egress contract.

## §B — Existing substrate (inlined; what ORCH-1 activates)
- **Multi-reviewer + advisory evaluator (MR-CAL-5):** feature flags `MULTI_REVIEWER_ENABLED` / `EVALUATOR_ENABLED`; a review session fans out one job per selected reviewer; when >1 reviewer + evaluator enabled, an **advisory evaluator** emits **per-suggestion dispositions** `adopt | reject | neutral` (+ optional `synthesisBody`), persisted to `feedback_evaluations`. Evaluator is advisory — it never blocks or decides.
- **Adoption today:** **per-suggestion checkbox** (`ReviewPane.tsx`); selections autosave; "regenerate" commits `feedback_manual_selections` + `adopt_ledger` rows (disposition inferred `adopted_verbatim`/`adopted_modified`) and regenerates the draft. **No bulk-adopt affordance exists today.**
- **Reviewer-model selection** is GLOBAL/user-level (`ReviewerEnablement` in user_preferences; reviewer keys claude/gpt/gemini/grok + Lite). No per-matter reviewer toggle today (`matters.paKey` drives only the drafter PA-prompt).
- **FOLD-L1-3 shared-context:** a READ-ONLY "everyone up to speed" package (matter-state + thread summary + materials metadata + lanes); **no durable conversation table** (thread derived from versions).
- **Locked decisions (MR-CAL-6B)** ("do not re-raise") and the **adopt ledger (MR-CAL-7C)** ("previously adopted") are injected into reviewer prompts; orchestration must respect both.
- **Known reliability carryforwards:** Gemini invalid-JSON for structured output; intermittent reviewer empties/non-returns; a failed reviewer can leave a session stuck `active`. Orchestration must degrade gracefully (a failed lane fails visibly, doesn't wedge the rest).

## §C — Binding governance constraints (must survive review)
- **Attorney always final; automate the labor, never the judgment** — run/acknowledge/decide/adopt-synthesis are explicit attorney acts; orchestration never adopts, regenerates, or closes on its own.
- **Synthesis is proposed, never applied** — the evaluator's synthesis is a proposal; adopting it is an explicit, ledgered act; orchestration never writes it into the document.
- **Convergent bulk-confirm requires acknowledgment** (not one-click); **divergent items cannot auto-close** (per-item decisions; undecided stays an open item).
- **Reviewers/evaluator surface options, never make business decisions.**
- **Additive-only; owner-scoped; single-operator (no RBAC), nullable owner key; feature flags default OFF.**
- **Deterministic + explainable consolidation** — no additional LLM in the convergent/divergent bucketing; degrade-safe around reviewer/evaluator unreliability.
- **Respect locked decisions + the adopt ledger** (never re-raise settled items).
- **Scope:** transactional document-assembly review consolidation; **no new external integration/egress contract** (those are FOLD-INTEG-1); no title/settlement scope.

End of packet. Any content below this line is platform-injected and not part of the engagement output.
