# CHAT-UI-1 — Gate 0 scoping: assessment + implementation plan

Date: 2026-06-11 (America/New_York). Engagement: Gate 0 scoping (INVESTIGATE AND PLAN ONLY).
Branch: `lex-next/gate0-scoping` off `origin/main` (`08f4d6a`). No source/build/flag/migration
changes were made. This document supersedes nothing; it is the plan for operator review.

Companion docs: `BUILD_BRIEF.md` (held verbatim), `GATE0_STATUS.md` (the 2026-06-11
reality-check; this plan re-verifies its three "NOT MET" findings against the *current* tree and
then plans the build).

## Evidence-class note

Every status below was re-verified against the code on this branch (HEAD `08f4d6a`), not taken from
stale notes. Each claim is tagged file:line where "confirmed by code inspection." Three facts are
"per operator-side doc": (1) the names/scope of the three Gate-0 engagements (from `GATE0_STATUS.md`);
(2) the async-UAT failure record and the "GPT-5 found 11 issues" evidence, which live **only** in
`C:\Users\Kelly\Desktop\Historical_Thread_Extraction\_progress\BUG_LOG.md` (row `REVIEWER-ASYNC-DISPLAY-1`)
— there is **no** `BUG_LOG.md` in the repo and no "11 issues" string anywhere in the tree; (3)
REVIEWER-ASYNC-FANOUT-1 "merged + deployed, flag-OFF" (the code exists and is flag-gated; the live
deploy is per `STATE.md`/state.json, not re-verified here). `GATE0_STATUS.md` cites `origin/main` as
`1251df3d`; that SHA predates the W0–W3 / wiring / backend-act merges — the current HEAD is `08f4d6a`
and the three prerequisite statuses are unchanged, so there is no contradiction, only a stale SHA in
the older doc.

---

# PHASE 1 — Current verified state of the three Gate-0 components

## 1A. JOB-RECOVERY-1 — durable recovery of stuck/orphaned jobs + review sessions

**What it is.** Durable recovery for two failure modes: (a) a job left in `running` after a
server crash/restart mid-LLM-call (an orphan), and (b) a review session left in `state='active'`
when its reviewer job fails — which then blocks the next `reviewSession.create` with
`SESSION_ALREADY_EXISTS`. The specific code evidence point ("H3") is that `markJobFailed` in the
canonical-mutation revert-catch path is itself unguarded.

**Current status: NOT STARTED** (confirmed by code inspection — every component is in its pre-fix
state).

Evidence (confirmed by code inspection):
- `src/server/jobs/dispatcher.ts:80-88` — `logOrphanedJobs()` is still a `console.log` stub; its
  own comment says orphan detection "is a Phase 3+ concern… For Phase 2, we log a startup message."
  No DB query, no reaper. Header doc `:17-21`: "v1 does not have automatic recovery; operator
  intervention is acceptable." `startDispatcher()` (`:329`) calls only `logOrphanedJobs()` at boot.
- `src/server/db/queries/jobs.ts` — there is **no** `getStuckJobs` / `getRunningJobs` / reaper /
  `resolveStuckSession`. The only status-filtered read is `getQueuedJobs` (`:390`, `status='queued'`
  only — never `'running'`). Repo-wide grep: zero occurrences of `getStuckJobs`, `reaper`,
  `resolveStuckSession`, `reapStale`, `recoverOrphan`, `staleJobs` in non-test code.
- **H3 confirmed at source:** `src/server/db/canonicalMutation.ts:634, 661, 685` — each is a bare
  `await jw.markJobFailed(...)` **inside** a `catch (revertErr)` block, not wrapped in its own
  try/catch. If `markJobFailed` itself throws (e.g. the same DB outage that failed the revert), the
  exception is unhandled and the job stays `running` (orphaned). The two terminal failure-path calls
  (`:693`, `:738`) are unguarded bare awaits of the same class.
- **Stuck-active-session confirmed:** `src/server/procedures/reviewSession.ts:404-410` — a failed
  reviewer's `txn2Revert` only emits `generation_reset` telemetry; it does **not** change the review
  session state. `src/server/db/queries/phase4b.ts:803-814` — `updateReviewSessionState` accepts only
  `active | regenerated | abandoned`; there is **no** terminal `failed`/`completed` state.
  `reviewSession.ts:179-187` — `create` throws `SESSION_ALREADY_EXISTS` if an active session exists.
  Net: a failed reviewer leaves the session `active`, wedging the next create; only the manual
  user-driven `abandon` (`reviewSession.ts:1021`) clears it.
- **Heartbeat written but never read:** `jobs.ts:224-238` writes `lastHeartbeatAt` (only WHERE
  `status='running'`); `schema.ts:191-192` notes it is "step-based… NOT a live health-check." Nothing
  reads it to detect staleness.

What remains: a stale-`running` reaper + the `getStuckJobs` query; H3 try/catch hardening; a
stuck-session recovery path; making `lastHeartbeatAt` actually consumed; tests for all three.

## 1B. REVIEWER-ASYNC-DISPLAY-1 — trustworthy async reviewer display / fan-in (PRIORITY)

**What it is.** The display/fan-in half of async review: as background reviewer jobs land at
different times, the pane should (a) stream each result in as it arrives, (b) show latency honestly
(which of N reviewers are still pending vs returned), and (c) have a late result **reopen** an open
item rather than silently appending or vanishing (`BUILD_BRIEF.md:44`, W4). The **server** half
(REVIEWER-ASYNC-FANOUT-1: fire-and-forget dispatch + raised undici envelope) exists in code but is
dual-gated behind `REVIEWER_ASYNC_ENABLED` (default OFF).

**Current status: BROKEN / effectively NOT BUILT** (the display/fan-in does not exist; the existing
sync display actively mis-renders async runs).

The priority re-verification — the "GPT-5 found 11 issues" record. The figure is **not** in the
repo; it is in `…\_progress\BUG_LOG.md`, row `REVIEWER-ASYNC-DISPLAY-1` (Sev: Bug). Verbatim core:
found in async UAT 2026-06-09 (REVIEWER-ASYNC-FANOUT-1 live, flag ON, build `83d62fe`); a 4-reviewer
async run on a ~15k-char doc completed all backend lanes (Claude=10, Gemini=5, **GPT-5=11**, Grok=0
substantive issues), **but the pane rendered only Grok's "no suggestions"** — zero cards for
Claude/GPT/Gemini (DOM-confirmed). "Operator would conclude the review found nothing while GPT-5
found 11 issues." Hypothesized root cause in the log: async skips the evaluator → no
issueGroups/dispositions → the consolidated pane degrades to a single empty-lane view. The log marks
it Routed-to-Code, with async re-enable now **dual-gated** (this display fix AND DISPATCHER-COMPLETE-1).

Open issues, reconstructed from the current code against the W4 contract (the "~11"; the stored
artifact is the BUG_LOG row above, not an enumerated list — these are the concrete code defects):

- **I1 — Single-reviewer short-circuit.** `src/client/utils/reviewState.ts:113-117` —
  `deriveCompletionState` returns a terminal state on the **first** feedback row and never inspects
  how many reviewers were selected (comment `:114` "MR-0G ensures at most one reviewer" — false for
  multi-reviewer/async).
- **I2 — Polling stops too early.** `ReviewPane.tsx:1147-1157` — `reviewSession.get` `refetchInterval`
  returns `false` the moment `completionState` leaves `pending_or_running`, i.e. right after the
  first reviewer lands → a slower reviewer's later-persisted row is never re-fetched (the silent-vanish).
- **I3 — Late failure masked.** `reviewState.ts:122-126` — the terminal-failure branch sits **after**
  the `feedback.length > 0` early return, so a still-pending reviewer's `failed`/`timed_out` can never
  produce the `failed` state once a sibling succeeded (pinned by `mr3.reviewState.test.ts:152`).
- **I4 — No "partial / N-of-M pending" UI state.** `ReviewPane.tsx:1500-1593` renders exactly one of
  four mutually-exclusive terminal states; none shows arrived feedback **while** others still run.
- **I5 — Dishonest "no feedback" race.** If the first-returning reviewer legitimately returns zero
  suggestions while others run, the pane shows the "No suggestions returned" terminal screen and stops
  polling.
- **I6 — No late-results-REOPEN for async.** The only reopen path (durable orchestration open-items,
  `ReviewPane.tsx:1329-1334`) is evaluator-driven, and the evaluator is skipped in async mode — so it
  is inert; a late result cannot reopen an item.
- **I7 — Evaluator/consolidation fan-in absent in async.** `reviewSession.ts:443-446`
  (`!reviewerAsync && …`) — multi-reviewer async runs get no consolidation, no denominator, no
  convergence. **This is the most likely root cause of the 06-09 UAT empty-lane render.**
- **I8 — Honest denominator is display-only.** `ReviewPane.tsx:1360-1375` — the N-of-M header/tooltip
  does not gate polling or completion, so it cannot keep the pane open or bring a late reviewer back.
- **I9 — Decoupled polling gates.** `ReviewPane.tsx:1130-1145` (`job.poll`) keeps polling while a
  reviewer is `running`, but the feedback short-circuit in the `session.get` deriver already declared
  the session terminal, so the still-running signal never reaches the rendered state.
- **I10 — No server completeness contract.** `reviewSession.get` (`reviewSession.ts:638-664`) exposes
  no expected-vs-returned reviewer count; the client must infer from `feedback.length` (the root of I1).
- **I11 — Engagement unbuilt + untested + dual-gated OFF.** No commit/branch/PR/queue/doc; no test
  covers "1 feedback row present + 1 reviewer still running" or async fan-in/late-failure; the whole
  async substrate is dual-gated OFF (`featureFlags.ts:64-66`; `llmFetch.ts:30`).

What remains: a reviewer-count-aware completion model; a "partial" display state; poll-until-all-terminal;
surface per-reviewer failure independently; an async fan-in/consolidation (evaluator or equivalent)
that does not assume the sync all-complete path; the W4 late-results-reopen; a server completeness
contract; and the engagement scaffolding + tests.

## 1C. DISPATCHER-COMPLETE-1 — durable execution dispatcher

**What it is.** A job/review dispatcher that runs queued work to completion durably — retries,
completion tracking, no silent drops, survives restarts.

**Current status: PARTIAL / scaffold-only** (the loop and resilience exist; it dispatches nothing).

Evidence (confirmed by code inspection):
- `dispatcher.ts:64-68` — `_handlers` registry + `registerJobHandler`. **Repo-wide grep:
  `registerJobHandler` has exactly ONE occurrence — its own definition. ZERO callers.** `_handlers`
  is permanently empty. `pollOnce` (`:279-287`) logs "No handler registered for jobType=…" and skips
  every job. The dispatcher runs at boot (`index.ts:803`) as a permanent no-op.
- All real LLM work runs **inline**, not via the dispatcher: drafts/extraction/regeneration/formatting
  `await executeCanonicalMutation(...)` in-request (`documents4a.ts:228, 579, 747, 1229`); reviews
  in-request (`reviewSession.ts:318`) either awaited (sync) or fire-and-forget in the same process
  when `isReviewerAsyncEnabled()` (`reviewSession.ts:413-421`). `canonicalMutation.ts:398` inserts
  `status='queued'` then `:414` `markJobRunning` immediately inline — the job never waits in `queued`
  for a dispatcher to pick it up.
- Real, working capability the dispatcher **does** have: poll-query transient-retry
  (`pollQueryWithRetry`, `:206-239`, 3 retries) and a consecutive-failure fatal handler →
  `process.exit(1)` at threshold 5 (`:245-274`) for a Railway restart. This guards the poll query
  only, not job execution. Handler dispatch (`:289-307`) is fire-and-forget — no completion tracking,
  no retry, no re-queue.

What remains: register real handlers; change enqueue so jobs are **left** `queued` for the dispatcher;
durable handler-completion tracking + retry/re-queue on failure; real orphan recovery (shared with
JOB-RECOVERY-1); an atomic `queued`→`running` claim/lease so a polled job cannot double-dispatch.

---

# PHASE 2 — Dependency map (what Gate 0 unblocks, from the code)

## The chokepoint: `executeCanonicalMutation`

`src/server/db/canonicalMutation.ts:357-799` is the single LLM chokepoint and is **inline** (the
whole queued→running→terminal lifecycle runs inside the caller's tRPC request — there is no detached
worker). Every job type inherits, through it: prompt **composition** (`resolvePromptComposition`,
`:453`), **prompt_snapshots** (DRAFT-only today, `:117/:530` — a new job type must be added to
`DRAFT_SNAPSHOT_JOB_TYPES` to be audited), **retry** (`isTransientRetryable`/`MAX_LLM_RETRIES=2`,
`:146-186` — transient 429/5xx only; never timeout/cancel/auth/parse), and **cancellation** (per-job
`AbortController` registry, `:323-335`). The master-injection layer already rides this chokepoint, so
anything routed through it inherits the master automatically.

## What each downstream surface depends on

- **chat → model dispatch.** The ChatSurface composer is an inert placeholder (`ChatSurface.tsx:96-104`
  — "Composer placeholder… No send control"); there is no chat→model dispatch and no `chat_turn` job
  type anywhere (verified absent in the `jobType:` grep). The requirement (`PROMPT_INJECTION…:76`) is
  that a chat turn be a **job type through `executeCanonicalMutation`** so it inherits the above. A
  chat turn run inline would block the request for the full turn (the exact multi-minute UX the
  operator rejected for reviewers); run fire-and-forget it would be lost on restart. **chat-dispatch
  therefore depends on DISPATCHER-COMPLETE-1 (durable detached execution) + JOB-RECOVERY-1 (restart
  recovery).** It does **not** depend on REVIEWER-ASYNC-DISPLAY-1.
- **W4 (live reviewer/disposition surface).** Gate-0-blocked and deferred (`GATE0_STATUS.md:29-31`;
  `ChatSurface.tsx:8-9`). It dispositions real reviewer findings with disposition-aware regenerate and
  late-results-reopen. **W4 depends on all three:** REVIEWER-ASYNC-DISPLAY-1 (the trustworthy surface
  it dispositions *from*), JOB-RECOVERY-1 (so a failed/orphaned reviewer is recovered and the session
  is not wedged), and DISPATCHER-COMPLETE-1 (durable reviewer execution surviving restart). It is the
  most dependent surface.
- **Phase D (master-injection "chat always-on").** Per its own plan it is "gated on the chat→model
  wiring (which does not exist yet), Gate 0, and the triad review" (`PROMPT_INJECTION…:150, 167`).
  Master injection already rides the chokepoint, so Phase D needs **no new injection machinery** — it
  needs the chat-dispatch job type to exist. **Phase D's Gate-0 dependency is therefore transitive
  through chat-dispatch → DISPATCHER-COMPLETE-1 + JOB-RECOVERY-1** (and D-6's "fail-loud" posture
  requires durability — a silently-dying fire-and-forget turn cannot honor it). Plus a process gate:
  an external triad review (D-8), separate from the code dependency.

## Code-driven build order among the three

1. **DISPATCHER-COMPLETE-1 first** — the substrate. Until jobs genuinely run detached through a
   registered handler in the durable queued lane, both recovery and durable async are meaningless.
2. **JOB-RECOVERY-1 second** (depends on 1) — recovery is only coherent once there is a durable lane
   to recover *into* and re-dispatch *from*; it also clears the stuck-active session.
3. **REVIEWER-ASYNC-DISPLAY-1 third** (its display logic is largely file-independent, but its prod
   re-enable is dual-gated on the dispatcher, and a robust display is only worth shipping once the
   jobs it renders run durably and don't strand on restart).

So: **DISPATCHER-COMPLETE-1 → JOB-RECOVERY-1 → REVIEWER-ASYNC-DISPLAY-1.** chat-dispatch (and Phase D
riding it) becomes safe after 1+2; W4 needs all three.

---

# PHASE 3 — Implementation plan

Principles: every increment is **flag-gated, reversible, and CI-testable**; the inline path stays the
default until each new lane is proven; no increment requires a destructive or non-additive migration
(the one place a migration could arise — a new session state — is avoided by reusing the existing
`abandoned` state; see R-3). Local gates are runnable; run the FULL suite before any push. Any new
matter-scoped table/column must be wired into `purgeMatter`. Increments map to per-engagement PRs;
per Rule 17 these land on a phase branch once we are at a clean phase boundary.

## Component A — DISPATCHER-COMPLETE-1 (build first)

New flag `JOB_DISPATCHER_ENABLED` (default OFF). The dispatcher stays a no-op until a handler is
registered **and** the flag is on; the inline path is untouched when OFF.

- **D-1 — Register one handler behind the flag (shadow).** Register a handler for one job type
  (`reviewer_feedback`) that invokes the existing canonical logic; gate registration on
  `JOB_DISPATCHER_ENABLED`. Acceptance: flag ON → a queued job is claimed and run to terminal; flag
  OFF → byte-for-byte current behavior (work runs inline). Tests: registration, claim, single-run.
- **D-2 — Atomic claim/lease (the load-bearing semantics decision).** Add an atomic `queued`→`running`
  claim (conditional UPDATE returning affected rows; 0 rows = lost the race) so a polled job cannot
  double-dispatch. This fixes the at-least-once-vs-exactly-once question for the lane. Acceptance:
  concurrent-claim test → exactly one winner; a claimed job is never re-run. Tests only; no migration.
- **D-3 — Completion tracking + bounded retry/re-queue.** On handler failure, bounded re-queue up to
  N then mark terminal-failed — replacing the fire-and-forget drop (`dispatcher.ts:289-307`).
  Acceptance: a failing handler re-queues N times then fails; nothing is silently dropped. Tests with
  an injected failing handler.
- **D-4 — Route async reviewers through the dispatcher.** Behind `JOB_DISPATCHER_ENABLED` +
  `REVIEWER_ASYNC_ENABLED`, change the async-reviewer enqueue to leave the job `queued` for the
  dispatcher instead of in-process fire-and-forget. Acceptance: a queued reviewer job runs via the
  dispatcher to terminal; a simulated restart leaves it recoverable (hands off to JOB-RECOVERY-1).

## Component B — JOB-RECOVERY-1 (build second)

- **R-1 — H3 hardening (no flag; strictly safer).** Wrap the bare `markJobFailed` calls in the
  revert-catch blocks (`canonicalMutation.ts:634, 661, 685`) and the terminal calls (`:693, :738`) in
  try/catch so a `markJobFailed` throw can never strand a job. Acceptance: an injected throwing
  `markJobFailed` is caught + logged; no unhandled rejection; the job is still best-effort terminalized.
  Tests mock `markJobFailed` to throw.
- **R-2 — `getStuckJobs` + reaper.** New query `getStuckJobs` (`status='running'` AND `lastHeartbeatAt`
  older than `ORPHAN_THRESHOLD_MS`) and a reaper that marks each terminal (`timed_out`/`failed`), run
  at startup and on a periodic sweep, behind `JOB_REAPER_ENABLED` (default OFF). Replaces the
  `logOrphanedJobs` stub. Acceptance: a seeded stale `running` job is reaped; a fresh one is not (fake
  clock). No migration (reuses existing columns/states).
- **R-3 — Stuck-session recovery (no migration; recommended).** When a reviewer job is terminal-failed
  and its session is still `active` with no other live reviewer, recover the session by reusing the
  existing `abandoned` state with a recovery reason — so `SESSION_ALREADY_EXISTS` stops wedging the
  next create. **Recommended path avoids a schema enum change** (no migration, fully reversible).
  Acceptance: a failed-reviewer session no longer blocks the next create; an attorney's adopted
  decisions are untouched. Tests cover the recover-and-recreate path. (Alternative — a new terminal
  `failed` session state — is an additive enum migration, operator-gated; flagged here, **not**
  recommended for v1.)

## Component C — REVIEWER-ASYNC-DISPLAY-1 (build third; FIRE — triad review before implementation)

- **AD-1 — Reviewer-count-aware completion.** Replace/extend `deriveCompletionState` to take the
  expected reviewer set + per-reviewer job/feedback status; report a fully-terminal state only when
  every expected reviewer has a row or a terminal job, else a new `partial` state. Fixes I1, I3.
  **Note:** the current single-reviewer tests (`mr3.reviewState.test.ts:152, 163`) encode the false
  assumption; updating those assertions is an intended behavior change and a surfaced decision (part
  of the FIRE review).
- **AD-2 — Partial / N-of-M display + poll-until-all-terminal.** Add the `partial` UI state to
  ReviewPane (arrived feedback renders while remaining reviewers show pending); keep `reviewSession.get`
  polling until ALL expected reviewers are terminal. Fixes I2, I4, I5, I8, I9.
- **AD-3 — Async fan-in / late-results-reopen (root-cause fix for the 06-09 UAT).** Restore an async
  consolidation/fan-in that does not depend on the sync all-complete assumption (the evaluator is
  skipped in async today, `reviewSession.ts:443-446`), and implement the W4 late-results-reopen. Fixes
  I6, I7. Acceptance: the exact 4-reviewer UAT repro renders each lane's substantive feedback (no
  empty-lane render); a late lane reopens the item.
- **AD-4 — Server completeness contract.** `reviewSession.get` exposes expected-vs-returned reviewer
  count so the client gates fan-in authoritatively rather than inferring from `feedback.length`. Fixes
  I10. Acceptance: client renders partial/complete from the server contract.

Scheduling note: because Component C is a FIRE, assemble its triad packet **early** (right after this
plan is accepted) so the external review runs concurrently with the Component A/B build — the review
is the long pole, not the code.

### Triad-review disposition (2026-06-11) — APPROVE WITH CHANGES (3/3); required changes folded

The §3.1 external triad (GPT + two independent Claude) returned **APPROVE WITH CHANGES, 3/3
concurrence.** No reviewer found the AD-1…AD-4 direction unsound; all three independently converged on
a **server-owned completeness contract** replacing client `feedback.length` inference. The HARD STOP on
Component C implementation **lifts**, conditional on the following changes being folded here (done).
Full disposition: `docs/reviews/REVIEWER-ASYNC-DISPLAY-1_packet.md` §10.

**Ratified operator decision (the completion denominator).** The denominator is the **INTENDED reviewer
set**, persisted at review-iteration creation and **immutable**. A dispatch failure is surfaced as a
terminal **`dispatch_failed`** lane and is **never dropped** from the denominator; the run proceeds
**partial** — it does **not** atomic-fail the whole run.

**Blocking conditions (all required for the approval; they refine AD-1…AD-4):**

1. **Server-owned per-reviewer lane contract (refines AD-4 — now the core of Component C).**
   `reviewSession.get` returns, per reviewer, `{ status, terminal, suggestionCount, feedbackRowId,
   jobStatus, failureReason, timestamps }` plus aggregate `expected / terminal / returned / failed /
   pending` counts and a derived `displayState`. The client **renders and gates polling off this
   payload** and **stops** using `deriveCompletionState(feedback, jobs)` for async. Lanes are **keyed by
   reviewer identity** and **deduped to the latest-terminal-per-reviewer** under durable-dispatch
   retries. (Single source of truth for both "keep polling?" and render — closes I9.)
2. **Immutable expected set (refines AD-1).** The expected reviewer set is **persisted at iteration
   creation, before dispatch**, and is never reconstructed from whatever jobs/rows happen to exist.
3. **Fan-in is a distinct layer (refines AD-3).** Completion/terminalization is computed independently of
   the evaluator. The evaluator runs **downstream and advisory-only**, after all expected lanes are
   terminal. **Display completeness must survive the evaluator being disabled, skipped, slow, or
   failed.** Fan-in is **idempotent**, triggered from **job completion/recovery (not from
   `reviewSession.get`)**, and guarded by a `(session_id, iteration_id, consolidation_type)` lock.
4. **Bounded terminalization (defense-in-depth, owned here).** Every expected lane reaches a terminal
   status server-side: `completed_with_feedback`, `completed_without_feedback`, `failed`, `timed_out`,
   `dispatch_failed`, `orphaned_reaped`, `canceled`. Component C **owns a server-side per-reviewer
   terminal-deadline** as defense-in-depth — it does **not** delegate liveness solely to JOB-RECOVERY-1.
   The **client never invents completion**: a client elapsed-time window drives an **"incomplete — here
   is what arrived; send is blocked/flagged pending a recorded attorney override"** state, **not** a
   fake terminal status.
5. **Per-reviewer empty-vs-pending (refines AD-2).** Empty-vs-pending is judged **per reviewer**. The
   global "no suggestions" verdict appears **only** when ALL expected lanes are terminal AND total
   suggestions across all lanes == 0. `completed_without_feedback` requires an **affirmative zero-result
   record** (never inferred from job-done + no-row). A distinct **`complete_with_failures`** state when a
   lane failed but siblings succeeded.
6. **Iteration + document-revision isolation (blocking).** Key every job / feedback row / evaluation /
   lane to `session_id + iteration_id + document_revision_id` (or `draft_hash`). A late result from an
   **older** iteration is shown ONLY as an old-iteration result, never merged into the current pane.
7. **Late-results-reopen is strictly additive (blocking).** Reopen must **not reset, reorder, or
   re-derive** suggestions the attorney has already adopted/modified/passed. State the invariant
   explicitly; **require a test**.
8. **Consolidation incompleteness flag.** Consolidation output carries an explicit **incompleteness
   flag** labeled with the set it ran over ("based on 3 of 4; reviewer X timed out"), so a synthesis
   over a partial set never reads as consensus.
9. **Audit snapshot at finalize/send.** Capture which reviewers had completed, their suggestion counts,
   and which were pending/failed **at the moment of send** — the malpractice-defense artifact.
10. **Job-terminal-before-row race.** Require transactional write ordering, OR treat "completed job, no
    result record yet" as **NOT display-terminal**.
11. **Unknown/unselected reviewer row.** Ignored for the denominator (logged as an anomaly), never
    counted as expected completion.

These conditions are **binding refinements** of AD-1…AD-4: where a condition and an original AD bullet
differ (notably AD-4 → condition 1's per-reviewer lane contract, and AD-1 → condition 2's immutable
intended set), the condition governs. The sanctioned `mr3.reviewState.test.ts:152,163` assertion changes
are **approved** as part of this disposition and are made in the Component C **build**, not in this
record.

## Exit criteria — "Gate 0 MET" (falsifiable)

1. **DISPATCHER-COMPLETE-1:** at least one job type runs end-to-end through a registered handler in
   the durable queued lane (flag ON), with an atomic claim (no double-dispatch), completion tracking,
   and bounded retry/re-queue on handler failure — proven by tests; the inline path is unchanged when
   the flag is OFF.
2. **JOB-RECOVERY-1:** H3 calls are try/catch-guarded; a stale `running` job is reaped to terminal by
   the sweep; a failed-reviewer session is recovered so it no longer wedges the next create — all
   proven by tests; no destructive migration.
3. **REVIEWER-ASYNC-DISPLAY-1 (expanded per the 2026-06-11 triad disposition):** the server-owned
   per-reviewer lane contract (condition 1) drives both render and polling — the client no longer infers
   async completion from `feedback.length` — and every expected lane terminalizes server-side
   (condition 4). The following all pass as tests:
   - the exact **06-09 repro** (Claude=10/Gemini=5/GPT-5=11/Grok=0) under **adversarial orderings** —
     zero-first, failure-after-success, late-arrival;
   - **dispatch-failure** terminal lane (`dispatch_failed`, never dropped from the denominator);
   - **timeout / orphan terminalization** (no infinite pending);
   - **iteration-staleness isolation** (an older-iteration result never merges into the current pane);
   - **job-terminal-before-row** (no false display-terminal);
   - **duplicate-retry idempotency** (latest-terminal-per-reviewer dedupe);
   - **evaluator-disabled** (lanes still display correctly without the evaluator);
   - **late-reopen-without-clobber** (adopted/modified/passed suggestions untouched);
   - **single-reviewer regression** (the genuine one-reviewer path still correct).
   Plus: its §3.1 triad review is **dispositioned** (APPROVE WITH CHANGES, 3/3 — recorded 2026-06-11).
4. **Dual-gate satisfied (retained per the 2026-06-11 disposition):** `REVIEWER_ASYNC_ENABLED` can be
   turned on in prod only after (2)+(3)+the dispatcher lane (1) — i.e. async survives restart and the
   display is trustworthy. (Flag-flip is a separate operator-gated step; reaching MET does not flip it.)
5. **Unblocked:** with 1–4 done, chat→model dispatch (a `chat_turn` job type through
   `executeCanonicalMutation`, riding the dispatcher) and W4 can be built on a durable substrate; Phase
   D's code dependency is satisfied (its separate triad gate remains).

## §3.1 external-triad checkpoint triage (one line per component)

- **DISPATCHER-COMPLETE-1 — Checkpoint triage: skip** — reversible, flag-gated execution-infra build
  for draft/review jobs; it makes no access-control / privilege / client-send-safety / data-destruction
  decision by itself, and the claim/retry semantics are CI-testable. (The execution-semantics decision
  rises to a FIRE only when a *consequential act* — chat-dispatch / send — is later routed through the
  lane; that FIRE attaches to the chat-dispatch engagement, not to this one.)
- **JOB-RECOVERY-1 — Checkpoint triage: skip** — reversible recovery infra (H3 try/catch + stale-job
  reaper + stuck-session clear); the recommended recovery path reuses the existing `abandoned` state
  (no migration) and destroys no attorney decision; CI-testable. (Re-triage only if R-3 is instead
  built as a session-state enum migration or auto-discards in-flight work.)
- **REVIEWER-ASYNC-DISPLAY-1 — Checkpoint triage: FIRE** — Class-T trigger: it is the fix for a
  **failed live-verification** (async UAT 2026-06-09: the pane showed "no suggestions" while GPT-5 had
  11 substantive issues). It also meets the three-prong test independently — the trustworthiness of the
  reviewer display is **client-send-safety** (an attorney could send a defective document believing
  review found nothing), the async fan-in design is load-bearing and hard to reverse once attorneys
  rely on it, and async-timing correctness is not caught by CI. Per Rule 13 / `EXTERNAL_TRIAD_REVIEW_
  CHECKPOINTS.md` §3.1, this component's implementation requires the self-contained triad packet
  (GPT + independent Claude) **before** any code; the packet is assembled at the implementation-entry
  gate, not in this plan-only engagement.
  **Disposition (2026-06-11): RETURNED — APPROVE WITH CHANGES, 3/3.** The HARD STOP is **LIFTED**,
  conditional on the required-changes fold above (done; see the "Triad-review disposition" subsection in
  Component C and `docs/reviews/REVIEWER-ASYNC-DISPLAY-1_packet.md` §10). Implementation remains
  sequenced after Components A/B and operator-gated; the sanctioned `mr3.reviewState.test.ts` assertion
  changes happen in the Component C build.

---

## Scope confirmation

This engagement was INVESTIGATE AND PLAN ONLY. No source, build, flag, or migration changes were made.
Local `main`, `origin/main`, the review-report branch, and `.claude/settings.json` were not touched.
The pre-existing `M .claude/settings.json` and four untracked `prompts/*.md` files in the working tree
are not mine and were left untouched. The only write is this plan document, committed to the scoping
branch per Rule 12 (architecture-planning report commits by default; the branch is local and unpushed).
Implementation of any component, the per-engagement FIRE packet for REVIEWER-ASYNC-DISPLAY-1, all
merges, the flag-flip, and any deploy remain operator-gated and are not started.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
