# GOV-MECH-1 — dispatch (paste-ready for the Claude Code CLI)

**Author:** Cowork, 2026-07-07, operator-directed. **Authority:** operator ruling "Accept all recommendations" on `docs/reviews/OUTSIDE-REVIEW-DISPOSITION-1_2026-07-07.md` (disposition block at the end of that file; read it first — it is the governing decision record). **Goal:** mechanize the governance safety items adopted from the 2026-07-07 outside reviews + fresh-eyes audit, BEFORE the next unattended overnight batch. Three parts, each its own PR, in this order. Run after DEED-STAGE1-SIMPLE-1 completes; 7-command baseline first; §3.1 triage line per part.

**Sequencing note:** Part C's first action (commit the untracked July docs) protects everything else — do C-1 first if you judge the working tree at risk, otherwise A → B → C is fine.

---

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

---

## Explicitly out of scope for this dispatch

Operator-only items from the disposition: A3 rollback drill; A11 attended clone repair (separate attended session — do NOT attempt clone surgery inside this dispatch); B4 carrier date. Cowork-lane items: Phase 3 design draft, RESEARCH-LANE-1 packet, ZDR/DPA memo. EGRESS-UNIFY-1 is a separate future design engagement with its own §3.1 triage — do not start it here.

**Paste-to-start:** `Execute docs/engagements/GOV-MECH-1-dispatch.md. Read docs/reviews/OUTSIDE-REVIEW-DISPOSITION-1_2026-07-07.md first (governing decision record). Report repo state, then Part A → Part B → Part C in order (or C-1 first if the working tree is at risk). Honor the Rule-11 wait on C-2 and the operator diff gate on C-3.`

---

*Cowork dispatch. The CLI is the sole builder. Parts A and B are reversible build-and-PR; Part C carries two explicit operator gates.*
