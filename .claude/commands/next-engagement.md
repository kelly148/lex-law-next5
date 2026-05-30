---
description: Advance the MR-CAL completion loop one engagement
---

# next-engagement (procedure)

If this file lives at `.claude/commands/next-engagement.md` and the environment recognizes it as a slash command, it runs on `/next-engagement`. Otherwise, follow the procedure manually when Kelly types `next engagement` in chat.

Run the repo-state baseline (the 7-command sequence in CLAUDE.md). Print verbatim.

Read `docs/MR_CAL_engagement_state.json`. Identify the next eligible engagement using this precedence:

1. If `in_progress_engagement` is set AND not awaiting acceptance/verification → resume it.
2. If anything is in `awaiting_operator_acceptance` or `awaiting_live_verification` → STOP and instruct Kelly to use `operator approve` first.
3. Otherwise pop the first item from `queue`. (Use the state-transition approval gate from Rule 11 before writing.)
4. If `queue` is empty → MR-CAL is complete; print Definition-of-MR-CAL-complete checklist from master plan and STOP.

Read `docs/MR_CAL_completion_master_plan.md`. Find the section for the chosen engagement. Extract its Type, Objective, Required behavior / What to build, Do-not-touch list, Acceptance criteria.

## Execute based on Type

### Type = Investigation only

Do investigation. Do not modify code. Produce a written investigation report. Per Rule 12, investigation reports DO commit to `docs/engagements/<ENGAGEMENT-ID>-investigation.md` (they're durable project records). Update state to `awaiting_operator_acceptance` (with Rule 11 gate). Print summary to chat. STOP.

### Type = Phase A implementation

1. Confirm scope: print the engagement's Objective, Required behavior, and Acceptance criteria. Confirm with Kelly that you have the right understanding. Wait for `operator approve scope:<engagement-id>` for any architecture engagement (MR-CAL-4 onward). For others, you may proceed.
2. Implement per the engagement. Honor Do-not-touch list strictly. No prompt/scoring/parser changes unless the engagement explicitly authorizes.
3. Write tests where applicable.
4. Run tests locally only if local toolchain is proven available. Otherwise rely on CI in Phase B.
5. Stage ONLY the files you created/modified. No `git add -A`.
6. Per Rule 12: produce the Phase A close-out in CHAT FIRST. Do not commit to `docs/engagements/` unless Kelly says "commit this report."
7. Update state: move engagement to `awaiting_operator_acceptance` (Rule 11 gate). Phase = `awaiting-acceptance`.
8. Print to chat:
   - Files changed (summary)
   - Tests added
   - What's staged but not committed
   - Phase A close-out (full text, in chat)
   - "Type `operator approve accept:<engagement-id>` to proceed to Phase B (commit/push/PR/CI/merge). Type `commit this report` to also save the close-out to `docs/engagements/`."
9. STOP.

### Type = Phase B (triggered by `operator approve accept:<id>`)

1. Confirm staged diff matches what was accepted (re-print `git diff --cached --stat`).
2. Ask: "Branch name for this engagement? Default `feat/<engagement-id>`. Push to remote and open PR, or hold local?"
3. WAIT for explicit `operator approve push:<engagement-id>`.
4. After approval: create branch, commit (subject = engagement ID + one-line summary, body = bullet list of changes; no credentials), push.
5. If a PR is requested, open it via `gh pr create` if `gh` is available, otherwise print the URL operator should visit to open manually.
6. WAIT for CI to complete. Print status. If CI fails, surface; do not auto-fix without operator approval.
7. On CI green: ask `operator approve merge:<engagement-id>` before merging to `main`.
8. On merge approval: merge per the project's standard convention.
9. Update state: move engagement to `awaiting_live_verification` if user-visible; otherwise `completed`. (Rule 11 gate.)
10. Phase B close-out: chat-first per Rule 12.
11. STOP.

### Type = Live verification

1. Print the live-verification checklist from the engagement's acceptance criteria.
2. Ask Kelly to perform the live check (or to authorize you to perform it if it's automatable).
3. WAIT for `operator approve live-verified:<engagement-id> pass|partial|fail`.
4. Update state per Kelly's verdict. If `partial` or `fail`, the engagement is `blocked` until remediation. (Rule 11 gate.)
5. Live-verification close-out: chat-first per Rule 12.
6. STOP.

### Type = Planning / close-out / documentation

Produce the planning or close-out document. Architecture-planning engagements commit to `docs/engagements/<ENGAGEMENT-ID>-<type>.md` (durable). Move state to `awaiting_operator_acceptance` for sign-off. (Rule 11 gate.) STOP.

## Close-out footer (every committed document)

Every produced document ends with EXACTLY this footer:




End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.


## State update sanity

After every state.json write, immediately re-read it and confirm the structure is valid JSON with all required keys. If invalid, surface to Kelly before any further action.
