# MR-CAL-5A - Investigation Report

Engagement: MR-CAL-5A (Phase 4, item 4.1) - Evaluator / multi-reviewer topology investigation
Type: Investigation only (no code changes; no implementation)
Date: 2026-05-31 (America/New_York)
Repo state: main @ a882125.

## Objective

Define what the evaluator does, decide whether it compares reviewers within a
cycle or across iterations, identify data/UI requirements, establish the
non-decisionmaking boundary, and determine how the evaluator interacts with
native feedback cards - so a narrow implementation engagement can be scoped. No
implementation here. MR-CAL-5B/5C implementation requires operator approve
scope:<id> before any code.

## Headline

The evaluator is already scaffolded (schema, queries, model config, UI display
and an invocation site) but is dormant and incomplete, and was disabled on
purpose. Standing it up is a larger lift than it appears because it depends on
first repairing the multi-reviewer path that MR-0G deliberately gated off. It is
also a genuine product-direction decision, not only an implementation task.

## What already exists (confirmed by code inspection at a882125)

- DB: feedback_evaluations table (src/server/db/schema.ts:857) with a dispositions
  JSON column; types NewFeedbackEvaluation / FeedbackEvaluation.
- Queries: insertFeedbackEvaluation (phase4b.ts:615) and getEvaluationForIteration
  (phase4b.ts:594).
- Config: EVALUATOR_MODEL (llm/config.ts:161), default anthropic:claude-opus-4-5;
  decision #41 - evaluator always uses EVALUATOR_MODEL, never attorney-selectable.
- Invocation: reviewSession.create contains an evaluator executeCanonicalMutation
  block (reviewSession.ts:301-338).
- Read + UI: reviewSession.get returns evaluation (reviewSession.ts:471);
  ReviewPane renders per-suggestion evaluator dispositions (adopt/reject/neutral
  icons) and an evaluator synthesis line.

## Why it is dormant (two independent reasons)

1. Never fires. The evaluator block is guarded by
   `if (input.selectedReviewers.length > 1)` (reviewSession.ts:301). The MR-0G
   single-reviewer gate forces selectedReviewers to length 0 or 1 everywhere
   (API Zod .max(1) plus the UI radio group), so the condition is never true.

2. Incomplete even if it fired. The evaluator block's txn2Commit only emits
   telemetry; it does not parse the evaluator LLM output and never calls
   insertFeedbackEvaluation. So no dispositions are persisted by this path. The
   evaluator system/user prompts are placeholder-level.

## Why it was disabled (intentional)

reviewSession.ts:290-300 documents the decision: the multi-reviewer path was
structurally broken (MR-0 defects D1-D5; gated by MR-0G), and the current product
model (Operating Plan v1.2 section 1.3) makes the ATTORNEY the synthesizer across
iterations - automated cross-synthesis is explicitly "not required." The comment
directs that evaluator repair or full decommissioning be scoped as a separate
engagement. MR-CAL-5 is that arc.

## Answers to the engagement questions

- What does the evaluator do? Intended role (sound and non-controversial):
  identify reviewer consensus and conflicts, rank severity, distinguish
  drafting vs business issues, summarize differences, recommend adoption priority,
  and NEVER make the final attorney decision. None of this is live today.
- Same cycle or across iterations? The existing entity is per-iteration
  (getEvaluationForIteration keyed by documentId + iterationNumber). The valuable
  evaluator role is comparing MULTIPLE reviewers WITHIN one iteration/cycle - which
  is exactly what is impossible today because only one reviewer runs per session.
- Does it need its own DB entity? It already has one (feedback_evaluations,
  dispositions JSON). Basic dispositions need no migration; richer evaluator output
  (consensus/conflict summary, severity ranking) could extend that JSON shape
  additively without a destructive migration.
- Does output feed regeneration or only attorney display? Today: display only
  (dispositions shown in ReviewPane). Recommended target: attorney display and
  advisory input - it must not auto-adopt or auto-regenerate.
- How does it avoid business/legal decisions? By treating all evaluator output as
  ADVISORY surfacing (consensus, conflicts, priority) that the attorney acts on;
  never auto-adopting, never rewriting, and explicitly flagging business decisions
  for the attorney - consistent with the P8-T10 business-decision-separation
  principle already calibrated for reviewers.
- How does it interact with native feedback cards? It should consume the native
  cards (MR-CAL-4B): evaluate by severity, severity_subtype (DRAFTING/BUSINESS),
  critique_type, requires_attorney_decision, and audience_affected, rather than the
  thin legacy { title, body, severity } shape. The native-card disposition_options
  and evaluator_disposition fields in FeedbackCardSchema already anticipate this.

## Hard dependency: the MR-0G single-reviewer gate

A real evaluator needs more than one reviewer per cycle to compare. That requires
reversing/repairing the MR-0G gate, which exists because the multi-reviewer
session model was structurally broken (MR-0 D1-D5). Therefore MR-CAL-5B
(multi-reviewer session data model) is the true prerequisite and must address WHY
MR-0G disabled multi-reviewer - not merely lift the .max(1) constraint. This is
the largest and riskiest part of the arc.

## Product-direction note (for the operator)

The current design deliberately positions the attorney as the cross-iteration
synthesizer and treats automated synthesis as optional. Activating an evaluator /
multi-reviewer topology is a product decision about whether to introduce automated
cross-reviewer synthesis at all - not just an engineering task. The reviewers and
evaluator must remain non-decisionmaking; the attorney stays the final decision
maker (a core platform principle).

## Recommended scoping for the implementation engagements (not authorized here)

- MR-CAL-5B (Phase A, needs scope approval): repair/enable a multi-reviewer
  session data model that addresses the MR-0 D1-D5 defects; group multiple
  reviewer outputs in one cycle; preserve sequential-comparison behavior and manual
  attorney selection. Largest risk.
- MR-CAL-5C (Phase A, needs scope approval): complete the evaluator output
  contract - real prompt/schema, parse output, persist via insertFeedbackEvaluation
  (extending dispositions additively), consume native cards, advisory-only.
- MR-CAL-5D-LIVE: live verification once the deploy pipeline is restored
  (currently blocked - see MR-CAL-4C-LIVE-blocked / OPS-DEPLOY-PIPELINE-1).

## Scope and evidence class

- Investigation only. No source files modified.
- All claims confirmed by code inspection at main @ a882125 (files/lines cited).
- "Was disabled on purpose / multi-reviewer structurally broken" is from the
  in-code comment and MR-0 references; the underlying D1-D5 defects were not
  re-derived in this engagement.

## Out-of-scope log

None.

---
End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
