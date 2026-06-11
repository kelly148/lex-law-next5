# REVIEWER-LATENCY-1 Step 2b — Reviewer Output-Contract Recon (investigation)

Read-only recon performed against `origin/main` (`39f8a50`), which equals the live prod commit at the
time of investigation. The reviewer contract/parser/display files were byte-identical between the local
tree and `origin/main`; the token-side files were read at `origin/main`. This report informed the Step 2b
implementation (the reviewer output-contract diet, flag-gated behind `REVIEWER_LEAN_CONTRACT_ENABLED`).

## Objective

Map the reviewer output contract so a lean single-render schema could be designed without breaking the
parser or the display path: which fields exist, who populates them, what the parser requires, what is
persisted, what is rendered, whether the prose memo is reconstructable from the cards, and how to surface
the reasoning-token fraction.

## Architecture (load-bearing fact)

The reviewer does NOT emit a structured record. It emits a legacy JSON array of `{title, body, severity}`
wrappers, and is instructed to stuff BOTH a `NARRATIVE_REVIEWER_MEMO` prose block AND a
`STRUCTURED_FEEDBACK_CARDS` JSON array inside the `body` string of each wrapper
(`src/server/llm/prompts/reviewerPrompts.ts:132-144`). The active parser validates ONLY the wrapper and
never reads `body` (`src/server/llm/parsers/feedbackParser.ts:70-91`). The card is re-extracted leniently
at display time (`src/server/procedures/reviewSession.ts:649`). So the "double render" is prose + cards
both living as opaque text inside one body string, and the structured card is already the thing the UI
prefers to render.

## 1. Contract definition

- Prompt instruction emitting both renders: `src/server/llm/prompts/reviewerPrompts.ts:132-144` (L133 JSON
  array only; L134 wrapper shape; L135 both sections inside body; L136 memo must cover issue, source basis,
  jurisdiction treatment, recommended action, attorney decision points; L137-138 cards as a JSON array with
  exact field names).
- Card field list: `FEEDBACK_CARD_FIELD_NAMES` at `reviewerPrompts.ts:37-63`; strict Zod schema at
  `src/shared/schemas/feedbackCards.ts:113-157`.
- Precision note: the contract is 25 fields (not 24): feedback_id, review_cycle_id, reviewer_track,
  severity, severity_subtype, critique_type, target_document, target_section, issue, source_basis,
  source_of_truth_tier, recommendation, suggested_revision, requires_attorney_decision, suppress_by_default,
  routine_blank_flag, audience_affected, confidence, disposition_options, future_memory_instruction,
  persistence_count, persistence_chain, evaluator_disposition, evaluator_rationale, regeneration_instructions.

## 2. Field ownership / parser / persistence / render

- Parser-required: NONE of the 25 card fields. The active parser (`parseFeedbackOutput`) only validates the
  wrapper's title/body/severity (`feedbackParser.ts:27-31`). The card fields live inside `body` as opaque text.
- Persistence: the whole legacy suggestion `{suggestionId, title, body, severity}` is stored in
  `feedback.suggestions` JSON (`src/server/db/schema.ts:939-940`). No per-field column; card fields persist
  only as embedded text inside `body`.
- Rendered (7 fields) in `SuggestionCard` (`src/client/components/ReviewPane.tsx:424-519`): severity,
  critique_type, requires_attorney_decision, audience_affected, issue, recommendation, suggested_revision —
  plus the wrapper title and a prose fallback. `severity_subtype` is in the TS interface but not rendered.
  18 of 25 fields are never shown.
- Reviewer-owned vs not: evaluator_disposition/evaluator_rationale are EVALUATOR-owned (the prompt even tells
  the reviewer not to implement evaluator mode, `reviewerPrompts.ts:128`); review_cycle_id, reviewer_track,
  target_document, feedback_id are RUNTIME-known (feedback_id is overridden by a fresh UUID at
  `feedbackParser.ts:85-89`); persistence_count/chain, future_memory_instruction, regeneration_instructions
  are matter-memory/regeneration RUNTIME (deferred/unbuilt). ~9 fields the reviewer is told to emit are owned
  or ignored by the runtime.

## 3. Parser

`parseFeedbackOutput` (`feedbackParser.ts:70-91`) hard-requires only title/body/severity; `body` is opaque.
It never reads the prose memo. Call site / persistence: `reviewSession.ts:347-392`. The strict
`parseFeedbackCardOutput` (`feedbackParser.ts:100-113`) is NOT wired into the reviewer path. Removing the
prose memo as a separately emitted block breaks no parser.

## 4. Display

`SuggestionCard` takes `card0 = nativeCards[0]` (`ReviewPane.tsx:425`) and renders severity chip,
attorney-decision badge, wrapper title, a meta line (critique_type + audience_affected + reviewer label),
Issue (card0.issue else the prose fallback `stripEmbeddedCardsJson(body)`), Recommend (card0.recommendation),
Revision (card0.suggested_revision). Cards are attached in `reviewSession.get` via
`extractEmbeddedFeedbackCards(s.body)` (`reviewSession.ts:645-651`), tolerated by `FeedbackCardDisplaySchema`
(`feedbackCards.ts:174-212`). Prose is surfaced only as the Issue fallback. "Prose derived for display" must
produce three readable strings: Issue, Recommend, Revision — from issue/recommendation/suggested_revision.

## 5. Prose vs card overlap — verdict: prose CAN become a derived view, with one gap

Memo elements map onto cards: issue->issue; source basis->source_basis; recommended action->recommendation +
suggested_revision; attorney decision points->requires_attorney_decision + recommendation. The one gap:
JURISDICTION / GOVERNING-LAW treatment is required in the memo (`reviewerPrompts.ts:136`) but has NO
structured card field. Resolution adopted in Step 2b: add a `governing_law` string field so the derived
display is lossless.

## 6. Token breakdown — read path

- Persisted: `jobs.tokensReasoning` (int nullable; migration 0027) at `src/server/db/schema.ts:203-207`, with
  `tokensCompletion`/`tokensPrompt`. Written by `markJobCompleted` (`src/server/db/queries/jobs.ts:245-271`)
  and `canonicalMutation.ts:695`. Also emitted in the `job_completed` telemetry event
  (`src/shared/types/telemetry.ts:233`).
- Root cause it was uncomputable: every job read (`job.getById`/`listForDocument`/`poll`) runs rows through
  `parseJobRow`->`JobRowSchema.parse` then `PublicJobSchema.parse`; neither schema listed `tokensReasoning`
  (`src/shared/schemas/jobs.ts:135-137, 164-166`), so Zod stripped it even though the DB `.select()` fetched it.
- Smallest fix (adopted, always-on in Step 2b): add `tokensReasoning: z.number().int().nonnegative().nullable()`
  to JobRowSchema and PublicJobSchema. No query change. reasoning_fraction = tokensReasoning / tokensCompletion.

## Step 0 consumer check (performed at Step 2b implementation)

Traced every consumer of `suppress_by_default` / `routine_blank_flag` across `src/`. The only non-test
references are the strict schema field defs (`feedbackCards.ts:129-130`), a default-writer setting both
false (`feedbackCards.ts:286-287`), and the prompt emit-instruction (`reviewerPrompts.ts:52-53,104`). No
runtime path (evaluator, disposition, suppression, regeneration, display) reads them; the only readers are
test harnesses. Verdict: both INERT -> DROPPED from the lean field set. The execution-blank suppression
BEHAVIOR is preserved by the prompt rule that tells the reviewer not to flag routine blanks, not by anything
reading these booleans.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
