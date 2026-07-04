# CAL-1 — Calibration Rerun Report (HALTED pre-run at dispatch step 2)

**Engagement:** CAL-1 (live four-vendor calibration rerun), executed per `CAL_1_DISPATCH_2026-07-03.md` inside the 2026-07-04 autonomous batch, with the live-run approval pre-granted (≤ $25 estimate) replacing dispatch step 3.

**Disposition:** **HALTED at the step-2 pre-run inspection — no provider call made.** The harness snapshot hardcodes pre-modernization model IDs that no longer match the current pinned config, so running it would calibrate the *wrong* (old / retired) models on 5 of 8 lanes and spend the live budget on them. Correcting the harness requires a model-ID edit, which the engagement terms explicitly forbid ("no code / prompt / parser / scoring changes"). Dispatch step 2 (run against the CURRENT pinned IDs) and step 9 (no code changes) therefore conflict — a genuine operator decision.

---

## Pre-run inspection (dispatch step 2 — "inspect, do not assume")

The CAL-7B harness (`tools/calibration/cal7b_harness.mjs`) is a standalone snapshot (verbatim at commit `6f69c68`). Its reviewer-lane → model map is **hardcoded** in the `TRACKS` object (lines 452-459); it does **not** read `src/server/llm/config.ts` at runtime. Compared against the current pinned reviewer IDs (`config.ts` `REVIEWER_MODELS` / `LITE_REVIEWER_MODELS`, post REVIEWER-MODEL-MODERNIZATION-1):

| Lane | Harness targets (`TRACKS`) | Current pinned (`config.ts`) | Status |
| :--- | :--- | :--- | :--- |
| `gpt` (full) | `openai:gpt-5` | `openai:gpt-5.5` | **STALE** |
| `claude` (full) | `anthropic:claude-opus-4-5` | `anthropic:claude-opus-4-5` | current |
| `gemini` (full) | `google:gemini-2.5-pro` | `google:gemini-3.1-pro-preview` | **STALE** (and preview-tier — perpetually swap-eligible) |
| `grok` (full) | `xai:grok-4` | `xai:grok-4.3` | **STALE** |
| `gpt_lite` | `openai:gpt-4.1-mini` | `openai:gpt-4.1-mini` | current |
| `claude_lite` | `anthropic:claude-sonnet-4-5` | `anthropic:claude-sonnet-4-5` | current |
| `gemini_lite` | `google:gemini-2.5-flash` | `google:gemini-3.5-flash` | **STALE** |
| `grok_lite` | `xai:grok-3-mini` | `xai:grok-4.3` (grok-3-mini RETIRED) | **STALE / retired** |

**5 of 8 lanes are stale.** Only `claude`, `claude_lite`, and `gpt_lite` would call the current pinned model. Several stale IDs (`gemini-2.5-pro`, `grok-3-mini`, possibly `gpt-5`) are likely to return model-not-found. Running as-is would therefore (a) not accomplish the rerun's purpose — calibrating the *swapped* models — and (b) spend the live budget on retired models.

This is exactly the mismatch dispatch step 2 asks to catch before running. The harness header itself notes it is a snapshot: "If those sources change, re-sync this snapshot."

## Estimated call volume + cost (dispatch step 2)

- `cal7b_harness.mjs --full` grid: Block A (4 scenarios × 4 full tracks × N=3 = 48) + Block B (4 × 2 lite = 8) + Block C (2) = **58 provider calls** (hard `RUN_CAP` = 75).
- W6 golden capture (`golden_reviewer_harness.mjs`, `golden/prompts.json` scenarios P8-T1/T6/T7/T10 once per lane) ≈ **16–32 calls**.
- Total ≈ **74–90 calls**. `REVIEWER_MAX_TOKENS = 16384`; dominant cost driver = the Claude Opus full lane.
- Estimated cost at realistic single-provision output lengths (~4–8K output tokens): **≈ $12–18 (under the $25 ceiling)**; worst case (all lanes emit the full 16K) ≈ $28. Point estimate ≤ $25 — the cost ceiling is **not** the blocker; the stale-model-ID finding is.

## The conflict (why this halts)

- **Dispatch step 2** requires the harness to run against the **current** pinned model IDs.
- **Dispatch step 9** (restated in the Item-4 authorization) forbids "code / prompt / parser / scoring changes."
- The harness hardcodes **stale** IDs. Satisfying step 2 requires editing `TRACKS` (a code change → violates step 9); not editing it means running a calibration of retired models (violates step 2's purpose and wastes live budget).

Neither branch is self-approvable: one is a forbidden code change, the other spends money mis-calibrating. This is a genuine operator decision (a standing hard stop for this batch), so no provider call was made.

## Per-lane verdicts

**UNVERIFIED (not run)** for every lane — `gpt`, `claude`, `gemini`, `grok`, and all four lite lanes. No calibration data was captured because no call was made. The accepted-risk comparison (GPT-P8-T1, GPT-P8-T6) and the P8-T6 soft-spot check are consequently **not re-measured** this engagement.

## Decision requested (one of)

1. **Authorize a minimal harness model-ID update** — resync `TRACKS` (and the lite map) to the current pinned IDs (`gpt-5.5`, `gemini-3.1-pro-preview`, `grok-4.3`, `gemini-3.5-flash`, `grok-4.3` for grok_lite), as a scoped exception to "no code changes" **for the harness config only** (not prompt/parser/scoring). Then run `--full` + the golden capture (~$12–18 est.) and produce the real per-lane verdicts. *(Recommended — it is the only path that fulfills the rerun's purpose.)*
2. **Run as-is against the stale IDs** — records the old/retired models (several expected to 404) as the finding; explicitly **not** a current-model calibration, and spends live budget on retired models.
3. **Defer CAL-1** until the harness is re-synced in a separate (non-findings-only) engagement.

Provider keys were **not** read or echoed; no credential handling occurred. No live provider call was made.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
