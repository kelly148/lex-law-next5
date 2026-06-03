# FOLD-ORCH-1 — Phase-A Design Plan: Shared-Context Multi-Model Orchestration

Engagement: FOLD-ORCH-1 (Whereas fold Phase 3 / Appendix B). Type: Implementation (design artifact — pre-implementation). Checkpoint: **§3.1 FIRE** (re-flagged — establishes a NEW decision-authority / judgment-automation contract: convergent bulk-confirm acknowledgment + no auto-close of divergent items; not covered by FOLD-L1-3's substrate review). Status: **plan drafted; auto-assembled into `docs/reviews/FOLD-ORCH-1_packet.md` + phase2 mirror; HALTED for external triad review before any implementation.**
Date: 2026-06-03. Repo: `fold/phase-3-cont` branched from `main` `f7d81cc` (FOLD-L0-1 + KB-1 merged + deployed + live-verified).

> This is a **design proposal for review**, not a built artifact. No code until the triad disposition returns and the operator directs adopt/reject/blend. **The attorney is always the final decision-maker — orchestration automates the LABOR, never the JUDGMENT.**

---

## 1. Objective

Activate the **shared-context multi-model conversation** as deliberate orchestration: a per-matter model toggle, an attorney-invoked auto-orchestration that runs the configured lanes (the labor) and consolidates their feedback into **convergent** and **divergent** groupings, and an adoption surface that **automates the labor but never the judgment**. The load-bearing, FIRE-worthy contract (master-plan acceptance):

- **Synthesis is always PROPOSED, never APPLIED.**
- **Convergent bulk-adopt requires ACKNOWLEDGMENT** — at least a scroll-acknowledge, not a one-click bulk adopt (reviewer §1.3).
- **Divergent items cannot AUTO-CLOSE** — they force per-item attorney decisions.

Per the master plan, FOLD-ORCH-1 activates the MR-CAL-5B toggle + the per-matter model toggle + auto-orchestration. The deterministic block/warn/pass sendability gate is FOLD-SEND-1; drafting/audience primitives are FOLD-DRAFT-1.

## 2. Current substrate (code map, 2026-06-03)

The multi-model machinery already exists from MR-CAL-5/6/7 — ORCH-1 *activates and constrains* it, it does not build it from scratch:

- **Multi-reviewer + advisory evaluator (MR-CAL-5B/5C/5D):** `MULTI_REVIEWER_ENABLED` / `EVALUATOR_ENABLED` feature flags (`src/server/config/featureFlags.ts`); `reviewSession.create` fans out one reviewer job per selected reviewer and (when >1 reviewers + evaluator enabled) dispatches the **advisory evaluator**, which emits **per-suggestion dispositions** `adopt | reject | neutral` (+ optional `synthesisBody`) — `EvaluatorDispositionSchema` (`src/shared/schemas/phase4b.ts`), persisted to `feedback_evaluations`.
- **Adoption today:** **per-suggestion checkbox** in `ReviewPane.tsx`; selections autosave; `reviewSession.regenerate` commits `feedback_manual_selections` + `adopt_ledger` entries (disposition inferred: `adopted_verbatim` vs `adopted_modified`) and regenerates. **There is NO bulk-adopt affordance today** — every suggestion is an individual checkbox.
- **Evaluator icons** render per-suggestion (CheckCircle adopt / XCircle reject / Minus neutral). No convergent/divergent *bucketing* in the UI or persistence — grouping is implicit in the disposition enum.
- **Reviewer-model selection** is GLOBAL/user-level (`ReviewerEnablementSchema` in `user_preferences`; `REVIEWER_MODELS` claude/gpt/gemini/grok + Lite). **No per-matter model toggle today.** (`matters.paKey` drives the *drafter* PA-prompt, not reviewer selection.)
- **FOLD-L1-3 shared-context substrate:** `sharedContext.get` assembles a READ-ONLY "everyone up to speed" package (matter-state block + thread summary + materials metadata + lanes); **no durable conversation/thread table** — the thread is derived on-read from document versions.
- **Locked decisions (MR-CAL-6B) + adopt ledger (MR-CAL-7C):** injected into reviewer prompts ("do not re-raise" / "previously adopted"); ORCH-1 must respect these so orchestration never re-surfaces settled items.
- **Known reliability carryforwards:** Gemini invalid-JSON for structured output; intermittent reviewer empties/non-returns; a failed reviewer can leave a session stuck `active` (blocks the next create). Auto-orchestration MUST degrade gracefully around these.

## 3. Proposed design (additive, owner-scoped, attorney-final, automate-labor-not-judgment)

### 3.1 Per-matter model toggle (Fork C)
Add a per-matter reviewer-lane configuration: `matters.orchestrationLanes` (additive nullable JSON, or a thin `matter_orchestration` row) recording which reviewer lanes the attorney enabled for THIS matter, layered over the global `ReviewerEnablement` default. Never silently inferred; an explicit attorney act. Migration additive; existing matters fall back to the global default.

### 3.2 Auto-orchestration — labor only (Fork D)
An attorney-invoked **"run orchestration"** action that dispatches the matter's configured lanes (reuse the `reviewSession.create` fan-out + the canonical-mutation chokepoint) and runs the evaluator — **the labor**. It is **attorney-invoked, never auto-triggered**; it never adopts, never regenerates, never closes anything. Degrade-safe around the reliability carryforwards (a failed lane fails visibly and does not block the others or wedge the session).

### 3.3 Convergent / divergent consolidation (Fork B)
Define the two buckets deterministically over the evaluator output + reviewer agreement:
- **Convergent** = suggestions the reviewers broadly AGREE on (evaluator `adopt`, or N-of-M reviewer overlap above a threshold) — high-confidence, low-judgment.
- **Divergent** = suggestions where reviewers DISAGREE or the evaluator returns `neutral` / a judgment-call / business-decision — these are the highest-signal items.
The bucketing is **deterministic and explainable** (not another LLM call), computed from the persisted dispositions + per-suggestion reviewer overlap. **Fallback when there is no evaluator** (single reviewer, or evaluator disabled/failed): everything is treated as requiring per-item decision (no convergent bucket) — never silently bulk-confirm without consolidation.

### 3.4 The decision-authority contract (Fork A — the FIRE core)
- **Convergent bulk-confirm requires ACKNOWLEDGMENT.** The convergent bucket may be confirmed as a group, but ONLY after a deliberate acknowledgment — a scroll-through/expand-acknowledge of the items, not a single rubber-stamp click on a collapsed list. The affordance records that the attorney saw each item. (The exact mechanic — scroll-acknowledge vs per-item-but-grouped checkbox vs a typed/clicked attestation — is the central fork.)
- **Divergent items force per-item decisions.** Each divergent item is an individual decision (the existing per-suggestion checkbox); they **cannot be bulk-confirmed** and **cannot auto-close**. An undecided divergent item stays open (surfaces as an open item / blocks "done", per the matter-state open-items model) — it is never silently dropped.
- **Synthesis is proposed, never applied.** The evaluator's `synthesisBody` is shown as a PROPOSAL the attorney may adopt (recorded in the adopt ledger as an explicit act) — orchestration never writes it into the document itself.

### 3.5 Records + reuse (Fork G)
Every confirmation (convergent group + each divergent decision) flows through the existing `adopt_ledger` + `feedback_manual_selections` paths (provenance preserved), respects **locked decisions** ("do not re-raise") and the **adopt ledger** ("previously adopted"), and is auditable. No new outbound/egress contract; orchestration is internal review consolidation.

### 3.6 Scope, migrations, safety
- **Additive only.** Per-matter lane config is an additive column/table; consolidation is a deterministic read-projection over existing `feedback`/`feedback_evaluations`. No destructive migration.
- **Attorney-final / default-safe:** run-orchestration, convergent-acknowledge, each divergent decision, and synthesis-adopt are all explicit attorney acts; nothing is inferred or auto-applied. Flags stay default-OFF where they are today.
- **Degrade-safe** around reviewer/evaluator unreliability; a missing/failed evaluator collapses to all-per-item (the safe direction).

## 4. Acceptance (from the master plan)
Synthesis is always **proposed never applied**; **convergent bulk-adopt requires acknowledgment** (not one-click); **divergent items cannot auto-close** (per-item decisions). Plus: per-matter model toggle; auto-orchestration automates the labor (dispatch + consolidate) but never the judgment (adopt/regenerate stay explicit).

## 5. Forks for the triad (the load-bearing decisions to pressure-test)
- **FORK A — the decision-authority / acknowledgment mechanic (DECISION-AUTHORITY; the FIRE core):** what exactly is "acknowledgment" for convergent bulk-confirm — scroll-through-to-enable, per-item-grouped checkboxes, or a typed/explicit attestation? How do we prevent rubber-stamping (the failure mode: a one-click "adopt all" that defeats attorney-final) WITHOUT being so heavy it pushes attorneys back to ignoring the tool? Where exactly is the labor/judgment line drawn?
- **FORK B — convergent/divergent definition + the no-evaluator fallback:** is "convergent = evaluator `adopt` / reviewer-overlap-threshold; divergent = disagreement/`neutral`" the right deterministic rule? What threshold? Is collapsing to all-per-item the right fallback when the evaluator is absent/unreliable (Gemini JSON, stuck sessions)?
- **FORK C — per-matter model toggle vs global enablement:** add per-matter lane config over the global default, or keep global only? Migration/UX impact.
- **FORK D — auto-orchestration scope:** attorney-invoked "run orchestration" only (proposed) vs any auto-trigger — confirm there is NO auto-dispatch, and that "auto" means automating the dispatch+consolidate labor, never the decision.
- **FORK E — divergent open-item lifecycle:** an undecided divergent item — does it block "done" / surface as a matter-state open item, and how is "never auto-close" enforced across regenerations?
- **FORK F — synthesis handling:** is "synthesisBody shown as a proposal, adopt = explicit ledger act, never written to the document by orchestration" sufficient?
- **FORK G — interaction with locked decisions + adopt ledger + reliability:** orchestration must not re-raise settled items and must degrade safely around the known reviewer/evaluator failures.

## 6. Explicitly NOT in FOLD-ORCH-1 (deferred)
The deterministic block/warn/pass sendability gate (FOLD-SEND-1); drafting/audience primitives (FOLD-DRAFT-1); a durable conversation/thread table (L1-3 stays read-only derivation); new providers/adapters; fixing the underlying reviewer-reliability bugs (tracked separately — ORCH-1 degrades around them, it does not fix them); any new external/egress contract.

## 7. Constraints honored
Additive-only; owner-scoped; **attorney always final** (run / acknowledge / decide / adopt-synthesis are explicit acts); **automate the labor never the judgment**; synthesis proposed never applied; convergent bulk-confirm acknowledgment-gated; divergent items per-item, never auto-close; deterministic+explainable bucketing (no extra LLM in the consolidation); respects locked decisions + adopt ledger; degrade-safe around reviewer/evaluator unreliability; transactional-document-assembly scope; no new external integration/egress contract.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
