# W6-BASELINE-EXPANSION-1 — extend golden reviewer baselines to the lite + grok lanes

**Class:** reversible build-and-PR + operator-authorized LIVE capture (~16 calls, within the $15 batch cap).
**Date:** 2026-07-05.

## What
Extended the W6 golden reviewer-drift baseline (`tools/calibration/golden/`) from 2 tracks (`claude`, `gpt`)
to 6 by LIVE-capturing 4 additional lanes across the 4 golden scenarios (P8-T1, P8-T6, P8-T7, P8-T10):
`claude_lite`, `gpt_lite`, `grok`, `grok_lite`. **Gemini stayed dormant** (not declared in the scenario tracks),
per the dispatch.

## How (harness change)
`golden_reviewer_harness.mjs --live` was made **incremental + fail-safe**:
- starts from the EXISTING committed fixtures/baselines and only calls lanes not already baselined (so the
  capture ADDED the 4 new lanes without re-calling — or disturbing — the committed `claude`/`gpt` baselines);
  `--force` re-captures all;
- wraps each provider call in a per-lane try/catch and **never promotes an errored / unparseable / invalid-model
  lane** (an error is not a baseline) — it is reported instead. This is what made it safe to attempt the
  operator-pending `grok` model id.

`prompts.json` scenario `tracks` extended to the 6 lanes.

## Result — 16 live calls, 16 promoted, 0 failed
- **grok / grok_lite (`xai:grok-4.3`) WORKED.** The config pin was marked `operator-pending-provider-confirmation`;
  this capture **empirically confirms `xai:grok-4.3` is servable** and returns parseable reviewer output on all
  four scenarios. (Resolves the pending confirmation for the reviewer surface.)
- `claude_lite` = `anthropic:claude-sonnet-5`, `gpt_lite` = `openai:gpt-4.1-mini` — both servable, captured clean.
- DARK (zero-egress) drift check: **all 24 lane-scenarios match baseline**. `golden_reviewer_diff.test.ts` green (9).

## Findings (informational — the baseline snapshots behavior, PASS or FAIL, for drift detection)
- **Lite-lane calibration gaps** captured as baselines: `claude_lite` **FAILs P8-T1** (flags a routine
  execution blank — the over-flagging class CAL-T1-1 targets); `gpt_lite` **FAILs P8-T10** (business-decision
  separation); `grok_lite` **PARTIAL on P8-T10**. These are the lite models' actual behavior — recorded so a
  future model/prompt swap that changes them is flagged as drift. They are NOT a capture defect.

## Scope / safety
- Egress only via the golden harness's live capture (operator-authorized for W6). Synthetic prod-free scenarios.
- Raw per-lane captures in `tools/calibration/golden/runs/<runId>/` are **gitignored** (not committed).
- No prod change, no flag flip, no schema change.
