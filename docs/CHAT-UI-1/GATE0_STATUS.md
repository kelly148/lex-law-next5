# CHAT-UI-1 — Gate 0 reality-check + operator dispositions

Date: 2026-06-11. Companion to `BUILD_BRIEF.md` (which is held verbatim). This records the
disposition of the brief's Open Items, established before W0 implementation began.

## Gate 0 reality-check (brief §5 / Open Item 1) — NOT MET

All three named prerequisites are unbuilt on `origin/main` (`1251df3d`). Verified against
git history (all refs), `docs/MR_CAL_engagement_state.json`, `docs/STATE.md`, and the code.

| Prerequisite | Status | Evidence |
| :-- | :-- | :-- |
| JOB-RECOVERY-1 | Not started | Proposed in `PROJECT_REVIEW.md` §6 Action 1 / finding H3, but the operator-approved "DURABILITY-1 queue write" was never executed — not in the queue, zero implementing commits. Code still pre-fix: `src/server/jobs/dispatcher.ts logOrphanedJobs()` is a `console.log` stub (no reaper/query); `src/server/db/canonicalMutation.ts:634` calls `markJobFailed` unwrapped; a failed/empty review still leaves the session stuck `active`. |
| REVIEWER-ASYNC-DISPLAY-1 | Not found | No commit/branch/PR/queue entry/doc. Current display is synchronous/fragile: `src/client/components/ReviewPane.tsx` polling stops at the first finished reviewer, so a late result can silently vanish. REVIEWER-ASYNC-FANOUT-1 (merged, deployed, flag-OFF) built only server-side dispatch plumbing, not the display/fan-in. |
| DISPATCHER-COMPLETE-1 | Not found | No commit/doc. `src/server/jobs/dispatcher.ts` is a scaffold with zero registered handlers (dormant); its docstring disclaims auto-recovery. Reviews run inline / fire-and-forget. FOLD-ORCH-1 is a different thing (consolidation/display, not durable execution). |

This is consistent with the recorded state — `state.json` / `STATE.md` hold `REVIEWER_ASYNC_ENABLED`
OFF precisely because these two are dual-gated and unbuilt — so there is no contradiction; the
brief's Open Item 1 simply had not been reality-checked. Now it has.

## Consequence for the build (brief §5 fallback)

Gate 0 unmet → **scaffold only the non-reviewer surfaces and flag the dependency.**

- BUILDABLE NOW (no reviewer substrate dependency): W0 scaffold; the W1 safety spine — the shared
  consequence-tier confirm component, the posture model (issuer/privilege/recipient), the ~8-row
  HARD/SOFT incoherence table, the issuer-scenario acceptance test, the Auto-Act posture-confirm
  queue, and the send/lock egress coherence check.
- DEFERRED (Gate-0-blocked, flagged): the live reviewer/disposition surface (W4) — dispositioning
  real findings, disposition-aware regenerate, late-results-reopen — and the later W2/W3/W5/W6
  work that depends on the async reviewer substrate.

## Operator dispositions (2026-06-11)

- **D1 carve-out — RATIFIED (2026-06-11), BROAD scope.** Any set/transition to recipient = neutral
  third party, regulator/court, adverse, or public interrupts INDIVIDUALLY and can never be
  batch-cleared or "confirm-all'd" in Auto-Act, even though other posture confirms queue (brief §2.6).
  External set = {neutral third party, regulator/court, adverse, public}; privileged × adverse stays a
  HARD block. Rationale: privilege waiver triggers on disclosure to any non-privileged third party
  (selective/limited waiver largely rejected). Shipped in W1 (`NON_BATCHABLE_RECIPIENTS`, commit
  81328ef). Final — do not narrow without an explicit new instruction.
- **D2 — SHIP.** The full ~8-row incoherence table ships in v1 as enumerated HARD/SOFT data (brief
  §2.6). Lands in W1.
- **Proceed — build the non-reviewer scaffold now** (PR1–PR4), flag-OFF and reversible; W4 deferred.

## Scope fence (unchanged from brief §7)

Branch `lex-next/chat-ui-1` off `origin/main`; never touch local `main`, the review-report branch,
or `.claude/settings.json`. Sole committer; merges / deploys / flag-flips are operator-gated. Flag
`CHAT_UI_1_ENABLED`, default OFF.
