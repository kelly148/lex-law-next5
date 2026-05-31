# MR-CAL-5B - Phase A Plan (plan-first; no code)

Engagement: MR-CAL-5B - Multi-reviewer session data model + global toggle.
Type: Phase A planning/investigation (architecture; scope approved 2026-05-31).
Repo state: main @ 5733a3e. No source modified by this plan.
Scope boundary: data model + the global on/off toggle ONLY. Explicitly NOT the
evaluator output contract (MR-CAL-5C), matter memory, locked decisions, adopt
ledger, sendability gate, or any reviewer prompt/scoring/parser change.

## Objective

Support multiple reviewer outputs in a single comparison cycle, behind a global
on/off flag (default OFF = today's single-reviewer behavior), without breaking
sequential iteration behavior, prior-feedback comparison, or manual attorney
selection. Per the operator design decision (design:MR-CAL-5B), the toggle is a
single global master flag, architected so per-matter granularity can be added
later without rework.

## Method and evidence class

All findings below are confirmed by code inspection at main @ 5733a3e (files and
lines cited). The authoritative MR-0 close-out (the source of the "D1-D5"
structural-defect labels) is NOT present in the repository; see "D1-D5 gap" below.

## Finding 1 - The multi-reviewer block is an INPUT gate, not a schema limit

The MR-0G gate lives in exactly two places (confirmed by mr0g.gate.test.ts):

- API: reviewSession.create input Zod schema, selectedReviewers
  `.min(1, NO_REVIEWERS_SELECTED).max(1, MULTI_REVIEWER_DISABLED)`
  (reviewSession.ts ~line 82).
- UI: ReviewPane.tsx uses `type="radio"` / `name="reviewer-selection"`, holds a
  single string `useState<string>(selectedReviewer)`, and derives the payload as
  `selectedReviewer ? [selectedReviewer] : []`.

Nothing in the database schema forbids multiple reviewers. The gate is a
deliberate input restriction. This is the primary intervention point for the toggle.

## Finding 2 - The storage/write model is already multi-reviewer-shaped

- Schema (schema.ts): `feedback` is documented as "one row per reviewer-model
  invocation per document iteration", keyed by (userId, documentId,
  iterationNumber, reviewerRole). review_sessions stores selectedReviewers as an
  array and holds "one active session per (documentId, iterationNumber)".
- Write path (reviewSession.create): already `for (const reviewerRole of
  input.selectedReviewers)` dispatches a reviewer job and calls insertFeedback per
  reviewer (reviewSession.ts ~177-281). So N reviewers in one iteration already
  produce N feedback rows under one session.

Implication: the create/persist path likely needs little or no change to STORE
multiple reviewers. The risk concentrates in the READ/DISPLAY/SELECTION paths and
the evaluator, not in table shape.

## Finding 3 - The "D1-D5" gap (must be resolved before implementation)

reviewSession.ts (~299) cites "MR-0 close-out (D3, D4 evaluator-path defects);
MR-0G acceptance". Only D3/D4 are characterized in-code (evaluator path). The
authoritative MR-0 close-out enumerating D1-D5 is not in docs/ (no MR-0 file
exists; the D1/D5 in LLN_Reviewer_Architecture_Analysis.md are a DIFFERENT
research-deliverable numbering, not the structural defects). The 5A report already
noted D1-D5 were not re-derived.

Re-derived FROM CODE, the concrete residual-risk areas a multi-reviewer repair must
address are:

- R-A (evaluator, = D3/D4): the evaluator dispatch block only emits telemetry; it
  never parses evaluator output or calls insertFeedbackEvaluation, and prompts are
  placeholder-level (reviewSession.ts ~301-338). Belongs to MR-CAL-5C, but 5B must
  not regress it.
- R-B (read/display): reviewSession.get returns feedback rows as an array (already
  per-row), but ReviewPane's active-session rendering and the per-reviewer grouping
  must be verified to display N reviewers in one iteration without collision.
- R-C (prior-feedback comparison): getDocumentHistory and the sequential-comparison
  view must group/compare correctly when an iteration has multiple reviewer rows
  (today every iteration has exactly one).
- R-D (manual selection): feedbackManualSelections is keyed by (documentId,
  iterationNumber); selection/regeneration semantics must remain unambiguous when
  suggestions come from multiple reviewers in the same iteration.
- R-E (active-session uniqueness, R10): "one active session per (documentId,
  iterationNumber)" must still hold with multiple reviewers grouped under that one
  session.

DECISION NEEDED (operator): either (a) locate/supply the MR-0 close-out so D1-D5
are authoritatively reconciled against R-A..R-E, or (b) proceed on this
code-derived risk list as the working defect set. Recommendation: (b) is
sufficient to proceed safely because the toggle defaults OFF and each risk area is
independently testable; (a) is a nice-to-have for completeness.

## Design A - The global on/off toggle

- A single boolean, read from an environment variable (proposed name
  MULTI_REVIEWER_ENABLED, default false), surfaced to the client via the existing
  settings/config read path.
- OFF (default): behavior is byte-for-byte today's. API keeps `.max(1)`; UI keeps
  the radio/single-string selection. Zero regression; this is the safe default.
- ON: API relaxes to `.max(N)` (N = count of enabled reviewers); UI switches the
  reviewer list to multi-select (checkbox) and the payload becomes the real array.
  Selecting >1 reviewer engages the (advisory, non-decisionmaking) evaluator path -
  but the evaluator's completion is MR-CAL-5C, so in 5B the evaluator stays inert
  unless/until 5C lands.
- Extensibility (Option 2 later): keep the flag check behind a single accessor
  (e.g. isMultiReviewerEnabled(ctx)) so a future per-matter setting can override
  the global default without touching call sites.

## Design B - Data-model / behavior work in 5B

1. Flag plumbing: env var + accessor + client exposure (default off).
2. Gate relaxation behind the flag (API `.max`, UI selection control).
3. Read/display: ensure reviewSession.get + ReviewPane group N reviewer rows under
   one iteration correctly (R-B).
4. Prior-feedback comparison: ensure getDocumentHistory + sequential-comparison
   handle multi-row iterations (R-C).
5. Manual selection/regeneration across reviewers (R-D), preserving manual attorney
   control.
6. Preserve R10 single-active-session invariant (R-E).
7. Tests: extend mr0g.gate.test.ts (flag off = current gate; flag on = multi
   allowed), plus read/display/selection coverage.

Evaluator output contract (R-A) is explicitly deferred to MR-CAL-5C.

## Acceptance-criteria mapping (from master plan 4.2)

- Multiple reviewer outputs can be grouped -> Design B.3 (and write path already does).
- Existing sequential iteration behavior not broken -> default-off guarantee + R-C.
- Prior feedback comparison still works -> R-C tests.
- Attorney selection remains manual -> R-D; no auto-adopt anywhere.
- CI passes -> tests in Design B.7.

## Risks

- Highest risk is R-B/R-C/R-D (display/comparison/selection with multiple rows),
  since these paths have only ever run with one reviewer per iteration. Mitigated
  by default-off rollout and targeted tests.
- The toggle does not make the evaluator work; do not imply multi-reviewer = working
  evaluator until 5C.

## Recommended next steps

1. Operator resolves the Finding-3 decision (recommend option b: proceed on the
   code-derived risk list).
2. On acceptance of this plan, MR-CAL-5B implementation proceeds as a bounded Phase
   A: flag plumbing + gate relaxation + read/display/comparison/selection repairs +
   tests, default OFF, delivered for review before any merge.

## Out-of-scope log

Evaluator output contract (MR-CAL-5C); matter memory; locked decisions; adopt
ledger; sendability gate; reviewer prompt/scoring/parser changes. None touched.

---
End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
