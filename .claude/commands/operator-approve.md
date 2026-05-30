---
description: Record an operator approval decision and advance the loop
---

# operator-approve <decision>

Parse the decision string. Expected forms:

- `scope:<engagement-id>` — approves starting the implementation phase of an architecture engagement
- `accept:<engagement-id>` — approves Phase A → Phase B transition
- `push:<engagement-id>` — approves branch push + PR creation
- `merge:<engagement-id>` — approves merge to main
- `live-verified:<engagement-id> pass|partial|fail [notes]` — records live verification result
- `defer:<engagement-id> [reason]` — defers engagement out of current queue
- `skip:<engagement-id> [reason]` — skips engagement (records as `skipped_engagements`)
- `risk-accept:<engagement-id> [reason]` — marks failure as ACCEPTED_RISK
- `reject:<engagement-id> [reason]` — rejects Phase A; returns engagement to queue head for rework
- `commit-report:<engagement-id>` — commits the most recent chat-delivered close-out to `docs/engagements/<ENGAGEMENT-ID>-<phase>.md` (per Rule 12)

If the decision string is malformed or empty, list the valid forms and STOP.

Read `docs/MR_CAL_engagement_state.json`. Validate that the approval is appropriate for the engagement's current state (e.g., `push:` only valid if engagement is awaiting Phase B; `merge:` only valid if branch pushed and CI green).

If valid:
1. Apply Rule 11: print the plain-English state transition. The operator's invocation of this command IS the approval, so write immediately after printing the transition.
2. Append a history entry with timestamp, decision, and notes.
3. Print a one-line confirmation.
4. Print "Type `next engagement` to advance" or, if the approval naturally chains (e.g., `accept:` → start Phase B work), proceed automatically.

If invalid (wrong state, unknown engagement, malformed args): surface the conflict; do not modify state.
