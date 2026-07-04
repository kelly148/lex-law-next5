# Pinned-model inventory + GA-vs-preview decision memo (ULTRABUILD-1 W5 / run-sheet 0.11)

**For:** Kelly. **Date:** 2026-07-03. **Decision required:** whether the reviewer/drafter model pins should be
moved off preview-tier slugs to GA ids, or kept with the standing "preview lanes are perpetually
swap-eligible" posture. **No model id was changed in this work** — this is inventory + flags + this memo.

## Complete pinned-model inventory (`src/server/llm/config.ts`, `modelCapabilities.ts`)

| Where | Key | Pinned id | Tier |
|---|---|---|---|
| Reviewer full | claude | `anthropic:claude-opus-4-5` | GA |
| Reviewer full | gpt | `openai:gpt-5.5` | GA · *provider-unconfirmed* |
| Reviewer full | **gemini** | **`google:gemini-3.1-pro-preview`** | **PREVIEW** · provider-unconfirmed |
| Reviewer full | grok | `xai:grok-4.3` | GA · provider-unconfirmed |
| Reviewer lite | claude_lite | `anthropic:claude-sonnet-4-5` | GA |
| Reviewer lite | gpt_lite | `openai:gpt-4.1-mini` | GA |
| Reviewer lite | gemini_lite | `google:gemini-3.5-flash` | GA-class · provider-unconfirmed |
| Reviewer lite | grok_lite | `xai:grok-4.3` | GA (reuses flagship) |
| Drafter default | PRIMARY_DRAFTER_MODEL | `anthropic:claude-opus-4-5` | GA |
| Evaluator default | EVALUATOR_MODEL | `anthropic:claude-opus-4-5` | GA |
| Lite generation | LITE_GENERATION_MODEL | `openai:gpt-4.1-mini` | GA |
| Whitelist (drafter/evaluator) | — | opus-4-5, sonnet-4-5, gpt-5.5, **gemini-3.1-pro-preview**, grok-4.3 | one preview |
| Finalize/formatting job | documents4a.ts:1311 | `anthropic:claude-opus-4-7` | GA · **bypasses boot validation** (unregistered) |

**Only one pinned lane is preview-tier:** `google:gemini-3.1-pro-preview` (the full Gemini reviewer lane + the
drafter/evaluator whitelist copy). It is now marked **UNCALIBRATED-until-rerun** in code comments at all three
sites (`config.ts` reviewer + whitelist, `modelCapabilities.ts` registry), and a pure predicate
`isPreviewTierModel(id)` (id-substring `-preview`) lets governance/telemetry flag it without a second registry.

## Why preview-tier matters (the audit's finding, restated)

- **Silent swap risk.** A provider can deprecate or replace a `*-preview` endpoint at any time with **no swap
  event** — so the standing "model-swap ⇒ re-run calibration" rule (G.3) never fires for it. It drifts
  invisibly.
- **Unmeasured calibration.** The reviewer ceiling for `gemini-3.1-pro-preview` (32768) was **carried over
  unmeasured** from the retired `gemini-2.5-pro`. "Calibrated multi-reviewer" is therefore unverified for this
  lane on the current slug until a harness re-run (that re-run is CAL-1, a separate operator-initiated dispatch).

## The decision (options + tradeoffs — no recommendation beyond the audit's)

**Option A — Keep the preview slug, treat it as perpetually swap-eligible.** Accept that Gemini has no GA "Pro"
today; keep `gemini-3.1-pro-preview`, rely on the standing rule that preview lanes are re-run on a cadence (not
on a swap event) and moved to a GA id the moment one exists. *Pro:* keeps the strongest available Gemini Pro
reasoning lane. *Con:* the "calibrated" claim for this lane stays contingent on the cadence re-run actually
happening; a silent provider swap is possible between re-runs.

**Option B — Drop Gemini to a GA slug now.** Move the Gemini reviewer lane to a GA id (e.g. a GA flash, or
retire the Gemini reviewer lane and keep Gemini only for research/currency per audit U-6). *Pro:* every pinned
reviewer lane is GA and swap-events become detectable. *Con:* loses Gemini-Pro-class reasoning in the reviewer
panel until Google ships a GA Pro; a lane change is itself a swap that requires a calibration re-run.

**Option C — Reduce the panel instead (ties to audit U-6 / run-sheet 0.5).** The audit found Grok's evidenced
role is research/currency, not reviewer; and the four-provider panel is the largest live confidentiality
exposure. A panel-composition decision (0.5) could make the Gemini-preview question moot by trimming the
reviewer panel to the evidenced pair + evaluator. *This is the 0.5 decision, surfaced here only because it
overlaps.*

**The audit's own position** (not a recommendation from this memo, restated for the record): *preview lanes are
perpetually swap-eligible — re-run on cadence or move to GA ids.* Whichever option you choose, the CAL-1
harness re-run on the **current** slugs is the cheapest restoration of the "calibrated" claim and should happen
regardless.

## Related standing-governance hooks (built in W8, not decided here)

- **G.3 corollary:** preview-tier lanes are re-run on a cadence (no swap event will fire). Recorded in
  `docs/GOVERNANCE_STANDING_RULES.md`.
- **Provider-confirmation debt:** `gpt-5.5`, `gemini-3.1-pro-preview`, `grok-4.3`, `gemini-3.5-flash` are
  *operator-pending-provider-confirmation* — code cannot prove a slug is real (an operator/provider-docs task).
- **Un-validated pin:** the finalize job pins `anthropic:claude-opus-4-7`, which bypasses all boot-time
  model-id validation (not in the whitelist or the capabilities registry). Noted for a future cleanup; not
  touched here (it is hard-anchored by a source-audit test).
