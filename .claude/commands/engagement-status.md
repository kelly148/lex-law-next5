---
description: Print MR-CAL completion loop status (read-only)
---

# engagement-status (procedure)

Read `docs/MR_CAL_engagement_state.json`. Do not modify. Print:

MR-CAL Completion — Status
In progress: [engagement ID or "none"] Phase: [phase] Awaiting operator acceptance: [list] Awaiting live verification: [list] Blocked: [list with reasons] Completed: N of M total [bulleted list, last 5 only — full list in state.json] Deferred / skipped: [list] Next in queue: [first 3 items]

Last updated: [timestamp] by [updater]

Type next engagement to advance.


One screen. No state changes. No Rule 11 gate needed (read-only).
