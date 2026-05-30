# MR-CAL-CORE-CLOSEOUT

Engagement: MR-CAL-CORE-CLOSEOUT (Phase 2, item 2.2)
Type: Documentation / governance close-out
Date: 2026-05-30 (America/New_York)
Repo state: main @ 8c48ee1.

## Purpose

Declare the current legacy-wrapper reviewer workflow CORE COMPLETE, state the
final GPT posture, enumerate known risks, and frame the next major architecture
decision. This close-out does not begin any new architecture work.

## Core reviewer workflow status: COMPLETE (legacy-wrapper runtime)

The attorney-supervised reviewer workflow is live-verified end-to-end on
production. The active runtime remains the legacy JSON-array wrapper parsed by
parseFeedbackOutput, with feedback-card detail embedded in the legacy suggestion
body. This is unchanged and intentional; native feedback-card runtime is deferred
(see below).

Live-verified on production at 8c48ee1 (MR-CAL-3F-LIVE, full coverage):

- Review sessions create correctly.
- Reviewer feedback renders.
- Attorney per-suggestion selection works.
- Regeneration with selected feedback works and commits a new version.
- Review iteration advances server-side.
- Sequential prior-feedback comparison renders and accumulates across iterations.
- All four reviewer tracks exercised live and working:
  GPT (openai:gpt-5, 11 suggestions), Claude (anthropic:claude-opus-4-5, 7
  suggestions), Gemini (google:gemini-2.5-pro, 3 suggestions), Grok (xai:grok-4,
  completed cleanly with a graceful no-suggestions result). GPT Lite
  (openai:gpt-4.1-mini) additionally exercised.

Supporting fixes completed and merged in this arc:

- LLN-OUTLINE-GEN-1: outline generation hardened against normal LLM JSON shapes
  with visible/recoverable failure (merged 94daf8e).
- LLN-UX-ITER-LABEL-1: pre-creation review label neutralized (merged de2d7c2,
  live-verified PASS).
- LLN-REVIEW-DEFAULT-1: default-reviewer-equals-drafter UX trap investigated;
  fix options scoped (not implemented).
- MR-CAL-2G: raw reviewer output now captured to telemetry before the feedback
  parse, closing the artifact-observability gap (merged 8c48ee1, live regression
  PASS).

## GPT final posture

GPT does not pass all four calibration cells. Per MR-CAL-2I-LIVE, the remaining
instability is classified and accepted as documented risk:

- P8-T1 (execution-blank suppression): PARSE_FAILURE - parse/adapter/provider-shape
  class, indeterminate without a captured raw artifact. ACCEPTED_RISK.
- P8-T6 (counterparty-facing over-disclosure): substantive FAIL. ACCEPTED_RISK.
- P8-T7 (governing-law / sendability blocker): PASS.
- P8-T10 (business-decision separation): PASS.

The MR-CAL-2F investigation identified the root cause (raw output was never
persisted, so failures could not be reconstructed). MR-CAL-2G fixed that
observability gap. Consequently, the next live GPT run that reproduces P8-T1 will
capture an auditable artifact, enabling a future, separately-authorized GPT
correction to definitively classify and fix the parse-class failure. No such
correction is authorized by this close-out.

## Reviewer output contract

Stable and documented: legacy JSON-array wrapper, parsed by parseFeedbackOutput;
structured feedback-card detail embedded in the suggestion body
(NARRATIVE_REVIEWER_MEMO + STRUCTURED_FEEDBACK_CARDS markers). Calibrated reviewer
prompts for all four tracks are in place (MR-CAL-2 / 2A). Scoring predicates live
in mr_cal_2d_calibration_scoring.test.ts.

## Known risk list

1. GPT P8-T1 instability (parse-class) - ACCEPTED_RISK; now capturable.
2. GPT P8-T6 instability (substance-class) - ACCEPTED_RISK.
3. Synthetic production test data accumulated during live verifications
   (multiple synthetic matters, documents, and review sessions; a regeneration on
   the synthetic POA iteration test doc). Cleanup is LLN-PROD-CLEANUP-1
   (operator-approved only; not in the automated queue).
4. Default-reviewer-equals-drafter UX trap (LLN-REVIEW-DEFAULT-1): first-pass
   review defaults to Claude, the same model that drafts, so it can legitimately
   return no suggestions and look broken. Fix scoped (Option A non-drafter default
   + Option B advisory), not implemented.
5. AUTH_BYPASS_ENABLED status in the Railway production environment is not
   established (see docs/CODE_REVIEW_2026-05.md).
6. Telemetry now stores raw reviewer output (reviewer_output_captured) - same
   DB/security boundary as the feedback table, but retention schedule may differ.

## Formally deferred out of core MR-CAL

The following are NOT part of the now-complete core workflow and require explicit
operator scope approval before implementation begins (master plan Phases 3-8):

- Native feedback-card runtime (MR-CAL-4 arc).
- Evaluator / multi-reviewer topology (MR-CAL-5 arc).
- Matter memory and locked decisions (MR-CAL-6 arc).
- Cumulative adopt ledger (MR-CAL-7 arc).
- Sendability gate (MR-CAL-8 arc).
- Full calibration regression grid (CAL-7B). The 2I-LIVE close-out consciously
  waived the "do not proceed to CAL-7B until GPT resolved" gate on a risk-accepted
  basis; CAL-7B retains its own separate prerequisites.

## Next major architecture decision (framed, not decided)

With the core legacy-wrapper workflow complete and GPT posture risk-accepted, the
next decision is which deferred arc to authorize first. The master plan's
recommended order resumes at Phase 3 (MR-CAL-4A: native feedback-card runtime
investigation), which is investigation-only and unblocks the structured-card
foundation that several later arcs (evaluator, sendability) build on. The operator
chooses; nothing is started without operator approve scope:<id>.

## Scope and evidence class

- Documentation only. No source files modified.
- Live-verified claims are from MR-CAL-3F-LIVE (full 4-track) and prior
  live-verified merges, all on production at the SHAs cited.
- GPT cell outcomes are operator-accepted prior findings (MR-CAL-2E-LIVE) plus the
  MR-CAL-2I-LIVE risk acceptance; not re-run here.

## Out-of-scope log

None.

---
End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
