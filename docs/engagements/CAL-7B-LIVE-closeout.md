# CAL-7B-LIVE — Calibration Regression Grid Run (Live/Harness Validation)

Engagement: CAL-7B-LIVE
Type: Live/harness validation (master plan 8.2)
Operator verdict: PASS-qualified (operator approve live-verified:CAL-7B-LIVE pass-qualified)
Date: 2026-06-02 (America/New_York)
Snapshot: production 6f69c68 (scenario grid offline against the same source; feature cells live on prod 6f69c68)
Harness run id: 2026-06-02T13-35-17-930Z

## Framing (as accepted in CAL-7B-PLAN)

This is a LIVE PRODUCTION BEHAVIORAL SNAPSHOT, not an offline reproducible regression suite. It answers "does the live system behave acceptably now?" It does NOT establish "calibration is locked and regression-protected." Fixtures are a RE-DERIVED baseline (NOT the 20260528T122851Z originals); reconcilable to a true regression if the original bundle is supplied. Reviewer verdicts are non-deterministic; the reliability guardrails (one reviewer per session, prefer GPT, avoid Gemini for the evaluator) bias the sample toward reviewers that behave. Gemini structured-output invalid-JSON is an open reviewer-reliability DEFECT, not a calibration result.

## Part 1 — Scenario grid (Blocks A/B/C)

26 cells / 58 calls. Scoring via the existing classifyScenario predicates. Raw + normalized provider output preserved per call in the gitignored tools/calibration/runs/2026-06-02T13-35-17-930Z/ directory (artifact column: telemetry-style raw capture = YES, preserved locally; provider output available in close-out = YES, local artifacts).

| Block | Scenario | Track | N | Verdict | Runs |
| :---- | :---- | :---- | :-- | :---- | :---- |
| A | P8-T1 | gpt | 3 | unstable (FLAG: improved) | PASS,PASS,FAIL |
| A | P8-T1 | claude | 3 | PASS | PASS,PASS,PASS |
| A | P8-T1 | gemini | 3 | PASS | PASS,PASS,PASS |
| A | P8-T1 | grok | 3 | PASS | PASS,PASS,PASS |
| A | P8-T6 | gpt | 3 | unstable | PASS,FAIL,FAIL |
| A | P8-T6 | claude | 3 | unstable | PARTIAL,PARTIAL,PARSE_FAILURE |
| A | P8-T6 | gemini | 3 | PARTIAL | PARTIAL,PARTIAL,PARTIAL |
| A | P8-T6 | grok | 3 | PARTIAL | PARTIAL,PARTIAL,PARTIAL |
| A | P8-T7 | gpt | 3 | unstable | PASS,NOT_RUN,PASS |
| A | P8-T7 | claude | 3 | unstable | PASS,PARSE_FAILURE,PASS |
| A | P8-T7 | gemini | 3 | PASS | PASS,PASS,PASS |
| A | P8-T7 | grok | 3 | PASS | PASS,PASS,PASS |
| A | P8-T10 | gpt | 3 | unstable | PASS,PARTIAL,PASS |
| A | P8-T10 | claude | 3 | PASS | PASS,PASS,PASS |
| A | P8-T10 | gemini | 3 | PASS | PASS,PASS,PASS |
| A | P8-T10 | grok | 3 | PASS | PASS,PASS,PASS |
| B | P8-T1 | gpt_lite | 1 | PARSE_FAILURE | PARSE_FAILURE |
| B | P8-T1 | claude_lite | 1 | PASS | PASS |
| B | P8-T6 | gpt_lite | 1 | PARTIAL (FLAG: improved) | PARTIAL |
| B | P8-T6 | claude_lite | 1 | PARTIAL | PARTIAL |
| B | P8-T7 | gpt_lite | 1 | PASS | PASS |
| B | P8-T7 | claude_lite | 1 | PASS | PASS |
| B | P8-T10 | gpt_lite | 1 | PASS | PASS |
| B | P8-T10 | claude_lite | 1 | PASS | PASS |
| C | P8-T7 | gemini_lite | 1 | PARSE_FAILURE | PARSE_FAILURE |
| C | P8-T10 | grok_lite | 1 | PARTIAL | PARTIAL |

Tally: PASS 13 / PARTIAL 5 / unstable 6 / PARSE_FAILURE 2.

Expected vs observed by scenario:
- P8-T1 (expected: suppress routine execution blanks; empty valid output OK): STRONG. Claude/Gemini/Grok clean 3xPASS; GPT unstable (2 PASS, 1 FAIL) and GPT-Lite PARSE_FAILURE.
- P8-T6 (expected: flag counterparty over-disclosure as substantive audience risk; preserve the selected offer): SOFT SPOT. No clean PASS at N=3; mostly PARTIAL (reviewers flag the risk and preserve the offer but miss the precise SUBSTANTIVE/DRAFTING taxonomy the PASS predicate requires). GPT majority FAIL (accepted-risk posture).
- P8-T7 (expected: escalate governing-law/jurisdiction mismatch as a blocker requiring attorney decision): STRONG. Gemini/Grok clean 3xPASS, both lites PASS; GPT and Claude PASS-on-substance but unstable due to one provider-instability run each (GPT empty -> NOT_RUN; Claude non-strict JSON -> PARSE_FAILURE).
- P8-T10 (expected: surface both business options; require attorney decision; never choose; never rewrite): STRONG. Claude/Gemini/Grok 3xPASS; GPT 2/3 PASS.

Classify-then-tag-and-flag (accepted-risk handling):
- GPT-P8-T1: majority PASS vs accepted PARSE_FAILURE posture -> FLAGGED as a deviation in the IMPROVEMENT direction (GPT may have improved). Not auto-absorbed.
- GPT-Lite-P8-T6: PARTIAL vs accepted FAIL posture -> FLAGGED (improvement direction).
- GPT-P8-T6 (full): majority FAIL matches the accepted substance-failure posture -> tagged ACCEPTED_RISK, not flagged.
- GPT-Lite-P8-T1: PARSE_FAILURE matches the accepted T1 parse posture -> consistent, not flagged.

Instability root causes (artifact-confirmed, genuine reviewer behavior, not harness error):
- GPT-5: intermittent empty responses (NOT_RUN; raw length 0).
- Claude: intermittent non-strict JSON in the long body (control chars/escaping) -> the strict legacy parser rejects it; the live app uses the same parser and would fail identically (genuine reliability signal).
- Gemini-Lite: invalid JSON for structured output (PARSE_FAILURE) -> known carryforward GEMINI-STRUCTURED-OUTPUT-INVALID-JSON.

## Part 2 — Feature cells (live production, doc cbf83ad7-a437-4aa7-9ecb-7a31d7985a95)

Artifact note: feature-cell mutations succeeded and were confirmed via read-back (reviewSession.get / listLockedDecisions / listAdoptLedger / checkSendability). telemetry_events rows were NOT INSPECTED (no DB access this session); telemetry emission is asserted by code path, not by row inspection.

- F1 Sendability (8C) -> PARTIAL. (a) Blocker detection: PASS - checkSendability returned sendable:false with 5 BLOCKERs (unresolved_blanks + business_decision_needed). (b) Clean-draft negative control: sendable:true NOT OBSERVED - no clean/complete draft exists on prod and creating one is scope expansion; per the plan's F1 rule the negative-control portion is PARTIAL. Honest: blocker detection verified; sendable:true never observed.
- F2 Locked decisions (6C) -> PASS. Declined-and-locked the GPT-Lite suggestion "Ambiguity in Delegation of Authority Section 4.2" (lock 995c3a37). The next review (lock active, injected) CONSUMED the lock: memo stated "Given that the supervising attorney has declined to change this approach, this issue is noted for awareness but no change is required unless the attorney reconsiders." Demonstrates respect-unless-new-facts (flag deliberately, do not hard-suppress) - stronger evidence than 6C.
- F3 Adopt ledger (7C) -> PASS. Adopted a GPT-full suggestion (98e6aa13) WITH edited text (modified-adopt path) -> regenerate produced new version 54ba315c -> adopt_ledger entry 1005d218 disposition=adopted_modified, auto-transitioned unresolved->superseded (statusSource=auto, producedVersionId=54ba315c); prior 7C entry (62f132c1, adopted_verbatim, attorney/active) preserved. Distinguishes adopted/unresolved/superseded/active. "Previously Adopted" carryforward injection is the same code path verified in 7C (entries active/superseded, ready to inject).
- F4 Evaluator (5D) -> PASS-qualified. Multi-reviewer session (gpt + claude). GPT returned 14 suggestions; Claude returned 0 (intermittent non-strict JSON). Evaluator FIRED: 14 advisory dispositions (adopt/neutral), and sessionSelections=0 -> NO automatic decision (selection model untouched). QUALIFIED: Claude contributing 0 means two-substantive-input cross-reviewer synthesis was not exercised, and dispositions had empty rationale/synthesis text this run. Per revision #4 the fallback (GPT-Lite + Grok-Lite) was not run because (a) the evaluator mechanism was already confirmed live and (b) the active locks were suppressing the lite reviewers' usual topics (GPT-Lite returned 0 in F3 setup), so the fallback would likely also fail to land two substantive inputs.
- F5 Native cards (4C) -> PASS. 19 card-bearing suggestions present on the document (embedded STRUCTURED_FEEDBACK_CARDS parse to cards); native-card display/projection was live-verified at this exact code in MR-CAL-4C-LIVE.

Feature-cell tally: PASS 3 (F2, F3, F5) / PASS-qualified 1 (F4) / PARTIAL 1 (F1).

## Overall assessment

No un-accepted clean FAILs. The single majority-FAIL cell (GPT-P8-T6) matches the standing accepted-risk posture. Core MR-CAL capabilities (business-decision separation P8-T10; governing-law/sendability blocker P8-T7) are strong across tracks. P8-T6 over-disclosure taxonomy precision is the documented soft spot (PARTIAL, not failure). All five advisory feature systems function live (locked decisions and adopt ledger fully; evaluator fires with no auto-decision; native cards render; sendability detects blockers). The live system behaves acceptably now (the CAL-7B-LIVE bar), within the documented qualifications.

## Remediation / follow-ups surfaced (none blocking)

- P8-T6 taxonomy precision: reviewers flag the audience risk and preserve the offer but under-tag the SUBSTANTIVE/DRAFTING subtype. Candidate for a future prompt-calibration engagement (NOT done here; CAL-7B is observe-and-classify only).
- Reviewer reliability (open carryforwards): GPT-5 intermittent empties; Claude/Gemini intermittent non-strict JSON (GEMINI-STRUCTURED-OUTPUT-INVALID-JSON); STUCK-ACTIVE-SESSION-ON-REVIEWER-FAILURE (a failed/empty review leaves the session active; encountered and handled per the abandon-once rule during F3 setup).
- Fixtures reconciliation: if the 20260528T122851Z bundle is supplied, swap fixtures and re-run for a true regression.
- F1 sendable:true and F4 two-substantive-input synthesis were not observed (documented gaps, not defects).

## Synthetic data created (LLN-PROD-CLEANUP-1)

Review sessions iter 20-25 on cbf83ad7 (mix of active/abandoned/regenerated); locked decision 995c3a37; adopt_ledger entry 1005d218; document version 54ba315c. Operator-approved cleanup only.

## Disposition

CAL-7B-LIVE -> completed_engagements (PASS-qualified). Queue head -> CAL-7B-CLOSEOUT (formal program close-out).

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
