# GOV-MECH-1 — red-team review packet (discretionary pre-dispatch review)

**Date:** 2026-07-07. **Assembled by:** Cowork lane, operator-directed. **Status:** discretionary quality pass — NOT a §3.1 FIRE checkpoint. The underlying recommendations are already operator-adopted; this review targets the DISPATCH DRAFTING ONLY: does the dispatch faithfully and safely implement what was adopted, before it is handed to the builder?

---

## READY-TO-PASTE REVIEWER PROMPT

You are an independent reviewer with no access to the project repository. Everything you need is in this packet. Do not assume facts not stated here.

**Context (minimal).** A solo attorney (Virginia/Maryland, title + transactional practice) is building "Whereas," an attorney-supervised legal-AI drafting/review platform, as a Stage-1 personal tool. One AI coding agent (Claude Code CLI) is the sole code builder, operating under a governance file (CLAUDE.md) with hard gates: additive-only migrations, default-OFF feature flags, merge-to-main ≠ deploy (deploy is always operator-gated), an auto-merge rule (Rule 15) for a "reversible build-and-PR lane," a print-and-wait gate on state-file membership changes (Rule 11), a report-commit gate (Rule 12), per-phase integration branches (Rule 17), and a triad-review FIRE checkpoint (§3.1) for load-bearing/irreversible/ethics-adjacent decisions. A 2026-07-07 outside audit + two red-team reviews produced numbered recommendations; the operator adopted ALL of them (decision record inlined below as DOCUMENT 2). A dispatch (DOCUMENT 1) was then drafted to have the builder implement the adopted governance mechanization. The operator wants YOUR adversarial review of the dispatch BEFORE it is handed to the builder.

**Your task.** Red-team DOCUMENT 1 (the dispatch) against DOCUMENT 2 (the adopted decision record). Answer these questions specifically:

1. **Fidelity:** Does each Part (A, B, C) faithfully implement its adopted item(s) (A1, A2, A5–A9)? Identify any drift, omission, or silent scope expansion.
2. **Loopholes in the CI lane-guard (Part A):** The guard's purpose is to stop the builder from self-certifying that a PR is "reversible." Can the builder — accidentally or through goal-directed drift — bypass it? Consider: who can apply the ack label/title marker; the guard's own workflow file being one of the protected paths; renamed/moved files; new deployment-config files not on the list; the featureFlags.ts "default values only if cheaply detectable" carve-out; anything else.
3. **Runbook drift (Part B):** Will the flag-precondition table stay true over time? Is the "parse both, keep it dumb" coverage test likely to rot or give false confidence?
4. **State repair risks (Part C):** C-2 rewrites a state-tracking JSON once, then demotes it. C-3 amends the governance file itself (diff-gated by the operator). Does the amendment list open any new gap — especially the combination of: Rule 11 narrowed to reclassifications only, Rule 12 retired (reports auto-commit), Rule 17 retired (no phase branches), morning-digest replacing per-engagement close-outs for batch runs, and pruning of the confirmation-gate list? Could these, combined with Rule 15 auto-merge, let an unattended overnight batch do something the operator would have wanted gated?
5. **Ordering:** the dispatch says A → B → C, with C-1 (commit untracked governing docs) movable to first. Is anything ordered dangerously?
6. **Anything else** a careful reviewer should flag: ambiguity a builder could misread, missing acceptance criteria, single points of failure.

**Output format (mandatory):**
- Verdict line: `ADOPT-AS-DRAFTED` / `ADOPT-WITH-CHANGES` / `REDRAFT`
- Numbered findings, each labeled `BLOCKER` / `MAJOR` / `MINOR`, each citing the specific dispatch text and stating a concrete fix.
- Maximum 12 findings. No praise padding. If a question above yields nothing, say "no finding" in one line.

---

## DOCUMENT 1 — the dispatch under review (verbatim)

# GOV-MECH-1 — dispatch (paste-ready for the Claude Code CLI)

**Author:** Cowork, 2026-07-07, operator-directed. **Authority:** operator ruling "Accept all recommendations" on `docs/reviews/OUTSIDE-REVIEW-DISPOSITION-1_2026-07-07.md` (disposition block at the end of that file; read it first — it is the governing decision record). **Goal:** mechanize the governance safety items adopted from the 2026-07-07 outside reviews + fresh-eyes audit, BEFORE the next unattended overnight batch. Three parts, each its own PR, in this order. Run after DEED-STAGE1-SIMPLE-1 completes; 7-command baseline first; §3.1 triage line per part.

**Sequencing note:** Part C's first action (commit the untracked July docs) protects everything else — do C-1 first if you judge the working tree at risk, otherwise A → B → C is fine.

## PART A — `CI-LANE-GUARD-1` (closes disposition A1; reversible build-and-PR)

**Problem:** Rule 15's auto-merge condition (iv) ("no residual risk was flagged") is self-certified by the model seeking the merge. The reversible lane must be enforced mechanically, not asserted.

**Change:** add a CI job (`reversible-lane-guard`) to `.github/workflows/ci.yml` that runs on every PR and FAILS when the diff touches any protected path, unless the PR carries an explicit operator-visible acknowledgment (label `lane:non-reversible-ack` or a `[NON-REVERSIBLE]` title marker — builder's choice, but it must be something the operator applies deliberately, not something the builder can add silently in the same automated flow; state your choice and its rationale in the close-out).

**Protected paths (initial set):**
- `src/server/db/migrations/**`
- `src/server/db/schema.ts`
- `scripts/apply-prod-migrations.mjs`
- `railway.json`, `nixpacks.toml`, `Dockerfile`
- `.github/workflows/**` (self-protecting; the guard's own PR is the last unguarded change)
- `tools/deploy/**`
- `src/server/config/featureFlags.ts` — **default values only if cheaply detectable; otherwise the whole file** (a new default-OFF flag then needs the ack marker — acceptable friction; note it)

**Acceptance (Part A):** a test PR (or workflow-level unit test) demonstrates: docs-only diff passes; a diff touching a migration file without the ack fails; the same diff with the operator ack passes. CI green. Close-out states which manual carry this eliminates: the operator's need to eyeball every "reversible" claim before trusting auto-merge.

**FIRE triage (Part A): skip** — additive CI job, fully reversible, no gate-semantics or egress change; it only ADDS a failure mode to CI.

## PART B — `FLAG-FLIP-RUNBOOK-1` (closes disposition A2; reversible build-and-PR)

**Problem:** a prod flag flip is a behavior change with no PR, no CI, no review. Config drift already caused the D3-enforce incident, and at least one live booby-trap exists (`CHAT_UI_1_ENABLED` flipped on prod would hit deliberately-unapplied migrations 0028/0029).

**Change:**
1. Create `docs/FLAG_FLIP_RUNBOOK.md`: the per-flip checklist — (1) migration precondition verified against prod schema; (2) partner-flag check; (3) post-flip smoke step named; (4) revert step named; (5) STATE.md line recorded. Short, operational, no prose padding.
2. Add a **per-flag precondition table** (in the runbook): for EVERY flag in `featureFlags.ts` — required migrations (or "none"), partner flags (e.g. `REVIEWER_ASYNC_ENABLED` → `JOB_REAPER_ENABLED`; `CHAT_COPILOT_ENABLED` → `GROUNDED_CHAT_PROVIDERS` populated; the 5-flag chat chain), known booby-traps (0028/0029), smoke check, revert step.
3. Add a test that FAILS when a flag exists in `featureFlags.ts` but not in the runbook table (parse both; keep it dumb and robust). This makes the table self-maintaining: a new flag without a runbook row breaks CI.

**Acceptance (Part B):** table covers 100% of current flags; the coverage test proves it (and proves failure on a synthetic missing flag); CI green. Carry eliminated: the operator re-deriving flip preconditions from code and memory at each activation.

**FIRE triage (Part B): skip** — docs + a test; zero runtime change.

## PART C — `STATE-TRUTH-1` (closes disposition A7 + the CLAUDE.md amendment for A5/A6/A8/A9; multiple gates — read carefully)

**C-1 — Commit the untracked governing docs (do this first).** `docs/WHEREAS_BUILD_ROADMAP_2026-07.md`, `COWORK_MAP.md`, the July dispatches (`DEED-EXPORT-409-1`, `DEED-STAGE1-SIMPLE-1`, `C4a-substrate-consolidation`, this file), `docs/reviews/FRESH-EYES-AUDIT-1_2026-07-07.md`, `docs/reviews/OUTSIDE-REVIEW-DISPOSITION-1_2026-07-07.md`, and the July design docs under `docs/design/` if any are untracked. Explicit per-file staging (no `add -A`). Inventory-and-report any other untracked files; do not delete anything.

**C-2 — engagement_state.json one-time repair.** Fix: stale prod pin (`4e07e51` → current); phantom `in_progress_engagement` CHAT-COPILOT-1; obsolete FOLD queue (replace with a pointer to the roadmap phases); `blocked_engagements` staleness; the FOLD-L0-1 verified-contradiction — **do NOT resolve the contradiction yourself: record both claims and mark `OPERATOR-RESOLVE`** (tripwire discipline). Under amended Rule 11 this rewrite is decision-bearing membership change → **print the transition summary and wait for `y`.** After repair, add a header line demoting the file: "Generated/secondary; docs/STATE.md is authoritative; do not hand-maintain."

**C-3 — CLAUDE.md amendment PR (diff-gated — operator must approve the diff before merge, per standing rule).** One PR containing exactly:
- Replace the "Current state (as of …)" block with a two-line pointer: current state lives at the top of `docs/STATE.md`; never trust a dated header block.
- Rule 11 narrowed per disposition A5: `y`-gate only for reclassifications (skip / defer / risk-accept / ACCEPTED_RISK); routine adds and moves-to-completed run free.
- Rule 12 retired per A6: all reports commit by default.
- Rule 15 supplemented per A1: auto-merge additionally requires the `reversible-lane-guard` CI job green (mechanical lane enforcement).
- Rule 17 retired per A9: engagements land on `main` via per-engagement PRs (ratifies existing practice); per-phase branches no longer used.
- Morning-digest format per A8: for batch runs, one digest per run (PRs merged w/ SHAs, migrations queued, flags introduced, self-flagged items, deferred decisions) replaces per-engagement 15-item close-outs; non-batch engagements keep the current format.
- Boundary statement RETAINED (A4 — no change).
- Prune the confirmation-gate list entries that the amendments supersede (branch push / PR open lines that contradict autopilot; the Rule 17 merge language).

**Acceptance (Part C):** C-1 files on `main`; C-2 repaired file carries the demotion header and the OPERATOR-RESOLVE marker; C-3 merged only after operator diff approval; STATE.md + Desktop mirror updated per Rule 16. Carry eliminated: every fresh session (and every outside reviewer) re-deriving true state from five contradictory representations.

**FIRE triage (Part C): skip** — docs/bookkeeping; no runtime behavior. Gates that DO apply: Rule 11 print-and-wait on C-2; operator diff approval on C-3.

## Explicitly out of scope for this dispatch

Operator-only items from the disposition: A3 rollback drill; A11 attended clone repair (separate attended session — do NOT attempt clone surgery inside this dispatch); B4 carrier date. Cowork-lane items: Phase 3 design draft, RESEARCH-LANE-1 packet, ZDR/DPA memo. EGRESS-UNIFY-1 is a separate future design engagement with its own §3.1 triage — do not start it here.

**Paste-to-start:** `Execute docs/engagements/GOV-MECH-1-dispatch.md. Read docs/reviews/OUTSIDE-REVIEW-DISPOSITION-1_2026-07-07.md first (governing decision record). Report repo state, then Part A → Part B → Part C in order (or C-1 first if the working tree is at risk). Honor the Rule-11 wait on C-2 and the operator diff gate on C-3.`

*Cowork dispatch. The CLI is the sole builder. Parts A and B are reversible build-and-PR; Part C carries two explicit operator gates.*

---

## DOCUMENT 2 — the adopted decision record (relevant sections, verbatim)

**A1 — Mechanize the reversible lane. ADOPT.** Rule 15 condition (iv) is self-graded: auto-merge requires "no residual risk was flagged," certified by the same model seeking the merge. Fix: a CI job that FAILS any PR claiming the reversible lane if its diff touches `src/server/db/migrations/**`, `railway.json`, `nixpacks.toml`, `.github/**`, `scripts/apply-prod-migrations.mjs`, `tools/deploy/**`, or featureFlags.ts default values. Lane membership becomes enforced, not asserted.

**A2 — Flag-flip runbook. ADOPT.** A prod flag flip is a behavior change with no PR, no CI, no review, and flag/config drift has already caused one prod incident (D3 enforce) and one booby-trap exists today (CHAT_UI_1 flip would hit deliberately-unapplied migrations 0028/0029). Adopt a per-flip checklist: (1) migration precondition verified against prod schema; (2) partner-flag check; (3) smoke immediately after; (4) named revert step; (5) STATE.md line.

**A5 — Rule 11 print-and-wait-`y`: ADOPT-NARROWED.** Membership writes that RECLASSIFY (skip, defer, risk-accept) are decision-bearing. Narrow the gate to reclassifications only; routine adds/moves-to-completed run free.

**A6 — Rule 12 (report-commit gating): ADOPT kill.** Reports are append-only markdown in git; gating their commit buys nothing. All reports commit by default.

**A7 — Consolidate state representations. ADOPT.** Five representations of one fact set; the auto-loaded one is the stalest. Actions: (i) replace the CLAUDE.md "Current state" block with a two-line pointer to STATE.md top; (ii) repair engagement_state.json once (stale prod pin, phantom in-progress CHAT-COPILOT-1, obsolete FOLD queue, FOLD-L0-1 verified-contradiction) then demote it to generated-or-retired; (iii) keep STATE.md + one Desktop mirror; (iv) commit COWORK_MAP.md and the July roadmap/dispatches.

**A8 — Morning digest for batch runs. ADOPT.** For overnight batches, replace per-engagement 15-item close-outs with one digest per run: PRs merged w/ SHAs, migrations queued, flags introduced, self-flagged items, decisions deferred. Individual engagements outside batches keep the current format. Pairs with the audit's OPS-DEADMAN-1 (failed/orphaned-job summary pushed out-of-band) — the digest model only works if failures surface in it.

**A9 — Rule 17 phase branches: RETIRE (ratify existing practice).** July practice already lands engagements on main per-PR. Ratify reality.

**A10 — Keep verbatim (reaffirm):** 7-command baseline; no `add -A`; no `reset --hard`; credential rule; contradiction tripwire; evidence-class language; additive-only migrations; default-OFF flags; merge ≠ deploy; §3.1 three-prong FIRE test.

**Operator ruling:** "Accept all recommendations" — A1/A2/A7 as CLI engagements; A5/A6/A8/A9 as one diff-gated CLAUDE.md amendment PR; A3 (rollback drill) and A11 (attended clone repair) are operator-only; EGRESS-UNIFY-1 and the research lane are separate, out of scope here.

---

## Review legs and returns

- **Leg 1 — GPT (browser, operator's account):** return to be appended to `GOV-MECH-1_redteam_returns.md`.
- **Leg 2 — Grok (browser, operator's account):** same.
- **Consolidation:** Cowork drafts a consolidated disposition for the operator; the operator rules. Nothing in this review self-executes.

*Cowork lane. New file; no existing docs modified. This packet is append-only once reviews are collected.*
