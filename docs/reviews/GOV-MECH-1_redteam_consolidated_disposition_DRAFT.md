# GOV-MECH-1 — red-team consolidated disposition (DRAFT for operator ruling), 2026-07-07

**Both legs returned ADOPT-WITH-CHANGES** (GPT: 3 BLOCKER / 7 MAJOR / 2 MINOR; Grok: 1 BLOCKER / 3 MAJOR / 3 MINOR). Neither found wholesale fidelity failure — Parts A/B/C map correctly to the adopted items. Every serious finding is about implementation looseness the builder could exploit or drift through. Verbatim returns: `GOV-MECH-1_redteam_returns.md`.

**Bottom line:** the dispatch should be amended to v2 before Kelly pastes it. The changes are drafting-level (no new operator decisions required except item 8 below).

---

## Convergent findings → proposed v2 amendments (recommend ADOPT ALL)

**1. Ack mechanism: label-only, operator-bound.** (GPT BLOCKER×2; Grok MAJOR-2 — the strongest convergent finding.) Kill the `[NON-REVERSIBLE]` title-marker option and the "builder's choice" delegation. v2 language: ack = GitHub label `lane:non-reversible-ack` ONLY; the guard verifies the label **actor** is the operator account (`kelly148`); if actor verification isn't reliably available, the guard fails closed and merge happens manually outside Rule 15. The regulated actor must not design or operate its own bypass.

**2. Ack semantics: an ack is not a pass.** (GPT MAJOR-3.) The label means "operator acknowledges this PR is non-reversible" — it lets CI go green but **excludes the PR from Rule 15 auto-merge**; merge then requires explicit `operator approve accept:`. State this in both the workflow comment and the C-3 Rule 15 amendment text.

**3. Protected-path hardening.** (GPT MAJOR-4; Grok MAJOR-2, MINOR-7.) Add: rename/move/delete detection (not just modification); glob coverage for new deploy/infra surfaces (`infra/**`, `deploy/**`, `scripts/*prod*`, `*.prod.*`, `*.production.*`, `Procfile`, `docker-compose*.yml`, `fly.toml`, `render.yaml`, env templates); and acceptance test cases for a renamed protected file and a new config file.

**4. featureFlags.ts: whole file protected, period.** (GPT MAJOR-6.) Drop the "default values only if cheaply detectable" carve-out — it invites under-implementation. Whole file protected now; default-only detection is a possible later refinement. (This was already the dispatch's stated fallback; v2 just removes the discretion.)

**5. Guard self-protection acceptance test.** (GPT MAJOR-5; Grok MAJOR-2.) The guard's first PR must include a negative test proving a subsequent `.github/workflows/**` edit without the ack label FAILS, and the operator reviews the guard logic itself before that first merge (it is the one unguarded change).

**6. Part B honesty + robustness.** (GPT MAJOR-7/8; Grok MINOR-5.) Rename the claim: the coverage test is **coverage-maintaining, not correctness-maintaining**. Add: schema validation of table rows (no blank/placeholder cells); a reverse lint (runbook rows referencing nonexistent flags fail); required evidence fields for the prod-schema check (what was queried, when, expected vs. actual migration IDs, "do not flip on mismatch"); an explicit row hard-blocking `CHAT_UI_1_ENABLED` until 0028/0029 are resolved.

**7. Part C compensating batch gate.** (GPT BLOCKER-9; Grok MAJOR-3/4 — second-strongest convergence.) The C-3 amendment must state: Rule 15 auto-merge is UNAVAILABLE for any PR introducing migrations, new flags, protected-path changes, egress/provider changes, auth/permission changes, or carrying self-flagged items; the morning digest is post-run **reporting, not a gate substitute**, and must surface all OPERATOR-RESOLVE items and state discrepancies; the contradiction tripwire and A10 core are explicitly untouched; the pruned confirmation-gate entries are listed **verbatim** in the PR description so over-pruning is visible in the diff.

**8. C-2 evidence discipline.** (GPT MAJOR-10; Grok MAJOR-4.) C-2 must produce a before/after table — field, old value, new value, evidence source, classification (factual correction / demotion / OPERATOR-RESOLVE). "Blocked_engagements staleness" gets resolved per-item with evidence, never normalized in bulk. STATE.md reconciliation completes before the demotion header is added.

**9. Ordering: C-1 always first.** (GPT MINOR-11; Grok MINOR-6.) Remove builder discretion. v2 order: **C-1 → A → B → C-2 → C-3.**

**10. Part C FIRE-triage wording.** (GPT MINOR-12.) Replace "skip — docs/bookkeeping" with: "No new FIRE — the amendment implements an operator-adopted disposition; operator diff approval is mandatory because C-3 changes governance gate semantics."

## Divergent finding → operator call

**11. Grok BLOCKER-1: `schema.ts` + `Dockerfile` are additions beyond the adopted A1 list.** Grok reads them as silent scope expansion and says remove or re-approve. GPT flagged the opposite direction (list too narrow). Cowork recommendation: **KEEP both — they are protection-increasing, not risk-increasing** — but record them in v2 as deliberate additions to the adopted list so the expansion is operator-visible, which cures the "silent" part of Grok's objection. Operator to confirm.

---

## Proposed next steps

1. Operator rules on items 1–10 (recommend ADOPT ALL) and item 11 (recommend KEEP-AND-RECORD).
2. Cowork writes `GOV-MECH-1-dispatch.v2.md` as a NEW file incorporating the ruling (original preserved append-only; v2 supersedes it as the paste target).
3. Kelly pastes v2 to the CLI after DEED-STAGE1-SIMPLE-1 Part B lands.

**OPERATOR DISPOSITION — 2026-07-07: "ADOPT AND RECORD"** (operator, recorded verbatim). Effect: items 1–10 ADOPTED; item 11 KEEP-AND-RECORD (`schema.ts` + `Dockerfile` stay on the protected list, recorded as deliberate operator-approved additions to the adopted A1 set). Implementation: `docs/engagements/GOV-MECH-1-dispatch.v2.md` supersedes the original dispatch as the paste target; original preserved append-only.

---

*Cowork draft. Nothing here self-executes; the operator rules. New file; no existing docs modified. Review labor was automated (browser legs in the operator's accounts at operator direction); judgment was not.*
