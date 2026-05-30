Lex Law Next / MR-CAL Completion Automation Plan
Purpose
Create a controlled Claude Code execution plan to complete the remaining Lex Law Next / MR-CAL workstreams after the current live-verified state.

This plan is not authorization to implement everything at once.

Claude Code must treat this document as a master execution roadmap and proceed one bounded engagement at a time, with explicit operator approval before each irreversible or scope-expanding step.

The goal is to complete the MR-CAL program in a disciplined sequence while preserving the governance lessons already learned: no silent scope absorption, no broad staging, no credential exposure, no conflation of code-level merge with live functional verification, and no premature jump into major architecture before prerequisites are satisfied.
Current accepted baseline
Current repo state after the latest completed work:

main includes a559f71 — documentation state update after MR-CAL-3E live verification.
MR-UAT-MATERIALS-2 is code-level merged and live-verified.
MR-IR-ERR-1 is code-level merged and live-verified for visible failure behavior.
MR-IR-GEN-2 is code-level merged and live-verified PASS.
MR-CAL-3C / MR-CAL-3D / MR-CAL-3E are code-level merged and live-verified PASS.
Sequential reviewer comparison is now reachable in production through: review → regenerate → review again → iteration 2 → Prior Feedback / Sequential Comparison renders.
Reviewer runtime is healthy in the current workflow.
GPT stability remains unresolved for P8-T1 / P8-T6 because raw/normalized GPT artifacts were not preserved.
Major future arcs are not started:
MR-CAL-4
CAL-7B
evaluator / multi-reviewer topology
native feedback-card runtime
matter memory
locked decisions
cumulative adopt ledger
sendability gate
Global operating rules
Start every engagement by reporting repo state:

pwd
git remote -v
git branch --show-current
git rev-parse HEAD
git log --oneline -10
git status --porcelain
git ls-remote origin main

Do not use broad staging:

PROHIBITED:
git add -A
git add .

Stage explicit paths only.

Do not run destructive cleanup:

PROHIBITED:
git reset --hard
git clean -fd

Do not print, echo, log, store, or commit credential values. If a credential appears in output, redact it and surface immediately.

Do not push, merge, deploy, change Railway config, mutate production DB, or run production cleanup without explicit operator approval.

Treat local Node/pnpm toolchain as unavailable unless proven otherwise. CI may be the authoritative quality gate.

Every implementation follows:

investigation or Phase A local implementation
→ operator acceptance
→ Phase B push / PR / CI / merge
→ Pattern 16 live verification if user-visible

Every live/user-visible feature requires production live verification before being called substantively closed.

Major architecture work must not begin until prerequisites are satisfied and the operator explicitly approves the scope.

Every engagement close-out must end with:

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
Master sequence
Phase 0 — Stabilize adjacent workflow reliability before new MR-CAL architecture
0.1 — LLN-OUTLINE-GEN-1: Harden outline generation JSON contract
Type: Phase A implementation, then Phase B, then live verification.

Why now: Outline generation appears to share the same JSON-contract fragility that MR-IR-GEN-2 fixed for information-request generation.

Objective: Make outline generation robust to normal LLM JSON output shapes.

Required behavior:

Add structured-output enforcement if supported by the existing LLM call path.
Add tolerant parsing for:
raw JSON array;
fenced JSON;
known object wrappers;
malformed JSON;
empty array;
arrays with no usable items.
Replace silent-empty failure behavior with visible/recoverable failure behavior.
Preserve successful outline generation.

Do not touch:

reviewer calibration;
MR-CAL files;
provider adapters unless unavoidable;
DB schema;
Railway;
auth bypass;
evaluator topology;
native feedback-card runtime;
matter memory;
locked decisions;
adopt ledger;
sendability gate;
MR-CAL-4;
CAL-7B.

Acceptance criteria:

Phase A commit created locally.
CI passes in Phase B.
Merged to main.
Live verification confirms outline generation produces usable outlines or fails visibly without silent empty success.
0.2 — LLN-UX-ITER-LABEL-1: Fix pre-creation iteration label
Type: Small Phase A implementation.

Why now: Cosmetic mismatch remains after MR-CAL-3E. The review creation panel may say "iteration 1" even when the server will create iteration 2.

Objective: Make the pre-creation review label accurate or neutral.

Preferred fixes:

Remove the stale iteration number from the pre-creation label; or
Fetch/display the server-computed next iteration if already available safely; or
Use neutral language such as "Select a reviewer for the next review."

Do not touch:

server-side iteration logic;
HistorySection comparison logic;
reviewer prompts;
parser/scoring/calibration files;
DB schema;
Railway.

Acceptance criteria:

No change to server iteration behavior.
No change to HistorySection.
No reviewer/calibration changes.
CI passes.
Live/UI check confirms the label no longer misleads.
0.3 — LLN-REVIEW-DEFAULT-1: Default reviewer UX trap
Type: Investigation first; small Phase A only if approved.

Why now: The UI can default to Claude as reviewer when Claude also drafted the document, causing a legitimate "no suggestions" result that appears broken.

Investigation questions:

Where is default reviewer selected?
Does the app know which model drafted the document?
Can default reviewer avoid the drafter model?
Should the UI explain that same-model review may return no suggestions?

Possible implementation options:

Default to a non-drafter reviewer.
Add a warning if selected reviewer equals drafter.
Preserve current default but show explanatory text.
Add a preference setting.

Do not touch:

reviewer model adapters;
calibration scoring;
reviewer prompts;
parser logic;
DB schema unless separately authorized.

Acceptance criteria:

User is less likely to mistake "no suggestions" for reviewer failure.
No prompt/scoring/parser changes.
Reviewer runtime unchanged.
0.4 — LLN-PROD-CLEANUP-1: Synthetic production test-data cleanup
Type: Operator-approved cleanup only.

Why later: Cleanup is useful but should not interrupt functional work.

Scope:

Identify synthetic test matters/documents/matrices created during UAT.
Produce a deletion/archive plan.
Do not delete until operator approves exact targets.
Prefer soft delete/archive if available.
Do not touch real client data.

Acceptance criteria:

Synthetic test data cleaned or archived.
No real client data affected.
Cleanup log produced.

Automation note: This engagement is not included in the default automated queue. It must be invoked separately by operator decision.
Phase 1 — Resolve GPT calibration instability
1.1 — MR-CAL-2F: GPT raw-output capture / evidence recovery
Type: Investigation only.

Why: GPT instability remains the biggest core MR-CAL blocker. P8-T1 and P8-T6 could not be auditably reconstructed.

Objective: Capture raw and normalized GPT outputs for failing or unstable scenarios.

Scenarios:

P8-T1 — execution-blank suppression.
P8-T6 — counterparty-facing over-disclosure.
P8-T7 — governing-law/sendability blocker sanity check.
P8-T10 — business-decision separation sanity check.

Questions to answer:

Did GPT return malformed JSON?
Did provider adapter normalize incorrectly?
Did parser fail?
Did GPT produce substantively wrong feedback?
Did the harness lose the artifact?
Is the failure repeatable?

Do not do yet:

prompt patch;
parser patch;
scoring patch;
model switch;
CAL-7B.

Acceptance criteria:

Raw and normalized outputs captured or a clear explanation why impossible.
Failure classified as parser / adapter / prompt / substance / artifact / unknown.
Narrow next correction scoped.
1.2 — MR-CAL-2G: GPT targeted correction
Type: Phase A implementation, only after MR-CAL-2F.

Possible correction paths:

Adapter/output-normalization fix if raw shape is valid but parsing fails.
Prompt correction if GPT substantively misclassifies.
Artifact-preservation fix if the problem is observability.
Harness/test fix if scoring cannot reconstruct the result.
No-op/accepted risk if evidence shows non-repeatable noise.

Do not touch unless supported by MR-CAL-2F evidence:

reviewer prompt;
parser;
adapter;
scoring;
model selection;
test fixtures.

Acceptance criteria:

Targeted tests added.
CI passes.
No broad calibration rewrite.
No unrelated provider changes.
Follow-on live validation scoped.
1.3 — MR-CAL-2H: Optional second GPT correction
Type: On-demand only.

Trigger: MR-CAL-2F or MR-CAL-2G surfaces more than one distinct failure class requiring separate correction.

Examples:

parser correction required separately from prompt correction;
artifact capture required separately from substantive reviewer correction;
harness fix required before meaningful validation.

Acceptance criteria:

Separate failure class addressed.
No conflation of unrelated GPT issues.
CI passes.
Follow-on validation remains focused.
1.4 — MR-CAL-2I-LIVE: GPT focused live validation
Type: Live verification.

Goal: Confirm GPT stability on the previously unstable cells.

Minimum matrix:

GPT P8-T1
GPT P8-T6
GPT P8-T7
GPT P8-T10

Acceptance criteria:

GPT passes all four; or
remaining issue is expressly classified and accepted as risk.

Do not proceed to full CAL-7B until this is resolved or consciously waived.
Phase 2 — Core MR-CAL close-out
2.1 — MR-CAL-3F-LIVE: End-to-end reviewer workflow regression
Type: Live verification.

Goal: Validate the current reviewer workflow across intended tracks.

Workflow:

draft → review → select → regenerate → review again → compare prior feedback

Tracks:

Gemini
GPT
Claude
Grok if enabled and available

Acceptance criteria:

Review sessions create correctly.
Feedback renders.
Attorney selection works.
Regeneration works.
Iteration advances.
Prior feedback comparison renders.
Known exceptions documented.
2.2 — MR-CAL-CORE-CLOSEOUT
Type: Documentation / governance close-out.

Goal: Declare the current legacy-wrapper reviewer workflow core complete.

Close-out must state:

What is live verified.
What remains advanced/future.
GPT final posture.
Whether native feedback-card runtime is deferred or next.
Whether evaluator/multi-reviewer is deferred or next.
Known risk list.
Which items are formally deferred out of core MR-CAL.

Acceptance criteria:

Repo docs updated.
Core reviewer workflow status is unambiguous.
Next major architecture decision is clearly framed.
Phase 3 — Native feedback-card runtime
3.1 — MR-CAL-4A: Native feedback-card runtime investigation
Type: Investigation only.

Questions:

What native feedback-card schema already exists?
What legacy wrapper fields still drive runtime?
What DB changes are needed, if any?
Can native cards coexist with legacy { title, body, severity }?
What UI expects feedback-card data?
What tests exist?
What migration or compatibility strategy is safest?

Do not implement yet.

Acceptance criteria:

Migration strategy documented.
Compatibility strategy documented.
Whether schema migration is required is known.
Phase A implementation scope can be drafted safely.
3.2 — MR-CAL-4B: Native feedback-card runtime Phase A
Type: Phase A implementation after operator scope approval.

Objective: Activate native feedback-card parsing/persistence/display while preserving legacy compatibility.

Do not include:

evaluator topology;
matter memory;
sendability gate;
adopt ledger;
multi-reviewer session model changes unless mechanically required and approved.

Acceptance criteria:

Native card fields parse and persist.
UI renders structured card fields.
Legacy outputs still work or fail clearly.
CI passes.
Phase B and live verification follow.
3.3 — MR-CAL-4C-LIVE: Native card live verification
Type: Live verification.

Acceptance criteria:

At least two reviewer tracks produce native cards.
Cards render correctly.
Attorney selection/regeneration still works.
No regression to sequential comparison.
No legacy-wrapper regression unless expressly accepted.
Phase 4 — Evaluator / multi-reviewer topology
4.1 — MR-CAL-5A: Evaluator topology investigation
Type: Investigation only.

Core decision: What does evaluator do?

Possible evaluator roles:

identify reviewer consensus;
identify conflicts;
rank severity;
distinguish drafting vs. business decisions;
summarize differences;
recommend adoption priority;
never make final attorney decision.

Questions:

Does evaluator compare reviewers in the same cycle or across iterations?
Does evaluator need its own DB entity?
Does evaluator output feed regeneration or only attorney display?
How does evaluator avoid making business/legal decisions?
How does evaluator interact with native feedback cards?

Acceptance criteria:

Evaluator role definition approved.
Non-decisionmaking boundary explicit.
Data/UI requirements identified.
Implementation engagement can be scoped narrowly.
4.2 — MR-CAL-5B: Multi-reviewer session data model
Type: Phase A implementation only after 5A.

Objective: Support multiple reviewer outputs in a single comparison cycle if required.

Acceptance criteria:

Multiple reviewer outputs can be grouped.
Existing sequential review iteration behavior not broken.
Prior feedback comparison still works.
Attorney selection remains manual.
CI passes.
4.3 — MR-CAL-5C: Evaluator output contract
Type: Phase A implementation.

Objective: Add evaluator prompt/schema/output display.

Acceptance criteria:

Evaluator output is structured.
Attorney remains decision-maker.
Evaluator does not auto-adopt changes.
Conflicts and consensus are visible.
CI passes.
4.4 — MR-CAL-5D-LIVE: Evaluator live verification
Type: Live verification.

Acceptance criteria:

At least two reviewer outputs feed evaluator.
Evaluator summarizes differences usefully.
No automatic legal/business decision is made.
Attorney can still select/disposition suggestions.
No regression to existing single-reviewer workflow.
Phase 5 — Matter memory and locked decisions
5.1 — MR-CAL-6A: Matter memory investigation
Type: Investigation only.

Define what memory stores:

accepted attorney decisions;
rejected reviewer suggestions;
client/business choices;
jurisdiction choices;
negotiation posture;
"do not re-raise" items.

Questions:

Does memory live at matter level, document level, or both?
How is attorney approval captured?
How does memory get included in prompts?
How is stale memory retired?
How are conflicts surfaced?

Acceptance criteria:

Data model options surfaced.
UI/provenance requirements surfaced.
Privacy/security implications flagged.
Implementation path scoped.
5.2 — MR-CAL-6B: Locked decisions Phase A
Type: Implementation.

Objective: Allow attorney to lock decisions that reviewers should respect.

Acceptance criteria:

Locked decisions have provenance.
Reviewer prompt/context receives locked decisions.
Reviewers do not re-raise locked issues unless new facts justify it.
Attorney can unlock/modify.
CI passes.
5.3 — MR-CAL-6C-LIVE: Locked decisions verification
Type: Live verification.

Acceptance criteria:

Reviewer respects locked decision.
Reviewer still flags true blockers.
Prior rejected issue is not repeatedly re-raised.
Locked-decision UI is understandable.
Phase 6 — Cumulative adopt ledger
6.1 — MR-CAL-7A: Adopt ledger investigation
Type: Investigation only.

Define ledger item fields:

source reviewer;
source suggestion;
attorney disposition;
adopted/modified text;
target document version;
regeneration result;
current status;
superseded status.

Questions:

Is ledger separate from feedback rows or derived from them?
Does ledger track modified adopts?
Does ledger feed reviewer context?
Does ledger feed regeneration?
How does ledger interact with locked decisions?

Acceptance criteria:

Data model and UI plan documented.
Relationship to locked decisions clarified.
Implementation path scoped.
6.2 — MR-CAL-7B: Adopt ledger implementation
Type: Phase A implementation.

Objective: Persist adopted suggestions and track them across regeneration.

Acceptance criteria:

Adopted suggestions remain visible.
Regeneration does not lose adopted changes silently.
Later reviewer passes can see adopted context.
Superseded/resolved/unresolved states are distinguishable.
CI passes.
6.3 — MR-CAL-7C-LIVE: Adopt ledger live verification
Type: Live verification.

Acceptance criteria:

Select → regenerate → review again preserves adopted item.
System can distinguish adopted, superseded, and unresolved items.
Attorney can understand what was adopted and what remains open.
Phase 7 — Sendability gate
7.1 — MR-CAL-8A: Sendability gate investigation
Type: Investigation only.

Define gate categories:

jurisdiction mismatch;
missing material terms;
unresolved blanks;
missing party/capacity;
conflicting provisions;
business decision needed;
execution/signature defects;
counterparty-facing over-disclosure;
P8-T7-style blocker.

Questions:

Is sendability a reviewer output, evaluator output, or separate classifier?
Is it advisory or blocking?
Where does it appear in UI?
Can attorney override?
How is override recorded?
Does it require native feedback cards first?

Acceptance criteria:

Gate role approved.
Advisory vs. blocking behavior defined.
UI placement defined.
Dependencies identified.
7.2 — MR-CAL-8B: Sendability gate implementation
Type: Phase A implementation.

Objective: Add advisory sendability checkpoint.

Acceptance criteria:

Sendability result visible before finalize/export/send.
Attorney can override if appropriate.
Gate does not silently block.
Gate preserves attorney decision authority.
CI passes.
7.3 — MR-CAL-8C-LIVE: Sendability live verification
Type: Live verification.

Acceptance criteria:

Known blocker is detected.
Non-blocker is not over-escalated.
Attorney override/decision flow works.
Sendability result is understandable and useful.
Phase 8 — Full calibration regression
8.1 — CAL-7B-PLAN
Type: Planning only.

Prerequisites:

GPT instability resolved or risk-accepted.
Core reviewer workflow live verified.
Decision made on native cards/evaluator/memory/ledger/sendability inclusion.

Define grid:

scenario families;
reviewer tracks;
lite/full variants if included;
evaluator if active;
native-card schema if active;
memory/locked decision cases if active;
sendability gate cases if active;
accepted-risk classification rules.

Acceptance criteria:

Full grid approved before running.
Pass/partial/fail criteria defined.
Runtime and provider cost expectations documented.
8.2 — CAL-7B-LIVE
Type: Live/harness validation.

Acceptance criteria: Each cell classified as one of:

PASS
PARTIAL
FAIL
PARSE_FAILURE
NOT_RUN
ACCEPTED_RISK

The close-out must include:

scenario;
model/reviewer;
expected behavior;
observed behavior;
result classification;
raw/normalized output preservation status;
remediation if needed.
8.3 — CAL-7B-CLOSEOUT
Type: Formal close-out.

Acceptance criteria:

Calibration posture documented.
Remaining failures classified.
Accepted risks explicit.
Deferred items explicit.
Next non-MR-CAL product phase identified.
Repo docs updated to final MR-CAL state.
Automation structure in Claude Code
Claude Code should use this master plan as the controlling reference for the MR-CAL completion loop.

If an orchestration scaffold is installed, it should maintain:

docs/MR_CAL_completion_master_plan.md
docs/MR_CAL_engagement_state.json
docs/engagements/
.claude/commands/next-engagement.md
.claude/commands/engagement-status.md
.claude/commands/operator-approve.md

The tracker should contain:

Engagement queue.
Current status.
Dependencies.
Acceptance criteria.
Next prompt pointer.
Closed workstreams.
Deferred workstreams.
Operator decisions needed.

Do not create, modify, commit, or push tracker files unless the operator expressly authorizes the scaffolding task.
Recommended immediate execution order
LLN-OUTLINE-GEN-1
LLN-UX-ITER-LABEL-1
LLN-REVIEW-DEFAULT-1
MR-CAL-2F
MR-CAL-2G / MR-CAL-2H if needed
MR-CAL-2I-LIVE
MR-CAL-3F-LIVE
MR-CAL-CORE-CLOSEOUT
MR-CAL-4A
MR-CAL-4B
MR-CAL-4C-LIVE
MR-CAL-5A
MR-CAL-5B
MR-CAL-5C
MR-CAL-5D-LIVE
MR-CAL-6A
MR-CAL-6B
MR-CAL-6C-LIVE
MR-CAL-7A
MR-CAL-7B
MR-CAL-7C-LIVE
MR-CAL-8A
MR-CAL-8B
MR-CAL-8C-LIVE
CAL-7B-PLAN
CAL-7B-LIVE
CAL-7B-CLOSEOUT

Do not proceed from one line to the next without an engagement close-out and operator acceptance.
Definition of MR-CAL complete
MR-CAL is complete only when:

Current reviewer workflow is live verified across intended tracks.
GPT instability is resolved or explicitly accepted as documented risk.
Reviewer output contract is stable and documented.
Sequential and/or multi-reviewer comparison works in production.
Attorney selection/regeneration/prior-feedback preservation work.
Matter memory, locked decisions, adopt ledger, and sendability gate are either implemented/live verified or formally deferred out of MR-CAL scope.
Full calibration grid is run or formally deferred with written rationale.
Repo docs reflect the actual final state.
A final MR-CAL close-out is committed and pushed.

End of master plan.
