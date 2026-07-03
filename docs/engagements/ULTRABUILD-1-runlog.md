# ULTRABUILD-1 — run log

CLI-executable portion of the Fable audit run sheet (`AUDIT_RUN_SHEET_2026-07-03_AMENDED.md`). Standalone
reversible build-and-PR batch, OUTSIDE the fold queue — one branch per item (`lex-next/ub1-w<n>`), PRs to `main`.

**Batch posture (2026-07-03):** isolated build worktree `C:\Users\Kelly\Documents\lex-ub1` off `origin/main`
`2cc7ecc`. **Auto-merge SUSPENDED** (Railway auto-deploy status unconfirmable from the repo) → every merge stops
for `operator approve accept:UB1-W<n>`. Migrations generated + enumerated, NEVER applied. W10a/W10b are §3.1
FIRE (packet + HALT); all other items skip.

## Status

| Item | Scope | State |
|---|---|---|
| W1 | E4b/E7b durable tables (C.3) | **PR #470** — accept-gated; purge-coverage fix pushed; awaits accept |
| W2 | Hygiene (0.4/0.7/0.8/0.9) | **PR #471** — accept-gated; 2 decisions surfaced (null-policy, waiver copy) |
| W5 | Model-pin inventory + preview flag (0.11) | PR pending push |
| W3, W4, W6–W9 | deed-finish / sendability / golden prompts / telemetry / governance | not started |
| W10a/b | FIRE design packets | not started (HALT point) |

## Notes

- **W1** — 3 additive tables (`express_loop_run`, `express_ledger_entry`, `express_approval_attestation`)
  replacing the in-memory Express decision-ledger + attorney-approval attestation. Fork-C consistent (attorney
  decisions → `audit_events`; tables hold state + pointer). Flag-dark (`EXPRESS_DURABLE_RECORDS_ENABLED` OFF);
  migration `0051` operator-applied. Registered in `purgeMatter`. tsc/eslint clean, tests green.
- **W2** — de-id scrub-rule doc + local manifest annotation (corpus .docx re-scrub = sandbox/[K] task);
  build-SHA footer via existing `/api/version`; VA-only deed guard (loose null policy); conflicts-waiver banner.
- **W5** — inventory of every pinned model id; the ONE preview lane (`google:gemini-3.1-pro-preview`) marked
  UNCALIBRATED-until-rerun at all three sites + pure `isPreviewTierModel` predicate; decision memo
  `ULTRABUILD-1-model-pin-memo.md` (GA-vs-preview options, no recommendation beyond the audit's). No id changed.
