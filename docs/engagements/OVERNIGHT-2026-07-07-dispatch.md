# OVERNIGHT-2026-07-07 — autonomous batch dispatch (paste-ready for the Claude Code CLI)

**Author:** Cowork, 2026-07-07, operator-directed ("queue up the overnight build session; put everything in there that could possibly be built overnight; run autonomously without asking permission"). **Baseline:** `origin/main` ≈ `9b228c7` (Part B non-gift off-ramp #549 on top of #548/#547; docs PR #550 auto-merging on green; operator reports prod deploy of this line COMPLETE). Verify at run time with the 7-command baseline — and verify against **origin/main**, never the stale local scratch state.

---

## Run rules (read first; these ARE the autonomy contract)

1. **`run batch OVERNIGHT-2026-07-07`** — the fence is exactly the queue below, in order. NO mid-run operator questions. Rule 14 auto-advance between items.
2. **Auto-merge (Rule 15) applies ONLY to PRs that touch no protected surface** — no migrations, no new or changed flags (`featureFlags.ts` at all), no `.github/**`, no deploy/infra files, no egress/provider/auth changes, no self-flagged residuals. This is the operator-adopted compensating gate (GOV-MECH-1 red-team item 7, "ADOPT AND RECORD" 2026-07-07, `docs/reviews/GOV-MECH-1_redteam_consolidated_disposition_DRAFT.md`) — it is in force NOW, before the C-3 CLAUDE.md amendment lands.
3. **Everything else: BUILD IT ANYWAY** — open the PR, get CI green, mark it HOLD, list it in the morning digest with the exact gate it awaits, and **continue to the next item**. A held PR never stops the batch. Stack dependent increments on held branches where needed; they merge in order in the morning.
4. **Hard stops that survive tonight's autonomy directive** (waiving any would contradict the operator's own same-day ruling — tripwire): NO prod deploy; NO prod data mutation or cleanup; NO credential handling; NO merge of any CLAUDE.md change without operator diff approval; NO `engagement_state.json` membership write without the Rule-11 `y`; NO FIRE implementation without a recorded operator disposition (see item 3 below); NO live provider calls (mocked lanes only — zero API spend); NO browser/prod runs. `pause`/`hold` stops the chain.
5. Per item: §3.1 triage line → build → 3-lens adversarial self-review → green CI → merge-or-hold per rule 2/3 → Rule-16 upkeep. Per-increment close-outs are replaced by the single **morning digest** (A8 format) — that is the adopted batch format.
6. Skip-if-risky is pre-authorized for every item: skipping with a stated reason is always better than a mess at 3am. A finding that contradicts a prior accepted close-out HALTS the batch (tripwire, not a judgment call).

## The queue

### 1. GOV-MECH-1 v2 (`docs/engagements/GOV-MECH-1-dispatch.v2.md` — v2 supersedes v1)
- **C-1** — commit the untracked governing docs, exactly per v2 (docs-only; auto-merge). Include this dispatch file.
- **Part A `CI-LANE-GUARD-1`** — build fully per v2 (label-only operator-bound ack, whole-file featureFlags protection, rename/new-file globs, negative self-test). **PR = HOLD**: touches `.github/**`, and the adopted red-team item 5 requires the operator to review the guard logic itself before its first merge. Present the workflow diff in the digest.
- **Part B `FLAG-FLIP-RUNBOOK-1`** — build per v2 (evidence fields, CHAT_UI_1 hard-block row, coverage + schema validation + reverse lint). Docs + tests, no runtime change: **auto-merge on green.**
- **C-2** — PREPARE ONLY: produce the full before/after evidence table (field, old, new, evidence source, classification incl. OPERATOR-RESOLVE for FOLD-L0-1) and the proposed repaired JSON as a report artifact. **Do NOT write `engagement_state.json`** — the Rule-11 `y` is a morning item.
- **C-3** — PREPARE ONLY: author the CLAUDE.md amendment exactly per v2 (compensating gate verbatim, tripwire retained, pruned lines listed verbatim in the PR description), open the PR, **HOLD** — merge only on operator diff approval in the morning.

### 2. PHASE 1 FLAGSHIP — C4-C6 conversational matter page
**Operator authorization note:** the operator pasting THIS dispatch constitutes the roadmap's "execute C4-C6" (G-A dropped, G-B satisfied, C4a's G-A precondition void — `docs/WHEREAS_BUILD_ROADMAP_2026-07.md` gate block).
- **C.4a** substrate consolidation per `docs/engagements/C4a-substrate-consolidation-dispatch.md` + the C4-C6 brief (`docs/design/C4-C6_IMPLEMENTATION_BRIEF_DRAFT_2026-07-05.md`). No new flag expected → auto-merge on green if clean.
- **Continue in brief order as far as the night allows:** C.4b (matter conversation page — new flag `CONV_MATTER_PAGE_ENABLED` → **HOLD PR**), C.5a (rail + ambient capture — additive migration → **HOLD PR**), C.5b (drops → Materials), C.6a (draft verb routing chips + provenance), C.6b (verify verb: D4a Express ask + D4b panel-review-of-answer — **mocked lanes only**), C.6c (flag consolidation + G1–G9 render assertions). Stack dependent increments on the held branches.
- Binding: NC-C1-1..8; NC-PT-1..12 conformance (typed unverified-fact state, disposition-as-record, phase-sensitive verbs); zero drafting affordances in the conversation lane (grep + render tests); input-parity manifests on multi-lane surfaces; per-increment carry-eliminated statement (fold into the digest). A brief-flagged STOP (e.g. the D6 ephemeral-vs-durable conflict) stops the **C-chain only**, not the batch — record it and move to item 4.

### 3. DEED-MANUAL-LEGAL-DESC-1 gift path — APPROVED, BUILD IT
The external triad review is COMPLETE (3/3 approve-with-conditions) and the operator's checkpoint approval is carried in the batch kickoff prompt. Governing conditions: **G1–G12 plus non-gift delta N1 and N2-ADOPTED** in `docs/reviews/DEED-MANUAL-LEGAL-DESC-1_triad_disposition_2026-07-07.md` — read it in full before building; implement exactly to the conditions, no softening of G3 (affirmation w/ subject-property cross-check) or G10 (Express protected-span lock — this is the model-never-authors red line). Record G1 in the FIRE §7 spine documentation as the operator's express re-ratification exception, citing the disposition file. Complete Part 7 of the Desktop packet with the verdicts + operator decision. N1/N2: run the delta check on merged #549 and add the uniform affirmation component to the non-gift lanes. Reversible build-and-PR; deed agent stays flag-dark; auto-merge rules per run-rule 2 apply (no new flags expected — if one becomes necessary, HOLD the PR).

### 4. FL sweep (`docs/UAT_FIX_LIST_2026-07-05.md`)
Every FL item: closed (cite squash SHA) or carried with a reason, in the digest. Build the small reversible residuals now: FL-17 template Activate residual; the OCR-confidence display on the deed cure card (candidate dispatch noted 2026-07-07). Skip-if-risky per item.

### 5. NC-PT-11 rubber-stamping design engagement (design doc only)
Draft `docs/design/NC-PT-11_RUBBER_STAMPING_DESIGN_2026-07.md` — the Stage-2 second-attorney safeguard design the thesis disposition requires before any second user. Reports commit by default. No code.

### 6. Stretch (only if 1–5 are done; skip-if-risky)
OPS-DEADMAN-1, CI-side only: a failed/orphaned-job summary surfaced into the morning-digest path. Anything that would touch Railway config or deploy infra beyond CI = build + **HOLD PR**.

### 7. Close-out — ONE morning digest (A8 format)
PRs merged (SHAs); PRs **built-and-held** (each with the exact gate it awaits: CI-LANE-GUARD merge review, C-3 diff approval, C-2 `y`, held C4-C6 flag/migration PRs); migrations queued with apply-before-flip notes; flags introduced; self-flagged items; skips with reasons; the deferred-decisions list for the operator's morning pass. Rule-16: STATE.md entry + Desktop `_progress` mirror.

---

**Paste-to-start:** `run batch OVERNIGHT-2026-07-07 per docs/engagements/OVERNIGHT-2026-07-07-dispatch.md. Report the 7-command baseline against origin/main, then execute the queue in order under the dispatch's run rules. No mid-run operator questions; hold-don't-stop on gated PRs; one morning digest.`

---

*Cowork dispatch. The CLI is the sole builder. Autonomy is total inside the reversible lane; the four operator gates (deploy, C-2 y, C-3 diff, FIRE dispositions) are batched to morning, not waived — per the operator's own ADOPT AND RECORD ruling of this date.*
