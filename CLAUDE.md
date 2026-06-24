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

## Current state (as of 2026-06-24) — WHEREAS FOLD in progress; DEED-DRAFT-AGENT-1 fence COMPLETE

- **`main` is at `e412864`.** `docs/STATE.md` (newest-first, mirrored to `…\_progress\STATE.md`) is the authoritative running narrative; the latest phase-boundary brief is `…\_progress\HANDOFF_BRIEF_2026-06-24_deed-fence-complete.md`. The MR-CAL program (the prior arc) is complete; the project has since run the **WHEREAS FOLD** queue and a separate **DEED-DRAFT-AGENT-1** track — see STATE.md for the engagement-by-engagement log.
- **DEED-DRAFT-AGENT-1 — MONSTER-v2 fence COMPLETE (2026-06-24).** A FIRE-gated, flag-dark (`DEED_DRAFT_AGENT_ENABLED`, default OFF), deterministic VA deed-drafting agent on a SEPARATE track (NOT in `docs/MR_CAL_engagement_state.json`, operator ruling 2026-06-23). On `main`, all flag-dark with no live caller and **zero migrations** (the fence is schema-free; it rides existing tables): 7 deterministic Mason deed assemblers (gift, seller-side, Into-LLC C3, TOD C5, Confirmation C1, Out-of-LLC C4, Into-Trust C2 — registered in `deedTypeRegistry`, cites KB-verified in `deedKbVa`); the B2 estate-grantor input contract; Inc 4 issue-spotting depth + the attorney-driven refine loop; and the Quick Deed surface (QD-1 gift-only) + its firm-level conflicts toggle (QD-2). The DEED-DRAFT-AGENT-1 arc is PRs #404–#418. Pure/deterministic/no-egress/no-LLM; fail-closed; surface-not-decide; never auto-records/sends.
- **Deploy posture:** **Railway auto-deploy-on-merge is OFF** — `main` advances without touching prod (merge ≠ deploy); deploy is operator-gated + manual. **Operator deploying `e412864` (2026-06-24).** The deed program ships **dark** (flag OFF), so the deploy is behavior-neutral until `DEED_DRAFT_AGENT_ENABLED` is flipped; **not client-facing until the conflicts-at-intake gate is live-verified** (self-use only). No pending deed migrations.
- **Local gates ARE runnable** in the build worktree (`node_modules/.bin` tsc/eslint/vitest via a node_modules junction) — pre-validate CI locally despite older "not installed" notes; **CI remains the authoritative gate.**

### Immediate next action

**DEED-DRAFT-AGENT-1 fence complete; operator deploying `e412864`.** After deploy: flip `DEED_DRAFT_AGENT_ENABLED` on prod → Pattern-16 live-verify on synthetic data → not client-facing until conflicts-at-intake is live. **Open deed follow-ups (each a future engagement, none blocking):** seller-side→B2 wiring (step #7); wiring the 6 non-gift categories into Quick Deed Generate (QD-1 is gift-only); an on-quick-screen conflicts-clearance step for QD-2 enforced-mode; the Inc-4 regenerate UI; calibrated-reviewers-on-deeds. The broader WHEREAS FOLD queue continues per `docs/WHEREAS_FOLD_master_plan.md` (consult STATE.md for the current head).

### Open carryforwards (non-blocking unless noted)

- **SECURITY:** `AUTH_BYPASS_ENABLED` disabled on prod (G1 closed) — real auth required.
- **Reviewer reliability:** GPT-5 intermittent empties; Gemini invalid JSON for structured output; Claude intermittent non-strict JSON; a failed/empty review can leave the session `active` (stuck-session).
- **LLN-PROD-CLEANUP-1:** synthetic test data on prod (operator-approved cleanup only); once the deed flag is on, any Quick Deed "Quick Deed — DATE" auto-matters join this class.
- **DEPLOY-MIGRATIONS-NOT-AUTOMATIC:** schema-bearing work needs a manual prod migrate (the deed fence added none).
- **`docs/Claude Code Project Handoff.docx`** predates this arc and may need a manual refresh (not editable from Claude Code).

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
13. **External triad-review checkpoint (tightened criterion).** A checkpoint FIRES only for an engagement that **establishes or changes a load-bearing decision** that is **(a)** hard to reverse once shipped, **(b)** not caught by CI, **AND (c)** carries **access-control, privilege/confidentiality, ethics/conflicts, client-send-safety, or data-destruction** risk — all three prongs must hold — plus any §3 Class-T trigger (blocked engagement, failed live-verification, corrected/superseded diagnosis, or ≥2 failed attempts), which always fires regardless. A downstream engagement that **implements an already-triad-reviewed design**, and any **mechanical / additive / reversible** build, **does NOT fire** — it rides the parent's review and runs under normal reversible-lane automation (Rule 15: auto-merge on green CI; stop only on a surfaced decision or a hard stop). You MAY re-flag such an engagement FIRE only if it introduces a **new** load-bearing irreversible / records-management / ethics decision the parent's review did not cover, and you must state why. When a checkpoint fires, **auto-assemble a self-contained review packet** — the four parts (banner / decision under review / ready-to-paste reviewer prompt / document manifest) **plus the inlined Phase-A plan and the relevant diffs/code**, per `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §4/§7, so that **a reviewer with no repo access can review from it alone**. Write the packet to `docs/reviews/<ENGAGEMENT-ID>_packet.md` **AND** mirror a copy to `C:\Users\Kelly\Desktop\Historical_Thread_Extraction\_analytical\phase2\reviews\<ENGAGEMENT-ID>_packet.md` (create the directory if missing; if the mirror path is unavailable, still write the repo copy and say so). Then **halt** and tell the operator `packet ready for <ENGAGEMENT-ID>`. This automates the review **labor only** — do **NOT** self-run, self-review, or self-approve the review; the checkpoint stays a **hard stop** until the operator returns an external-review disposition. Full criterion, worked calls, and the queue FIRE snapshot: `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §3.1 and §8.
14. **Auto-advance on close-out (default).** When an engagement closes out — `operator approve accept:` given (or auto-merged per Rule 15) AND its PR merges green — **automatically proceed to the next engagement in `docs/WHEREAS_FOLD_master_plan.md` queue order (honoring dependencies) WITHOUT waiting for a manual `next engagement`/"continue."** Run forward until the next *genuine stop*: (a) a **FIRE** checkpoint → halt for the §3.1 triad review before implementation; (b) any **irreversible/prod action** → halt; (c) the next **accept gate** → build complete, present the close-out for `operator approve accept:`; (d) a **blocked dependency or unmet gate** → halt and flag. Guards: follow queue order + dependencies — never open an engagement whose prerequisites (a prior merge, or a gate it depends on) aren't met; do not auto-advance past an engagement that left an open post-merge live-verification **if the next engagement depends on it** (otherwise note the open live-verify and proceed); never skip or auto-run a FIRE triad review; never self-approve an irreversible/prod action; **never auto-merge (the `operator approve accept:` gate is retained)**; the contradiction-with-prior-close-out tripwire still halts. **`pause` or `hold` from the operator stops the auto-advance chain at the current point.** (This supersedes any "wait for `next engagement`" behavior between engagements; scope self-approval for reversible build-and-PR is per Rule 8.)
15. **Auto-merge the reversible build-and-PR lane (default).** When ALL of the following hold, **squash-merge the PR to `main` on green CI WITHOUT an `operator approve accept:` prompt**, then continue under auto-advance (Rule 14): (i) the engagement is the *reversible build-and-PR lane* — no prod change, no data mutation, no new external/egress contract; (ii) **CI is green** (tsc + vitest + eslint); (iii) **no operator decision or fork was surfaced** during the engagement (you never had to ask the operator anything to proceed); and (iv) **no residual risk or limitation was flagged** that needs a human call. This supersedes the Rule 14 "never auto-merge" clause for this lane only. **STOP for `operator approve accept:` when ANY of these is true:** CI is not green; a genuine decision/fork arose; the change touches prod / irreversible / data / egress; or you flagged a residual risk or limitation. **FIRE engagements still halt earlier for the §3.1 triad review** — auto-merge never applies before a triad disposition. **Prod deploy is a SEPARATE, operator-gated step — `operator approve deploy:` — and is NEVER automated.** PRECONDITION (deploy topology): this rule is safe ONLY while Railway auto-deploy-on-merge is **OFF**, so `main` advances without touching prod (merge ≠ deploy); if auto-deploy is ever re-enabled, **auto-merge is suspended** because a merge would deploy. Unchanged backstops: scope-expansion halt; contradiction-with-prior-close-out tripwire; `pause`/`hold` stops the chain.
16. **Automated state upkeep + handoff (reversible bookkeeping; no gate).** On every engagement close-out (`operator approve accept:`/auto-merge + green merge), WITHOUT a separate approval: (a) update `docs/MR_CAL_engagement_state.json` — status, commit/squash SHA, and gate impact — so the tracker never drifts; (b) append a dated entry to `docs/STATE.md` — one paragraph: what changed, current build state, open items, gate residuals; (c) mirror `docs/STATE.md` to `C:\Users\Kelly\Desktop\Historical_Thread_Extraction\_progress\STATE.md` (create the dir if missing; if unavailable, keep the repo copy and say so). At each **phase boundary**, also write a full dated handoff brief to `C:\Users\Kelly\Desktop\Historical_Thread_Extraction\_progress\HANDOFF_BRIEF_<YYYY-MM-DD>_*.md` in the `HANDOFF_BRIEF_2026-06-02` format (§1 one-paragraph context … §11 paste-to-start opener) so a fresh thread always has current state. This bookkeeping is **reversible and ungated** — it happens automatically. **Reconciliation with Rule 11:** recording the *just-closed* engagement's status/commit/gate-impact (the membership move to `completed` that an already-approved closeout implies) is part of this ungated upkeep; Rule 11's print-and-wait-`y` still governs every OTHER list-membership change (adding, reordering, skipping, deferring, or reclassifying an engagement). Effective immediately (from the next close-out).
17. **Per-phase integration branches + per-phase merges.** Each fold phase gets one integration branch `fold/phase-<n>`, branched from `main`. Engagements land on the **phase branch** as they close out (NOT directly on `main`): each engagement still opens its PR into `fold/phase-<n>`, still runs CI when it lands, and still hits its per-engagement decision/FIRE/accept stops — so failure attribution and per-engagement revert are preserved. Auto-advance (Rule 14) continues engagement→engagement **within the phase, on the phase branch**. At the **phase boundary** (all the phase's engagements closed): run the FULL CI suite on the phase branch; if **green**, merge `fold/phase-<n>` → `main` as ONE merge under the auto-merge rule (Rule 15 — only if no unresolved decision/residual surfaced across the phase; otherwise stop for `operator approve accept:`); if **red**, **HALT and flag**. Phases are **sequential**: branch `fold/phase-<n+1>` from `main` only AFTER phase n merges. Deploy stays gated/batched off `main` (`operator approve deploy:`), now naturally per-phase. **Revert is available at both granularities** — a per-engagement commit on the phase branch, or the per-phase merge to `main`. **Effective from the next clean phase boundary:** Phase 1 (FOLD-AUTH-1 / TIER-1 / GOV-1 / PERSIST-1) is already partly on `main` — **finish Phase 1 on `main` as-is; do NOT rebranch mid-phase.** Start phase branches at **Phase 2** (`fold/phase-2`, FOLD-L1-1 onward).
18. **Deploy-trigger prompts (proactive; deploy stays operator-gated — NEVER autonomous).** Deploy is never executed autonomously (Rules 15/17 unchanged: `operator approve deploy:` is always required). But when a **deploy-trigger milestone** is reached, proactively surface a **DEPLOY PROMPT** and **halt** so the operator is told *when* to deploy. **Deploy-trigger milestones:** (a) **phase boundary** — a phase branch merges to `main` (phase complete); (b) **live-verification dependency** — an engagement's acceptance/gate requires post-deploy Pattern-16 verification (e.g., G3); (c) **urgent/security fix** flagged for immediate deploy, independent of phase cadence. **The DEPLOY PROMPT MUST include, in order:** (1) which milestone triggered it + what's in the deploy (engagements/changes since the last prod deploy); (2) **pre-deploy checklist** — **PENDING DB MIGRATIONS to apply to prod FIRST**, enumerated (warn: deploying code before its migration breaks prod); **guard status** (are `SMOKE_*` + `RAILWAY_TOKEN`/service/env set for true auto-rollback, or MODE B alert-only = operator verifies by hand?); and confirm `main` is the merged, CI-green commit being deployed; (3) **deploy steps** — the Railway manual-trigger steps, OR if `RAILWAY_TOKEN` is present, offer to trigger on `operator approve deploy:`; (4) **post-deploy** — the smoke suite runs → green = mark live-verified + clear any dependent gate; red = rollback (auto if token, else the exact manual rollback step); (5) **reminder** — deploy ≠ client-facing until FOLD-L0-1 (conflicts-at-intake) is live-verified (self-use only). Then **halt for `operator approve deploy:`** (or the operator's confirmation they deployed manually). Record the deploy + smoke result via Rule 16. **MODE A collapse (effective once the automation is in place):** when (i) the pre-deploy migration runner is wired (`railway.json` `deploy.preDeployCommand` = `node scripts/apply-prod-migrations.mjs`, additive-only) AND (ii) the smoke secrets are present (`SMOKE_USERNAME`/`SMOKE_PASSWORD` + `RAILWAY_TOKEN`/`RAILWAY_SERVICE_ID`/`RAILWAY_ENVIRONMENT_ID`) with a dedicated smoke account provisioned, the DEPLOY PROMPT **collapses to MODE A**: the operator's single action is **"Railway `Ctrl+K` → Deploy Latest Commit"**, and **migrations (pre-deploy), verification (post-deploy smoke), and rollback-on-red are automatic** — the manual TiDB migration steps and by-hand checks are shown only as a *fallback*. When either precondition is missing, show the full **MODE B** checklist (enumerated manual migrations + by-hand verify + manual rollback step). Always keep (5) the not-client-facing-until-FOLD-L0-1 reminder, and flag any **destructive/non-additive** migration as excluded from the pre-deploy path (operator-gated/manual). Effective going forward. *(Caveat to carry until proven: the Railway GraphQL auto-rollback path in `tools/deploy/smokeCore.mjs` is UNTESTED against a live token — on first real RED, confirm the rollback or use the printed manual step.)*

### Confirmation-gate decisions Kelly always wants surfaced
- Phase A → Phase B transition
- Branch push to origin
- PR open
- Merge to main — from **Phase 2 onward** this is the **per-phase merge** (`fold/phase-<n>` → `main`, one merge at the phase boundary on full-CI-green; Rule 17), auto under Rule 15 only when no unresolved decision/residual surfaced across the phase, else `operator approve accept:`. Within a phase, engagements merge onto the **phase branch**, not `main`. (Phase 1 finishes on `main` as-is.)
- Prod deploy (`operator approve deploy:`) — deploy is never automated (Railway auto-deploy-on-merge is OFF; merge ≠ deploy), now naturally per-phase off `main`
- Deploy-trigger milestone reached (Rule 18) — at a phase boundary, a post-deploy live-verification dependency, or an urgent/security fix: proactively surface the DEPLOY PROMPT (what's in the deploy + pending prod migrations + guard status + Railway trigger/rollback steps + the not-client-facing-until-FOLD-L0-1 reminder) and halt for `operator approve deploy:` — deploy is still never autonomous
- Railway config change
- Production DB mutation or migration
- Production cleanup or data deletion
- Starting a FIRE engagement (→ §3.1 triad review of its plan) or an engagement that expands scope beyond transactional document-assembly — NOT routine reversible build-and-PR engagement/increment starts (those self-approve per Rule 8)
- Reclassifying a failure as ACCEPTED_RISK
- Skipping or deferring an engagement
- Any state.json write changing list membership (Rule 11)
- Any append to this CLAUDE.md file (diff-gated)
- External triad-review checkpoint reached (see `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §3.1): before implementing an engagement that **establishes or changes a load-bearing decision** meeting ALL THREE prongs — (a) hard to reverse once shipped, (b) not caught by CI, and (c) access-control / privilege-confidentiality / ethics-conflicts / client-send-safety / data-destruction risk; and on any §3 Class-T trigger (blocked engagement, failed live verification, corrected diagnosis, or >=2 failed attempts). A downstream engagement that only implements an already-triad-reviewed design, and mechanical/additive/reversible build, does NOT fire (it rides the parent's review). At the checkpoint, **auto-assemble a self-contained review packet** (decision under review + ready-to-paste reviewer prompt + document manifest + inlined Phase-A plan and relevant diffs/code — reviewable with no repo access), write it to `docs/reviews/<ID>_packet.md` and mirror it to the `…\phase2\reviews\<ID>_packet.md` Desktop path, then **halt** with `packet ready for <ID>`. Do NOT self-run or self-approve the review, and do not write code past the checkpoint, until the operator returns a disposition.

### Engagement document conventions
- Reports live at `docs/engagements/<ENGAGEMENT-ID>-<phase>.md` when committed
- `docs/STATE.md` is the append-only, newest-first running state log (Rule 16): one dated paragraph per close-out; mirrored to `…\_progress\STATE.md`. Phase-boundary handoff briefs live at `…\_progress\HANDOFF_BRIEF_<YYYY-MM-DD>_*.md` (the `HANDOFF_BRIEF_2026-06-02` format)
- FIRE-checkpoint review packets live at `docs/reviews/<ENGAGEMENT-ID>_packet.md`, mirrored to `C:\Users\Kelly\Desktop\Historical_Thread_Extraction\_analytical\phase2\reviews\<ENGAGEMENT-ID>_packet.md`; self-contained (reviewable with no repo access); append-only like reports
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
- land an engagement on its **phase branch** `fold/phase-<n>` and run CI there (Rule 17; Phase 2 onward) — nothing on `main` changes;
- wait on / report CI status;
- **auto-merge a reversible-lane PR once CI is green** (Rule 15) — only when no operator decision/fork was surfaced and no residual risk was flagged; otherwise stop for `operator approve accept:`. From Phase 2 this is the **per-phase** `fold/phase-<n>`→`main` merge at the phase boundary, on full-CI-green (Rule 17);
- perform the **ungated state upkeep** on close-out (Rule 16): update `state.json` status/commit/gate-impact for the just-closed engagement, append the `docs/STATE.md` dated paragraph, mirror it to `…\_progress\`, and at a phase boundary write the handoff brief;
- write close-outs to chat;
- prepare the next proposed state transition (but not write it — see hard stops).

#### HARD STOPS — never self-approve; stop and ask

- a §3.1 external-review checkpoint that returns **FIRE** — auto-assemble the self-contained review packet (`docs/reviews/<ID>_packet.md` + the phase2 Desktop mirror), then STOP for external triad review (GPT + independent Claude) BEFORE implementation; never self-run or self-approve the review (see `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §4);
- squash-merge to main **when the Rule-15 auto-merge conditions don't all hold** (a clean reversible-lane PR with green CI, no surfaced decision/fork, and no residual risk auto-merges per Rule 15; everything else still stops here). From Phase 2 the merge to `main` is the **per-phase** `fold/phase-<n>`→`main` merge at the phase boundary: auto on **full-CI-green** with no unresolved decision/residual (Rule 17); **HALT and flag if the phase CI is red**;
- any prod deploy (`operator approve deploy:`) — deploy is never automated;
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
