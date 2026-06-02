# CAL-7B-PLAN — Full Calibration Regression Grid (Planning)

Engagement: CAL-7B-PLAN
Type: Planning only (master plan section 8.1)
Status at delivery: plan delivered and operator-accepted (operator approve accept:CAL-7B-PLAN)
Date: 2026-06-02 (America/New_York)

## Purpose

Define the full calibration regression grid for Lex Law Next so it can be run as the program-closing behavioral validation (CAL-7B-LIVE, master plan 8.2) and documented at close-out (CAL-7B-CLOSEOUT, 8.3). This document is the grid definition only. Nothing runs on the basis of this plan; the run is the separate, gated engagement CAL-7B-LIVE. The acceptance criterion for this planning engagement (8.1) is that the full grid is approved before running, with pass/partial/fail criteria defined and runtime/cost expectations documented.

## Framing (stated up front, not deferred to close-out)

1. CAL-7B-LIVE is a LIVE PRODUCTION BEHAVIORAL SNAPSHOT, not an offline reproducible regression suite. It answers "does the live system behave acceptably now?" It does NOT establish "calibration is locked and regression-protected." A replayable, artifact-anchored offline harness remains the deferred, stronger alternative; it is blocked today by the absence of a local Node/pnpm toolchain and the lack of scripted DB/telemetry access.

2. The reliability guardrails bias the sample toward reviewers that behave. One reviewer per session, prefer GPT, and avoid Gemini for the evaluator cell all improve completion rates but mean the grid over-represents the well-behaved tracks. Gemini's structured-output invalid-JSON behavior is an OPEN REVIEWER-RELIABILITY DEFECT (carryforward GEMINI-STRUCTURED-OUTPUT-INVALID-JSON), not a calibration result, and is reported as a defect.

3. Reviewer output is non-deterministic. Even N=3 on the load-bearing cells is a snapshot, not a proof.

## Prerequisites (8.1) — status

- GPT instability resolved or risk-accepted: MET. GPT-P8-T1 (parse-class) and GPT-P8-T6 (substantive) are recorded in accepted_risks.
- Core reviewer workflow live-verified: MET (MR-CAL-3F-LIVE).
- Inclusion decision for native cards / evaluator / memory / locked decisions / adopt ledger / sendability: MET. All five advisory features are built and live-verified (4C, 5D, 6C, 7C, 8C) and are included below as feature cells.

## 1. Scenario families (rows)

The fixed calibration taxonomy is four families (confirmed in src/server/__tests__/mr_cal_2d_calibration_scoring.test.ts: ScenarioId = 'P8-T1' | 'P8-T6' | 'P8-T7' | 'P8-T10').

- P8-T1 — Execution-blank suppression. Do not flag routine signature/date/notary blanks on a pre-execution draft; an empty valid output may be correct.
- P8-T6 — Counterparty-facing over-disclosure. Flag as substantive drafting/audience risk; preserve the attorney's selected business offer.
- P8-T7 — Governing-law / sendability blocker. Escalate jurisdiction mismatch as a blocker requiring attorney decision before send.
- P8-T10 — Business-decision separation. Surface both options (e.g. recourse vs non-recourse); require attorney decision; never pick; never rewrite structure.

Scoring uses the EXISTING classifyScenario predicates (PASS/PARTIAL/FAIL) in mr_cal_2d_calibration_scoring.test.ts. No new scoring code is written for the grid.

## 2. Reviewer tracks (columns)

- GPT: full openai:gpt-5, lite openai:gpt-4.1-mini
- Claude: full anthropic:claude-opus-4-5, lite anthropic:claude-sonnet-4-5
- Gemini: full google:gemini-2.5-pro, lite google:gemini-2.5-flash
- Grok: full xai:grok-4, lite xai:grok-3-mini

## 3. The grid

### Block A — Full-track scenario grid, N=3 (load-bearing cells)

4 scenarios x 4 full tracks = 16 cells, each run 3 times = 48 runs.

- Each cell reports all three classifications PLUS a majority verdict.
- If the three runs disagree (e.g. PASS/PASS/FAIL), the cell is recorded as "unstable" and surfaced explicitly; it is NOT smoothed to the majority.
- Rationale: a single lucky draw on a non-deterministic model is indistinguishable from a real PASS. As the program-closing artifact, the central claims must survive more than one roll.

### Block B — Lite scenario cells, N=1

GPT-Lite and Claude-Lite (the reliable lite tracks) x 4 scenarios = 8 cells / 8 runs.

### Block C — Lite-smoke cells, N=1

Closes the "two lite tracks untested" gap without a full sweep.

- Gemini-Lite -> P8-T7 (one scenario).
- Grok-Lite -> P8-T10 (one scenario).
- (Scenario assignments are representative and adjustable at run time.)
- Classified on the merits (PASS/PARTIAL/FAIL/PARSE_FAILURE/NOT_RUN). A Gemini-Lite invalid-JSON result: preserve the artifact, classify PARSE_FAILURE, do not chase.
- = 2 cells / 2 runs.

### Block D — Feature cells, N=1 (multi-step flows)

- F1 — Sendability (8C). (a) A governing-law-blank draft -> reviewSession.checkSendability returns a BLOCKER-category item. (b) Clean-draft NEGATIVE CONTROL: attempt to observe sendable:true on a deliberately simple clean/clean-ish synthetic draft. If a clean draft cannot be created or found without expanding scope, classify the negative-control portion PARTIAL and state explicitly that blocker-detection was verified but sendable:true was never observed. Do not silently re-accept the 8C limitation without trying to close it.
- F2 — Locked decisions (6C). Decline-and-lock a suggestion -> re-review -> confirm the locked item is not re-raised while a genuine new issue still surfaces.
- F3 — Adopt ledger (7C). Adopt -> regenerate -> review -> confirm the "Previously Adopted" carryforward and survival/superseded status behavior.
- F4 — Evaluator / multi-reviewer (5D). PRIMARY pair: GPT + Claude (or GPT-Lite + Claude-Lite) so that both reviewers return SUBSTANTIVE feedback and synthesis is actually exercised. FALLBACK pair: GPT-Lite + Grok-Lite, only if Claude is too slow or fails. If neither pair lands both reviewers in one session, record F4 as NOT_RUN with the reliability cause; do not burn session budget chasing it. (The 5D pass leaned on a one-suggestion/zero-suggestion pair, which proved the evaluator fires but barely exercised synthesis.)
- F5 — Native cards (4C). MANDATORY: at least one cell must confirm native-card display/projection on real reviewer output (nativeCardsLen > 0, confirmed via DOM inspection or API + bundle/source). If no Block-A cell emits a card, run one additional known-card-producing reviewer cell to satisfy this.

= 5 cells, but multi-step, so roughly 9-11 LLM/classifier invocations (F1 = 2 checks; F2/F3 ~ 2 reviews each; F4 = 2 reviewers + 1 evaluator; F5 = 0-1 extra).

### Block E — Ambiguity reruns

Up to 4 runs for cells whose result is borderline or contested.

## 4. Classification vocabulary

Per master plan 8.2: PASS, PARTIAL, FAIL, PARSE_FAILURE, NOT_RUN, ACCEPTED_RISK.

Plus two cell-level states this grid adds:
- "unstable" — a Block A cell whose three runs disagree.
- "NOT_RUN/BLOCKED" — a cell that could not run because a stuck active session blocked the document (see section 6).

## 5. Accepted-risk handling — classify-then-tag-and-flag (NOT auto-absorb)

For GPT-P8-T1 and GPT-P8-T6:
1. Classify on actual merits first (run and score normally).
2. Tag ACCEPTED_RISK only if the result matches the accepted posture: T1 = parse-class failure, T6 = substance failure.
3. Flag for operator attention if the result differs in EITHER direction, INCLUDING if either cell now PASSES. Improvement is surfaced as loudly as regression. The auto-absorb rule would have made the two most-uncertain cells the two least-examined; this rule prevents that.

## 6. Stuck-active-session rule

Before each cell, confirm no active review session blocks the target document. On SESSION_ALREADY_EXISTS: attempt a normal app/API abandon once. If the session is still active, classify the cell NOT_RUN/BLOCKED and move to a fresh synthetic document. No manual DB mutation under any circumstances. (Carryforward STUCK-ACTIVE-SESSION-ON-REVIEWER-FAILURE: a failed/timed-out reviewer leaves the session state=active.)

## 7. Per-cell artifact-evidence columns

Every grid row records:
- Raw/normalized output captured in telemetry: YES / NO / NOT INSPECTED. If DB/telemetry cannot be inspected, record NOT INSPECTED. Never write "captured" on assumption. (The MR-CAL-2G capture is expected to write raw reviewer output to telemetry_events with eventType reviewer_output_captured, but its actual presence is only asserted when inspected.)
- Provider output available in close-out: YES / NO.

## 8. Execution method (for CAL-7B-LIVE)

- Drive production via the tRPC GET/POST path on synthetic documents. This is the proven-reliable path; on-screen renderer screenshots intermittently time out on this heavy app, so structured reads (reviewSession.getDocumentHistory / reviewSession.get, document.get, version.get) are the primary evidence channel.
- Status reads use the REAL document UUIDs; reviewSession.list does not exist (a prior session wasted effort probing it).
- Auth bypass is currently enabled on the public production URL (carryforward AUTH-BYPASS-DISABLE; operator to disable once verifications are complete).

## 9. Run/cell budget — honest accounting

| Block | Cells | Runs |
| :---- | :---- | :---- |
| A — Full-track scenarios, N=3 | 16 | 48 |
| B — GPT-Lite + Claude-Lite scenarios | 8 | 8 |
| C — Gemini-Lite + Grok-Lite smoke | 2 | 2 |
| D — Feature cells F1-F5 (multi-step) | 5 | ~9-11 |
| E — Ambiguity reruns | - | <=4 |
| Total | 31 cells | ~67-73 worst case |

The well-bounded core (Blocks A+B+C) is 58 single-reviewer runs. Blocks D+E add roughly 13-15 more because the feature cells are multi-step flows, not single invocations. The true worst-case LLM-invocation count is therefore ~67-73, above a round "60." This is stated honestly rather than smoothed to fit.

ACCEPTED RUN-CAP (operator decision at acceptance): the ~70 working cap is accepted, preserving N=3 on Block A. A HARD CEILING of 75 LLM invocations applies, with a pause-and-report if the run approaches it (the cap is a real ceiling, not a soft estimate). The operator may override the cap up or down at CAL-7B-LIVE time. Rationale for preserving N=3: dropping Block A to N=2 would weaken the program-closing artifact's central claims to save ~16 runs; forcing a hard 60 by counting multi-step feature cells as single runs would reintroduce the smoothing this plan is designed to avoid.

Cost: most cells use lite/mid models; only F1 (sendability) and F4 (evaluator) invoke Opus-4-5. Serial wall-clock is roughly one hour. Provider cost is bounded (order of magnitude: low single-digit dollars).

## 10. Reviewer-reliability hazards (known going in)

- GEMINI-STRUCTURED-OUTPUT-INVALID-JSON: Gemini reviewers return invalid JSON for structured output and fail the session. Gemini is avoided for the evaluator cell (F4) and Gemini-Lite is limited to one smoke cell (Block C); failures are recorded as PARSE_FAILURE, not chased.
- STUCK-ACTIVE-SESSION-ON-REVIEWER-FAILURE: a failed or timed-out reviewer leaves the session state=active, blocking the next create with SESSION_ALREADY_EXISTS. Handled by the section 6 rule.
- GPT P8-T1 / P8-T6 accepted documented risk: handled by the section 5 classify-then-tag-and-flag rule.

## 11. Pass/partial/fail criteria (8.1 acceptance)

- Scenario cells (P8-T1/T6/T7/T10): the classifyScenario predicate output is authoritative (PASS/PARTIAL/FAIL); Block A additionally reports the three-run majority and the "unstable" state on disagreement.
- Feature cells (F1-F5): the behavioral acceptance already defined by each feature's LIVE engagement (8C/6C/7C/5D/4C) is reused verbatim.
- A cell that cannot be run is PARSE_FAILURE (malformed provider output), NOT_RUN (not attempted or no usable pair for F4), or NOT_RUN/BLOCKED (stuck session).

## 12. Do-not-touch

No prompt, parser, scoring, or adapter changes during the grid run. The grid observes and classifies only. Any remediation it surfaces becomes a separate, gated engagement. Do not modify finalize procedures, locked_decisions/6B, adopt_ledger/7B, the evaluator, reviewer scoring/taxonomy, the feedback parser/card contract, or multi-reviewer gating.

## 13. CAL-7B-LIVE close-out requirements (carried from 8.2)

Each cell's close-out must record: scenario; model/reviewer; expected behavior; observed behavior; result classification; raw/normalized output preservation status (per the section 7 artifact columns); and remediation if needed.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
