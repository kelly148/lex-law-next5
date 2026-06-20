# F2-ASYNC-REVIEWER-PREFLIGHT-1 — Pre-Flight Investigation

**Engagement class:** Investigation / READ-ONLY pre-flight (no code, no flags, no deploy, no prod mutation).
**Subject:** Activating the already-built async reviewer path — durable lanes + live Queued→Running→Returned — currently gated OFF behind `REVIEWER_ASYNC_ENABLED` + `JOB_DISPATCHER_ENABLED`.
**Date:** 2026-06-20 (America/New_York).
**Disposition:** **GO-WITH-WATCH** (see §7). The async path is end-to-end present, wired, tested, flag-gated, and rollback-safe. Activation has real, automatable preconditions (egress-plane migrations + flip order + hold posture) that must be VERIFIED before the operator flips prod flags.

---

## 0. Repo-state baseline + SHA reconciliation (READ FIRST)

| Item | Value |
| :-- | :-- |
| `origin/main` (activation HEAD) | **`67b45c7c67eb3a0c102db5150507fca86243ff66`** |
| HEAD commit subject | `feat(streaming): DRAFT-STREAMING-1 Inc 3 — OpenAI / xAI / Gemini generateStream (#364)` |
| Pre-flight branch | `lex-next/f2-async-preflight` (branched clean from `origin/main`; worktree `lex-uat-fix-wt`) |
| Files investigated against | the activation HEAD `67b45c7` (the worktree checkout) |

**SHA reconciliation.** The dispatch brief cited `25906d6` as the activation HEAD. That SHA is **not** `origin/main` — it is the local `main`-tracking worktree `lex-law-next5-mce`, which is **behind** the true remote. The authoritative activation HEAD is **`origin/main` = `67b45c7`**. The delta from `25906d6` → `67b45c7` is the F3 token-streaming series (PRs #362–#364, `DRAFT_STREAMING_ENABLED` — default-OFF, inert, drafts only). **F3 does NOT touch the async reviewer path** (`canonicalMutation.ts:743` explicitly excludes any job carrying an `egress` descriptor from the streaming seam, and reviewers always carry one). The pre-flight is therefore evaluated against `67b45c7`, and the streaming delta is activation-irrelevant.

**Evidence-class note (Rule 6).** This is a read-only source audit. "Confirmed by code inspection" = I read the file/line. "Not established here" = requires a live prod check I cannot and did not run (e.g., which commit is deployed, whether a migration physically ran, whether a standing hold exists). The async suites are asserted present by source audit; **I did not re-run CI** in this pre-flight (CI greenness is inherited from the CI-gated merges of #322–#364).

---

## 1. Completeness — is the async path end-to-end PRESENT and WIRED?

**Verdict: PASS.** The path is present end-to-end with an atomic outbox commit, durable job rows, restart reconstruction, per-reviewer lane orchestration, client live-refresh, and single-reviewer re-run. No TODO/stub/`FIXME` was found on the active async path.

End-to-end trace (all `src/server` / `src/client`, activation HEAD):

1. **Create / atomic outbox** — `procedures/reviewSession.ts:540` reads `isReviewerAsyncEnabled()`; `:604–635` commits session(`active`) + reviewer_lanes (async-only, `:615`) + ALL reviewer jobs(`queued`, frozen input) inside ONE `db.transaction` with a pre-generated `sessionId`; a duplicate-key race is caught and resumable (`SESSION_ALREADY_EXISTS`, `:153–156`).
2. **Post-commit transmit (async branch)** — `reviewSession.ts:652–672`: marks `lifecyclePhase='dispatching'` (recovery-refusal marker), registers a deferred continuation per reviewer, fires `runDeferredCanonicalJob` in the background (NOT awaited), resets phase in `finally`. Returns `{ sessionId }` immediately.
3. **Durable job row** — `jobs/reviewerJobFactory.ts:88–128` serializes frozen prompts + reconstruction params into `jobs.input`; `:135–289` `buildReviewerCanonicalParams` rebuilds the runtime contract from that durable input — reused by BOTH create and dispatcher post-restart reconstruction.
4. **Dispatcher** — `jobs/dispatcher.ts:206` registers the `reviewer_feedback` handler when `isJobDispatcherEnabled() || isReviewerAsyncEnabled()`; `:207–230` reconstructs params from committed `jobs.input` when the in-memory continuation was lost (post-restart), then `runDeferredCanonicalJob` (atomic `queued→running` claim dedupes a double-run).
5. **Lane deadline sweep (defense-in-depth)** — `dispatcher.ts:304–334` `reapStaleLanes` every 60s, gated on `REVIEWER_ASYNC_ENABLED` (independent of `JOB_REAPER_ENABLED`); reaps non-terminal lanes past `terminalDeadlineAt` (15 min) as `orphaned_reaped`; never clobbers a real terminal (`reviewerLaneState.ts:281–313`).
6. **Lane terminalization** — `reviewerLaneState.ts:122–155` `markReviewerLaneTerminal` with HI-3 LANE-OVERWRITE-GUARD-1 (failure-class restricted to non-terminal lanes; success/feedback terminals unconditional → "latest feedback wins").
7. **Session finalization** — `reviewerJobFactory.ts:330–354` `finalizeSessionLifecycleIfSettled` runs after each lane terminates and acts only when ALL lanes terminal; derives `partialReason` with hold-block precedence over non-response.
8. **Client live-refresh** — `client/components/AsyncLaneReviewView.tsx` renders honest N-of-M + per-lane Queued/Running/Returned, display-only, with a stalled banner after 5 min; `ReviewPane.tsx` polls (`refetchInterval` driven by `lanes.allTerminal`, self-terminating) and `DocumentDetail` sets `refetchIntervalInBackground:true` so polling continues while the tab is unfocused.
9. **Single-reviewer re-run** — `reviewSession.ts:1380–1495` `rerunReviewer` (async-only; rerunnable-lane-state guarded; reuses the `(session,reviewer)` idempotency slot; recomposes input against the CURRENT draft).

**Non-blocking doc-staleness (not a code gap):** `config/featureFlags.ts:60–62` still describes the async path as "v1 LIMITATION … fire-and-forget is in-process — a server restart mid-review loses the in-flight LLM call." That is accurate ONLY for `REVIEWER_ASYNC_ENABLED=ON` **with `JOB_DISPATCHER_ENABLED=OFF`**. With the dispatcher ON (the recommended posture), the durable outbox + restart reconstruction (steps 3–4 above, shipped by EGRESS-CONTROL-PLANE-1 Inc 2) close that gap. The comment is stale relative to the dispatcher being available; it is not a defect. No code change recommended in this read-only pre-flight.

---

## 2. Flag semantics, dependency, flip sequence, OFF byte-for-byte

**Verdict: PASS.** Both flags default OFF and are read with an exact `=== 'true'` string test against `process.env`:

- `REVIEWER_ASYNC_ENABLED` → `isReviewerAsyncEnabled()` — `featureFlags.ts:64–66`.
- `JOB_DISPATCHER_ENABLED` → `isJobDispatcherEnabled()` — `featureFlags.ts:80–82`.
- `JOB_REAPER_ENABLED` → `isJobReaperEnabled()` — `featureFlags.ts:96–98` (optional; restart-retry durability).

**What each gates.** `REVIEWER_ASYNC_ENABLED` gates: the async-vs-sync fork (`reviewSession.ts:540`), the lane insert (`:615`), the evaluator skip (`:734`, evaluator runs sync-only), the `rerunReviewer` precondition (`:1390–1395`, `RERUN_REQUIRES_ASYNC`), the long-timeout undici dispatcher (`llm/llmFetch.ts:30`, 720s async vs 300s sync), and the lane deadline sweep (`dispatcher.ts:314`). `JOB_DISPATCHER_ENABLED` (OR async) gates the dispatcher's `reviewer_feedback` handler registration (`dispatcher.ts:206`).

**The dependency (the dual-gate at `dispatcher.ts:206`):** `if (!isJobDispatcherEnabled() && !isReviewerAsyncEnabled()) return;` — register the handler if AT LEAST ONE is ON.

| Flag state | Behavior |
| :-- | :-- |
| both OFF (default/prod today) | Sync inline reviewers (`Promise.allSettled`, awaited); dispatcher no-op; **byte-for-byte unchanged** (`reviewSession.ts:673–714`, `dispatcher.ts:206`). |
| ASYNC ON, DISPATCHER OFF | Jobs committed `queued` but no handler registered → in-process fire-and-forget; a restart mid-run loses the in-flight call (the documented v1 limitation). **Avoid this intermediate state.** |
| DISPATCHER ON, ASYNC OFF | Handler registered but create still runs inline → nothing in the queue. Harmless no-op. |
| **both ON (target)** | Durable async: create fires background runs AND leaves durable `queued` jobs; the dispatcher polls and runs/recovers them; the atomic `queued→running` claim dedupes. |

**Safe flip order: `JOB_DISPATCHER_ENABLED=true` FIRST (or simultaneously), then `REVIEWER_ASYNC_ENABLED=true`.** Setting `REVIEWER_ASYNC_ENABLED` first (dispatcher still OFF) opens a window of in-process fire-and-forget where a restart loses work. Reverse is not catastrophic but is strictly worse.

**OFF byte-for-byte.** Every lane write is inside `if (reviewerAsync)`; the sync path writes zero lanes, no `lifecyclePhase` transitions, no `dispatching` phase. With both OFF the dispatcher returns at `:206` and never registers a handler. Confirmed by the guard tests in §4.

---

## 3. Migration safety — and the egress-plane coupling (KEY FINDING)

**Verdict: PASS on safety; GO-WITH-WATCH on completeness of the dependency set.**

**3a. Migration 0030 (reviewer_lanes) is additive + idempotent + safe.** `CREATE TABLE IF NOT EXISTS reviewer_lanes` (`migrations/0030_…sql:18`); all indexes INLINE in the CREATE (`:37–41`, incl. the UNIQUE) — no `ALTER … ADD INDEX` (the TiDB trap is avoided); no DROP/TRUNCATE/RENAME/`DELETE FROM`/statement-initial-UPDATE. It is in the prod allowlist (`scripts/apply-prod-migrations.mjs:94`) and `reviewer_lanes` is in `EXPECTED_TABLES_EXTRA` (`:186`). The `DESTRUCTIVE` guard (`:138–144`: DROP/TRUNCATE/DELETE FROM/RENAME/`(^|;)\s*UPDATE`) does NOT match 0030 (`ON UPDATE CURRENT_TIMESTAMP` is not statement-initial). **Safe to have already run; safe to re-run.**

**3b. KEY FINDING — the async flip depends on the EGRESS-plane migrations too, not just 0030.** At the activation HEAD the reviewer transmit is routed through the egress control plane **unconditionally** (no separate egress feature flag): `reviewerJobFactory.ts` attaches an `egress: { surface:'reviewer', … }` descriptor to every reviewer job's canonical params (the descriptor is NOT inside an `isAsync` guard — only its `onRunning`/`onBlocked` lane hooks are), and `canonicalMutation.ts:788` routes the single provider call through `documentEgressSend(...)` whenever `params.egress` is present. The async path's `onBlocked` hook (`reviewerJobFactory.ts:210–211`) marks the lane **`blocked_by_hold`** — a reviewer_lanes status value that exists ONLY after migration **0043**.

The egress gate is **fail-closed** (`egress/documentEgress.ts:95–116`, `egress/auditedEgress.ts:39–74`): a present `no_external` hold blocks (`hold_no_external`), and — critically — **a hold check that cannot be confirmed blocks too (`hold_check_uncertain`)**. The reviewer surface opts OUT of the provider allowlist (`enforceProviderAllowlist:false`), so providers are not blocked, but the hold check is unconditional. Therefore, if the egress hold table (0042) is missing on prod, every reviewer hold-check would fail → `hold_check_uncertain` → **all reviewers blocked** → every lane `blocked_by_hold` (which then also needs 0043's ENUM value to even persist).

**The full migration dependency set for the flip:**

| Migration | Supplies | In allowlist | Additive/idempotent |
| :-- | :-- | :-- | :-- |
| `0030_reviewer_async_display_1_reviewer_lanes.sql` | `reviewer_lanes` table (async-only) | yes (`:94`) | yes |
| `0041_egress_control_plane_1_egress_events.sql` | `egress_events` audit table | yes (`:149`) | yes |
| `0042_egress_control_plane_1_egress_hold.sql` | `egress_hold` table (the hold the gate resolves) | yes (`:150`) | yes |
| `0043_egress_control_plane_1_inc2_outbox.sql` | `review_sessions.lifecyclePhase`+`partialReason`, `reviewer_lanes.status += blocked_by_hold`, `jobs.idempotencyKey`, audit ENUM `review_session_transition` | yes (`:157`) | yes (ENUM values appended trailing; `ADD COLUMN/INDEX IF NOT EXISTS`) |

All four are additive (`0043` verified: ENUM `MODIFY` appends trailing values only; no column dropped/retyped; companion `lifecyclePhase` column added specifically because TiDB forbids `MODIFY` on a column a generated column depends on). All four are in `MIGRATIONS` and applied by `scripts/apply-prod-migrations.mjs`, which `railway.json` wires as `deploy.preDeployCommand` — so they **auto-apply on the next prod deploy of `67b45c7`** and the runner fails the deploy (keeping the old version serving) if any `EXPECTED_TABLES_EXTRA` table is missing afterward.

**Note on "net-new for the flip":** because the egress routing is unconditional for the reviewer surface, 0041/0042/0043 are already required by the CURRENTLY-DEPLOYED **sync** reviewer path if prod runs an egress-plane build. So if sync reviewers work in prod today, the egress tables are already applied, and the genuinely flip-specific additions are (i) `reviewer_lanes` (0030) and (ii) the `blocked_by_hold` ENUM value (0043) that only the async `onBlocked` path writes. Either way, the operator must VERIFY (see §7 watch item W1).

---

## 4. CI / test coverage — both flag states

**Verdict: PASS** (by source audit; CI greenness inherited from the CI-gated merges, not re-run here).

Server-side, both flag states are explicitly exercised:
- `reviewer_async_fanout_1.test.ts:25–38` (default-OFF; only `'true'` is ON), `:49–79` (async wiring: reads flag, atomic outbox, durable continuation, NOT fire-and-forget), `:65–75` (sync concurrent `Promise.allSettled`), `:76–78` (evaluator skipped in async).
- `reviewer_async_display_1.create_wiring.test.ts:75–96` (the ONLY lane write is inside `if(reviewerAsync)` → sync writes no lanes), `…client_guard.test.ts:37–41` (sync poll gate preserved).
- `dispatcher_complete_1.dispatcher.test.ts:65–73` (handler registered only when `JOB_DISPATCHER_ENABLED==='true'`), `…canonical_split.test.ts:186–200` (deferred path runs to terminal) / `:115–132` (inline path byte-for-byte: insert→markRunning→LLM→completed, one insert).
- `reviewer_async_display_1.lane_state.test.ts:34–105` (completion discipline with the adversarial 06-09 repro: zero-first ordering, failure-after-success, late-arrival reopen).
- `review_loop_ux_1_rerun_procedure.test.ts:105–108` (`RERUN_REQUIRES_ASYNC` when async OFF).
- `reviewer_async_fanout_2.test.ts:31–56` (720s async vs 300s sync timeout envelope; long-timeout dispatcher attached only when async ON).

Client-side render tests: `asyncLaneLiveRefresh.render.test.tsx:232–276` (live-refresh while unfocused, real `QueryClient`, `refetchIntervalInBackground`), `asyncLaneReviewView.render.test.tsx:39–91` (N-of-M + per-lane strip), `asyncLaneReopenAudit.render.test.tsx:44–74` (late arrivals strictly additive — no clobber/reorder), `reviewPaneAsyncParity.render.test.tsx:143–184` (suggestion parity with sync via the shared `SuggestionCard`).

No untested critical async conditional was found; the four async-gated branches in `reviewSession.ts` (`:615`, `:652`, `:734`, `:1390`) each have coverage.

---

## 5. Regression / rollback — flip OFF reverts cleanly

**Verdict: PASS.** Flipping both flags OFF reverts to the sync path with **no data migration and no one-way door**:
- The sync path is byte-for-byte preserved (§2, §4). With both OFF the dispatcher is inert (`dispatcher.ts:206`).
- `reviewer_lanes` rows are async-only (`reviewSession.ts:615`); the sync path never reads or writes them, so orphaned lane rows from a prior async run are harmless after rollback.
- The egress migrations (0030/0041/0042/0043) are additive and stay applied — they do not need to be reverted and do not change sync behavior.

**One operational rollback nuance (watch item W4):** an async session that is mid-flight at the instant you flip OFF leaves background/`queued` jobs. If `JOB_DISPATCHER_ENABLED` is also turned OFF, the dispatcher stops draining them; those sessions may sit non-terminal until CR-4 auto-recovery (stale-orphan abandon after `MAX_DISPATCH_WINDOW_MS` = 30 min, `reviewSession.ts:370–440`). Prefer to let in-flight async sessions settle before flipping OFF, or accept the ≤30-min CR-4 cleanup window. This is a clean degrade, not a wedge.

**Stuck-session interaction (improved by async, not worsened):** the atomic outbox commits the session+jobs+lanes before returning, and `finalizeSessionLifecycleIfSettled` settles the session strictly when all lanes are terminal — driven by lane state, not by a reviewer-completion side effect. A failed/timed-out/blocked reviewer terminalizes its own lane and the session settles when the last lane does. The lane deadline sweep (15 min) plus the CR-4 recovery are the backstops. The old "empty/active-on-failure" stuck-session wedge is closed on the async path because lanes are the source of truth for what is in-flight.

---

## 6. Gemini non-return / slow / failed reviewer interaction

**Verdict: PASS — async stops the attorney from blocking on a slow/failed reviewer.**

- **Sync (today):** `reviewSession.create` blocks on `await Promise.allSettled(...)` until EVERY reviewer settles, each bounded by a 300s timeout (`reviewSession.ts:692`, `:585`). One hung/invalid reviewer (e.g., Gemini's known `finishReason: MAX_TOKENS`-before-valid-JSON truncation) does not block the OTHER reviewers (allSettled isolates), but the client waits for the slowest.
- **Async (target):** `create` returns `{ sessionId }` immediately; each reviewer runs in the background under a 720s timeout. A slow/failed/non-returning reviewer:
  - never blocks `create` or the attorney;
  - terminalizes its OWN lane — success → `completed_with_feedback`/`completed_without_feedback`; parse failure or timeout → `txn2Revert` marks `failed`/`timed_out` (`reviewerJobFactory.ts:259`, `:279`); a `no_external` hold → `blocked_by_hold`;
  - is swept to `orphaned_reaped` if it blows past the 15-min lane deadline (`dispatcher.ts:304–334`), so a permanently non-returning provider cannot pin a session open forever;
  - the session settles (with `partialReason` = `blocked_by_hold` ▸ precedence ▸ `non_response` ▸ `null`) only when all lanes are terminal.

A Gemini truncation specifically: `parseFeedbackOutput` throws → `txn2Revert` → lane `failed` → other lanes continue → the session is finalized partial-by-non_response when the rest settle. No stuck active session. (No Gemini-specific token-budget workaround exists; the 720s envelope + lane deadline + retry are the safety nets — a documented empirical posture, not a defect.)

---

## 7. Activation recommendation — **GO-WITH-WATCH**

The async reviewer path is complete, correct, tested, flag-gated, and rollback-safe. Recommend activation **once the watch items below are verified**, because the reviewer transmit is now egress-routed and fail-closed (§3b), which makes the egress migrations a hard precondition rather than an optional extra.

**Exact env values to set (Railway prod), in order:**
```
JOB_DISPATCHER_ENABLED=true     # set first (or simultaneously) — registers the durable handler
REVIEWER_ASYNC_ENABLED=true     # then this — forks create() to background + lanes
JOB_REAPER_ENABLED=true         # recommended: restart-durable retry; closes the v1 fire-and-forget gap
```
(Any value other than the exact string `true` is OFF. `JOB_REAPER_ENABLED` is optional but recommended — without it, dispatch-retry counters live only in-process and a restart loses them.)

**Watch items / preconditions (verify BEFORE flipping):**

- **W1 — Migrations applied to prod (HARD precondition).** Confirm on prod TiDB: `reviewer_lanes` exists AND its `status` ENUM includes `blocked_by_hold`; `egress_events` and `egress_hold` exist; `review_sessions` has `lifecyclePhase` + `partialReason`; `jobs` has `idempotencyKey`. These auto-apply via the Railway `preDeployCommand` when `67b45c7` (or any build carrying 0030–0043) deploys — so **deploy `67b45c7` first, let the pre-deploy migration runner succeed, THEN flip.** Because the egress gate is fail-closed, a MISSING `egress_hold` table → `hold_check_uncertain` → ALL reviewers blocked. Do not flip on a prod that predates the egress-plane migrations. *(Cannot be confirmed from the repo; requires the operator's prod check.)*
- **W2 — Egress hold posture.** Confirm NO standing GLOBAL `no_external` hold is set (a global hold would block every reviewer → every lane `blocked_by_hold` → zero feedback). Per-matter holds are expected and fine (that is the gate working as designed).
- **W3 — Flip order.** `JOB_DISPATCHER_ENABLED` before/with `REVIEWER_ASYNC_ENABLED` (§2). Reverse opens an in-process fire-and-forget window where a restart loses work.
- **W4 — Rollback drain.** If rolling back, prefer to let in-flight async sessions settle first; otherwise accept the ≤30-min CR-4 cleanup of any session caught mid-flight (§5).
- **W5 — Live verification (Pattern 16, operator-driven).** After the flip: create a review session on synthetic data, watch Queued→Running→Returned refresh live (including with the tab unfocused), confirm feedback lands and the N-of-M aggregate is honest; confirm a deliberately slow/failed reviewer terminalizes its lane without blocking the others; confirm flipping both OFF reverts cleanly to the sync card view.
- **W6 — Known async v1 scope (informational, not blockers).** The advisory **evaluator is SKIPPED in async** (`reviewSession.ts:734`; fan-in is a deferred fast-follow) — if you rely on the evaluator pass, it will not run under async until that increment lands. The `featureFlags.ts:60–62` "fire-and-forget" comment is stale once the dispatcher is ON (§1).

**Why GO-WITH-WATCH and not unconditional GO:** every watch item except W1/W2 is satisfied in-code; W1/W2 are prod-state facts I cannot read from the repo, and W1 is genuinely load-bearing (a fail-closed egress gate over a missing hold table blocks all reviewers). Why not NO-GO: the code is complete and correct, the migrations are additive/idempotent/allowlisted/auto-applied, and rollback is a clean flag flip — none of the watch items indicate a defect, only a verification sequence.

---

## Out-of-scope log

- Wrote NO code, changed NO flags, ran NO migration, touched NO prod. Read-only throughout.
- Did not re-run CI (greenness inherited from the CI-gated merges of #322–#364).
- Did not inspect live prod state (deployed commit, physical migration status, standing holds) — flagged as W1/W2 for the operator.
- The stale `featureFlags.ts:60–62` doc comment (§1) is noted, not edited.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
