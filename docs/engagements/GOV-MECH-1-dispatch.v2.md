# GOV-MECH-1 — dispatch v2 (paste-ready for the Claude Code CLI; SUPERSEDES v1)

**Author:** Cowork, 2026-07-07, operator-directed. **Authority:** (1) operator ruling "Accept all recommendations" on `docs/reviews/OUTSIDE-REVIEW-DISPOSITION-1_2026-07-07.md` (governing decision record — read it first); (2) operator ruling "ADOPT AND RECORD" on `docs/reviews/GOV-MECH-1_redteam_consolidated_disposition_DRAFT.md` (red-team of the v1 dispatch; GPT + Grok, both ADOPT-WITH-CHANGES — this v2 incorporates all adopted amendments). v1 (`GOV-MECH-1-dispatch.md`) is preserved append-only and is NOT the paste target.

**Goal:** mechanize the governance safety items adopted from the 2026-07-07 outside reviews + fresh-eyes audit, BEFORE the next unattended overnight batch. Run after DEED-STAGE1-SIMPLE-1 completes; 7-command baseline first; §3.1 triage line per part.

**ORDER IS FIXED (red-team item 9 — no builder discretion): C-1 → A → B → C-2 → C-3.** Each of A, B, C is its own PR.

---

## STEP C-1 — Commit the untracked governing docs (ALWAYS FIRST)

`docs/WHEREAS_BUILD_ROADMAP_2026-07.md`, `COWORK_MAP.md`, the July dispatches (`DEED-EXPORT-409-1`, `DEED-STAGE1-SIMPLE-1`, `C4a-substrate-consolidation`, `GOV-MECH-1-dispatch.md` AND this v2), `docs/reviews/FRESH-EYES-AUDIT-1_2026-07-07.md`, `docs/reviews/OUTSIDE-REVIEW-DISPOSITION-1_2026-07-07.md`, the GOV-MECH-1 red-team set (`GOV-MECH-1_redteam_packet.md`, `_returns.md`, `_consolidated_disposition_DRAFT.md`), and any untracked July design docs under `docs/design/`. Explicit per-file staging (no `add -A`). Produce an **untracked-inventory report** (every remaining untracked file, disposition noted) in the close-out; do not delete anything. Acceptance: all July governing docs on `main` and referenced in STATE.md before C-3 begins.

## PART A — `CI-LANE-GUARD-1` (closes disposition A1; reversible build-and-PR)

**Problem:** Rule 15's auto-merge condition (iv) ("no residual risk was flagged") is self-certified by the model seeking the merge. The reversible lane must be enforced mechanically, not asserted.

**Change:** add a CI job (`reversible-lane-guard`) to `.github/workflows/ci.yml` that runs on every PR and FAILS when the diff **adds, modifies, renames, moves, or deletes** any protected path.

**Ack mechanism (red-team items 1–2; FIXED, not builder's choice):**
- The ONLY acknowledgment is the GitHub label **`lane:non-reversible-ack`**. NO title marker, NO body marker, NO builder-applied equivalent.
- The guard MUST verify the label **actor**: it counts only if applied by the operator account (**`kelly148`**). If the actor cannot be reliably determined from the API, the guard **fails closed** and the PR merges manually outside Rule 15.
- **Semantics: the ack is not a pass.** The label means "operator acknowledges this PR is non-reversible." With the label, the guard job goes green so CI can complete — but the PR is **excluded from Rule 15 auto-merge**; merge then requires explicit `operator approve accept:`. State this in the workflow's comments and in the C-3 Rule 15 amendment.

**Protected paths (initial set; rename/move/delete of any of these also trips the guard):**
- `src/server/db/migrations/**`
- `src/server/db/schema.ts` *(operator-approved deliberate addition to the adopted A1 list — red-team item 11, "ADOPT AND RECORD" 2026-07-07)*
- `scripts/apply-prod-migrations.mjs`
- `railway.json`, `nixpacks.toml`, `Dockerfile` *(Dockerfile likewise a recorded deliberate addition)*
- `.github/**`
- `tools/deploy/**`
- `src/server/config/featureFlags.ts` — **the WHOLE file, no default-value carve-out** (red-team item 4). A new default-OFF flag therefore needs the operator ack label — accepted friction. Default-only detection is a possible later refinement, not this engagement.
- **New-surface globs** (red-team item 3): `infra/**`, `deploy/**`, `scripts/deploy/**`, `scripts/*prod*`, `*.prod.*`, `*.production.*`, `Procfile`, `docker-compose*.yml`, `fly.toml`, `render.yaml`, `.env*` templates. Any NEW file matching a deployment/infra/CI/hosting/env/container pattern is protected even though none exist today.

**Guard self-protection (red-team item 5):** `.github/**` is on the list, so the guard protects itself; the guard's own first PR is the last unguarded change. That first PR MUST include a negative test proving a subsequent `.github/workflows/**` edit without the operator ack label FAILS, and the operator reviews the guard logic itself before that first merge (present the workflow diff explicitly, not just the PR link).

**Acceptance (Part A):** workflow-level tests (or test PRs) demonstrate ALL of: docs-only diff passes; migration-file diff without label fails; same diff with operator-applied label passes-but-is-flagged-non-reversible; **renamed protected file fails; new `docker-compose.prod.yml`-style file fails** (red-team item 3); `.github/workflows/**` edit without label fails (item 5). CI green. Close-out states the carry eliminated: the operator's need to eyeball every "reversible" claim before trusting auto-merge.

**FIRE triage (Part A): skip** — additive CI job, fully reversible; it only ADDS a failure mode to CI. Note the recorded protected-path additions (schema.ts, Dockerfile) in the close-out.

## PART B — `FLAG-FLIP-RUNBOOK-1` (closes disposition A2; reversible build-and-PR)

**Problem:** a prod flag flip is a behavior change with no PR, no CI, no review. Config drift already caused the D3-enforce incident; `CHAT_UI_1_ENABLED` flipped on prod would hit deliberately-unapplied migrations 0028/0029.

**Change:**
1. Create `docs/FLAG_FLIP_RUNBOOK.md`: per-flip checklist — (1) migration precondition verified against prod schema; (2) partner-flag check; (3) post-flip smoke step named; (4) revert step named; (5) STATE.md line recorded. Short, operational.
2. **Prod-schema verification evidence (red-team item 6):** the checklist's step (1) requires recorded evidence — what was queried (command/source), when, expected migration IDs vs. actual — and an explicit rule: **do not flip on mismatch.**
3. Per-flag precondition table for EVERY flag in `featureFlags.ts`: required migrations (or "none"), partner flags (e.g. `REVIEWER_ASYNC_ENABLED` → `JOB_REAPER_ENABLED`; `CHAT_COPILOT_ENABLED` → `GROUNDED_CHAT_PROVIDERS` populated; the 5-flag chat chain), booby-traps, smoke check, revert step. **`CHAT_UI_1_ENABLED` gets an explicit HARD-BLOCK row: do not flip until 0028/0029 are separately resolved** (red-team item 6).
4. Coverage test: FAILS when a flag exists in `featureFlags.ts` but not in the table. Parse top-level flag keys only (robust to comments/formatting). PLUS (red-team item 6): **schema validation** — a row with blank or placeholder cells fails; and a **reverse lint** — a table row referencing a nonexistent flag fails.

**Honesty line (red-team item 6):** the test suite is **coverage-maintaining, not correctness-maintaining** — it proves every flag has a complete row, not that the row's content is right. Say exactly this in the runbook header and the close-out; row content is operator-verified at each flip.

**Acceptance (Part B):** table covers 100% of current flags; coverage test proves it and proves failure on a synthetic missing flag, a blank-cell row, and an orphan row; CI green. Carry eliminated: the operator re-deriving flip preconditions from code and memory at each activation.

**FIRE triage (Part B): skip** — docs + tests; zero runtime change.

## PART C — `STATE-TRUTH-1` (closes disposition A7 + the CLAUDE.md amendment for A5/A6/A8/A9)

**C-2 — engagement_state.json one-time repair (after A and B land).** Fix: stale prod pin (`4e07e51` → current); phantom `in_progress_engagement` CHAT-COPILOT-1; obsolete FOLD queue (→ pointer to roadmap phases); `blocked_engagements` staleness — **resolved per-item with evidence, never normalized in bulk**; the FOLD-L0-1 verified-contradiction — do NOT resolve it: record both claims, mark `OPERATOR-RESOLVE`.
**Evidence discipline (red-team item 8):** C-2 produces a **before/after table** — field, old value, new value, evidence source, classification (factual correction / demotion / OPERATOR-RESOLVE). STATE.md reconciliation completes BEFORE the demotion header is added. This rewrite is decision-bearing → **print the transition summary and wait for `y`.** After repair, add the header: "Generated/secondary; docs/STATE.md is authoritative; do not hand-maintain."

**C-3 — CLAUDE.md amendment PR (diff-gated — operator approves the diff before merge).** One PR containing exactly:
- Replace the "Current state (as of …)" block with a two-line pointer to the top of `docs/STATE.md`.
- Rule 11 narrowed per A5: `y`-gate only for reclassifications (skip / defer / risk-accept / ACCEPTED_RISK); routine adds and moves-to-completed run free.
- Rule 12 retired per A6: all reports commit by default.
- Rule 15 supplemented per A1 **with the red-team item 7 compensating gate, verbatim:** auto-merge additionally requires the `reversible-lane-guard` job green, AND auto-merge is **UNAVAILABLE** for any PR that introduces migrations, new flags, protected-path changes, egress/provider changes, auth/permission changes, or carries self-flagged items — regardless of CI status. An operator ack label never restores auto-merge eligibility (see Part A semantics).
- Rule 17 retired per A9: engagements land on `main` via per-engagement PRs; per-phase branches no longer used.
- Morning-digest per A8, **with red-team item 7 language:** the digest is post-run REPORTING, never a gate substitute; it MUST surface all OPERATOR-RESOLVE items, state discrepancies, and self-flagged items. For batch runs it replaces per-engagement 15-item close-outs; non-batch engagements keep the current format.
- Boundary statement RETAINED (A4). **Contradiction tripwire and the A10 core RETAINED verbatim — explicitly untouched** (red-team item 7).
- Prune the confirmation-gate entries the amendments supersede — **and list every pruned line VERBATIM in the PR description** so over-pruning is visible in the diff (red-team item 7).

**Acceptance (Part C):** C-1 files on `main` (done first); C-2 file carries the demotion header, the OPERATOR-RESOLVE marker, and the before/after evidence table in its report; C-3 merged only after operator diff approval; STATE.md + Desktop mirror updated per Rule 16.

**FIRE triage (Part C — red-team item 10):** No new FIRE — the amendment implements an operator-adopted disposition; operator diff approval is mandatory because C-3 changes governance gate semantics. Gates that apply: Rule 11 print-and-wait on C-2; operator diff gate on C-3.

---

## Explicitly out of scope

Operator-only: A3 rollback drill; A11 attended clone repair (do NOT attempt clone surgery here); B4 carrier date. Cowork-lane: Phase 3 design draft, RESEARCH-LANE-1 packet, ZDR/DPA memo. EGRESS-UNIFY-1 is a separate future design engagement with its own §3.1 triage.

**Paste-to-start:** `Execute docs/engagements/GOV-MECH-1-dispatch.v2.md (v2 supersedes v1 per the operator's ADOPT AND RECORD ruling in docs/reviews/GOV-MECH-1_redteam_consolidated_disposition_DRAFT.md). Read docs/reviews/OUTSIDE-REVIEW-DISPOSITION-1_2026-07-07.md first. Report repo state, then C-1 → Part A → Part B → C-2 → C-3, honoring the Rule-11 wait on C-2 and the operator diff gate on C-3.`

---

*Cowork dispatch v2. The CLI is the sole builder. A and B are reversible build-and-PR; Part C carries two explicit operator gates. Red-team provenance: GPT + Grok legs run 2026-07-07 in the operator's browser at operator direction; all adopted amendments incorporated above.*
