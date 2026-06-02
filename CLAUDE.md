# CLAUDE.md — Lex Law Next

Standing briefing for any Claude Code session on this project. Read it fully before doing substantive work. Full detail lives in `docs/Claude Code Project Handoff.docx`; this file is the auto-loaded essentials.

---

## Who you're working with

You're working with Kelly — the managing attorney who owns this project. **Kelly is not a developer.** Communicate in plain English, explain technical steps in non-technical terms, never assume coding knowledge. Kelly directs the work by describing goals; you do the technical execution. Kelly makes the business and legal decisions; you never make them on her behalf.

**Stop and get explicit approval before anything irreversible** — pushing, merging, deleting, deploying, or any database/production change. Show proposed file changes before saving. Do not self-expand scope.

---

## What this project is

Lex Law Next is an attorney-supervised legal AI drafting and review platform. Matter-based workflow:

1. Create/open a matter.  
2. Add client/source materials (questionnaires, notes, uploads, extracted text).  
3. Generate a legal document draft from those materials.  
4. Run one or more calibrated reviewer passes.  
5. Compare reviewer feedback.  
6. Attorney decides what to adopt.  
7. Regenerate/finalize — **the attorney is always the final decision-maker.** Reviewers surface options and issues; they never make business decisions or treat business choices as drafting defects.

Eventual architecture (not yet built; do not start without authorization): matter memory, locked decisions, cumulative adopt ledger, sendability gate, native feedback-card runtime, multi-reviewer/evaluator topology, full calibration regression grid.

---

## Current state (as of 2026-06-02) — MR-CAL COMPLETE

- **`main` is at `9a0ebc3`** plus the CAL-7B-CLOSEOUT docs PR (program-complete). `docs/MR_CAL_engagement_state.json` is the authoritative HEAD/queue source.
- **MR-CAL completion program COMPLETE — 30 engagements across Phases 0–8.** Queue empty.
- **Features now live + production-verified:** native feedback-card *display* (MR-CAL-4C); multi-reviewer + advisory evaluator, toggleable/default-safe (MR-CAL-5D; `MULTI_REVIEWER_ENABLED`/`EVALUATOR_ENABLED` currently true); document-scoped **locked decisions** (MR-CAL-6C, migration 0002); cumulative **adopt ledger** (MR-CAL-7C, migration 0003); advisory **sendability** classifier (MR-CAL-8C, no table).
- **Calibration posture (CAL-7B-LIVE):** live system behaves acceptably — a live behavioral snapshot, NOT a locked regression suite; re-derived-baseline fixtures. P8-T10 & P8-T7 strong, P8-T1 good, **P8-T6 the soft spot** (taxonomy under-tagging). Offline harness: `tools/calibration/cal7b_harness.mjs`.
- **Accepted risks:** GPT-P8-T1 (parse — but observed PASSING/improved in CAL-7B-LIVE, flagged), GPT-P8-T6 (substance).
- **Dev environment:** Serena MCP + CodeGraph configured; PreToolUse Bash guard hook. **Node v24 + `npx` ARE installed; `pnpm`/`tsc`/`vitest` are NOT** — local quality gates can't run; **CI is the authoritative gate.** Railway auto-deploys `main` (~30–90s) but does **NOT** run DB migrations (apply schema to prod TiDB out-of-band).

### Immediate next action

**MR-CAL is complete; the next phase is an operator decision.** No queued engagement. Candidates (see `docs/engagements/CAL-7B-CLOSEOUT.md` §7): (1) **security — disable `AUTH_BYPASS_ENABLED`**; (2) reviewer-reliability hardening; (3) P8-T6 calibration; (4) prod cleanup (LLN-PROD-CLEANUP-1); (5) optional depth (native-card runtime, per-matter granularity, true offline regression suite).

### Open carryforwards (non-blocking unless noted)

- **SECURITY (escalate):** `AUTH_BYPASS_ENABLED` is **TRUE** on the public production URL — app is publicly unauthenticated. Recommend setting `false` in Railway now (operator action; only exact lowercase `true` is the on-value). `MULTI_REVIEWER_ENABLED`/`EVALUATOR_ENABLED` also true.
- **Reviewer reliability:** GPT-5 intermittent empties; Gemini invalid JSON for structured output; Claude intermittent non-strict JSON; a failed/empty review leaves the session `active` (stuck-session), blocking the next create.
- **P8-T6 taxonomy precision:** the one substantive calibration soft spot (candidate prompt-calibration engagement).
- **LLN-PROD-CLEANUP-1:** synthetic test data on prod (matters/docs/sessions; locks; adopt-ledger entries; many versions on doc `cbf83ad7`). Operator-approved cleanup only.
- **DEPLOY-MIGRATIONS-NOT-AUTOMATIC:** schema-bearing work needs a manual prod migrate.
- **Fixtures reconciliation:** CAL-7B used re-derived fixtures; reconcile to the `20260528T122851Z` originals for a true regression if the bundle is supplied.
- **`docs/Claude Code Project Handoff.docx`** predates this arc and may need a manual refresh (it is not editable from Claude Code).

**Deferred (not started):** native feedback-card *runtime* (only additive display shipped); per-matter granularity (Option 2); true offline reproducible regression suite.

---

## Repository and deployment

- **GitHub repo:** `kelly148/lex-law-next5`  
- **Local clone:** `C:\Users\Kelly\Documents\lex-law-next5-local`  
- **Production:** Railway. Deploy config confirmed by code inspection (`railway.json` Dockerfile build, healthcheck `/api/health`; `package.json` `build:railway` + `start`). Auto-deploy-from-`main` is a Railway dashboard setting and is not establishable from the repo. \[CONFIRM trigger in Railway dashboard.\]  
- `main` is the source of truth; work reaches it via squash-merged PRs, then Railway deploys.

---

## Tech stack

(Confirmed by code inspection 2026-05-29.)

- **TypeScript.** Server in `src/server/`, client (React, `.tsx`) in `src/client/`.  
- **Tests:** Vitest. **Package manager:** pnpm.  
- **Quality gates:** `pnpm typecheck`, `pnpm lint`, `pnpm test`. If the default parallel test run stalls (a known MR2 S4E behavioral test issue), use the serial run: `pnpm exec vitest run --no-file-parallelism`.  
- **API/framework layer:** tRPC v11 procedures in `src/server/procedures/`, served by Express 4 (`src/server/index.ts`) at `/trpc` plus a few REST routes.  
- **DB layer:** Drizzle ORM over TiDB-compatible MySQL (`mysql2`, pooled); tables include `matter_materials` and the Phase-4b information-request tables (`src/server/db/queries/phase4b.ts`).  
- **Build/deploy:** `build` / `build:railway` (tsc → vite → esbuild bundle), `start`, Drizzle-kit `db:generate` / `db:migrate` / `db:push`.

---

## Reviewer tracks and models

| Track | Full model | Lite model |
| :---- | :---- | :---- |
| GPT | `openai:gpt-5` | `openai:gpt-4.1-mini` |
| Claude | `anthropic:claude-opus-4-5` | `anthropic:claude-sonnet-4-5` |
| Gemini | `google:gemini-2.5-pro` | `google:gemini-2.5-flash` |
| Grok | `xai:grok-4` | `xai:grok-3-mini` |

---

## MR-CAL calibration essentials

- **Active runtime contract:** legacy JSON-array wrapper parsed by `parseFeedbackOutput`; feedback-card detail embedded in the legacy suggestion body. NOT native feedback-card runtime.  
- **Scoring:** repaired MR-CAL-2D predicates in `src/server/__tests__/mr_cal_2d_calibration_scoring.test.ts`.  
- **Scenario taxonomy:**  
  - **P8-T1** — execution-blank suppression (do NOT flag routine signature/date/notary blanks on pre-execution drafts; empty valid output may be correct).  
  - **P8-T6** — counterparty-facing over-disclosure (flag as substantive drafting/audience risk; preserve the attorney's selected business offer).  
  - **P8-T7** — governing-law / sendability blocker (escalate jurisdiction mismatch as a blocker requiring attorney decision before send).  
  - **P8-T10** — business-decision separation (surface both options, e.g. recourse vs. non-recourse; require attorney decision; never pick; never rewrite to change structure).  
- **GPT raw-artifact issue (open):** P8-T1 and P8-T6 GPT classifications could not be auditably reconstructed. Make NO prompt/parser/scoring patch until raw and normalized provider outputs are captured. Do not chase unless Kelly specifically returns to GPT calibration.

### Milestone commit anchors

| Milestone | Commit |
| :---- | :---- |
| MR-CAL-2 | `8fcdbf9` |
| MR-CAL-2A | `baa580b` |
| MR-CAL-2D | `50dbf25` |
| MR-CAL-3C | `703ff40` |
| MR-UAT-MATERIALS-2 | `e4d7dd3` |
| MR-IR-ERR-1 | `832d569` |
| MR-IR-GEN-2 | `4a989ad` |
| MR-CAL-3E | `dc1e98e` |

---

## Governance model — two-phase engagement

Every task is one of these scopes; **Kelly chooses the scope, you do not expand it:**

- **Investigation only** — read-only unless expressly authorized.  
- **Phase A — local implementation only.** Permitted (if authorized): modify allowlisted source files, add/update tests, run local gates, create a local commit. NOT permitted: push, PR, merge, Railway, production/staging DB, provider credentials, live testing, scope change.  
- **Phase B — remote completion** after Phase A acceptance. Permitted (if authorized): push the accepted branch, open PR, wait for CI, squash-merge, delete branch, verify `main`. Must NOT author new source unless a correction cycle is authorized.  
- **Live verification (Pattern 16\)** — code-level closure ≠ live closure. A user-visible feature is not closed until verified in the deployed app (or explicitly waived).
- **Live-testing standard (operator directive, 2026-05-31):** do **enough** live testing to be reasonably confident the feature/product is functional — exercise the real end-to-end path (including LLM- and DB-touching runs on synthetic data) rather than under-testing to conserve quota. This **supersedes** the earlier "keep live-testing light" carryforward (the TiDB quota constraint that prompted it has been relaxed). The bar is "reasonably likely to be functional," not exhaustive coverage.

---

## Hard operating rules

1. **Start every task by reporting repo state:** `pwd`, `git remote -v`, `git branch --show-current`, `git rev-parse HEAD`, `git log --oneline -10`, `git status --porcelain`, `git ls-remote origin main`. If a task references a commit, verify it: `git rev-parse --verify <SHA>^{commit}`.  
2. **No broad staging.** Never `git add -A` or `git add .`. Stage only explicit authorized paths.  
3. **No destructive cleanup.** Never `git reset --hard` or `git clean -fd` without express authorization. Report untracked files; do not delete them. (Note: an untracked `mr-cal-3c.bundle` may exist; leave it unstaged and unmodified.)  
4. **No credential exposure.** Never print, echo, log, store, or commit credential values. Validate a credential in the exact environment/process that will use it.  
5. **Halt on scope expansion.** If a task would touch files, systems, credentials, schemas, migrations, DB records, Railway, or product areas outside the prompt, stop and report.  
6. **Preserve evidence-class distinctions.** Use precise language: "confirmed by repo command," "confirmed by code inspection," "operator assertion," "consistent with," "not established," "not inspected," "not reproduced." Do not overstate.  
7. **No productization tails.** Don't end formal close-outs with unrelated offers or future suggestions; end with the required boundary statement.

---

## Credentials and environment (names only — never values)

- **Provider keys** at Windows User scope: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`. Inherited from the environment automatically; never echo them.  
- **GitHub:** GitHub CLI (`gh`) OAuth, account `kelly148`. Pushing works via this. Do NOT use or request personal access tokens.  
- **Python 3.13** installed (calibration harness).  
- **Recurring failure class — Secret Handoff Integrity Failure Across Execution Boundaries:** credentials valid in one environment failed when hand-carried to Manus's sandbox (provider 401s; malformed PATs). Rule: prefer local credential flows; prefer `gh` browser OAuth over PATs; if a credential fails in one environment but passes in another, diagnose environment propagation before blaming code or provider.

---

## Do NOT begin without express authorization

MR-CAL-3D; MR-CAL-4; CAL-7B; matter memory; locked decisions; cumulative adopt ledger; sendability gate; native feedback-card runtime; GPT prompt/parser/scoring repair; Railway config changes; production/staging DB mutation; schema migration; provider adapter changes; credential troubleshooting beyond the authorized task.

---

## Conventions

- **Branch naming:** `lex-next/<short-kebab-description>`.  
- **Commit & PR titles:** `type(scope): MR-<ID> — <summary>` (e.g. `fix(uat): MR-UAT-MATERIALS-2 — create material from completed questionnaire`).  
- **Merges:** PRs squash-merged into `main`; delete the feature branch after merge.

---

## Reference documents (in `docs/`)

- `docs/Claude Code Project Handoff.docx` — full operating context, runbooks, and close-out formats (the authoritative deep reference).  
- `docs/MR-CAL_program_history.md` — full MR-CAL narrative \+ current-state update.  
- `docs/LLN_Reviewer_Architecture_Analysis.md`  
- `docs/LLN_Reviewer_Prompt_Specifications.docx`  
- `docs/LLN_Reviewer_Calibration_Test_Plan.docx`  
- `docs/Reference_Taxonomies_v1_3_Proposal.docx`  
- `docs/MR-CAL-2E-LIVE_formal_close_out.md`  
- `docs/MR-CAL-2G_formal_close_out.md`  
- `docs/MR-CAL-3C_Phase_B_addendum.md`  
- `docs/MR-UAT-MATERIALS-2_Phase_B_addendum.md`

Read the relevant ones before reviewer/calibration work.

---

## Close-out format

Every completed task produces a concise close-out. **Phase B:** disposition; starting branch/HEAD; accepted-commit verification; working-tree status; GitHub auth account (no token values); push evidence; PR number/URL; CI results; merge result \+ squash SHA; post-merge verification; files changed; scope confirmation; credential-safety confirmation; carryforward facts; live verification still required; then the boundary statement. **Investigation/Phase A:** repo state; objective; source map; findings; files changed (if any); tests/gates; commit SHA (if committed); out-of-scope log; then the boundary statement. Boundary statement, exactly:

`End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.`

---

## Code intelligence (CodeGraph / Serena)

- Before broad file reads or any edit, use **CodeGraph** (and **Serena** once its MCP server is active) to locate symbols and map callers, callees, and impacted tests. Prefer these over wide grep/read sweeps.  
- Keep changes as small, reviewable diffs; explain the intended files and approach before editing.  
- After editing, run the **narrowest relevant tests first**, then widen.

---

## How we work

1. Kelly describes a goal in plain English, or forwards a dispatch brief.  
2. You report repo state, confirm scope, do the work locally, explain it plainly, and show changes before saving.  
3. For Phase B: verify HEAD matches the accepted commit → push → PR → CI green → squash-merge → delete branch → post-merge verify → write the addendum.  
4. Stop and ask before any irreversible step. Kelly approves; you execute.


## MR-CAL completion loop — operating rules

This repo runs the MR-CAL completion plan as a controlled, gated engagement loop. Master plan: `docs/MR_CAL_completion_master_plan.md`. State: `docs/MR_CAL_engagement_state.json`. Engagement reports: `docs/engagements/`.

### Loop entry points
- `next engagement` (or `/next-engagement` if slash commands supported) — advance the loop
- `engagement status` (or `/engagement-status`) — read-only status
- `operator approve <decision>` (or `/operator-approve <decision>`) — record an approval gate response

### Operating rules (apply to every engagement)
1. Always begin with the 7-command repo-state baseline.
2. No broad staging (`git add -A` / `git add .`). Explicit paths only.
3. No destructive cleanup (`git reset --hard` / `git clean -fd`). Surface unexpected dirty state.
4. Never print, echo, log, store, or commit credentials. Redact in chat output if seen.
5. No push, merge, deploy, Railway change, production DB mutation, or production cleanup without `operator approve <type>:<engagement-id>`.
6. Local Node/pnpm toolchain assumed unavailable unless proven. CI is authoritative.
7. Sequence: investigation OR Phase A → operator acceptance → Phase B → live verification (if user-visible).
8. Architecture engagements (MR-CAL-4 onward) require `operator approve scope:<id>` before implementation phase begins.
9. Every committed close-out ends with: "End of formal addendum. Any content below this line is platform-injected and not part of the engagement output."
10. Stop and surface on: failed tests you cannot explain, credential exposure, merge conflict, unknown CI status, irreversible-action threshold reached.
11. **State-transition gate.** Before every state.json write that changes engagement list membership, print plain-English transition and wait for `y`. Exception: history-log appends from `operator approve` decisions.
12. **Report-commit discipline.** Investigation and architecture-planning reports commit by default. Phase A / Phase B / live-verification reports deliver to chat first; commit only on `operator approve commit-report:<id>` or natural-language equivalent.

### Confirmation-gate decisions Kelly always wants surfaced
- Phase A → Phase B transition
- Branch push to origin
- PR open
- Merge to main
- Railway config change
- Production DB mutation or migration
- Production cleanup or data deletion
- Starting any MR-CAL-4+ engagement scope
- Reclassifying a failure as ACCEPTED_RISK
- Skipping or deferring an engagement
- Any state.json write changing list membership (Rule 11)
- Any append to this CLAUDE.md file (diff-gated)

### Engagement document conventions
- Reports live at `docs/engagements/<ENGAGEMENT-ID>-<phase>.md` when committed
- Reports are append-only; never edit historical reports
- Reruns produce `<ENGAGEMENT-ID>-<phase>.v2.md` etc.
- No emojis, single trailing newline, no unicode bullets in docx outputs
- All timestamps America/New_York unless explicitly UTC
