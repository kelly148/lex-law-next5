# FOLLOWUP-CATALOG-1 — reversible-build follow-up menu (read-only catalog)

**Engagement:** FOLLOWUP-CATALOG-1 (investigation/catalog; Rule 12 commit-by-default)
**Date:** 2026-06-11 (America/New_York)
**Branch:** `lex-next/followup-catalog-1` off `origin/main` @ `1adc312`
**Nature:** read-only. **Nothing built.** A morning menu for the operator, sourced from `docs/MR_CAL_engagement_state.json` `recommended_followups` + the open carryforwards.

Each item: one-line scope · §3.1 (skip/FIRE) · tag. Tags: **READY** = reversible build-and-PR, no held-merge / decision / FIRE / prod-migration dependency, self-approvable per Rule 8; **NEEDS-DECISION** = buildable but waits on an operator/product/legal call; **NEEDS-AUTHORIZATION** = reversible but on the CLAUDE.md "do-not-begin-without-authorization" list; **FIRE** = §3.1 triad review before any build; **BLOCKED/NOT-A-BUILD** = prod action, live-verify, or already-resolved.

---

## A. READY now — reversible build-and-PR, no blockers (the actual buildable menu)

| # | Item | Scope (one line) | §3.1 | Notes |
|---|---|---|---|---|
| A1 | **MATTERSTATE-BADGE-1** | Relabel the `MatterStateDashboard` posture badge "Sendability" (it badges `safeToSend.posture` under a panel titled "Matter State", so it reads as if the *state* is "unknown"). One-line display fix. | **skip** | Display-only; render-test-gated (ci-gotchas #10). Smallest, safest pick. |
| A2 | **RELAYOUT-2-STRIP-CLEANUP** | Delete the now-dead `MatterReadinessStrip.tsx` + its render test + 2 `r2_cta_oxblood.source.test.ts` references (RELAYOUT-2 replaced it with `MatterRecitalBand`). | **skip** | Reversible; render-test-gated. **Caveat:** it edits another engagement's assertion test to drop refs to deleted code — surface that test edit at review (it's the cleanup's purpose, not a weakening). |
| A3 | **REVIEWER-AUDIENCE-ARRAY** | Align reviewer prompts to emit `audience_affected` as an array (the display already coerces a string; the canonical `FeedbackCardSchema` wants an array). | **skip** | Minor. **Calibration-adjacent** (a reviewer-prompt edit) — keep it a pure format alignment, don't touch scoring semantics. |
| A4 | **FOLD-AUTH-CHANGEPW — SettingsPage UI (UI half only)** | Add a SettingsPage form over the **existing** `auth.changePassword` procedure (bcrypt-verify current, min-10 new). | **skip** | UI over an already-shipped, tested protected procedure; reversible, render-test-gated. (The *live-exercise* half is operator/prod — see C2.) |

## B. Buildable but gated on a call or an authorization

| # | Item | Scope | §3.1 | Tag |
|---|---|---|---|---|
| B1 | **EXPORT-ENHANCEMENTS-1** (WATERMARK-1 + EXPORT-PDF-1) | Export watermarking (fail-safe: unaccepted draft → DRAFT watermark, recorded in the export audit) + a PDF download that **must ride the SAME gated export path** as DOCX (conflict gate + sendability shadow + audit; no bypass endpoint). | **skip-leaning, but touches client-send-safety** | **NEEDS-DECISION** — it touches the export/outbound boundary; recommend the operator confirm the "rides-the-existing-gate, no second endpoint" design is acceptable (or wants a triad look) before build. Sequenced-after-RELAYOUT-2 (done). |
| B2 | **GEMINI-STRUCTURED-OUTPUT-INVALID-JSON** | Make the Gemini reviewer adapter emit valid JSON for structured output (`structuredOutputSchema` + tolerant parse, the MR-IR-GEN-2 fix class). Reversible. | **skip** (reliability/parse, not calibration semantics) | **NEEDS-AUTHORIZATION** — a **provider-adapter change** is on CLAUDE.md's do-not-begin-without-authorization list. Reversible build once the operator green-lights scope. |
| B3 | **KB-LIBRARY-1** | Firm-level practice-memo library: browse/filter + lifecycle acts (verify/supersede/retire). HARD constraints: **no capture, no library→matter adoption** (design is triad-signed). | **skip** (rides the signed design) | **NEEDS-DECISION (scheduling)** — a larger feature and a companion to FOLD-SEED-1; schedule deliberately rather than as a quick fix. |
| B4 | **G4-INIT** | Wire a real matter-level "sendability checked?" signal so the readiness band can earn its green (today `deriveSafeToSend` is open-items-only). | **skip** (a read/signal) | **NEEDS-DECISION** — touches the eval path + a product call on when green is earned; "separate engagement, not display-only" per the source note. |
| B5 | **TELEMETRY-RETENTION** | Size/retention policy for `telemetry_events` (MR-CAL-2G writes full raw reviewer output per review; TiDB-serverless growth). | depends — **pruning = data-destruction prong** | **NEEDS-DECISION** — investigate size first; a retention/pruning policy is an operator decision, not a clean reversible build. |

## C. Not a reversible build now (prod / live-verify / FIRE / resolved)

| # | Item | Why it is not in the buildable menu |
|---|---|---|
| C1 | **DISPOSITION-CARRYFORWARD-1** | **§3.1 FIRE** (explicit): conflict-hit disposition carry-forward changes conflicts-core decision/ethics semantics → triad review of the plan **before** any build. Not buildable tonight. |
| C2 | **FOLD-AUTH-CHANGEPW (live-exercise) / FOLD-AUTH-STOPGAP-CRED** | Operator/prod credential actions (run changePassword against the live DB; rotate the weak stopgap `kelly` credential). Not a build. |
| C3 | **EVALUATOR-RENDER-EYEBALL** | Pattern-16 live verification (eyeball the evaluator synthesis/disposition rendering in `ReviewPane`). Operator-driven against the running app; not a build. *(Named as a candidate in the batch — it is a live-verify, not a reversible build.)* |
| C4 | **STUCK-ACTIVE-SESSION-ON-REVIEWER-FAILURE** | **Likely already addressed** by JOB-RECOVERY-1's stuck-active-session self-heal (Gate 0 Component B, on `main`, behind `JOB_REAPER_ENABLED` default OFF). Verify overlap before treating as a fresh build; otherwise it is a flag-activation, not new code. |
| C5 | **FOLD-GOV-1b-EGRESS-POSTURE** | Needs operator legal/product decisions (which providers' zero-retention terms; which material categories may egress; deny-by-default?). "Highest-value external-triad-review candidate." Not buildable without the decisions. |
| C6 | **FOLD-GOV-1c-OUTPUT-GOVERNANCE** | Deferred to FOLD-L1 (needs source-authority tiers). Blocked by a dependency. |
| C7 | **DEPLOY-MIGRATIONS-NOT-AUTOMATIC** | Largely **superseded** — the MODE-A pre-deploy migration runner is wired in `railway.json` (CLAUDE.md Rule 18). Residual is the manual non-additive-migration path only. |
| C8 | **AUTH-BYPASS-DISABLE** | **Resolved** 2026-06-02 (G1 closed). Excluded. |

---

## Recommendation (one paragraph)

If the operator wants one or two quick reversible wins next, **A1 (MATTERSTATE-BADGE-1)** and **A2 (RELAYOUT-2-STRIP-CLEANUP)** are the cleanest — small, display/dead-code only, render-test-gated, §3.1 skip. **A4** (changePassword SettingsPage UI) and **A3** (audience-array alignment) follow. **B2 (Gemini valid-JSON)** is genuinely useful for reviewer reliability but needs a one-word scope authorization (provider-adapter change). Everything in C is either prod/live-verify, a FIRE, or already handled — none should be built without the operator's gate.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
