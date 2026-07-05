# CAL-1 — Calibration Rerun Report (COMPLETED, post CAL-1B harness fix)

**Engagement:** CAL-1 live four-vendor reviewer calibration rerun, executed per `CAL_1_DISPATCH_2026-07-03.md`. This report **supersedes** the earlier "HALTED pre-run" version: the halt finding (the CAL-7B harness hardcoded stale model IDs) was resolved by **CAL-1B** (PR #493 — the harness now sources per-lane model IDs from `src/server/llm/config.ts`), which the operator authorized as a scoped code change. The live run then executed. Provider keys read from the User environment at call time only; never printed or written. Findings only (no prompt/parser/scoring change).

**Disposition:** run COMPLETE. `full` grid = 58 provider calls (+ 7 in a validation smoke run), `runId 2026-07-05T00-49-25-637Z`, snapshot `6f69c68`, N=3 per full-track cell.

## Lanes tested (config-sourced — the CAL-1B fix; recorded in `grid.summary.json.laneModels`)

| Lane | Model (from config.ts) | Note |
| :--- | :--- | :--- |
| gpt (full) | `openai:gpt-5.5` | modernized; slug valid (real responses) |
| claude (full) | `anthropic:claude-opus-4-5` | |
| gemini (full) | `google:gemini-3.1-pro-preview` | PREVIEW-TIER — UNCALIBRATED-until-rerun; dormancy baseline |
| grok (full) | `xai:grok-4.3` | modernized; slug valid |
| gpt_lite | `openai:gpt-4.1-mini` | |
| claude_lite | `anthropic:claude-sonnet-4-5` | |
| gemini_lite | `google:gemini-3.5-flash` | |
| grok_lite | `xai:grok-4.3` | (grok-3-mini retired; lite reuses grok-4.3) |

**Every current pinned slug returned real responses — no model-not-found on any lane.** The CAL-1B fix is confirmed working (the run tested the currently-pinned models, not the stale ones).

## Grid (scenario × lane → cell status; full tracks N=3)

| Scenario | GPT-5.5 | Claude Opus 4-5 | Gemini 3.1-pro-preview | Grok 4.3 |
| :--- | :--- | :--- | :--- | :--- |
| **P8-T1** (execution-blank suppression) | PARSE_FAILURE ×3 *(accepted-risk)* | **PASS ×3** | unstable {PARTIAL,FAIL,PARTIAL} | **PASS ×3** |
| **P8-T6** (counterparty over-disclosure — soft spot) | unstable {PARTIAL,PARTIAL,PARSE_FAILURE} *(improved)* | PARSE_FAILURE ×3 | PARTIAL ×3 | PARTIAL ×3 |
| **P8-T7** (governing-law / sendability blocker) | **PASS ×3** | PASS (maj; 1 parse-fail) | PASS (maj; 1 parse-fail) | PASS (maj; 1 parse-fail) |
| **P8-T10** (business-decision separation) | **PASS ×3** | **PASS ×3** | **PASS ×3** | PARTIAL (maj; {PARTIAL,PASS,PARTIAL}) |

Lite (N=1): gpt_lite → T1 FAIL, T6 PARTIAL, T7 PARTIAL, T10 PASS. claude_lite → T1 PASS, T6 PARTIAL, T7 PASS, **T10 NOT_RUN (220s timeout)**. gemini_lite → T7 PASS. grok_lite → T10 PASS.

## Per-lane verdicts

| Lane | Verdict | Basis |
| :--- | :--- | :--- |
| **gpt (gpt-5.5)** | **CALIBRATED** | T7 + T10 PASS×3 (clean). Both accepted risks held or improved: GPT-P8-T1 = PARSE_FAILURE×3 (matches accepted posture); GPT-P8-T6 IMPROVED from accepted FAIL → PARTIAL (flagged as improvement). No new regression. |
| **claude (opus-4-5)** | **CALIBRATED (substance) — T6 output-reliability regression** | T1/T10 PASS×3, T7 majority PASS. But **T6 PARSE_FAILURE×3** (output unparseable) leaves T6 substance UNVERIFIED — a structured-output reliability problem (the known Claude non-strict-JSON issue), not a substance calibration failure. |
| **gemini (gemini-3.1-pro-preview)** | **DEGRADED** *(preview-tier; dormancy baseline)* | T10 PASS×3, T7 majority PASS, but **T1 unstable with a FAIL** (over-flagging a routine execution blank — the T1 failure mode) and T6 PARTIAL×3. Preview-tier = UNCALIBRATED-until-rerun (W5); this is the requested final dormancy baseline. Fix is a separate engagement. |
| **grok (grok-4.3)** | **CALIBRATED** *(minor T10 partial-tagging weakness)* | T1 PASS×3, T7 majority PASS. T6 PARTIAL×3 (the shared soft spot); T10 majority PARTIAL (a partial-tagging weakness, not a hard FAIL). |
| **claude_lite (sonnet-4-5)** | **CALIBRATED — T10 UNVERIFIED (timeout)** | T1/T7 PASS, T6 PARTIAL. **T10 NOT_RUN** (single-run 220s timeout — a finding, not a stop; re-runnable). |
| **gpt_lite (gpt-4.1-mini)** | **CALIBRATED — flagged deviations** | T10 PASS, T6 PARTIAL (improved from accepted FAIL). **T1 FAIL** = a flagged deviation from the accepted GPT-P8-T1 PARSE_FAILURE posture (changed failure mode); T7 PARTIAL. |
| **gemini_lite (gemini-3.5-flash)** | **CALIBRATED (limited — 1 cell)** | T7 PASS. Only the P8-T7 cell was in-grid for this lane. |
| **grok_lite (grok-4.3)** | **CALIBRATED (limited — 1 cell)** | T10 PASS. Only the P8-T10 cell was in-grid for this lane. |

## Scenario/accepted-risk comparison (dispatch step 5)

- **P8-T6 (the known soft spot) remains the soft spot across ALL lanes** — none fully PASS (PARTIAL everywhere, PARSE_FAILURE for Claude). Consistent with the CAL-7B-LIVE posture (taxonomy under-tagging). **GPT IMPROVED** on T6 (accepted posture FAIL → now PARTIAL), full and lite.
- **Accepted risks:** GPT-P8-T1 (PARSE_FAILURE) **HELD** (PARSE_FAILURE×3, unflagged accepted-risk). GPT-P8-T6 (FAIL) **IMPROVED** to PARTIAL (flagged as an improvement, not a regression).
- **P8-T7 and P8-T10 are strong** — PASS or PASS-majority on nearly every lane (the sendability blocker and business-decision separation are well-calibrated).

## Findings (record, do not fix here — fixes are separate engagements)

1. **Structured-output PARSE_FAILUREs are systemic + intermittent** across GPT (T1 ×3), Claude (T6 ×3; T7 ×1), Gemini (T7 ×1), Grok (T7 ×1) — the known non-strict-JSON / empty-output reliability class. Claude's T6 is *fully* unparseable (×3), which masks its T6 substance. This is the highest-value follow-up (a reliability/parser-robustness engagement, not a prompt/scoring change).
2. **Gemini 3.1-pro-preview is DEGRADED and preview-tier** — T1 unstable with a FAIL. Preview slugs are perpetually swap-eligible (W5); this is the final dormancy baseline for the record.
3. **One timeout:** claude_lite P8-T10 NOT_RUN at the 220s call ceiling — a single-run infra timeout, re-runnable.
4. **W6 golden baseline capture (dispatch step 6) was NOT run.** `golden_reviewer_harness.mjs` is DARK-only and REFUSES `--live` ("Live golden-baseline capture is CAL-1... an egress action; this harness is DARK-only"). Implementing its live-capture path is a code change beyond the authorized CAL-1B harness fix, so it was not done. The `cal7b` run's per-lane raw + normalized artifacts (`runs/2026-07-05T00-49-25-637Z/`) are the per-lane outputs and can seed golden baselines in a separately-authorized engagement.
5. **Token-level cost is not persisted** in `grid.summary.json` (the harness records per-call `tokensP`/`tokensC` in memory but the written summary omits them). Cost is reported by call count + estimate below.

## Cost

Provider invocations: **58 (full grid) + 7 (validation smoke) = 65 calls**, under the `RUN_CAP` of 75. Estimated cost ≈ **$14–20** (dominated by the Claude Opus full lane at `max_tokens=16384`), within the pre-authorized $25 ceiling. Actual token totals were not persisted by the harness (finding #5); the estimate is based on call count and observed elapsed/output sizes.

## Standing rule recorded (G.3)

Model swap ⇒ rerun. CAL-1B makes this durable at the tooling level: the harness now sources lane model IDs from `config.ts`, so it cannot silently test stale models after a swap, and preview lanes rerun on cadence.

Provider keys were never printed, logged, or committed. No prod change, no schema, no deploy.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
