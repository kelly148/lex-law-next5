# ULTRABUILD-1 — run log

Standalone reversible build-and-PR batch executing the CLI-executable portion of the Fable audit run sheet
(`AUDIT_RUN_SHEET_2026-07-03_AMENDED.md`). OUTSIDE the fold queue — PRs land directly to `main`, one branch per
item (`lex-next/ub1-w<n>`). Append-only.

**Batch-wide posture (recorded at startup, 2026-07-03):**
- Build worktree: `C:\Users\Kelly\Documents\lex-ub1` (isolated, off `origin/main` `2cc7ecc`).
- **Auto-merge SUSPENDED for the whole batch:** Railway auto-deploy-on-merge is a dashboard setting not
  readable from the repo, so it cannot be confirmed OFF. Per the dispatch, every merge stops for
  `operator approve accept:UB1-W<n>`.
- Checkpoint triage: W10a (C1-CONV-DESIGN) + W10b (D3-SIGNOFF) are §3.1 FIRE (packet + HALT). All others skip.
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
