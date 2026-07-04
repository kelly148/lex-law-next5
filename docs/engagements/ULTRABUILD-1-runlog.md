# ULTRABUILD-1 — run log

CLI-executable portion of the Fable audit run sheet (`AUDIT_RUN_SHEET_2026-07-03_AMENDED.md`). Standalone
reversible build-and-PR batch, OUTSIDE the fold queue — one branch per item (`lex-next/ub1-w<n>`), PRs to `main`.

**Batch posture (2026-07-03):** isolated build worktree off `origin/main` `2cc7ecc`. **Auto-merge SUSPENDED**
(Railway auto-deploy status unconfirmable from the repo) → every merge stops for `operator approve accept:`.
Migrations generated + enumerated, NEVER applied. W10a/W10b are §3.1 FIRE (packet + HALT).
Migrations generated + enumerated, NEVER applied. W10a/W10b are §3.1 FIRE (packet + HALT); others skip.
**Batch posture (2026-07-03):** isolated build worktree `C:\Users\Kelly\Documents\lex-ub1` off `origin/main`
`2cc7ecc`. **Auto-merge SUSPENDED** (Railway auto-deploy status unconfirmable from the repo) → every merge stops
for `operator approve accept:UB1-W<n>`. Migrations generated + enumerated, NEVER applied. W10a/W10b are §3.1
FIRE (packet + HALT); all other items skip.

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
| W1 | E4b/E7b durable tables (C.3) | **PR #470** — accept-gated; purge-coverage fix pushed; awaits accept |
| W2 | Hygiene (0.4/0.7/0.8/0.9) | **PR #471** — accept-gated; 2 decisions surfaced (null-policy, waiver copy) |
| W5 | Model-pin inventory + preview flag (0.11) | PR pending push |
| W3, W4, W6–W9 | deed-finish / sendability / golden prompts / telemetry / governance | not started |
| W10a/b | FIRE design packets | not started (HALT point) |

## Notes

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
- **W5** — one preview lane marked UNCALIBRATED-until-rerun + `isPreviewTierModel` predicate + decision memo. No id changed.
- **W8+W9** — 3 fresh governance docs: `GOVERNANCE_STANDING_RULES.md` (index/pointer + G.1 start-gate, G.3
  model-swap⇒rerun + preview corollary, G.4 quarterly cadence — does NOT restate CLAUDE.md);
  `CLIENT_FACING_PRECONDITIONS.md` (the client-facing checklist keyed to evidence — resolves the D3 = source-
  anchored-signoff and F-2 = wire-containment tokens); `WHERE_CLIENT_DATA_LIVES.md` (skeleton with `[K]` cells).
  **W9 F-2:** CONFIRMED by code inspection — no wire/disbursement/payoff/settlement-money production or
  money-movement path in `src/` (recorded in CLIENT_FACING_PRECONDITIONS.md with the exhaustive term list).
- **W1** — 3 additive tables (`express_loop_run`, `express_ledger_entry`, `express_approval_attestation`)
  replacing the in-memory Express decision-ledger + attorney-approval attestation. Fork-C consistent (attorney
  decisions → `audit_events`; tables hold state + pointer). Flag-dark (`EXPRESS_DURABLE_RECORDS_ENABLED` OFF);
  migration `0051` operator-applied. Registered in `purgeMatter`. tsc/eslint clean, tests green.
- **W2** — de-id scrub-rule doc + local manifest annotation (corpus .docx re-scrub = sandbox/[K] task);
  build-SHA footer via existing `/api/version`; VA-only deed guard (loose null policy); conflicts-waiver banner.
- **W5** — inventory of every pinned model id; the ONE preview lane (`google:gemini-3.1-pro-preview`) marked
  UNCALIBRATED-until-rerun at all three sites + pure `isPreviewTierModel` predicate; decision memo
  `ULTRABUILD-1-model-pin-memo.md` (GA-vs-preview options, no recommendation beyond the audit's). No id changed.
Standalone reversible build-and-PR batch executing the CLI-executable portion of the Fable audit run sheet
(`AUDIT_RUN_SHEET_2026-07-03_AMENDED.md`). OUTSIDE the fold queue — PRs land directly to `main`, one branch per
item (`lex-next/ub1-w<n>`). Append-only.

**Batch-wide posture (recorded at startup, 2026-07-03):**
- Build worktree: `C:\Users\Kelly\Documents\lex-ub1` (isolated, off `origin/main` `2cc7ecc`).
- **Auto-merge SUSPENDED for the whole batch:** Railway auto-deploy-on-merge is a dashboard setting not
  readable from the repo, so it cannot be confirmed OFF. Per the dispatch, every merge stops for
  `operator approve accept:UB1-W<n>`.
- Checkpoint triage: W10a (C1-CONV-DESIGN) + W10b (D3-SIGNOFF) are §3.1 FIRE (packet + HALT). All others skip.
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

## W1 — E4b + E7b durable tables (run sheet C.3) — accept-gated · **PR #470 OPEN (CI running)**

Three additive durable tables (`express_loop_run`, `express_ledger_entry`, `express_approval_attestation`)
replacing the in-memory Express decision-ledger + attorney-approval attestation. Fork-C consistent (attorney
decisions route through `audit_events`; tables hold state + pointer). Flag-dark
(`EXPRESS_DURABLE_RECORDS_ENABLED` default OFF); additive migration `0051` operator-applied out-of-band.
Local validation: tsc clean (W1 files), eslint clean, 11/11 new tests, Express regression 20/20.
**Awaits `operator approve accept:UB1-W1`.**

---

## W2 — Hygiene batch (run sheet 0.4 / 0.7 / 0.8 / 0.9) — reversible lane (accept-gated at merge)

Branch `lex-next/ub1-w2-hygiene`. One PR, four sub-parts:

- **W2a (0.4) — de-identification.** Committed PII-free scrub-rule doc
  `docs/_audit-corpus/DE_IDENTIFICATION_SCRUB_RULE.md` (structural-identifier scrub standard: legal
  descriptions, instrument/book-page, parcel/tax ids, file numbers — token-scan is NOT sufficient). Recorded:
  0.4 is a blocking precondition to any I0 corpus work. **Local (not in PR, gitignored PII):** annotated
  `deed-materials/_anonymized/_MANIFEST.md` to correct the overstated "zero-leak" claim and flag the SFH
  Property bullet as a known real-parcel structural leak. **The actual corpus re-scrub (regenerating
  `ANON_vesting_sfh.docx`) needs the sandbox real→fake mapping tooling (not in-repo) → operator/sandbox task.**
- **W2b (0.7) — build-SHA visibility.** AppShell sidebar footer shows the deployed build SHA (best-effort
  runtime read of the EXISTING `/api/version` stamp; no VITE_ build-flag hazard, no new endpoint). STATE.md
  entry recording prod-currency (U-1) + the mechanism. `/api/health` deliberately NOT changed (byte-locked by
  T-S4-7; `/api/version` already exposes the SHA). Per-deploy historical backfill needs Kelly's deploy log [K].
- **W2c (0.8) — MD/non-VA refusal guard.** Deterministic VA-only refusal at the shared
  `assertDeedDraftingAllowed` chokepoint (all 12 deed generation entry points): a KNOWN non-VA jurisdiction
  (e.g. MD) is refused with `DEED_JURISDICTION_NOT_VA` — never silence, never a VA-styled non-VA instrument.
  Pure predicate `isNonVaDeedJurisdiction` + new test. **LOOSE policy** (null/unset jurisdiction passes, as
  today — refusing null too is flagged for the accept gate; strict would break mocks across 30 test files).
- **W2d (0.9) — conflicts waiver at generate-time.** Client-only waiver banner in QuickDeedPage above all three
  lanes, driven by the live `getConflictsSetting.enforced` (shown when conflicts are NOT enforced = the
  bypass-and-stamp default). Render test extended. Copy mirrors the existing SettingsPage wording; styling
  (amber caution band) flagged for operator sign-off at the accept gate.

**Two decisions surfaced for the accept gate:** (1) W2c null-jurisdiction policy (loose vs. strict);
(2) W2d waiver copy/severity. **Awaits `operator approve accept:UB1-W2`.**
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

---

## 2026-07-04 — CLOSURE: full batch MERGED (this section supersedes the in-progress status tables above)

Rule-16 backfill written 2026-07-04. The status tables earlier in this log reflect the 2026-07-03 W10 FIRE-HALT
checkpoint and were never updated when the remaining items built and merged; the executing session's window
closed before this closure was logged. Final state re-verified against GitHub (`gh` + `git`). This section is
append-only — nothing above it was edited.

**All items merged to `main`. `origin/main = 00c4899`.** Fifteen squash commits (prod `2cc7ecc` -> `00c4899`):

| Item | PR | Squash SHA | Notes |
|---|---|---|---|
| W1 — Express durable E4b/E7b | #470 | `e6fbc67` | migration `0051` (flag-dark) |
| W2 — hygiene (0.4/0.7/0.8/0.9) | #471 | `45ec71d` | de-id rule, build-SHA footer, VA-only deed guard, waiver banner |
| W3 — deed-lane finish | #476 | `98eb404` | B6 verification, S5 review packet, provenance field -> migration `0052` |
| W4 — sendability scope-lock | #475 | `58e699b` | code-level `wrong_matter_id`-only enforce; flag default OFF |
| W5 — model-pin inventory | #472 | `1e9b467` | preview-tier flag; no id changed |
| W6 — golden reviewer prompts | #477 | `b87abb7` | dark drift harness; no live calls |
| W7 — reviewer-health view | #478 | `1b11c86` | 4 per-lane signals; `REVIEWER_HEALTH_VIEW_ENABLED` OFF |
| W8/W9 — governance docs + F-2 | #473 | `fdb3a5e` | standing rules, client-facing preconditions, data-lives |
| W10a/W10b — §3.1 FIRE packets | #474 | `b06ae60` | C1-CONV-DESIGN + D3-SIGNOFF |
| triad dispositions adopted | #479 | `24ae13d` | briefs -> v1.1; D3B follow-on ticket |
| D3-SIGNOFF A.1 Inc 1 — data core | #480 | `72dc4b8` | migration `0053`; flag-dark |
| D3-SIGNOFF A.1 Inc 2 — comparator | #485 | `3a2b904` | re-landed; #481 CLOSED (base was a feature branch, not `main`) -> superseded by #485 |
| D3-SIGNOFF A.1 Inc 3 — OBSERVE wiring | #482 | `a2780a1` | export-route; measures, never blocks |
| D3-SIGNOFF A.1 Inc 4 — UI + ENFORCE | #483 | `fd91165` | earlier RED (3 render tests / Express-entry flag-gating) resolved before merge |
| S5 (UB1-W3b) — survivorship fixes | #484 | `00c4899` | Q1/Q2/Q3/Q5; ratified with the informative-failure cure-card named change; = `origin/main` HEAD |

**CI:** all 15 green at merge. **Migrations `0051`/`0052`/`0053`:** generated + committed, NOT applied —
operator-applied out-of-band, and NOT on the `apply-prod-migrations.mjs` auto-apply allowlist (which ends at
`0050`); `0052` is a hard pre-deploy prerequisite (unconditional `documents.provenance` column breaks all
document read/write on an un-migrated prod). **Deploy:** operator-gated; nothing deployed (prod remains
`2cc7ecc`). Rule-18 MODE B DEPLOY PROMPT issued 2026-07-04. The post-deploy flag-flip order and the
`wrong_matter_id` shadow-log FP check are recorded in `docs/STATE.md` (2026-07-04 entry).
