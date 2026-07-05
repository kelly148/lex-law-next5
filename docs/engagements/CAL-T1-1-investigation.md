# CAL-T1-1 — P8-T1 execution-blank "over-flagging" — investigation + recommendation

**Class:** investigation-only (a calibration read; no reviewer-prompt or scoring patch written — CLAUDE.md gates
prompt/scoring patches until raw outputs are captured and the finding is understood). **Date:** 2026-07-05.
**Authorized live budget:** up to the remaining batch cap; **used: 0 new calls** — the finding is fully supported
by the raw outputs W6-BASELINE-EXPANSION-1 just captured (`tools/calibration/golden/runs/<runId>/`).

## Question
`docs/STATE.md` (2026-07-05, CLAUDE-LANE-MODERNIZATION/RPR entry) flagged **P8-T1 (execution-blank suppression)
as the now-visible calibration soft spot** — "reviewers over-flag routine blanks; previously MASKED by parse
failures." CAL-T1-1 was to reduce that over-flagging (prompt/scoring) with a live G.3 rerun on affected lanes.

## Finding — the visible P8-T1 "FAIL" is (for every captured lane) a SCORING ARTIFACT, not a reviewer over-flag
Across the four W6 lanes captured 2026-07-05 on the P8-T1 golden scenario (a clean pre-execution VA deed of
gift whose only blanks are signature/date/notary):
- **`gpt_lite`, `grok`, `grok_lite`** returned the **empty array** (`items=0`) — correct suppression, scored PASS.
- **`claude_lite`** returned ONE card that **suppressed correctly**: `severity: POLISH`,
  `routine_blank_flag: true`, `suppress_by_default: true`, `requires_attorney_decision: false`, and the memo
  states verbatim: *"Consistent with the execution-blanks suppression instruction, I am not treating these as
  defects."* It explicitly declined to flag them. **The reviewer did exactly what the calibrated P8-T1 behavior
  wants.**

Yet the golden harness scored `claude_lite` P8-T1 **FAIL**. Root cause: the golden harness's P8-T1 **signature
extractor** (`featuresFor('P8-T1')` in `golden_reviewer_harness.mjs` / `goldenReviewerDiff.ts`) is a crude
text-regex — it returns FAIL whenever the output text *mentions* a routine blank
(`/signature block|notary|acknowledgment|date line|.../` AND `/blank|missing|.../`) **without ever checking
whether the reviewer SUPPRESSED it.** A correctly-suppressed card that merely *names* the blanks it is
suppressing trips the regex → false FAIL.

By contrast, `cal7b_harness.mjs`'s REAL P8-T1 scorer parses the embedded card and credits suppression:
`if (routine_blank_flag === true && suppress_by_default === true) -> PARTIAL` (not FAIL). The two scorers
disagree; the golden extractor is the cruder one.

**Conclusion:** for the lanes observable here, there is **no genuine reviewer over-flag** — the reviewers
suppress routine execution blanks correctly. The visible P8-T1 "soft spot" is, at least for these lanes, the
golden drift-harness's coarse signature extractor scoring a correct suppression as FAIL. The reviewer SYSTEM
PROMPT's execution-blank suppression instruction is behaving as intended; **no prompt patch is warranted by this
evidence.**

## Recommendation (a scoped follow-up — deliberately NOT rushed at this batch's tail)
1. **Refine the golden P8-T1 signature extractor to credit suppression** — parse the embedded
   `STRUCTURED_FEEDBACK_CARDS` and treat `routine_blank_flag && suppress_by_default` (or the empty array) as
   PASS/PARTIAL, aligning it with `cal7b`'s real P8-T1 scorer. This is a change to the **drift detector's
   scoring contract**, not the production reviewer prompt — reversible, CI-catchable
   (`golden_reviewer_diff.test.ts` pins the TS source of truth), and NOT a §3.1 FIRE (no
   access-control/send-safety/ethics surface).
2. **Coordinate the re-baseline:** the change alters every P8-T1 signature (incl. the `claude_lite` baseline
   W6 just committed as FAIL). Re-derive from the **already-committed fixtures** (`golden/fixtures.json`) — **no
   new live calls needed** — then DARK-verify. Keep it a distinct engagement so the drift-scorer change and its
   re-baseline are one reviewable diff.
3. **Only if a full G.3 grid rerun surfaces a lane that emits an UNSUPPRESSED routine-blank card** (none did
   here) is a reviewer-prompt strengthening warranted — and that would be the point to capture raw outputs and
   consider whether it needs a triad look. This evidence does not reach that bar.

## Why investigation-only here
CLAUDE.md: make no prompt/parser/scoring patch until raw outputs are captured and understood; prompt/scoring
repair is authorization-gated. The raw outputs are now captured (W6) and understood (this report): the fix is a
drift-scorer refinement, not a reviewer-prompt change — and doing that scorer change + full P8-T1 re-baseline
as the "if time" tail of a large batch, right after W6 baselined against the current scorer, would be churn
against a scoring artifact. Surfacing the precise finding + the scoped fix is the higher-value, lower-risk
outcome.
