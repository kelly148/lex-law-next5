# F2-ASYNC-REVIEWER-ACTIVATION-RUNBOOK-1 — Deploy + Migration-Verify + F2 Flip + Live-Verify

**Class.** Operator-facing runbook (reference). **This document describes operator-gated actions; it does NOT execute any of them.** No deploy, no flag flip, no migration, no prod mutation was performed to write it — it is the product of a read-only source audit of `origin/main` at `3d03a1d`.

**Scope of the move.** Advance prod `25906d6` → `3d03a1d`, then (as a SEPARATE, later step) activate the async reviewer path by flipping `REVIEWER_ASYNC_ENABLED` + `JOB_DISPATCHER_ENABLED`. Every deploy and flip below is gated on `operator approve deploy:` / your explicit action.

**Date.** 2026-06-20 (America/New_York). **Evidence class (Rule 6):** "confirmed by code inspection" = a file/line was read; "not establishable from repo" = a prod-state or Railway-dashboard fact this audit cannot see (e.g., which build is deployed, whether a migration physically ran, whether a secret is set). All such items are called out for the operator to confirm.

---

## 0. READ FIRST — framing correction vs. the brief

The brief assumed this deploy *carries* the F2 async code and the fail-closed egress gate, and so *changes the existing sync reviewer path and hard-depends on the egress-plane migrations applying*. **The git history shows that is not what the `25906d6 → 3d03a1d` deploy does.** Confirmed by `git log`/`git diff`:

- The **only code** in `25906d6 → 3d03a1d` is **F3 token streaming** (#362/#363/#364, `DRAFT_STREAMING_ENABLED` default-OFF) plus two **docs-only** PRs (#365 pre-flight report, #366 STATE.md). Nothing in the delta touches the reviewer or egress path.
- **Zero migration files change** in the range — the migration set is identical at both commits (both top out at **0049**).
- The egress gate (`src/server/egress/documentEgress.ts`), the reviewer→egress wiring (`reviewerJobFactory.ts:186`, `canonicalMutation.ts:788`), the F2 async code, and migrations 0030–0049 are **already present at `25906d6`**.

**What that means operationally:**
- The egress gate is **already in prod's code at `25906d6`** — the *sync* reviewer path already routes every transmit through it. This deploy does **not** introduce it and does **not** change the reviewer path.
- This deploy carries **no new migration files**. The pre-deploy runner re-applies the *full* allowlist (0001–0049) idempotently on **every** deploy, so the egress-plane migrations are re-asserted, but they are not new here.
- Therefore this particular deploy is **low-risk** (dormant F3 + docs), and the migration-verify in §2/§5 is **confirming a standing prod-DB state** the live reviewer path already depends on — not validating a new change.
- **The one thing this audit cannot see:** whether prod's *database* is actually migrated through 0043+ today. If reviewers currently work on prod, it is — and §2/§5 are confirmations. If you are unsure, §5 is exactly how to find out. The runbook keeps the migration-verify + W2 + sync-reviewer smoke fully intact regardless, because it is the load-bearing safety step either way.

---

## 1. WHAT'S IN THE DEPLOY (`25906d6` → `3d03a1d`)

Five commits. Confirmed by `git log --oneline 25906d6..3d03a1d` and `git diff --name-only`.

| Commit | PR | Change | Runtime effect on deploy |
| :-- | :-- | :-- | :-- |
| `25b9c08` | #362 | DRAFT-STREAMING-1 Inc 1 — server token-streaming spine + Anthropic | **DORMANT** — `DRAFT_STREAMING_ENABLED` default-OFF; the streaming seam in `canonicalMutation.ts` is bypassed when off (`canStream` gated on `isDraftStreamingEnabled()`). Adds an inert `GET /api/stream/draft/:jobId` route. |
| `cd4f7b7` | #363 | DRAFT-STREAMING-1 Inc 2 — client incremental draft render | **DORMANT** — client hook only activates when streaming is on. |
| `67b45c7` | #364 | DRAFT-STREAMING-1 Inc 3 — OpenAI/xAI/Gemini `generateStream` | **DORMANT** — provider stream methods only reached when streaming is on. |
| `5b7a7f7` | #365 | F2 pre-flight report (docs) | **NONE** — `docs/` only. |
| `3d03a1d` | #366 | STATE.md Rule-16 bookkeeping (docs) | **NONE** — `docs/` only. |

**Active-on-deploy behavior change: NONE.** All code in the delta is flag-OFF (F3) or docs. The deploy does not alter the reviewer path, the egress path, or any un-flagged behavior.

**Already-present at `25906d6` (NOT introduced by this deploy):** the fail-closed egress gate that routes every reviewer transmit (`reviewerJobFactory.ts:186` attaches the `egress` descriptor unconditionally; `canonicalMutation.ts:788` routes through `documentEgressSend` whenever it is present — **not** F2-flag-gated), the F2 async reviewer code (flags `REVIEWER_ASYNC_ENABLED`/`JOB_DISPATCHER_ENABLED`/`JOB_REAPER_ENABLED` all default-OFF, `featureFlags.ts:64-98`), and migrations 0030–0049.

**Net:** deploying `3d03a1d` is a low-risk version bump. Its value is getting prod onto the CI-green tip; it does not, by itself, change reviewer behavior. The reviewer-behavior change (async) is the separate §6 flip.

---

## 2. MIGRATIONS — the runner re-applies the full allowlist every deploy (no NEW migrations here)

`railway.json:8` wires `deploy.preDeployCommand = node scripts/apply-prod-migrations.mjs`. On **every** deploy the runner connects to `DATABASE_URL` and applies **every** file in the `MIGRATIONS` allowlist, in order, before the new code serves; a non-zero exit **fails the deploy** and the previous version keeps serving (`apply-prod-migrations.mjs:227-241`, no half-migrated state). Each file is scanned by the `DESTRUCTIVE` guard first (`:192-210`: DROP / TRUNCATE / DELETE FROM / RENAME / statement-initial UPDATE → throw). After applying, the runner asserts every name in `EXPECTED_TABLES` + `EXPECTED_TABLES_EXTRA` is present via `SHOW TABLES` (`:235-241`).

**This deploy adds no new migration files** (§0). The table below is the egress-plane + recent migrations the prod reviewer path depends on — all already on the allowlist, all additive — with the exact post-deploy confirmation. **`0041/0042/0043` are LOAD-BEARING for reviewers** (see the box below).

| Migration | Allowlist | Creates / alters | Post-deploy verify on prod TiDB (read-only) | Auto-verified by runner? |
| :-- | :-- | :-- | :-- | :-- |
| `0030_…reviewer_lanes` | `:94` | TABLE `reviewer_lanes` (F2-async-only) | `SHOW TABLES LIKE 'reviewer_lanes';` → 1 row | **Yes** (in `EXPECTED_TABLES_EXTRA`) |
| `0041_…egress_events` ⚠ | `:149` | TABLE `egress_events` (egress audit ledger) | `SHOW TABLES LIKE 'egress_events';` → 1 row | **Yes** |
| `0042_…egress_hold` ⚠ | `:150` | TABLE `egress_hold` (the no_external hold) | `SHOW TABLES LIKE 'egress_hold';` → 1 row | **Yes** |
| `0043_…inc2_outbox` ⚠ | `:157` | **COLUMNS/ENUM only** — `review_sessions.lifecyclePhase`+`partialReason`; `reviewer_lanes.status += blocked_by_hold`; `jobs.idempotencyKey` + unique index; `audit_events.eventType += review_session_transition` | `SHOW COLUMNS FROM review_sessions LIKE 'lifecyclePhase';` and `… LIKE 'partialReason';` → 1 row each · `SHOW COLUMNS FROM reviewer_lanes LIKE 'status';` → ENUM **must include `blocked_by_hold`** · `SHOW COLUMNS FROM jobs LIKE 'idempotencyKey';` → 1 row · `SHOW COLUMNS FROM audit_events LIKE 'eventType';` → ENUM **must include `review_session_transition`** | **NO — manual** (runner checks tables, not columns/ENUM) |
| `0044_…party_model` | `:164` | TABLES `matter_entity`, `matter_entity_contact` | `SHOW TABLES LIKE 'matter_entity';` and `… 'matter_entity_contact';` → 1 row each | **Yes** |
| `0045_…notifications` | `:171` | TABLE `notifications` | `SHOW TABLES LIKE 'notifications';` → 1 row | **Yes** |
| `0046_…deadline_alerts` | `:175` | **COLUMNS/ENUM only** — `notifications.type += deadline`; `tickler.notifiedAt` + index | `SHOW COLUMNS FROM notifications LIKE 'type';` → ENUM includes `deadline` · `SHOW COLUMNS FROM tickler LIKE 'notifiedAt';` → 1 row | **NO — manual** |
| `0047_…posture_policy` | `:178` | TABLE `firm_conflict_policy` | `SHOW TABLES LIKE 'firm_conflict_policy';` → 1 row | **Yes** |
| `0048_…matter_posture` | `:181` | TABLE `matter_conflict_posture` | `SHOW TABLES LIKE 'matter_conflict_posture';` → 1 row | **Yes** |
| `0049_…deed_gate` | `:184` | TABLE `deed_gate` | `SHOW TABLES LIKE 'deed_gate';` → 1 row | **Yes** |

All eleven are **additive/idempotent** (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `CREATE [UNIQUE] INDEX IF NOT EXISTS` / trailing-append `ENUM MODIFY`) and trip **no** `DESTRUCTIVE` pattern — confirmed by reading each SQL file. **No non-additive or off-allowlist migration found → no gap.**

> **⚠ Why 0041/0042/0043 are load-bearing — confirmed by the code path, not asserted.**
> The reviewer transmit goes: `reviewerJobFactory.ts` (builds `egress` descriptor) → `canonicalMutation.ts:788` `if (params.egress)` → `documentEgressSend` → `resolveEffectiveHold` (`egressHold.ts:95-104`, a `SELECT` from `egress_hold`). The gate is **fail-closed**: `resolveEffectiveHold` returns a clean hold **or throws — it never silently returns "none"** (`egressHold.ts:9-11`). In `documentEgress.ts:105-111` any throw becomes block-reason `hold_check_uncertain` → `decision='blocked'` → no send. **If `egress_hold` (0042) is absent on prod, the `SELECT` throws → every reviewer is deterministically blocked** (lane `blocked_by_hold`, no feedback). If `egress_events` (0041) is absent, the synchronous pre-dispatch audit write fails → no send (failure path). If `0043` is absent, the `blocked_by_hold` ENUM value and the `review_sessions.lifecyclePhase`/`partialReason` columns the reviewer code reads/writes are missing → reviewer writes fail. These are prerequisites for a working reviewer path **right now at 25906d6**, independent of the F2 flip.

**Two non-blocking notes:**
- The runner's auto-check (`SHOW TABLES`) catches a missing **table** but **not** added **columns/ENUM values**. So **`0043` and `0046` are NOT auto-verified** — run their `SHOW COLUMNS` checks by hand (table above).
- The in-file SQL header comments in `0047`/`0048`/`0049` say "NOT on the apply-prod-migrations.mjs auto-apply allowlist — operator-applied at deploy." That comment is **stale/wrong**: all three **are** in the allowlist (`:178/:181/:184`) and the runner applies them automatically. Harmless (idempotent), but don't double-apply by hand thinking the runner skipped them.

---

## 3. PRE-DEPLOY GUARD STATUS — MODE A vs MODE B

**MODE A (automatic post-deploy smoke + automatic Railway rollback) is fully WIRED IN CODE, but whether it is ACTIVE is environment-dependent and not establishable from the repo.** The smoke/rollback tooling degrades gracefully (skip / alert-only, never throws) when secrets are absent, and the repo's own `tools/deploy/README.md:45-47` records the **current posture as ALERT-ONLY (no `RAILWAY_TOKEN`)** — i.e., effectively **MODE B for rollback**. The Railway GraphQL rollback is **admitted UNTESTED** against a live token in-code (`smokeCore.mjs:245-248`) and in the README.

**For MODE A you must confirm these are set (Railway env and/or GitHub Actions secrets — values not visible to this audit):**
- `SMOKE_USERNAME` + `SMOKE_PASSWORD` — without them the smoke suite **skips auth** and only checks health/ready/version/protected-401 (`smokeCore.mjs:100-102,127-129`). Provision a dedicated isolated smoke account first with `node scripts/create-smoke-user.mjs` (needs `DATABASE_URL` + `SMOKE_USERNAME` + `SMOKE_PASSWORD`; the username/password must match the Actions secrets).
- `SMOKE_EXPECTED_COMMIT` — makes the "right build deployed" check required (else informational only) (`smokeCore.mjs:72-82`).
- `RAILWAY_TOKEN` (+ `RAILWAY_SERVICE_ID` + `RAILWAY_ENVIRONMENT_ID`) — the switch for **true auto-rollback**. Missing → `alert-only`, manual instructions printed (`smokeCore.mjs:250-256`).

**Default for this runbook: MODE B** (manual `/api/version` + smoke-by-hand, manual dashboard rollback) unless you confirm the above. On the **first real RED**, verify the GraphQL rollback actually works or use the manual dashboard step.

**CI-green confirmation:** `origin/main` tip is `3d03a1d`; the deploy target. PRs #362–#366 each merged on green CI (Lint + Type Check + Tests). The commit being deployed is the merged, CI-green tip — confirmed by repo command (`git log --oneline 25906d6..origin/main`).

**Pre-deploy migration runner:** wired (`railway.json:8`). It will (re-)apply the full allowlist 0001–0049 idempotently and fail the deploy if any `EXPECTED_TABLES_EXTRA` table is missing afterward.

---

## 4. DEPLOY STEPS (operator-gated — `operator approve deploy:`)

1. **Confirm guard posture** (§3): MODE A secrets present? If not, proceed MODE B (manual verify + manual rollback).
2. **Trigger the deploy:** Railway → **`Ctrl+K` → "Deploy Latest Commit"** (target = `main` @ `3d03a1d`). (If `RAILWAY_TOKEN` is present and you want it triggered programmatically, that is a separate operator-approved action; default is the dashboard.)
3. **Pre-deploy runner runs first:** it applies the migration allowlist (0001–0049, idempotent) and verifies the expected tables. If it fails (e.g., a table missing it cannot create), **the deploy aborts and the old version keeps serving** — investigate before retrying.
4. **Health + version check** (MODE B by hand; MODE A does this for you):
   - `GET /api/health` → `200 {status:'ok'}`; `GET /api/ready` → `200 {status:'ready'}` (DB reachable).
   - `GET /api/version?cb=<nonce>` → JSON `{ commit, builtAt }`; expect `commit` to start with `3d03a1d` and `builtAt` fresh (`src/server/index.ts:115-127`). Cache-bust with the `?cb=` nonce.
5. **Hard-reload the app** (Ctrl+Shift+R) before any manual UI check, so the new client bundle loads.

---

## 5. POST-DEPLOY, BEFORE ANY F2 FLIP — confirm the EXISTING (sync) reviewer path still works through the egress gate

This is the gate that must pass **before** F2 is touched. It confirms the standing egress plane is healthy on prod. The sync reviewer path **already routes through the egress gate** (the `egress` descriptor is attached unconditionally — `reviewerJobFactory.ts:186`; `canonicalMutation.ts:788` is gated on `params.egress`, **not** on async), so the checks below validate it as it runs today.

**5a. Migrations applied (§2 queries).** Confirm at minimum the load-bearing egress trio plus the 0043 columns/ENUM:
`SHOW TABLES LIKE 'egress_hold';` · `SHOW TABLES LIKE 'egress_events';` · `SHOW TABLES LIKE 'reviewer_lanes';` (each → 1 row), and the 0043 `SHOW COLUMNS` checks (`reviewer_lanes.status` ENUM includes `blocked_by_hold`; `review_sessions.lifecyclePhase`/`partialReason` present). A missing `egress_hold` → all reviewers blocked (fail-closed), so this is the single most important check.

**5b. W2 — confirm NO firm-wide `no_external` hold is set.** A global hold blocks **every** reviewer (owner-scoped, subject-agnostic; `egressHold.ts:66`). Read-only confirm against prod TiDB:
```sql
SELECT id, userId, holdFlag, active, createdAt
FROM egress_hold
WHERE scope = 'global' AND holdFlag = 'no_external' AND active = 1;   -- expect ZERO rows
```
Note: there is **no app/UI/tRPC path that writes `egress_hold` today** — `recordEgressHold` is the sole writer and is unwired (`egressHold.ts:106-111`; "exposed for tests + future operator-gated hold management"). A firm-wide hold can presently be created only by a deliberate direct DB INSERT. So on current prod the table legitimately sits **empty** (`SELECT COUNT(*) FROM egress_hold;` likely `0`), which means no hold is blocking reviewers.

**5c. Synthetic sync-reviewer smoke (Cowork-driven — flag for Cowork to run).** With `REVIEWER_ASYNC_ENABLED` still **OFF**, run **one normal review** on a synthetic matter/document. What Cowork should confirm:
- The reviewer(s) **return feedback** end-to-end. Because the sync provider call goes through `documentEgressSend`, a returned review proves, together: `resolveEffectiveHold` ran without throwing (→ `egress_hold` exists, no binding hold), `egress_events` is writable (pre-dispatch row → `success`), and the reviewer provider-allowlist bypass works (`enforceProviderAllowlist:false`).
- **Failure signature to watch for:** all reviewers return **empty/blocked** (no feedback). Two indistinguishable-at-the-surface causes: (a) a binding `no_external` hold is set (most likely global) → block-reason `hold_no_external`; or (b) `egress_hold`/`egress_events` migration not applied → `hold_check_uncertain` / audit-write failure. Disambiguate by reading the smoke job's `egress_events` row `blockReason` and re-confirming 5a/5b.

**Do not proceed to §6 until 5a–5c pass.** (Note: the built-in smoke suite in §3 does **not** include a reviewer/draft check — it covers liveness/readiness/version/auth only — so 5c is a separate, Cowork-driven Pattern-16 step.)

---

## 6. F2 FLIP — env values, order, and the REQUIRED restart (operator-gated)

Set on Railway (strict `=== 'true'` semantics — only the exact string `true` enables; `featureFlags.ts:64-98`):
```
JOB_DISPATCHER_ENABLED=true     # registers the dispatcher's reviewer_feedback handler
REVIEWER_ASYNC_ENABLED=true     # create() forks reviewers to background + writes lanes
JOB_REAPER_ENABLED=true         # recommended: orphan-job reaper + stuck-session self-heal + durable retry
```

**What each gates:**
- `REVIEWER_ASYNC_ENABLED` — OFF: `reviewSession.create` runs reviewers inline and returns after all settle. ON: create fires reviewer jobs to the background, returns `{sessionId}` immediately, lanes power the live UI, the lane-deadline sweep arms (`reviewSession.ts:540,652-694`; `dispatcher.ts:581`).
- `JOB_DISPATCHER_ENABLED` — gates the dispatcher's `reviewer_feedback` handler registration (`dispatcher.ts:206`). The handler registers when **either** dispatcher **or** async is ON; both OFF → dispatcher is a no-op.
- `JOB_REAPER_ENABLED` — orphan reaper + stuck-active-session self-heal + durable (restart-surviving) retry counter (`dispatcher.ts:258,575`).

**CRITICAL — a restart is required.** The dispatcher reads these flags **once, at boot**, inside the run-once `startDispatcher()` (`src/server/index.ts:886`; `dispatcher.ts:565-588` reads handler registration + reaper schedule + lane-reaper schedule). **Flipping the env vars on Railway does NOT change the already-running process** — the handler and timers stay in their boot-time configuration. The request-side sync-vs-async routing (`isReviewerAsyncEnabled()` re-read per request at `reviewSession.ts:540`) *would* flip without a restart, which would route requests to the async lane while the dispatcher/lane-reaper infrastructure is still OFF — an inconsistent half-on state. **Therefore: set all three env vars, then REDEPLOY/RESTART the service** (Railway `Ctrl+K → Deploy Latest Commit`, or a service restart) so `startDispatcher` re-reads them. Because all three are picked up by the single restart, set them together — there is **no intermediate window** and the dispatcher-first ordering concern only applies if you flip incrementally with live edits (which don't take effect anyway without a restart).

---

## 7. POST-FLIP LIVE-VERIFY (W5 — Pattern-16, Cowork-driven, synthetic data)

After the restart, Cowork should confirm on a synthetic matter:
- **Durable lanes:** a new review writes `reviewer_lanes` rows (one per expected reviewer) and `create` returns immediately (`{sessionId}`) instead of blocking.
- **Live progress:** the review pane shows per-lane **Queued → Running → Returned** and an honest **N-of-M** aggregate, refreshing live — including while the tab is unfocused (`refetchIntervalInBackground:true`).
- **Parity with sync:** arrived suggestions render through the same card UI as the sync path; no content/format regression.
- **No stuck/empty sessions:** the session settles (lifecyclePhase `completed` + `partialReason`) only when **all** lanes are terminal; a session is never left active-with-zero-feedback.
- **A failed/non-returning reviewer does NOT block the whole review:** force or observe a slow/failing lane (e.g., the open **Gemini non-return** — invalid/truncated JSON). Confirm that lane terminalizes on its own (`failed`/`timed_out`, or `orphaned_reaped` after the 15-min lane deadline) while the **other** lanes complete normally and the attorney is never blocked. This is the core async win over the sync path (where the client waits for the slowest reviewer).
- **Re-run:** a single-reviewer re-run is offered only for a rerunnable terminal lane and recomposes against the current draft.

Only **you** sign off Pattern-16 (`operator approve live-verified:`). Cowork runs the steps and reports.

---

## 8. ROLLBACK

**Pre-flip (the deploy itself).** Trivial — the deploy is dormant F3 + docs (§1). To revert: Railway → Deployments → the previous **SUCCESSFUL** deployment (`25906d6`) → `…` → **Rollback** (or **Redeploy**) — fastest, no token needed (`smokeCore.mjs:230-242`). MODE A would attempt this automatically via the Railway GraphQL `deploymentRollback` mutation on a RED smoke, but that path is **UNTESTED** — confirm or use the dashboard. Re-run the smoke after rollback.

**Post-flip (async on → off).** Set `REVIEWER_ASYNC_ENABLED` and `JOB_DISPATCHER_ENABLED` back to anything other than `true` (or remove them), then **redeploy/restart** (same boot-read reason as §6). The reviewer path reverts to the **byte-for-byte sync** behavior. No data migration, no one-way door: `reviewer_lanes` rows written under async become inert (the sync path never reads them). Optional courtesy: let in-flight async sessions settle before flipping off; any caught mid-flight are cleaned up by the stuck-session/CR-4 recovery within ~30 min.

**The egress migrations are additive and forward-only (not reverted).** That is safe: additive tables/columns/ENUM values are inert when unused, and — critically — the egress gate is part of the **current** prod code at `25906d6`, so the egress tables must stay in place regardless of the F2 flag state. Rolling back F2 does **not** mean rolling back the egress plane.

---

## 9. REMINDER — client-facing gate (now CLEARED)

The platform was not to go client-facing until **FOLD-L0-1 (conflicts-at-intake)** was live-verified. **That is now DONE** — Cowork live-verified FOLD-L0-1 on prod on 2026-06-20 (STRONG PASS; recorded in `docs/STATE.md` 2026-06-20b). So the technical gate is cleared; **"self-use vs. client-facing" is now purely your posture decision, not a technical block.** Activating F2 (async reviewer UX) is independent of that posture call.

---

## Out-of-scope log

- Wrote NO code, ran NO migration, flipped NO flag, touched NO prod. Read-only audit + this doc only.
- Surfaced one framing gap vs. the brief (§0): the `25906d6→3d03a1d` deploy does not carry the egress gate / F2 code / new migrations — those are already at `25906d6`.
- Could not establish from the repo (flagged for the operator): whether prod's DB is migrated through 0043+ today; whether MODE A secrets (`SMOKE_*`, `RAILWAY_TOKEN`/`SERVICE_ID`/`ENVIRONMENT_ID`) are set; whether Railway auto-restarts on an env change (treated as "restart required").
- Did not exercise the Railway GraphQL rollback (UNTESTED per `smokeCore.mjs:245-248`); did not connect to prod TiDB.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
