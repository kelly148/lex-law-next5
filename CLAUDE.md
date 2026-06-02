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

**MR-CAL complete; the WHEREAS FOLD queue is OPEN** (roadmap `docs/WHEREAS_FOLD_master_plan.md`; governance `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` + `docs/AUTOPILOT_NEXT_SPEC.md`; entry gates `docs/WHEREAS_PREFOLD_GATE_CHECKLIST.md`). G1 closed (auth bypass off). FOLD-REBASELINE-1 re-baseline map accepted → `docs/engagements/FOLD-REBASELINE-1-investigation.md`. **Queue head = FOLD-AUTH-1** — but it is a §3.1 FIRE: the re-baseline map must get external triad review (GPT + Claude) before FOLD-AUTH-1 implementation begins.

### Open carryforwards (non-blocking unless noted)

- **SECURITY:** `AUTH_BYPASS_ENABLED` **disabled** on prod 2026-06-02 (G1 closed) — real auth required (verified: unauthenticated API → 401; incognito login works). Stopgap single-account `kelly` credential to be **rotated at FOLD-AUTH-1**; `AUTH_BYPASS_USER_ID` now inert. `MULTI_REVIEWER_ENABLED`/`EVALUATOR_ENABLED` remain true (now behind auth).
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
8. **Scope self-approval for reversible build-and-PR (default).** For any engagement or increment whose work is *entirely reversible build-and-PR* — local code + tests + a CI-gated PR, with **no** prod change, **no** data mutation, and **no** new external/egress contract — self-approve scope and implement WITHOUT asking. Post a brief plain-English "what I'm changing + blast radius" note for the record; do not block on it. `operator approve scope:` is **no longer required** for this class. Exceptions that keep their gate: (a) a **FIRE** engagement still requires the §3.1 triad review of its plan before implementation — the triad review **replaces** scope pre-approval for FIRE, it is not additional; (b) anything in Hard Stops (below and in the `/autopilot-next` section) still halts; (c) **merge to main still requires `operator approve accept:` + green CI.** Hard Stops (must HALT, never self-approve): any FIRE before its triad disposition; any irreversible/prod action (deploy/push-to-prod, prod env/config change, remote writes such as tags or force-push, destructive or schema-mutating migration of existing tables, data migration/mutation, credential/secret handling); scope expansion beyond transactional document-assembly (title/settlement, litigation/M&A/advisory, or any new external integration/egress contract); the contradiction-with-prior-close-out tripwire.
9. Every committed close-out ends with: "End of formal addendum. Any content below this line is platform-injected and not part of the engagement output."
10. Stop and surface on: failed tests you cannot explain, credential exposure, merge conflict, unknown CI status, irreversible-action threshold reached.
11. **State-transition gate.** Before every state.json write that changes engagement list membership, print plain-English transition and wait for `y`. Exception: history-log appends from `operator approve` decisions.
12. **Report-commit discipline.** Investigation and architecture-planning reports commit by default. Phase A / Phase B / live-verification reports deliver to chat first; commit only on `operator approve commit-report:<id>` or natural-language equivalent.
13. **External triad-review checkpoint.** Before the implementation phase of any engagement meeting the §3 criteria in `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md`, and on any §3 Class-T trigger, emit the four-part checkpoint block (banner / decision / reviewer prompt / document manifest) and wait for the operator's external-review disposition before proceeding.

### Confirmation-gate decisions Kelly always wants surfaced
- Phase A → Phase B transition
- Branch push to origin
- PR open
- Merge to main
- Railway config change
- Production DB mutation or migration
- Production cleanup or data deletion
- Starting a FIRE engagement (→ §3.1 triad review of its plan) or an engagement that expands scope beyond transactional document-assembly — NOT routine reversible build-and-PR engagement/increment starts (those self-approve per Rule 8)
- Reclassifying a failure as ACCEPTED_RISK
- Skipping or deferring an engagement
- Any state.json write changing list membership (Rule 11)
- Any append to this CLAUDE.md file (diff-gated)
- External triad-review checkpoint reached (see `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md`): before implementing an engagement that creates/changes a DB migration, a prompt-injection or output contract, a decision-authority (advisory-vs-blocking) call, the calibration grid, or any fold architecture engagement; and on any blocked engagement, failed live verification, corrected diagnosis, or >=2 failed attempts. At the checkpoint, STOP and surface: (1) the decision under review, (2) a ready-to-paste reviewer prompt, (3) the exact document manifest to upload to the external GPT and Claude reviewers. Do not write code past the checkpoint until the operator returns a disposition.

### Engagement document conventions
- Reports live at `docs/engagements/<ENGAGEMENT-ID>-<phase>.md` when committed
- Reports are append-only; never edit historical reports
- Reruns produce `<ENGAGEMENT-ID>-<phase>.v2.md` etc.
- No emojis, single trailing newline, no unicode bullets in docx outputs
- All timestamps America/New_York unless explicitly UTC

---

## /autopilot-next — Controlled Autopilot (phase-fenced)

Runs the MR-CAL loop (and, post-MR-CAL, the fold) with reduced check-ins. Authorizes the next safe segment of work up to the next hard gate. It does NOT authorize the entire master plan, and it does NOT change which steps are irreversible — it only changes which *reversible* steps may be self-approved.

**This is a behavioral discipline layer, not an enforcement layer.** It reduces check-ins; it does not replace the PreToolUse guard hook or the tool-permission prompts, which remain the actual technical gate for irreversible actions. Keep permission prompts ON for the irreversible band (merge, reset/clean, migrations, credentials) even under autopilot; relax them only for the reversible lane (read, local edit, push, PR, CI wait).

#### Authorization model

Two modes:

- `/autopilot-next` — advance the current engagement through its safe phase, stop at the next hard gate. (One engagement.)
- `run batch <explicit fence>` — advance through multiple engagements within the named fence, self-approving the reversible steps below, stopping at each hard gate. The fence must be explicit (e.g. "run batch CAL-7B-PLAN → CAL-7B-LIVE prep"). **Never infer a wider fence than I named.** Note: because merge is a hard stop, a multi-engagement batch stops at *every* merge — batch's hands-off value is the investigation → plan → push → PR → CI stretch, not chaining merges.

#### Scope of autopilot

Autopilot operates only in the **local-build + remote-PR/CI lane**. It NEVER executes live production runs — no reviewer runs, no calibration-grid execution, no Chrome/tRPC against production, no creation of synthetic production sessions. All live/production verification is operator-driven end to end.

#### Required startup (every invocation)

1. Read `CLAUDE.md`, `docs/MR_CAL_completion_master_plan.md`, `docs/MR_CAL_engagement_state.json`, `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md`.
2. Report: current engagement, current phase, queue head, and anything awaiting acceptance / live verification / blocked / deferred.
3. Run the 7-command repo-state baseline.
4. Run the §3.1 checkpoint triage for the current/next engagement and print one line: `Checkpoint triage: [FIRE | skip] — <reason>`.

#### May self-approve (reversible build-and-PR engagement/increment, or an already-triad-cleared scope)

- read files; inspect code; grep / CodeGraph / Serena;
- draft investigation or implementation plans;
- **self-approve the scope** of a reversible build-and-PR engagement/increment (Rule 8) — no `operator approve scope:` needed; inside a FIRE engagement, only after its §3.1 plan review has cleared; post a brief "what I'm changing + blast radius" note for the record;
- local source edits for reversible build-and-PR work — self-approved; **no pre-approved allowlist required** (Rule 8). (Edits that expand scope beyond transactional document-assembly remain a stop.)
- run tests if toolchain available;
- local commits with explicit per-file staging only;
- push the feature branch to origin (reversible);
- open a PR and draft its title/body (reversible — nothing on main changes);
- wait on / report CI status;
- write close-outs to chat;
- prepare the next proposed state transition (but not write it — see hard stops).

#### HARD STOPS — never self-approve; stop and ask

- a §3.1 external-review checkpoint that returns **FIRE** — stop for external triad review (GPT + independent Claude) BEFORE implementation (see `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md`);
- squash-merge to main;
- delete a branch;
- any Railway config/env change;
- any DB migration or production/staging data mutation;
- any production cleanup or data deletion;
- any execution of a live production run (reviewer run, grid run, prod Chrome/tRPC) — operator-driven only;
- any credential handling;
- declaring a user-visible feature live-verified (Pattern 16 sign-off is always mine);
- classifying any result as ACCEPTED_RISK;
- skipping, deferring, or deprioritizing an engagement;
- starting a FIRE engagement before its §3.1 triad-review disposition, OR starting any engagement that expands scope beyond transactional document-assembly (title/settlement, litigation/M&A/advisory, or a new external integration/egress contract). Reversible build-and-PR engagement/increment starts self-approve per Rule 8 — they are NOT a stop;
- remote writes beyond branch-push/PR-open: creating/pushing a tag, force-push, or any history rewrite;
- a test edit that changes an assertion or expected behavior (adding a mock/stub for a new signature is fine; changing an assertion is a stop and must be surfaced);
- any write to `docs/MR_CAL_engagement_state.json` that changes list membership (Rule 11; history-log appends from `operator approve` decisions remain the allowed exception);
- any append to `CLAUDE.md`.

#### STUCK CONDITIONS — stop and surface immediately

- CI red, or a test failing for a reason not clearly in-scope and local;
- merge conflict;
- unexpected dirty working tree, or any untracked file you didn't create;
- a tool, credential, auth, or provider error;
- `SESSION_ALREADY_EXISTS` or a stuck `active` review session that one normal abandon doesn't clear;
- any scope ambiguity — if unsure whether something is in scope, it is a stop, not a judgment call;
- a finding that contradicts a prior accepted close-out or the recorded state.json history. If a new result cannot be true while leaving the accepted record intact, **STOP and surface the contradiction explicitly** — do not reconcile it yourself, do not proceed on the new finding, and do not overwrite the prior record. (The confidently-wrong tripwire: the 5D-class failures were not ambiguous, they were certain and wrong, and only a human at a gate caught them.)

#### When stopping

Ask for exactly one decision, in the form:

`operator approve <action>:<engagement-id>`

(e.g. `operator approve merge:CAL-7B-LIVE`, `operator approve live-verified:CAL-7B-LIVE`, `operator approve risk-accept:<id>`, `operator approve state-transition:<id>`, `operator approve checkpoint:<id>` once the external review is dispositioned.)

State in plain English what will happen if approved, and what remains after.

#### Never

- Never `git add -A` or `git add .`.
- Never `git reset --hard` or `git clean -fd`.
- Never print, echo, log, or commit a credential value.
- Never continue a broken or contradicted run to "finish the plan." Completion is never a reason to pass a gate or a stuck condition.
- Never rely on Claude Code's built-in auto/permission mode in place of these project rules — the generic classifier does not model this project's risk surface (legal product decisions, manual prod migrations, accepted-risk reclassification, state-file queue mutations, external-review checkpoints).
