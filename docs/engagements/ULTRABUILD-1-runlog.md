# ULTRABUILD-1 — run log

CLI-executable portion of the Fable audit run sheet (`AUDIT_RUN_SHEET_2026-07-03_AMENDED.md`). Standalone
reversible build-and-PR batch, OUTSIDE the fold queue — one branch per item (`lex-next/ub1-w<n>`), PRs to `main`.

**Batch posture (2026-07-03):** isolated build worktree off `origin/main` `2cc7ecc`. **Auto-merge SUSPENDED**
(Railway auto-deploy status unconfirmable from the repo) → every merge stops for `operator approve accept:`.
Migrations generated + enumerated, NEVER applied. W10a/W10b are §3.1 FIRE (packet + HALT).

## Status

| Item | Scope | State |
|---|---|---|
| W1 | E4b/E7b durable tables (C.3) | **PR #470** — CI GREEN; accept-gated; awaits `operator approve accept:UB1-W1` |
| W2 | Hygiene (0.4/0.7/0.8/0.9) | **PR #471** — CI GREEN; accept-gated; 2 decisions surfaced |
| W5 | Model-pin inventory + preview flag (0.11) | **PR #472** — accept-gated |
| W8+W9 | Governance docs (G.1–G.4) + F-2 confirmation | **PR #473** — accept-gated (docs) |
| **W10a/b** | **FIRE design packets (C1-CONV-DESIGN + D3-SIGNOFF)** | **PR pending; packets written + mirrored → HALT for triad** |
| W3a | B6 chokepoint verification + tests | **NOT DONE** — remaining |
| W3b | S5 survivorship review packet (docs) | **NOT DONE** — remaining |
| W3c | deed provenance field | **NOT DONE** — remaining (may need migration → accept-gated; number after 0051) |
| W4 | sendability `wrong_matter_id` enforce | **NOT DONE** — remaining (accept-gated; shadow-log FP eval needs prod DB — Kelly) |
| W6 | golden reviewer prompt set (dark) | **NOT DONE** — remaining |
| W7 | reviewer-health telemetry | **PARTIAL/DISPOSITIONED** — collection already always-on (window accumulating); view extension + prod flag flip remain |

## Notes (completed)

- **W1** — 3 additive tables replacing in-memory Express records; Fork-C consistent; flag-dark; migration `0051`
  operator-applied; registered in `purgeMatter`. CI green after the purge-coverage fix.
- **W2** — de-id scrub-rule doc (+ local manifest annotation; .docx re-scrub = sandbox/[K]); build-SHA footer via
  existing `/api/version`; VA-only deed guard (loose null policy); conflicts-waiver banner. CI green.
- **W5** — one preview lane marked UNCALIBRATED-until-rerun + `isPreviewTierModel` + decision memo. No id changed.
- **W8+W9** — 3 governance docs (standing rules index; client-facing preconditions; where-client-data-lives
  skeleton) + F-2 CONFIRMED (no wire/disbursement/money-movement path in `src/`).
- **W10a/b** — two self-contained §3.1 FIRE review packets written to `docs/reviews/` + mirrored to the Desktop
  `phase2/reviews/` path. C1-CONV-DESIGN answers the 5 scope-guard questions (primary surface = CopilotPage
  recommended; LIVE-9 route-to-Quick-Deed; builds on W1's E4b/E7b). D3-SIGNOFF plans the fail-closed
  source-anchored deed sign-off at export (pivotal fork: source TEXT now vs IMAGE later; NC-1 red line; reuse
  dormant C1/C2 comparators). **HALT — do NOT self-run/self-review; await the operator's triad disposition.**

## W7 disposition (recorded)

Reviewer-health data COLLECTION is **already always-on and flag-independent** (`telemetry_events` writer wired
unconditionally; jobs/review_sessions/adopt_ledger persist regardless of any flag; `telemetry_events` is never
purged). **So the audit's raw goal — "the 30-day window starts now" — is already met** (the window has been
accumulating). What remains: (a) the additive view extension so the internal `/diagnostics` panel explicitly
shows all four per-lane counts (parse-failure / empty-review / stuck-session / finding-adoption) over a true
30-day window (Interpretation C — a reversible build-and-PR, no migration); and (b) flipping
`REVIEWER_HEALTH_VIEW_ENABLED` in prod to reveal the panel — a **prod Railway config change = operator-gated**.

## Remaining build items (for a continuation — findings already mapped in the ULTRABUILD-1 investigation)

W3a (B6 export-chokepoint verification across the 7 deed categories + missing tests), W3b (S5 Confirmation
survivorship review packet for Kelly — docs, no logic change), W3c (deed provenance field agent-vs-LLM — closes
the LIVE-9 export-scanner gap; may need a migration → accept-gated, numbered after 0051), W4 (sendability
`wrong_matter_id` enforcement code — build enforcement-capable, flag default OFF; the FP evaluation needs prod
shadow-log access = Kelly-only), W6 (golden reviewer prompt set + fixture-driven harness, no live provider
calls), W7 view extension. Each has a precise code-surface map from the parallel investigation.
