# MR-CAL-5D-LIVE - Live verification: BLOCKED

Status: BLOCKED (infra/DB reviewer-completion hang; MR-CAL-5C evaluator code not implicated)
Date: 2026-05-31 (America/New_York)
Production commit under test: b7ae166 (/api/version), /api/health 200
Flags live in prod: AUTH_BYPASS_ENABLED=true, MULTI_REVIEWER_ENABLED=true, EVALUATOR_ENABLED=true

## Objective

Live-verify the advisory evaluator (MR-CAL-5C): with two reviewers and EVALUATOR_ENABLED=true,
confirm that (1) two reviewer outputs feed the evaluator, (2) it usefully summarizes
consensus/conflict, (3) it makes NO automatic legal/business decision, (4) the attorney can
still select/disposition, and (5) there is no regression to the single-reviewer path.

## Environment confirmation

- /api/version = b7ae166df057af40970f919c16716f6c5d5db5dc, builtAt 2026-06-01T00:29:16Z (the
  EVALUATOR_ENABLED env-change redeploy).
- /api/health = 200.
- settings.get -> multiReviewerEnabled = true; reviewer picker rendered 8 multi-select checkboxes.
- Driven in Chrome (UNIVERSALTITLE) via auth bypass; verified by live tRPC inspection
  (reviewSession.list / reviewSession.get) plus DOM reads.

## What was run

Four controlled reviews on the synthetic "POA iteration test" document (d_poa_iter_001),
varying one factor at a time to isolate cause:

| Run     | Reviewers                | Evaluator path triggered? | Result                                   |
| ------- | ------------------------ | ------------------------- | ---------------------------------------- |
| iter 9  | GPT Lite + Claude Lite   | Yes (2 reviewers)         | hung ~12 min; in_progress; feedback 0    |
| iter 10 | GPT Lite + Grok Lite     | Yes (2 reviewers)         | hung ~6 min; in_progress; feedback 0     |
| iter 11 | GPT Lite (alone)         | No (single reviewer)      | hung ~6 min; in_progress; feedback 0     |
| iter 12 | Grok Lite (alone)        | No (single reviewer)      | hung ~5 min; in_progress; feedback 0     |

Reviewer model IDs observed on dispatch: GPT Lite = openai:gpt-4.1-mini;
Claude Lite = anthropic:claude-sonnet-4-5; Grok Lite = xai:grok-3-mini.

## Confirmed facts (by live tRPC inspection)

- All four sessions remained status=in_progress with feedbackCount=0 and evaluation=null.
- No browser console errors during any run.
- The in-app "Abandon review" control did not persist a status change server-side: all four
  sessions (iter9-12) remained in_progress when re-queried.

## Diagnosis (evidence-classed)

- CONFIRMED: the reviewer-completion path is currently broken for ALL reviewers - single or
  multi, evaluator on or off. A single-reviewer, evaluator-OFF run (iter 11 and iter 12) hangs
  identically to the 2-reviewer evaluator-ON runs (iter 9 and iter 10).
- THEREFORE the MR-CAL-5C evaluator code is NOT implicated. Runs that never reach the evaluator
  fail the same way, so the evaluator cannot be the cause. 5D-LIVE verification is simply not
  performable while the reviewer path is down.
- CONSISTENT WITH (not confirmed - no server-log or DB access): a hanging database write/commit.
  Sessions are inserted (status in_progress) but never flip to complete; feedback never commits;
  even the abandon status-update does not land. This matches a stuck write path. The TiDB
  serverless layer hit quota earlier in this program arc. The failure is coincident with the
  EVALUATOR_ENABLED env-change redeploy but is not caused by the evaluator code path.

## Operator follow-ups (operator domain; not Claude actions)

1. Inspect Railway service logs since the b7ae166 EVALUATOR_ENABLED env-change redeploy.
2. Check TiDB/DB health (connections, quota, locks); the signature is a write/commit that never
   returns.
3. A service restart/redeploy may clear it; after that, a single-reviewer smoke test that
   completes normally should gate resuming MR-CAL-5D-LIVE.

## Carryforwards

- 4 stuck synthetic sessions (iter9-12) on d_poa_iter_001 added to LLN-PROD-CLEANUP-1.
- Security: AUTH_BYPASS_ENABLED, MULTI_REVIEWER_ENABLED, and EVALUATOR_ENABLED are all ON in
  production; operator to disable AUTH bypass when verifications conclude.
- MR-CAL-5C remains code-complete and merged (74870ba); its live verification is deferred, not
  failed.

## Scope confirmation

Live-verification engagement only. No source authored. No Railway/DB/credential action taken.
Tracker updated (MR-CAL-5D-LIVE -> blocked) under an explicit Rule-11 operator confirmation.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
