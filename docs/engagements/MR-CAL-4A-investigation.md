# MR-CAL-4A - Investigation Report

Engagement: MR-CAL-4A (Phase 3, item 3.1) - Native feedback-card runtime investigation
Type: Investigation only (no code changes; no implementation)
Date: 2026-05-30 (America/New_York)
Repo state: main @ 9adb953, working tree clean except local tracker.

## Objective

Determine the safest strategy to activate a native feedback-card runtime while
preserving legacy compatibility, document whether a schema migration is required,
and establish that a Phase A (MR-CAL-4B) implementation scope can be drafted
safely. No implementation in this engagement. Any implementation requires
operator approve scope:MR-CAL-4B before it begins.

## Headline

The native feedback-card foundation is substantially built and, critically, the
reviewers already emit native-card data today (embedded in the legacy suggestion
body). Activation is therefore an incremental, additive extraction-and-render
effort, not a from-scratch build, and it does not require a destructive schema
migration.

## What already exists (confirmed by code inspection at 9adb953)

1. Native schema: src/shared/schemas/feedbackCards.ts
   - FeedbackCardSchema: a ~25-field canonical card (feedback_id, review_cycle_id,
     reviewer_track, severity [BLOCKER/SUBSTANTIVE/STRUCTURAL/PRECISION/POLISH],
     severity_subtype [DRAFTING/BUSINESS], critique_type, target_document,
     target_section, issue, source_basis, source_of_truth_tier, recommendation,
     suggested_revision, requires_attorney_decision, suppress_by_default,
     routine_blank_flag, audience_affected[], confidence, disposition_options[],
     future_memory_instruction, persistence_count, persistence_chain,
     evaluator_disposition, evaluator_rationale, regeneration_instructions).
   - Controlled vocabularies for severity, subtype, critique_type, audience,
     disposition, evaluator disposition; numeric source_of_truth_tier and
     confidence; superRefine cross-field validation (severity_subtype required iff
     SUBSTANTIVE).
   - FeedbackCardArraySchema for arrays.

2. Native parser entry point: src/server/llm/parsers/feedbackParser.ts
   - parseFeedbackCardOutput(raw): validates against FeedbackCardArraySchema,
     fail-loud (REVIEWER_OUTPUT_MALFORMED). Explicitly documented as NOT replacing
     or widening the legacy parseFeedbackOutput, and is currently not wired into
     the reviewer runtime.

3. Bidirectional compatibility helpers: feedbackCards.ts
   - legacySuggestionToFeedbackCard(...) and feedbackCardToLegacySuggestion(card),
     plus isLegacyFeedbackSuggestion / isFeedbackCard type guards, and legacy
     severity <-> card severity mappings.

4. Reviewers already produce native-card data: src/server/llm/prompts/reviewerPrompts.ts
   - The calibrated prompts instruct each reviewer to include, inside each body
     string, a NARRATIVE_REVIEWER_MEMO section and a STRUCTURED_FEEDBACK_CARDS
     section, where STRUCTURED_FEEDBACK_CARDS "must contain a JSON array compatible
     with the MR-CAL-1 feedback-card contract using exact field names only," with
     the controlled vocabularies enumerated. So native-card payloads already flow
     through the system embedded in the legacy body.

5. Tests: src/server/__tests__/mr_cal_1_feedback_cards.test.ts (9 tests) cover
   schema acceptance, controlled-vocabulary rejection, the SUBSTANTIVE subtype
   rule, the native parser bridge (no UUID restamp), fail-loud behavior, legacy
   parser preservation, and legacy<->card conversion. mr_cal_2d has a
   parseEmbeddedCards helper that already extracts STRUCTURED_FEEDBACK_CARDS from a
   body string for scoring.

## Legacy fields still driving runtime

- Parse: src/server/llm/parsers/feedbackParser.ts parseFeedbackOutput(raw) ->
  { suggestionId, title, body, severity:'critical'|'major'|'minor' }.
- Invocation/persistence: src/server/procedures/reviewSession.ts reviewer
  txn2Commit calls parseFeedbackOutput then insertFeedback with the legacy
  suggestions array.
- Storage: feedback.suggestions is a JSON column (src/server/db/schema.ts),
  holding the legacy suggestion objects; the embedded STRUCTURED_FEEDBACK_CARDS
  ride inside each suggestion body string.
- UI: src/client/components/ReviewPane.tsx FeedbackCard renders
  { suggestionId, title, body, severity } and per-suggestion selection.

## Answers to the engagement questions

- What native schema exists? A complete FeedbackCardSchema (above). No gaps for a
  first activation.
- What legacy fields drive runtime? The legacy suggestion shape and the JSON
  suggestions column, end to end (parse -> persist -> render).
- What DB changes are needed? None that are destructive. The native data already
  lives inside the existing JSON column. Two safe options:
  (a) Additive nullable JSON column (e.g. feedback.feedbackCards) holding the
      validated native cards alongside the legacy suggestions. Recommended:
      preserves the legacy path byte-for-byte, is reversible, and is an additive
      Drizzle migration (no data rewrite).
  (b) Reuse the existing suggestions JSON column with a richer shape. Avoids a new
      column but couples legacy and native storage and risks read-path
      assumptions; not recommended for the first step.
- Can native cards coexist with legacy { title, body, severity }? Yes. Dual parser
  entry points plus bidirectional converters already make them interoperable; the
  legacy path can remain the fallback.
- What UI expects feedback-card data? ReviewPane.FeedbackCard expects the legacy
  shape. Native activation needs UI work to surface native fields (severity tier,
  severity_subtype, critique_type, requires_attorney_decision, audience_affected,
  suggested_revision). This is the largest net-new surface.
- What tests exist? mr_cal_1_feedback_cards.test.ts (9) and mr_cal_2d
  parseEmbeddedCards, as above.
- Safest migration/compatibility strategy? See below.

## Recommended migration and compatibility strategy

Incremental, additive, legacy-preserving, in this order:

1. Extract: parse the STRUCTURED_FEEDBACK_CARDS array out of each reviewer body
   (the parseEmbeddedCards approach already used in tests), then validate with
   FeedbackCardArraySchema. On failure, fall back to the legacy suggestion (and,
   thanks to MR-CAL-2G, the raw output is now captured for audit).
2. Persist: store the validated native cards in an additive nullable JSON column
   (option (a) above). Keep writing the legacy suggestions column unchanged.
3. Render: extend the UI to display native fields when present, falling back to the
   legacy rendering when the native column is null. Preserve per-suggestion
   selection and the sequential-comparison view.
4. Keep the legacy parser path and the bidirectional converters as the
   compatibility layer throughout. Do not remove the legacy path in this arc.

Schema migration required: only an additive nullable column (reversible, no data
rewrite). No destructive migration. This is consistent with the project rule to
avoid DB schema churn and keeps the change rollback-safe.

## Phase A (MR-CAL-4B) scope - draftable, not authorized

A safe MR-CAL-4B Phase A would: add the additive nullable column; add an
extraction+validation step in the reviewer commit path that populates it from the
already-emitted embedded cards; extend the feedback read model and ReviewPane to
render native fields with legacy fallback; add tests. It would NOT include
evaluator topology, matter memory, sendability gate, adopt ledger, or
multi-reviewer session-model changes (master plan MR-CAL-4B do-not-include list).
MR-CAL-4B requires operator approve scope:MR-CAL-4B before any code.

## Scope and evidence class

- Investigation only. No source files modified.
- All claims confirmed by code inspection at main @ 9adb953 (files and symbols
  named above).
- "Reviewers already emit native-card data" is confirmed from the reviewer prompt
  source; it was not separately re-verified against a fresh live reviewer payload
  in this engagement (though live reviewer runs in MR-CAL-3F-LIVE rendered
  bodies containing the NARRATIVE_REVIEWER_MEMO / STRUCTURED markers).

## Out-of-scope log

None.

---
End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
