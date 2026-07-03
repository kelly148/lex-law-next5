# ULTRABUILD-1 — run log

CLI-executable portion of the Fable audit run sheet (`AUDIT_RUN_SHEET_2026-07-03_AMENDED.md`). Standalone
reversible build-and-PR batch, OUTSIDE the fold queue — one branch per item (`lex-next/ub1-w<n>`), PRs to `main`.

**Batch posture (2026-07-03):** isolated build worktree off `origin/main` `2cc7ecc`. **Auto-merge SUSPENDED**
(Railway auto-deploy status unconfirmable from the repo) → every merge stops for `operator approve accept:`.
Migrations generated + enumerated, NEVER applied. W10a/W10b are §3.1 FIRE (packet + HALT); others skip.

## Status

| Item | Scope | State |
|---|---|---|
| W1 | E4b/E7b durable tables (C.3) | **PR #470** — CI GREEN; accept-gated; awaits accept |
| W2 | Hygiene (0.4/0.7/0.8/0.9) | **PR #471** — CI GREEN; accept-gated; 2 decisions surfaced |
| W5 | Model-pin inventory + preview flag (0.11) | **PR #472** — accept-gated |
| W8+W9 | Governance docs (G.1–G.4) + F-2 confirmation | PR pending push (docs-only) |
| W3a | B6 chokepoint verification | not started |
| W3b | S5 survivorship review packet | not started |
| W3c | deed provenance field | not started (may need migration → accept-gated) |
| W4 | sendability wrong_matter_id enforce | not started (accept-gated) |
| W6 | golden reviewer prompt set (dark) | not started |
| W7 | reviewer-health telemetry ON | not started |
| W10a/b | FIRE design packets | not started (HALT point) |

## Notes

- **W1** — 3 additive tables replacing in-memory Express records; Fork-C consistent; flag-dark; migration `0051`
  operator-applied; registered in `purgeMatter`. CI green after the purge-coverage fix.
- **W2** — de-id scrub-rule doc (+ local manifest annotation; .docx re-scrub = sandbox/[K]); build-SHA footer via
  existing `/api/version`; VA-only deed guard (loose null policy); conflicts-waiver banner. CI green.
- **W5** — one preview lane marked UNCALIBRATED-until-rerun + `isPreviewTierModel` predicate + decision memo. No id changed.
- **W8+W9** — 3 fresh governance docs: `GOVERNANCE_STANDING_RULES.md` (index/pointer + G.1 start-gate, G.3
  model-swap⇒rerun + preview corollary, G.4 quarterly cadence — does NOT restate CLAUDE.md);
  `CLIENT_FACING_PRECONDITIONS.md` (the client-facing checklist keyed to evidence — resolves the D3 = source-
  anchored-signoff and F-2 = wire-containment tokens); `WHERE_CLIENT_DATA_LIVES.md` (skeleton with `[K]` cells).
  **W9 F-2:** CONFIRMED by code inspection — no wire/disbursement/payoff/settlement-money production or
  money-movement path in `src/` (recorded in CLIENT_FACING_PRECONDITIONS.md with the exhaustive term list).
