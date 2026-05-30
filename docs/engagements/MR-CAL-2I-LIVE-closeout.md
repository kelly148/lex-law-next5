# MR-CAL-2I-LIVE - Close-out (classification + risk acceptance)

Engagement: MR-CAL-2I-LIVE (Phase 1, item 1.4) - GPT focused live validation
Type: Live verification, closed via classification + operator risk acceptance
Date: 2026-05-30 (America/New_York)
Repo state: main @ 8c48ee1, working tree clean except local tracker + uncommitted reports.

## Disposition

GPT does NOT pass all four calibration cells. The remaining instability is
classified and accepted as documented risk (the acceptance criterion's second
branch: "remaining issue is expressly classified and accepted as risk").

No fresh ad-hoc live re-run was performed. This was a conscious decision:
rigorous cell scoring needs the offline harness (for repeatable scenario inputs
and stable scoring), and artifact inspection needs production database access -
neither is available in this environment. Reconstructing the four scenario
documents through the UI and scoring them by hand would have produced
lower-quality, subjective evidence at real GPT cost, without closing the one gap
that mattered (auditable raw artifacts), which MR-CAL-2G has now closed in code.

## GPT cell classification

Source: accepted MR-CAL-2E-LIVE run 20260528T122851Z, model openai:gpt-5. These
results are unchanged because MR-CAL-2G applied no GPT behavior change (it is
observability only).

- P8-T1 (execution-blank suppression): PARSE_FAILURE.
  Class: parser / adapter / provider-shape - indeterminate without the raw
  artifact. The failure occurs at the parse boundary; which layer is at fault
  cannot be decided until a raw artifact is captured.
- P8-T6 (counterparty-facing over-disclosure): FAIL.
  Class: substantive misalignment. Output parsed but the classification was
  substantively wrong.
- P8-T7 (governing-law / sendability blocker): PASS.
- P8-T10 (business-decision separation): PASS.

## What changed since the MR-CAL-2E-LIVE run

MR-CAL-2G (merged at 8c48ee1) now captures raw and normalized reviewer output
via the reviewer_output_captured telemetry event, emitted before the feedback
parse can throw. Consequently:

- The P8-T1 PARSE_FAILURE artifact - which MR-CAL-2F found was unreconstructable
  because nothing persisted raw output - will be auditable on the next live GPT
  run that reproduces it.
- The MR-CAL-2G live test already exercised the capture path on a passing live
  GPT-5 review (regression-safe PASS), confirming the modified reviewer commit
  path runs cleanly in production.
- The remaining open item is therefore narrowed: not "can we capture the
  artifact" (solved) but "classify P8-T1's parse failure (parser vs adapter vs
  provider-shape)" once a failure is next captured.

## Accepted risk

Accepted as documented risk (operator-approved):

- GPT P8-T1 instability (parse-class PARSE_FAILURE) - ACCEPTED_RISK.
- GPT P8-T6 instability (substance-class FAIL) - ACCEPTED_RISK.

These are not resolved. Resolution is deferred to a future, separately-authorized
GPT correction, whose prerequisite (raw-artifact preservation) is now satisfied
by MR-CAL-2G. P8-T7 and P8-T10 remain PASS.

## Gate effect on CAL-7B

The master plan states: "Do not proceed to full CAL-7B until this is resolved or
consciously waived." This close-out consciously waives that gate on a
risk-accepted basis. CAL-7B is therefore not blocked by this item, but it retains
its own separate prerequisites (core reviewer workflow live verified; decisions on
native cards / evaluator / memory / ledger / sendability inclusion).

## Scope and evidence class

- No source files modified. No fresh live GPT run performed in this engagement.
- Cell results are operator-accepted prior findings from MR-CAL-2E-LIVE, not
  re-run here.
- The capture capability is confirmed by code inspection (8c48ee1) and by the
  MR-CAL-2G live regression test; the captured telemetry rows themselves were not
  inspected in this engagement (no in-app telemetry view; no production DB access).

## Out-of-scope log

None. The only forward action is a future authorized GPT correction (parse-class
and/or substance-class), now unblocked on the observability prerequisite.

---
End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
