# GOV-MECH-1 — red-team returns (verbatim), 2026-07-07

Collected by Cowork via browser (operator's logged-in accounts, browser "UNIVERSALTITLE"). Packet: `GOV-MECH-1_redteam_packet.md`. Leg 1 = ChatGPT (Thinking); Leg 2 = Grok (SuperGrok, Think Harder). Returns reproduced verbatim below; consolidation in `GOV-MECH-1_redteam_consolidated_disposition_DRAFT.md`.

---

## LEG 1 — GPT return (verbatim)

Verdict: ADOPT-WITH-CHANGES

BLOCKER — Part A does not actually bind the "operator ack" to the operator.
Dispatch text: "unless the PR carries an explicit operator-visible acknowledgment (label lane:non-reversible-ack or a [NON-REVERSIBLE] title marker — builder's choice…)."
This is the biggest loophole. A coding agent can usually edit PR titles and may be able to apply labels depending on token permissions. A title marker is especially weak because the builder can add it in the same automated PR flow and then treat the PR as acknowledged.
Fix: prohibit title-marker ack. Use a protected GitHub label only, and require the guard to verify the label was applied by an allowed human/operator account or by an operator-only workflow/manual dispatch. If GitHub cannot reliably verify label actor, then the guard should fail and require manual merge/override outside Rule 15.

BLOCKER — Part A's "builder's choice" creates silent scope drift from A1.
Document 2 says lane membership should be "enforced, not asserted." Document 1 lets the builder choose the acknowledgment mechanism and rationale. That is letting the regulated actor design the bypass.
Fix: the dispatch should specify the mechanism, not delegate it. Recommended language: "Use only label lane:non-reversible-ack; no title/body marker; label must be manually applied by the operator; the workflow must document actor/label state in CI output."

MAJOR — Part A should fail protected-path PRs unless either operator-acknowledged or explicitly non-Rule-15/manual.
Dispatch text: "FAILS when the diff touches any protected path, unless the PR carries an explicit operator-visible acknowledgment…"
This is good for CI, but the dispatch should make clear that an ack does not make the PR "reversible"; it only marks it as non-reversible and therefore ineligible for Rule 15 auto-merge unless the operator separately permits merge. Otherwise the label becomes a magic pass.
Fix: rename the semantics: protected-path touch = "non-reversible." The ack should mean "operator has acknowledged this PR is non-reversible and must not be auto-merged under Rule 15." If the intended outcome is "CI passes but Rule 15 cannot auto-merge," state that directly and require Rule 15 text to say so.

MAJOR — Part A does not protect new or renamed deploy/config files.
Dispatch protected paths include railway.json, nixpacks.toml, Dockerfile, tools/deploy/**, .github/workflows/**, and migration files. A builder could introduce fly.toml, render.yaml, .env.production.example, docker-compose.prod.yml, Procfile, k8s/**, terraform/**, infra/**, or move deploy scripts elsewhere without tripping the guard.
Fix: add a "deployment/config expansion" rule: any new file matching deployment, infrastructure, CI/CD, hosting, env, container, secrets-template, or production config patterns is protected. At minimum add path globs for infra/**, deploy/**, scripts/deploy/**, scripts/*prod*, *.prod.*, *.production.*, Procfile, docker-compose*.yml, .github/**, and known host config files. Also require the guard to flag deleted/renamed protected files, not only modified ones.

MAJOR — Part A self-protection is incomplete because the guard's first PR is "last unguarded."
Dispatch text: ".github/workflows/** (self-protecting; the guard's own PR is the last unguarded change)."
That is unavoidable to some extent, but it needs an acceptance criterion: the first PR must include a negative test proving subsequent edits to .github/workflows/** fail without operator ack. Otherwise the builder can add a weak guard and the repo will trust it.
Fix: require a workflow-level test or scripted unit test that simulates .github/workflows/ci.yml changed without ack and confirms failure. Also require operator review specifically of the guard logic before merge.

MAJOR — Part A's feature flag carve-out is too loose.
Dispatch text: "src/server/config/featureFlags.ts — default values only if cheaply detectable; otherwise the whole file."
"Cheaply detectable" invites under-implementation and future false negatives. A default can be changed indirectly by renaming a flag, moving defaults to another file, changing env parsing fallback behavior, or adding helper functions.
Fix: make the entire featureFlags.ts protected for now. Add a later separate improvement to detect default-only changes. Also protect any future files containing flag defaults or production config defaults.

MAJOR — Part B overclaims that the runbook table is "self-maintaining."
Dispatch text: "This makes the table self-maintaining: a new flag without a runbook row breaks CI."
The test only proves name coverage. It does not prove that required migrations, partner flags, booby-traps, smoke checks, or revert steps are correct. It will rot if flag parsing changes or flags move. It can also give false confidence by accepting a row with "none" everywhere.
Fix: acceptance should say "coverage-maintaining, not correctness-maintaining." Require schema validation for non-empty columns and allowed values, plus a human review requirement for any row whose migration precondition is "none" or whose partner flags are blank. Require the test to fail if table columns are missing or placeholder values remain.

MAJOR — Part B omits a source-of-truth rule for prod schema verification.
Dispatch text: checklist requires "migration precondition verified against prod schema."
But the runbook does not specify how prod schema is verified, what evidence is recorded, or what happens if repo migrations and prod schema disagree.
Fix: add required evidence fields: prod migration table/result checked, timestamp, command/source used, expected migration IDs, actual migration IDs, and explicit "do not flip if mismatch." For the CHAT_UI/CHAT_COPILOT booby-trap, require an explicit row saying migrations 0028/0029 deliberately unapplied means flag remains blocked until separately resolved.

BLOCKER — Part C may weaken gates too much when combined with Rule 15 auto-merge.
Dispatch text: Rule 11 narrowed so "routine adds and moves-to-completed run free"; Rule 12 retired; Rule 17 retired; morning digest replaces per-engagement close-outs; confirmation-gate list pruned.
Individually these match Document 2. In combination with unattended overnight batches and auto-merge, they create a gap: routine "completed" moves, report commits, main-landing PRs, and reduced close-outs can all happen without the operator seeing per-engagement deltas until after the fact. If a "routine" completion actually contains hidden unresolved risk, the builder may self-classify it as routine and auto-merge.
Fix: add a compensating batch gate: Rule 15 auto-merge remains unavailable for any PR that introduces migrations, new flags, protected-path changes, egress/provider changes, auth/permissions changes, ethics/conflicts/state-of-record changes, or unresolved/self-flagged items. The morning digest must be post-run reporting only, not a substitute for gates on those categories.

MAJOR — Part C's C-2 state repair is under-specified and decision-bearing.
Dispatch text: "Fix: stale prod pin… phantom in_progress_engagement… obsolete FOLD queue… blocked_engagements staleness…"
Some of these are factual repairs; others are classification decisions. "Blocked_engagements staleness" is vague and could let the builder remove or downgrade blocked items.
Fix: require C-2 to produce a before/after table with each changed field, old value, new value, evidence source, and classification: factual correction / demotion / unresolved contradiction / operator decision required. Anything lacking evidence must be marked OPERATOR-RESOLVE, not normalized.

MINOR — Ordering is mostly fine, but C-1 should be mandatory first, not discretionary.
Dispatch text: "do C-1 first if you judge the working tree at risk, otherwise A then B then C is fine."
The dispatch itself says C-1 "protects everything else." Letting the builder judge working-tree risk is unnecessary discretion.
Fix: order should be C-1, then A, then B, then C-2/C-3. Committing the governing docs first gives a stable decision record before mechanizing or amending governance.

MINOR — FIRE triage skip rationale is too conclusory for Part C.
Dispatch text: "FIRE triage (Part C): skip — docs/bookkeeping; no runtime behavior."
C-3 changes governance gates that control unattended auto-merge behavior. That is gate-semantics, even if not runtime app behavior. Document 2 authorizes the amendment, so a full FIRE may not be necessary, but calling it mere bookkeeping understates the risk.
Fix: revise to: "FIRE triage: already decided by adopted outside-review disposition; no new FIRE, but operator diff approval is mandatory because C-3 changes governance gate semantics."

No finding on fidelity at the broad level: Parts A, B, and C generally map to A1, A2, and A5–A9. The problems are implementation looseness and missing compensating controls, not a wholesale mismatch.

---

## LEG 2 — Grok return (verbatim)

Verdict: ADOPT-WITH-CHANGES

1. BLOCKER (Fidelity + scope expansion - Part A)
Dispatch text: "Protected paths (initial set): - src/server/db/migrations/** - src/server/db/schema.ts - ... - src/server/config/featureFlags.ts - default values only if cheaply detectable..."
Adopted (A1): lists specific paths including "featureFlags.ts default values" but does not include schema.ts or Dockerfile. This is silent scope expansion beyond the adopted items.
Fix: Remove schema.ts and Dockerfile from the protected list in Part A (or explicitly justify and get operator re-approval as A10 amendment). Re-align .github/** vs .github/workflows/** wording exactly to adopted text.

2. MAJOR (Loopholes in CI lane-guard - Part A)
Dispatch text: "unless the PR carries an explicit operator-visible acknowledgment (label "lane:non-reversible-ack" or a "[NON-REVERSIBLE]" title marker - builder's choice...; the guard's own PR is the last unguarded change)" and "self-protecting".
The builder (Claude Code CLI) can rename/move protected files, create new deployment-config files outside the enumerated list (e.g. new .github/workflows/deploy-xxx.yml variant, new prod config in tools/deploy/new-env.json, or a new Dockerfile variant), or edit the guard workflow itself in the same PR that introduces the change (bypassing self-protection on the transitional PR). Label/title can be added in automated flows if CLI has write perms.
Fix: Expand protected paths to include **/*.json, */Dockerfile, /deploy/ (recursive), and add a "no self-modification of guard" rule with SHA pinning or separate operator PR requirement for the guard file. Explicitly require label/title applied in a separate operator-only action post-PR creation, not in the same builder flow.

3. MAJOR (Fidelity - Part C amendments)
Dispatch text (C-3): "Rule 11 narrowed per disposition A5: y-gate only for reclassifications... Rule 12 retired... Rule 17 retired... Morning-digest format per A8... Prune the confirmation-gate list entries..."
This bundles A5/A6/A8/A9 correctly but the "pruning" and "boundary statement RETAINED" language risks over-pruning related gates (e.g., any residual Rule 15/Rule 11 interactions or contradiction tripwire language). Combined with Rule 15 auto-merge supplementation, it could allow unattended batches to land reclassifications or state changes without full oversight.
Fix: In C-3, list every exact line/section to prune or retain verbatim. Add explicit post-amendment check that Rule 15 still requires operator-visible ack + guard AND that contradiction tripwire (A10) remains untouched.

4. MAJOR (State repair risks - Part C)
Dispatch text (C-2): "engagement_state.json one-time repair... Under amended Rule 11 this rewrite is decision-bearing... print... and wait for y. After repair, add a header line demoting..." and C-3 amendments including Rule 12 retired + morning-digest for batches + Rule 17 retired.
The combination (demoted state file + retired per-engagement gates + auto-merge on Rule 15) creates risk of unattended overnight batch silently accepting stale/contradictory state, phantom engagements, or un-reviewed reclassifications. The "OPERATOR-RESOLVE" marker on FOLD-L0-1 is insufficient if demotion reduces visibility.
Fix: Strengthen C-2 to require full STATE.md reconciliation before demotion and explicit operator confirmation of the repair summary. Add to C-3: morning digest must surface any OPERATOR-RESOLVE items and state discrepancies.

5. MINOR (Runbook drift - Part B)
Dispatch text: "Add a test that FAILS when a flag exists in featureFlags.ts but not in the runbook table (parse both; keep it dumb...)" and "table covers 100% of current flags".
The "parse both, keep it dumb" test will rot with structural changes to featureFlags.ts (e.g. nested objects, comments, renamed flags) or runbook format drift, giving false confidence. No coverage for partner-flag consistency or booby-trap staleness over time.
Fix: Make the test more robust (e.g. extract top-level flag keys only) and add a secondary lint that flags runbook entries referencing non-existent flags/migrations. Document this as living requirement in the runbook itself.

6. MINOR (Ordering + Anything else - Sequencing note)
Dispatch text: "Sequencing note: Part C's first action (commit the untracked July docs) protects everything else - do C-1 first if you judge... otherwise A then B then C" and "Run after DEED-STAGE1-SIMPLE-1 completes".
This leaves judgment to the builder on working-tree risk, creating inconsistency. No explicit acceptance criteria for C-1 inventory/report. C-3 diff-gate assumes operator review catches everything post-C-2 repair.
Fix: Mandate C-1 always first (or as a strict prerequisite step). Require explicit "untracked inventory report" in close-out for every part. Add acceptance criterion that all July governing docs are committed and referenced in STATE.md before C-3.

7. MINOR (Fidelity - Part A acceptance)
Dispatch text: "Acceptance (Part A): a test PR (or workflow-level unit test) demonstrates... Close-out states which manual carry this eliminates..."
Adopted A1 does not specify test PR details; dispatch adds them appropriately but risks builder implementing minimal test that doesn't cover all protected paths or the exact ack mechanics.
Fix: Explicitly require test cases for renamed/moved files and new config files in acceptance criteria.

No finding for overall Part B fidelity (matches A2 closely).
No finding for Part C fidelity on core A7 actions (pointer, repair, commit docs).

---

*Cowork lane. Verbatim captures; consolidation and operator ruling in the companion DRAFT disposition. New file; no existing docs modified.*
