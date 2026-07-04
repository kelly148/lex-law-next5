# ULTRABUILD-1 — run log

Standalone reversible build-and-PR batch executing the CLI-executable portion of the Fable audit run sheet
(`AUDIT_RUN_SHEET_2026-07-03_AMENDED.md`). OUTSIDE the fold queue — PRs land directly to `main`, one branch per
item (`lex-next/ub1-w<n>`). Append-only; newest entry at the bottom of each item.

**Batch-wide posture (recorded at startup, 2026-07-03):**
- Build worktree: `C:\Users\Kelly\Documents\lex-ub1` (isolated, off `origin/main` `2cc7ecc`). The primary
  worktree was 141 commits stale on a June-16 branch and could not cleanly hold `main` (24 untracked
  collisions; `main` held by the `mce` worktree); left untouched.
- **Auto-merge SUSPENDED for the whole batch:** Railway auto-deploy-on-merge is a dashboard setting not
  readable from the repo, so it cannot be confirmed OFF. Per the dispatch, every merge stops for
  `operator approve accept:UB1-W<n>`.
- Checkpoint triage: W10a (C1-CONV-DESIGN) and W10b (D3-SIGNOFF) are §3.1 FIRE (packet + HALT). All other
  items skip FIRE (each rides an already-triad-reviewed parent, or is mechanical/additive/reversible).
- Migrations are GENERATED + enumerated for the operator's out-of-band prod migrate — NEVER applied here.

---

## W1 — E4b + E7b durable tables (run sheet C.3) — accept-gated

**Status:** building.

**What it changes (plain English):** Today, when the Express auto-review loop runs, the record of what it
auto-accepted vs. escalated (the "decision ledger") and the attorney's final sign-off on the escalations both
live only in memory and vanish when the request ends — so the supervision story can't be reconstructed later.
W1 adds three durable database tables so those records survive, exactly as the audit's Top-5 #2 requires before
Express is ever activated.

**Blast radius:** additive-only. Three new tables (`express_loop_run`, `express_ledger_entry`,
`express_approval_attestation`); a new migration `0051` (operator-applied, NOT on the auto-apply allowlist); a
new flag `EXPRESS_DURABLE_RECORDS_ENABLED` **default OFF**; new query module + tests; and a flag-gated
persistence hook + a new `recordApproval` mutation in the existing Express procedure. With the flag OFF (the
default, and until the migration lands in prod) behavior is byte-for-byte unchanged. No existing table altered;
no `audit_events` enum change; no egress; no prod change.

**Fork-C consistency:** every attorney decision (per-escalation adopt/reject + the approval act) is ALSO
written to `audit_events` (`eventType='disposition'`), so these tables do not create a competing record of
attorney decisions — they hold operational state + a pointer to the deciding audit-event, and decision history
projects from `audit_events` (FOLD-L1-1 Fork C).
