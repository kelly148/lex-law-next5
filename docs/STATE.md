# STATE.md — Whereas build, running state log

Append-only, **newest-first**. One dated paragraph per engagement close-out (CLAUDE.md Operating Rule 16): what changed, current build state, open items, gate residuals. Mirrored to `C:\Users\Kelly\Desktop\Historical_Thread_Extraction\_progress\STATE.md` so a fresh thread always has current state. Full phase-boundary context lives in the `HANDOFF_BRIEF_<date>` briefs in that same folder. The authoritative machine-readable tracker is `docs/MR_CAL_engagement_state.json`; this file is the human-readable narrative.

---

## 2026-06-02 (late) — governance + infra batch merged; Rule 16 first run

**What changed.** Four PRs merged to `main` (each separately, per operator): **#106** tightened the §3.1 FIRE criterion to the three-prong conjunctive test + re-flagged the fold queue (8 stay FIRE, 10 drop to normal automation, FOLD-ORCH-1 re-flagged FIRE); **#108** added Rule 16 (this log) + Rule 17 (per-phase merges); **#109** made FIRE checkpoints auto-assemble a self-contained review packet then halt (review stays a hard stop); **#107** added FOLD-DEPLOY-VERIFY-1 — the post-deploy smoke suite (health/ready/version-match/401-unauth/login/changePassword + opt-in rotate-and-restore; runs via `post-deploy-smoke.yml`), in **MODE B** (alert-only + exact rollback step; true auto-rollback gated behind an absent `RAILWAY_TOKEN`). This is Rule 16's first bookkeeping run.

**Current build state.** `main` HEAD = `72a5263`. Phase 1 stays on `main` (AUTH-1/TIER-1/GOV-1a/PERSIST-1 all merged). Governance now live: Rules 8, 14, 15, 16, 17 + the tightened §3.1 criterion + packet auto-assemble. Prod unchanged (auto-deploy OFF; `main` ahead by docs + the smoke tooling, nothing functional undeployed).

**Open items / gate residuals.** Unchanged from the seed entry, plus: provide `RAILWAY_TOKEN` (+ service/env ids) for true auto-rollback and `SMOKE_USERNAME`/`SMOKE_PASSWORD` repo secrets to run the smoke suite; **list-membership reconciliation pending a Rule-11 `y`** (move FOLD-PERSIST-1 → completed, record FOLD-DEPLOY-VERIFY-1, advance to Phase 2); the `_analytical\phase2` Cowork mirror now owes Rules 8/14/15 + the §3.1 re-triage + Rule 16/17 + packet-auto-assemble.

**Next.** Start **Phase 2** on `fold/phase-2` with **FOLD-L1-1** (§3.1 FIRE → auto-assemble the review packet, halt for triad review).

## 2026-06-02 — seed entry (Rule 16/17 introduced)

**What changed.** Introduced automated state upkeep + handoff (Rule 16) and per-phase integration branches/merges (Rule 17); this is the first `STATE.md` entry. Earlier today the governance layer was extended on `main`: scope self-approval for the reversible build-and-PR lane (Rule 8, #101), auto-advance on close-out (Rule 14, #103), auto-merge of the reversible lane (Rule 15, #105), the §3.1 FIRE-criterion tightening + queue re-flag (#106), and Railway auto-deploy was **disabled** so merge ≠ deploy (decouple live-verified: the #105 merge did not advance prod).

**Current build state.** `main` HEAD = `d869f21`. MR-CAL COMPLETE; the Whereas fold is open. **Phase 1 (on `main`):** FOLD-AUTH-1 merged (real per-user auth + owner-key chokepoint; gate G3; `AUTH_BYPASS_ENABLED` off prod = G1 closed, live-verified unauth→401); FOLD-TIER-1 merged (context-priority vs source-authority tier rename, gate G4); FOLD-GOV-1a merged (immutable `audit_events` Matter Record + best-effort instrumentation); FOLD-PERSIST-1 merged (#104; retention/DR posture scaffold + default-safe mechanism). Prod is at the FOLD-PERSIST-1 build; `main` is ahead by docs-only governance PRs (nothing functional undeployed).

**Open items / gate residuals.** (1) Retention/DR values are **PENDING ATTORNEY SIGN-OFF** — flip `signoffStatus` in `retentionPolicy.ts` once decided. (2) **Migration `0004_fold_gov_1a_audit_events.sql` not yet applied to prod TiDB** (out-of-band) — audit events won't persist until it is. (3) Deploy is now **gated** (`operator approve deploy:`); never automated. (4) **No `RAILWAY_TOKEN`** → post-deploy smoke runs in alert-only mode (FOLD-DEPLOY-VERIFY-1, PR #107 CI-green, pending accept); provide a token for true auto-rollback. (5) Stopgap `kelly` credential **unrotated** (rotate via `auth.changePassword`). (6) FOLD-GOV-1b privilege-egress posture parked on operator legal decisions; GOV-1c → FOLD-L1. (7) `LLN-PROD-CLEANUP-1` synthetic prod data (operator-approved cleanup only). (8) The `_analytical\phase2` Cowork mirror owes Rules 8/14/15 + the §3.1 re-triage + Rule 16/17.

**Next.** Finish Phase 1 on `main` as-is; start **Phase 2** on `fold/phase-2` with **FOLD-L1-1** (a §3.1 FIRE → auto-assemble the review packet, then halt for triad review before implementation).
