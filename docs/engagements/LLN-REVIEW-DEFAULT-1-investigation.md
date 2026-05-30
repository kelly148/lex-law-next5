# LLN-REVIEW-DEFAULT-1 - Investigation Report

Engagement: LLN-REVIEW-DEFAULT-1 (Phase 0, item 0.3)
Type: Investigation only (no code changes)
Date: 2026-05-30 (America/New_York)
Repo state at investigation: main @ de2d7c2, working tree clean except the local engagement tracker.

## Objective

Determine why the review panel can default to a reviewer that legitimately
returns "no suggestions," making a working reviewer look broken, and scope
options for a future fix. No implementation in this engagement.

## The trap, confirmed in code

A first-pass review defaults to Claude reviewing a document that Claude just
drafted with the same underlying model. That can correctly yield zero
suggestions, which reads to the attorney as reviewer failure.

The chain:

1. Drafter model. PRIMARY_DRAFTER_MODEL defaults to anthropic:claude-opus-4-5
   (src/server/llm/config.ts:156). Documents are drafted with this model in
   "full" generation mode.
2. The "Claude" reviewer is the same model. REVIEWER_MODELS.claude =
   anthropic:claude-opus-4-5 (src/server/llm/config.ts:64) - identical to the
   drafter model string.
3. The default first-pass reviewer is Claude. Reviewer enablement defaults to
   claude:true, gpt:true, gemini:true, grok:false (src/server/db/schema.ts:560,
   decision #43). On a document with no prior review history, the panel default
   is enabledReviewers[0] (src/client/components/ReviewPane.tsx:114-118,
   "Case 4: no prior history"), which resolves to Claude because Claude is the
   first enabled reviewer in enablement key order.

## Investigation questions answered

1. Where is the default reviewer selected?
   Client-side, in CreateSessionView in src/client/components/ReviewPane.tsx.
   The derivedDefault memo (lines 114-132) implements a four-case heuristic.
   The relevant case for a first review is Case 4 (no prior feedback rows),
   which returns enabledReviewers[0]. enabledReviewers is derived from
   settings.reviewerEnablement filtered to enabled keys, preserving key order
   (claude, gpt, gemini, grok), so the first enabled reviewer is Claude.

2. Does the app know which model drafted the document?
   Server-side, yes. Each document version links to its generating job
   (document_versions.generatedByJobId -> jobs.modelId, src/server/db/schema.ts),
   and PRIMARY_DRAFTER_MODEL is a server constant. The client does NOT currently
   receive the drafter model string, so the panel cannot avoid the drafter
   automatically today.

3. Can the default reviewer avoid the drafter model?
   Yes, with a small change: expose the drafter's reviewer key (or model string)
   to the client and adjust the Case-4 default to pick the first enabled reviewer
   whose model differs from the drafter. No DB schema change is required because
   the drafter model is already a server constant and is already recorded per
   version via jobs.modelId.

4. Should the UI explain that same-model review may return no suggestions?
   Yes - an advisory is low-risk and directly addresses the confusion, whether or
   not the default is also changed.

## Important nuances

- Later iterations are already protected. The rotation heuristic (Case 1)
  already defaults the NEXT review away from the prior reviewer. The trap is
  specific to the FIRST review on a document with no review history.
- "Lite" generation mode is not affected. In lite mode the document is drafted
  with openai:gpt-4.1-mini (LITE_GENERATION_MODEL), so a Claude review is a
  genuinely different model. The trap bites only in the default "full" mode.

## Options for a future fix (not implemented here)

Option A - Default to a non-drafter reviewer.
  Change the Case-4 default to skip the drafter role and pick the first enabled
  reviewer whose model differs from the drafter. Requires exposing the drafter
  reviewer-key to the client. Cleanest user experience. No DB/schema change.
  Recommended primary fix.

Option B - Warn when the selected reviewer equals the drafter.
  Show advisory text when the chosen reviewer's model matches the drafter model
  ("Claude drafted this document; a Claude review may return few suggestions").
  Low risk; complements Option A.

Option C - Explanatory text only.
  Keep the current default but add the advisory. Smallest change; explains the
  confusion rather than preventing it.

Option D - Preference setting.
  Let the attorney configure the default reviewer. Heaviest; likely
  disproportionate to the problem at this stage.

## Recommendation

A future Phase A implementing Option A plus Option B. Both can be built without
touching reviewer model adapters, calibration scoring, reviewer prompts, parser
logic, or DB schema - all of which are on this engagement's do-not-touch list.
The change would be confined to the client default heuristic plus a small,
read-only server exposure of the drafter reviewer-key.

## Scope and evidence class

- Investigation only. No source files modified.
- All mechanism claims above are confirmed by code inspection at main @ de2d7c2
  (file and line references given).
- The production user-visible symptom ("no suggestions" on a default first
  review) is consistent with this mechanism but was not separately reproduced
  live in this engagement.

## Out-of-scope log

None. No adjacent changes were made or proposed beyond the four options above.

---
End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
