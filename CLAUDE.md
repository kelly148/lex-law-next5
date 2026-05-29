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

## Current state (as of 2026-05-28)

- **`main` is at `e4d7dd3`.**  
- **MR-CAL-3C** (sequential reviewer comparison view): merged at `703ff40` (PR \#47), Railway deploy active. **Live verification still pending** — was interrupted by the materials defect below.  
- **MR-UAT-MATERIALS-1**: diagnosed a materials/drafting defect — completed questionnaire answers live in Phase-4b information-request tables and are NOT auto-converted into `matter_materials`, so draft generation (which reads `matter_materials` via `assembleContext`) sees "no client materials" and warns it will draft with placeholders.  
- **MR-UAT-MATERIALS-2** (the bridge fix): Phase A accepted commit `9c0a972a…`. **Phase B is COMPLETE — PR \#48 squash-merged into `main` at `e4d7dd3`.** (This supersedes the handoff doc, which predates the merge and still says Phase B is pending.)  
- **MR-CAL-2E-LIVE**: completed. P8-T10 business-decision separation **fully validated across all four tracks**. **GPT stability NOT established** (P8-T1 parse failure, P8-T6 substantive failure, P8-T7 pass).

### Immediate next action

**Live Railway/UAT verification of MR-UAT-MATERIALS-2** (it is code-merged but not live-verified — Pattern 16): on the deployed app, create a synthetic matter → complete a questionnaire → click "Add to Client Materials" → confirm the material appears in the Materials Drawer → attempt a POA draft → confirm the no-materials/placeholder warning is gone and the draft receives questionnaire-derived context. Then resume MR-CAL-3C live verification. Do NOT redo MR-UAT-MATERIALS-2 Phase B — it is already merged.

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

---

## Governance model — two-phase engagement

Every task is one of these scopes; **Kelly chooses the scope, you do not expand it:**

- **Investigation only** — read-only unless expressly authorized.  
- **Phase A — local implementation only.** Permitted (if authorized): modify allowlisted source files, add/update tests, run local gates, create a local commit. NOT permitted: push, PR, merge, Railway, production/staging DB, provider credentials, live testing, scope change.  
- **Phase B — remote completion** after Phase A acceptance. Permitted (if authorized): push the accepted branch, open PR, wait for CI, squash-merge, delete branch, verify `main`. Must NOT author new source unless a correction cycle is authorized.  
- **Live verification (Pattern 16\)** — code-level closure ≠ live closure. A user-visible feature is not closed until verified in the deployed app (or explicitly waived).

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

