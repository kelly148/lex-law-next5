# MR-CAL-5C - Phase A Plan (plan-first; no code)

Engagement: MR-CAL-5C - Evaluator output contract.
Type: Phase A planning/investigation (architecture; scope approved 2026-05-31).
Repo state: main @ bb1f0b8. No source modified by this plan.
Scope boundary: complete the evaluator output contract ONLY (prompt + output schema
+ parse/persist + enablement). Explicitly NOT: matter memory, locked decisions,
adopt ledger, sendability gate, reviewer prompt/scoring/parser changes, or any
auto-adopt / auto-regenerate behavior.

## Objective

Make the (currently inert) evaluator produce real, structured, advisory output:
a real prompt, a validated output schema, parsing + persistence via the existing
insertFeedbackEvaluation, and enablement behind the existing isEvaluatorEnabled
flag. The evaluator must remain strictly advisory - it surfaces consensus,
conflicts, and adoption priority; it never decides, never auto-adopts, and flags
business decisions for the attorney (P8-T10 separation principle). The attorney
remains the sole decision-maker.

## Method and evidence class

All findings confirmed by code inspection at main @ bb1f0b8 (files/lines cited).

## Finding - the contract already exists end-to-end; only the dispatch is incomplete

- Schema: feedback_evaluations (schema.ts:857) with dispositions JSON =
  array of { suggestionId, disposition, synthesisBody? }. No migration needed.
- Disposition vocabulary: EvaluatorDispositionSchema (shared/schemas/phase4b.ts:38)
  = { suggestionId, disposition: enum['adopt','reject','neutral'], synthesisBody? };
  FeedbackEvaluationRowSchema wraps { ..., dispositions: [...] }.
- Persistence + read: insertFeedbackEvaluation and getEvaluationForIteration
  (phase4b.ts) already exist and are validated by FeedbackEvaluationRowSchema.
- Read path: reviewSession.get already returns `evaluation` (getEvaluationForIteration).
- Display: ReviewPane already renders, per suggestion, an evaluator disposition icon
  (adopt = green check, reject = red X, neutral = gray minus) and a synthesisBody
  italic line (ReviewPane.tsx ~436-440, 507-508; evalDispositions =
  evaluation?.dispositions). NO UI change is required.
- Dispatch (the gap): the evaluator block in reviewSession.create (reviewSession.ts
  ~301-338) is gated behind isEvaluatorEnabled() (default OFF, added in 5B) and
  input.selectedReviewers.length > 1, uses PLACEHOLDER system/user prompts, and its
  txn2Commit only emits telemetry - it never parses the evaluator output and never
  calls insertFeedbackEvaluation. Model is EVALUATOR_MODEL (config.ts:161, default
  anthropic:claude-opus-4-5; decision #41 - env-fixed, never attorney-selectable).

So 5C = complete the dispatch only.

## Design

1. Evaluator prompt (advisory, non-decisionmaking). Build from the cycle's reviewer
   feedback (the suggestions + their embedded native-card fields: severity,
   severity_subtype DRAFTING/BUSINESS, critique_type, issue, recommendation,
   audience_affected, requires_attorney_decision). Instruct the model to: identify
   consensus and conflicts across reviewers; rank adoption priority; distinguish
   drafting vs business issues; and, per suggestion, emit an ADVISORY disposition
   (adopt/reject/neutral) with a short synthesis rationale. Hard constraints in the
   prompt: never make the final decision; never rewrite the document; never treat a
   business choice as a defect; explicitly flag business decisions for the attorney
   (P8-T10). The disposition is a RECOMMENDATION only.

2. Output schema (structuredOutputSchema). Enforce
   { dispositions: [{ suggestionId: string, disposition: 'adopt'|'reject'|'neutral',
   synthesisBody: string }] }, matching EvaluatorDispositionSchema so the existing
   persist/read/display path accepts it unchanged. Use the structured-output +
   tolerant-parse pattern proven in MR-IR-GEN-2 (structuredOutputSchema +
   defensive parse) to avoid the JSON-contract brittleness that bit information
   requests/outlines.

3. Parse + persist. In the evaluator txn2Commit, parse the model output against the
   schema and call insertFeedbackEvaluation({ userId, documentId, iterationNumber,
   jobId, dispositions }) - replacing the telemetry-only stub. On parse failure,
   emit a visible/telemetry error and persist nothing (no partial/garbage rows);
   the legacy reviewer feedback remains fully usable (evaluator is additive).

4. Enablement. Keep the dual gate: isEvaluatorEnabled() (env EVALUATOR_ENABLED,
   default OFF) AND selectedReviewers.length > 1. So the evaluator only runs when an
   operator explicitly enables it AND the attorney selects multiple reviewers. This
   preserves zero-impact default-off behavior.

5. Display. No change - the existing ReviewPane disposition icons + synthesis line
   render the persisted dispositions as soon as they exist.

## Guardrails (advisory-only; attorney decides) - acceptance mapping

- Evaluator output is structured -> Design 2 (schema-validated).
- Attorney remains decision-maker -> dispositions render as advisory ICONS next to
  suggestions; the attorney's actual selection is the separate checkbox/selection
  model (feedbackManualSelections), which the evaluator never writes.
- Evaluator does not auto-adopt -> the dispatch only writes feedback_evaluations
  (advisory), never feedbackManualSelections and never triggers regeneration.
- Conflicts and consensus are visible -> synthesisBody per suggestion (and the
  prompt instructs explicit consensus/conflict surfacing).
- CI passes -> tests below.

## Tests (planned)

- Evaluator output parse: valid output -> dispositions persisted; malformed output
  -> no row, graceful error (mirrors MR-IR-GEN-2 / MR-CAL-2G parse tests).
- Dual-gate: evaluator dispatch fires only when isEvaluatorEnabled() AND >1 reviewer
  (extend the existing gate tests).
- Schema conformance: emitted dispositions validate against EvaluatorDispositionSchema.
- Source audit: txn2Commit calls insertFeedbackEvaluation (not telemetry-only).

## Risks

- Evaluator LLM output reliability (parse). Mitigated by structuredOutputSchema +
  tolerant parse + persist-nothing-on-failure.
- Live verification (MR-CAL-5D-LIVE) needs >=2 reviewers actually feeding the
  evaluator; the observed Gemini-Lite non-return (MR-CAL-5B 2-reviewer run) is a
  reviewer-reliability dependency to resolve around 5D-LIVE (use two reliable
  reviewers for the live check).
- EVALUATOR_MODEL is claude-opus-4-5 (env-fixed, decision #41); cost/latency per
  cycle. Default-OFF flag bounds exposure.

## Recommended next steps

1. On acceptance of this plan, MR-CAL-5C implementation proceeds as a bounded Phase
   A: evaluator prompt + structuredOutputSchema + parse/persist wiring + tests,
   default OFF, delivered for review before any merge.
2. MR-CAL-5D-LIVE (live verification) follows, with the flag enabled and two
   reliable reviewers selected.

## Out-of-scope log

Matter memory; locked decisions; adopt ledger; sendability gate; reviewer
prompt/scoring/parser changes; any auto-adopt or auto-regeneration. None touched.

---
End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
