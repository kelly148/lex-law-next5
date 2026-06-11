# §3.1 External Triad-Review Packet — REVIEWER-ASYNC-DISPLAY-1

**Engagement:** REVIEWER-ASYNC-DISPLAY-1 (CHAT-UI-1 / Gate 0, Component C)
**Packet type:** §3.1 external-triad review — implementation-entry gate (CLAUDE.md Rule 13 / `EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §3.1, §4, §7)
**Prepared:** 2026-06-11 · **Status:** HARD STOP — no implementation code may be written until an external disposition (GPT + an independent Claude) is returned.
**Self-contained:** a reviewer with no repository access can review from this packet alone. All load-bearing code is inlined in §5.

---

## 1. Banner — why this is a FIRE

This component is the fix for a **failed live verification** and a **client-send-safety** defect, which is why its implementation is gated on external review rather than riding normal reversible-build automation.

In an async multi-reviewer UAT on **2026-06-09** (4 reviewers, ~15k-char document, async fan-out flag ON, build `83d62fe`), the backend produced real substantive findings — **Claude = 10, Gemini = 5, GPT-5 = 11, Grok = 0** issues — **but the review pane rendered only Grok's "no suggestions"** (DOM-confirmed; zero cards for Claude/GPT-5/Gemini). An attorney reading that screen would conclude the review found nothing, while GPT-5 had found eleven substantive issues. On a malpractice-bearing product, a review surface that can hide found defects is a direct client-send-safety failure: an attorney could send or finalize a defective instrument believing review came back clean.

The async fan-in/display design is also load-bearing (hard to reverse once attorneys rely on it) and async-timing correctness is not caught by CI — so all three §3.1 prongs hold, in addition to the failed-live-verification Class-T trigger.

---

## 2. The decision under review

Reviewers are asked to assess the **proposed design** for making the async multi-reviewer surface trustworthy (the AD-1…AD-4 plan in §6), and specifically these load-bearing choices:

1. **Async fan-in / consolidation (AD-3, the root-cause fix).** Today the evaluator/consolidation step is **skipped** in async mode (it assumes all reviewers have completed — incompatible with fire-and-forget). The plan restores an async-safe fan-in. **Decision:** is reusing the existing evaluator (run once all expected reviewers are terminal) the right approach, versus a new fan-in component? Does running consolidation only at all-terminal interact correctly with the durable-dispatch substrate (Gate 0 Components A/B)?
2. **Reviewer-count-aware completion model (AD-1).** Replace the current "first feedback row = done" logic with a model that knows the expected reviewer set and only reports terminal when every expected reviewer has a row or a terminal job. **Decision:** is the expected-set the right denominator, and is a server-provided completeness contract (AD-4) the correct source of truth rather than client inference?
3. **Partial / N-of-M display + poll-until-all-terminal (AD-2).** **Decision:** correctness of the "render arrived feedback while others pending; keep polling until all terminal" model, including the honest empty-vs-pending distinction (the I5 race).
4. **Intended test-assertion changes.** The current single-reviewer tests (`mr3.reviewState.test.ts:152, 163`) **encode the false "at most one reviewer" assumption**. Fixing the bug requires changing those assertions — an intended behavior change, surfaced here deliberately (a test-assertion change is normally a stop). **Decision:** confirm the new asserted behavior is correct.
5. **Exit criteria / dual-gate.** Confirm the falsifiable "Gate 0 MET" criteria for this component (§6) actually prove trustworthiness, and that the prod re-enable stays dual-gated (display fix AND durable dispatch) before `REVIEWER_ASYNC_ENABLED` is flipped.

Reviewers should also surface anything the plan **misses** — failure modes, race conditions, or design risks not enumerated in I1–I11.

---

## 3. Background — what the surface is and how it failed

The product runs up to four reviewer "tracks" (Claude, GPT-5, Gemini, Grok) plus an advisory evaluator over a draft; the review pane shows the attorney each reviewer's suggestions so they can adopt/modify/pass. In **synchronous** mode the server awaits all reviewers, then renders. In **async** mode (flag `REVIEWER_ASYNC_ENABLED`, default OFF; server-side fan-out built as REVIEWER-ASYNC-FANOUT-1) reviewer jobs are dispatched fire-and-forget and land at different times — and the **display/fan-in half was never built for that timing**. The existing synchronous display logic, pointed at an async run, mis-renders it: it treats the first reviewer to land as the whole result and stops.

The "GPT-5 found 11 issues" evidence lives in an operator-side log (`…\_progress\BUG_LOG.md`, row `REVIEWER-ASYNC-DISPLAY-1`), not in the repo; it is reproduced in §1 above. The defects in §4 were re-verified against the current code (`HEAD 08f4d6a`).

---

## 4. Current verified state — the eleven defects (I1–I11)

Confirmed by code inspection at `HEAD 08f4d6a`. (Representative code is inlined in §5.)

- **I1 — Single-reviewer short-circuit.** `reviewState.ts:107-117` (`deriveCompletionState`) returns a terminal state on the **first** feedback row and never inspects how many reviewers were selected; its comment asserts "at most one reviewer" — false for multi-reviewer/async.
- **I2 — Polling stops too early.** `ReviewPane.tsx:1147-1157` — the `reviewSession.get` `refetchInterval` returns `false` the moment completion leaves `pending_or_running`, i.e. right after the first reviewer lands → a slower reviewer's later-persisted row is never re-fetched (the silent vanish).
- **I3 — Late failure masked.** `reviewState.ts:122-126` — the terminal-failure branch sits **after** the `feedback.length > 0` early return, so a still-pending reviewer's `failed`/`timed_out` can never produce a `failed` state once a sibling has succeeded (pinned today by `mr3.reviewState.test.ts:152`).
- **I4 — No "partial / N-of-M pending" UI state.** `ReviewPane.tsx:1500-1593` renders exactly one of four mutually-exclusive terminal states; none shows arrived feedback **while** others still run.
- **I5 — Dishonest "no feedback" race.** If the first-returning reviewer legitimately returns zero suggestions while others are still running, the pane shows the "No suggestions returned" terminal screen and stops polling.
- **I6 — No late-results-reopen for async.** The only reopen path (durable-orchestration open items, `ReviewPane.tsx:1329-1334`) is evaluator-driven, and the evaluator is skipped in async — so it is inert; a late result cannot reopen an item.
- **I7 — Evaluator / consolidation fan-in absent in async (most likely root cause).** `reviewSession.ts:446` guards consolidation with `!reviewerAsync` → multi-reviewer async runs get no consolidation, no denominator, no convergence.
- **I8 — Honest denominator is display-only.** `ReviewPane.tsx:1360-1375` — the N-of-M header/tooltip does not gate polling or completion, so it cannot keep the pane open or bring a late reviewer back.
- **I9 — Decoupled polling gates.** `ReviewPane.tsx:1130-1145` (`job.poll`) keeps polling while a reviewer is `running`, but the feedback short-circuit in the `session.get` deriver already declared the session terminal, so the still-running signal never reaches the rendered state.
- **I10 — No server completeness contract.** `reviewSession.get` (`reviewSession.ts:636-664`) exposes no expected-vs-returned reviewer count; the client must infer completion from `feedback.length` (the root of I1).
- **I11 — Unbuilt + untested + dual-gated OFF.** No commit/branch/PR; no test covers "1 feedback row present + 1 reviewer still running" or async fan-in/late-failure; the async substrate is dual-gated OFF (`featureFlags.ts:64-66`; `llmFetch.ts:30`).

---

## 5. Relevant code (inlined — no repo access required)

**5.1 — `src/client/utils/reviewState.ts` (`deriveCompletionState`) — I1, I3.** Note the first-row short-circuit and the false single-reviewer assumption; the terminal-failure check sits *after* the early return:

```ts
export function deriveCompletionState(
  feedback: FeedbackRowLike[],
  jobs: PublicJobLike[],
): CompletionState {
  // ── Step 1: Feedback-row signals (highest priority) ──
  if (feedback.length > 0) {
    // Use the first feedback row; MR-0G ensures at most one reviewer per session.
    const hasSuggestions = feedback[0]!.suggestions.length > 0;
    return hasSuggestions ? 'completed_with_feedback' : 'completed_without_feedback';
  }
  // ── Step 2: No feedback row — check for terminal failure job status ──
  const reviewerJobs = jobs.filter((j) => j.jobType === 'reviewer_feedback');
  const hasTerminalFailure = reviewerJobs.some((j) => TERMINAL_FAILURE_STATUSES.has(j.status));
  if (hasTerminalFailure) {
    return 'failed';
  }
  // ── Step 3: Default — pending or running ──
  // ...
}
```

**5.2 — `src/server/procedures/reviewSession.ts:~446` — I7 (root cause: consolidation skipped in async):**

```ts
// REVIEWER-ASYNC-FANOUT-1 Inc 1: the evaluator reads ALL reviewer feedback and must run only
// after every reviewer completes — incompatible with the fire-and-forget async path, so it is
// SKIPPED in async-mode v1 (advisory-only + default-OFF; evaluator fan-in is a fast-follow).
if (!reviewerAsync && isEvaluatorEnabled() && input.selectedReviewers.length > 1) {
  const evaluatorModelString = EVALUATOR_MODEL;
  const evaluatorFeedbackRows = await listFeedbackForSession(sessionId, userId);
  const evaluatorSystemPrompt = buildEvaluatorSystemPrompt();
  // ...
}
```

**5.3 — `src/server/procedures/reviewSession.ts:636-664` (`get`) — I10 (no completeness contract):**

```ts
get: protectedProcedure
  .input(z.object({ sessionId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const session = await getReviewSessionById(input.sessionId, userId);
    const feedbackRows = await listFeedbackForSession(input.sessionId, userId);
    const feedback = feedbackRows.map(/* attach display-only native cards */);
    const evaluation = await getEvaluationForIteration(/* ... */);
    return { session, feedback, evaluation };   // ← no expected-vs-returned reviewer count
  }),
```

**5.4 — `src/client/components/ReviewPane.tsx:1147-1157` — I2 (polling stops on first terminal):**

```ts
const { data } = trpc.reviewSession.get.useQuery({ sessionId }, {
  refetchInterval: (query) => {
    const d = query.state.data;
    if (!d) return false;
    const jobs = jobsData?.jobs ?? [];
    const completionState = deriveCompletionState(d.feedback ?? [], jobs);
    return completionState === 'pending_or_running' ? 3000 : false;  // ← stops after first reviewer
  },
});
```

---

## 6. Proposed fix and exit criteria (the design under review)

**AD-1 — Reviewer-count-aware completion.** Replace/extend `deriveCompletionState` to take the expected reviewer set + per-reviewer job/feedback status; report terminal only when every expected reviewer has a row or a terminal job, else a new `partial` state. (Fixes I1, I3. Requires updating the single-reviewer test assertions — see §2.4.)

**AD-2 — Partial / N-of-M display + poll-until-all-terminal.** Add the `partial` UI state (arrived feedback renders while remaining reviewers show pending); keep `reviewSession.get` polling until ALL expected reviewers are terminal; distinguish a true empty result from a still-pending one. (Fixes I2, I4, I5, I8, I9.)

**AD-3 — Async fan-in / late-results-reopen (root-cause fix).** Restore an async-safe consolidation/fan-in that does not assume the sync all-complete path (the evaluator is skipped in async today), and implement the W4 late-results-reopen so a late lane reopens the item rather than vanishing. (Fixes I6, I7.) **Acceptance:** the exact 4-reviewer UAT repro renders each lane's substantive feedback (no empty-lane render); a late lane reopens.

**AD-4 — Server completeness contract.** `reviewSession.get` exposes expected-vs-returned reviewer count so the client gates fan-in authoritatively rather than inferring from `feedback.length`. (Fixes I10.)

**Exit criteria ("Gate 0 MET" for this component):** the 06-09 UAT repro (Claude=10/Gemini=5/GPT-5=11/Grok=0) renders every lane's substantive feedback with honest N-of-M latency; a late result reopens rather than vanishes; a per-reviewer failure is surfaced even when a sibling succeeded — all proven by tests; **and** this §3.1 review is dispositioned. Prod `REVIEWER_ASYNC_ENABLED` flip remains dual-gated on this fix AND durable dispatch (Gate 0 Components A/B), and is a separate operator-gated step.

**Constraints:** every increment flag-gated, reversible, CI-testable; the inline/sync path stays default until proven; no destructive/non-additive migration.

---

## 7. Questions to pressure-test (for the reviewers)

1. Is reusing the existing **evaluator** as the async fan-in (run once all expected reviewers are terminal) sound, or does the async timing argue for a distinct fan-in component? What happens to consolidation if one reviewer never returns (permanent pending)?
2. Is the **expected-reviewer set** the right completion denominator, and should it come exclusively from a server completeness contract (AD-4)? How is the expected set determined authoritatively if a reviewer job is never created (dispatch failure)?
3. Does "poll until all terminal" create a hang risk if a reviewer job is orphaned? (Note the dependency on JOB-RECOVERY-1 reaping stale jobs — is the cross-dependency handled correctly, or could the pane poll forever?)
4. Is the **partial-state** model free of the dishonest-empty race (I5) in all orderings, including the first reviewer returning zero while others run, and all reviewers legitimately returning zero?
5. Are the **test-assertion changes** to the single-reviewer cases correct, and is there a risk of regressing the genuine single-reviewer path?
6. Anything missing from I1–I11 — additional async race conditions, late-arrival/reopen edge cases, or display states not enumerated?

---

## 8. Ready-to-paste reviewer prompt

> You are an independent senior reviewer (one of a triad: GPT and an independent Claude). Review **from this packet alone** — assume no repository access. This is a §3.1 external-review gate for a malpractice-bearing legal-AI product: the component fixes a review pane that, in a 2026-06-09 async test, displayed "no suggestions" while one reviewer had found eleven substantive issues. An attorney could have sent a defective document believing review came back clean.
>
> Read §1–§6 (the failure, the eleven verified defects I1–I11, the inlined code, and the proposed AD-1…AD-4 design). Then deliver:
> 1. A verdict on the proposed design — sound / sound-with-changes / not-yet-sound — with reasons.
> 2. A point-by-point assessment of the five load-bearing decisions in §2 (async fan-in approach; completion denominator + server contract; partial/poll-until-terminal model; the intended test-assertion changes; the exit criteria/dual-gate).
> 3. Answers to the §7 pressure-test questions, and **any failure mode the plan misses** — async races, orphaned-reviewer hangs, late-arrival/reopen edge cases, dishonest empty/pending states.
> 4. A clear disposition: APPROVE for implementation, APPROVE WITH CHANGES (enumerate the required changes), or REJECT (with the design direction you would take instead).
>
> Be concrete and adversarial about timing and ordering. The bar is "an attorney can trust what this pane shows."

---

## 9. Document manifest

- **This packet** — `docs/reviews/REVIEWER-ASYNC-DISPLAY-1_packet.md` (self-contained; review from this alone).
- **Source plan (full detail)** — `docs/CHAT-UI-1/GATE0_IMPLEMENTATION_PLAN.md` (committed on branch `lex-next/gate0-scoping`, commit `2711bf6`; the I1–I11 enumeration, dependency map, and AD-1…AD-4 plan originate here).
- **Failure evidence** — operator-side `…\Historical_Thread_Extraction\_progress\BUG_LOG.md`, row `REVIEWER-ASYNC-DISPLAY-1` (the 06-09 UAT record; not in repo — reproduced in §1).
- **Code at issue (verified `HEAD 08f4d6a`)** — `src/client/utils/reviewState.ts` (I1, I3); `src/client/components/ReviewPane.tsx` (I2, I4, I5, I6, I8, I9); `src/server/procedures/reviewSession.ts` (I7, I10); `src/server/config/featureFlags.ts` + `llmFetch.ts` (I11, dual-gate).
- **Governance** — CLAUDE.md Rule 13; `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §3.1 / §4 / §7.

**Mirror requirement (per Rule 13):** a copy of this packet should also be placed at `C:\Users\Kelly\Desktop\Historical_Thread_Extraction\_analytical\phase2\reviews\REVIEWER-ASYNC-DISPLAY-1_packet.md`. (That Desktop path is not accessible from this session; mirror it manually or have the CLI agent do so.)

---

## 10. Disposition (recorded 2026-06-11)

**Disposition: APPROVE WITH CHANGES — 3/3 concurrence.** All three reviewers (GPT + two independent Claude) concurred. No reviewer found the AD-1…AD-4 direction unsound; all three independently converged on a **server-owned completeness contract** replacing the client's `feedback.length` inference. The §3.1 **HARD STOP on REVIEWER-ASYNC-DISPLAY-1 implementation is LIFTED**, conditional on the required changes below being folded into the plan (done — `docs/CHAT-UI-1/GATE0_IMPLEMENTATION_PLAN.md`, Component C, "Triad-review disposition (2026-06-11)" subsection + expanded exit criteria). Implementation remains operator-gated and sequenced **after** Gate 0 Components A/B (durable dispatch + recovery) in build order; the prod `REVIEWER_ASYNC_ENABLED` flip stays **dual-gated** (this display fix AND durable dispatch/recovery) and is a separate operator-gated step.

**Ratified operator decision (the completion denominator).** The denominator is the **INTENDED reviewer set**, persisted at review-iteration creation and **immutable**. A dispatch failure is surfaced as a terminal **`dispatch_failed`** lane and is **never dropped** from the denominator; the run proceeds **partial** — it does **not** atomic-fail the whole run.

**Required changes (all blocking conditions of the approval):**

1. **Server-owned per-reviewer lane contract.** `reviewSession.get` returns, per reviewer, `{ status, terminal, suggestionCount, feedbackRowId, jobStatus, failureReason, timestamps }` plus aggregate `expected / terminal / returned / failed / pending` counts and a derived `displayState`. The client renders and gates polling off this payload and **stops** using `deriveCompletionState(feedback, jobs)` for async. Lanes are keyed by reviewer identity and deduped to the latest-terminal-per-reviewer under durable-dispatch retries. (Single source of truth for both "keep polling?" and render — closes I9.)
2. **Immutable expected set** persisted at iteration creation, before dispatch — never reconstructed from whatever jobs/rows exist.
3. **Fan-in/completion is a distinct layer.** The evaluator runs downstream and advisory-only, after all expected lanes are terminal. Display completeness must survive the evaluator being disabled, skipped, slow, or failed. Fan-in is idempotent — triggered from job completion/recovery (not from `reviewSession.get`), guarded by a `(session_id, iteration_id, consolidation_type)` lock.
4. **Bounded terminalization.** Every expected lane reaches a terminal status server-side (`completed_with_feedback`, `completed_without_feedback`, `failed`, `timed_out`, `dispatch_failed`, `orphaned_reaped`, `canceled`). This component **owns a server-side per-reviewer terminal-deadline** as defense-in-depth — it does NOT delegate liveness solely to JOB-RECOVERY-1. The client never invents completion; a client elapsed-time window drives an "incomplete — here is what arrived; send is blocked/flagged pending a recorded attorney override" state, NOT a fake terminal status.
5. **Partial / N-of-M display.** Empty-vs-pending is judged per reviewer; the global "no suggestions" verdict only when ALL expected lanes are terminal AND total suggestions across all lanes == 0. `completed_without_feedback` requires an affirmative zero-result record (never inferred from job-done + no-row); a distinct `complete_with_failures` state when a lane failed but siblings succeeded.
6. **Iteration + document-revision isolation.** Key every job / feedback row / evaluation / lane to `session_id + iteration_id + document_revision_id` (or `draft_hash`); a late result from an older iteration is shown ONLY as an old-iteration result, never merged into the current pane.
7. **Late-results-reopen is strictly additive.** It must not reset, reorder, or re-derive suggestions the attorney has already adopted/modified/passed. State the invariant explicitly and require a test.
8. **Consolidation incompleteness flag.** Consolidation output is explicitly labeled with the set it ran over ("based on 3 of 4; reviewer X timed out"), so a synthesis over a partial set never reads as consensus.
9. **Audit snapshot at finalize/send.** Capture which reviewers had completed, their suggestion counts, and which were pending/failed at the moment of send (the malpractice-defense artifact).
10. **Job-terminal-before-row race.** Require transactional write ordering, OR treat "completed job, no result record yet" as NOT display-terminal.
11. **Unknown / unselected reviewer row** is ignored for the denominator (logged as an anomaly), never counted as expected completion.

**Expanded exit criteria.** Component C must additionally pass tests for: the exact 06-09 repro (Claude=10/Gemini=5/GPT-5=11/Grok=0) with adversarial orderings (zero-first; failure-after-success; late-arrival); dispatch-failure terminal lane; timeout/orphan terminalization (no infinite pending); iteration-staleness isolation; job-terminal-before-row; duplicate-retry idempotency; evaluator-disabled (lanes still display correctly); late-reopen-without-clobber; and single-reviewer regression. The dual-gate (this display fix AND durable dispatch/recovery) is **retained** before `REVIEWER_ASYNC_ENABLED` is flipped in prod.

**Sanctioned test-assertion change.** The §2.4 single-reviewer assertions (`mr3.reviewState.test.ts:152, 163`) are **approved** to change as part of this disposition; the change is made in the Component C **build**, not in this record.

---

*Review packet with disposition. The external triad disposition was returned and recorded 2026-06-11 (APPROVE WITH CHANGES, 3/3): the §3.1 HARD STOP is LIFTED, conditional on the §10 required changes (folded into `GATE0_IMPLEMENTATION_PLAN.md` Component C). REVIEWER-ASYNC-DISPLAY-1 implementation remains operator-gated and sequenced after Gate 0 Components A/B.*
