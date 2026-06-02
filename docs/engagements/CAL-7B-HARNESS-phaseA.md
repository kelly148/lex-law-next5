# CAL-7B-HARNESS — Phase-A Close-out

Engagement: CAL-7B-HARNESS
Type: Phase A implementation
Disposition: Phase A accepted by operator (operator approve accept:CAL-7B-HARNESS); committed via gated PR.
Date: 2026-06-02 (America/New_York)

## Objective

Build a local offline calibration harness so the CAL-7B regression grid's scenario cells (P8-T1/T6/T7/T10 x reviewer tracks) can be run reproducibly off-app, since the live application cannot faithfully present the engineered P8-T fixtures. See CAL-7B-HARNESS-plan.md.

## Files created (Phase A)

- tools/calibration/cal7b_harness.mjs — full grid driver (Increments 1+2): four provider REST calls (verbatim shapes @ 6f69c68), verbatim reviewer system prompt, four re-derived fixtures, four ported scorers, N=3/majority/unstable, GPT-P8-T1/T6 classify-then-tag-and-flag, run cap 75, concurrency pool, summary generator. Modes --smoke (default) and --full.
- tools/calibration/.gitignore — excludes runs/ (raw provider artifacts) from git.
- tools/calibration/runs/ — local-only run artifacts (gitignored), not committed.

No live source files were modified.

## Validation (by execution)

Increment 1 (proof cell), P8-T7 x GPT (gpt-5):
- First run hit finish_reason length at 4096 tokens (gpt-5 reasoning consumed the budget). Fixed by raising maxTokens to 16384 (mirrors reviewSession.ts:321).
- Re-run: provider ok, finish_reason stop, 12,040 completion tokens, classification PASS.

Increment 2 (smoke, 7 calls, build-validation only — NOT the official run):
- P8-T7 x gpt (gpt-5): PASS (158s)
- P8-T7 x claude (claude-opus-4-5): PARSE_FAILURE (36s)
- P8-T7 x gemini (gemini-2.5-pro): PASS (21s)
- P8-T7 x grok (grok-4): PASS (9s)
- P8-T10 x gpt (gpt-5): PASS (161s)
- P8-T1 x gpt_lite (gpt-4.1-mini): FAIL -> accepted-risk FLAG (deviation from accepted PARSE_FAILURE posture)
- P8-T6 x gpt_lite (gpt-4.1-mini): PARTIAL -> accepted-risk FLAG (deviation from accepted FAIL posture)

Confirmed working: all four provider adapters; all four scorers; classify-then-tag-and-flag (fired on both GPT-Lite cells); concurrency; run-cap guard; artifact preservation.

## Findings (for CAL-7B-LIVE)

- Runtime: gpt-5 is the slow track (~160s/call); others 9-36s. With concurrency 4, the full ~58-call grid is estimated ~15-30 min (revises the earlier ~1 hr / 2-4 hr figures).
- P8-T7 x claude-opus came back PARSE_FAILURE: Claude output did not parse as the legacy JSON array. Either a genuine Claude reliability data point or a harness/live-adapter fidelity gap; the raw artifact is preserved for inspection during the official run. To inspect, not yet diagnosed.
- The smoke results are build-validation only; no calibration conclusions are drawn from them.

## Caveats (honest)

- Snapshot copy at 6f69c68, not live-module import (node_modules absent) -> re-sync needed if sources change; parity check is a follow-up.
- CI covers src only; tools/ is not exercised by CI. Validated by execution instead.
- Re-derived fixtures = fresh baseline, not the 20260528 originals.
- ANTHROPIC_API_KEY reaches the harness only via PowerShell User-scope injection.

## Scope confirmation

Stayed within scope: new files only under tools/calibration/; no live source edited; do-not-touch list respected (no prompt/parser/scoring/adapter/server/DB changes). Credentials never printed, logged, or committed; runs/ gitignored.

## Tests / gates

No CI test exercises the harness (CI lints/tests src only). Validation is by direct execution. A guard test under src can be added if desired.

## Carryforwards

- CAL-7B-LIVE remains the gated full run (the harness is the tool; the run is the next engagement).
- Claude-opus P8-T7 PARSE_FAILURE to inspect during the official run.
- Original fixture bundle (20260528T122851Z) reconciliation pending if/when supplied (Hybrid decision).

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
