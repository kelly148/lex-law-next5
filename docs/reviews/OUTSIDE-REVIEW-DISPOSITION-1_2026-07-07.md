# OUTSIDE-REVIEW-DISPOSITION-1 — 2026-07-07

**What this is.** Two deliberately outside-the-project reviews were run 2026-07-07 in fresh Cowork threads with no project context: (R1) a red-team of the product thesis + roadmap; (R2) an audit of the CLAUDE.md governance machinery. This memo consolidates them with FRESH-EYES-AUDIT-1 (same date, five context-free agents) into numbered decision items for the operator. Cowork lane; nothing here is adopted until the operator rules. Where an item would amend CLAUDE.md, the amendment is diff-gated per existing rules.

**Reviewer blind spot (material, cuts both ways).** Both outside reviews read the stale local clone (tracked files ≈ 2026-06-15, 216 commits behind origin/main). Corrections to their record: the "six queued migrations (0034–0039)" were applied to prod 2026-07-05 (MIGRATION-ALLOWLIST-1; no migrations pending as of the 07-06 deploys); phase branches (Rule 17) were already abandoned in practice — July engagements land on main via per-engagement PRs; the June-15 reviewer-model incident (gpt-5.4-mini 404) was fixed in #320. Structural conclusions survive these corrections; specific counts do not. The fact that outside reviewers were misinformed by the stale clone is itself evidence for items A7/A9 below.

---

## SECTION A — Governance amendments (from R2 + audit convergence)

**A1 — Mechanize the reversible lane. RECOMMEND ADOPT (build engagement).**
Rule 15 condition (iv) is self-graded: auto-merge requires "no residual risk was flagged," certified by the same model seeking the merge — in direct tension with the 5D tripwire lesson. Fix per R2: a CI job that FAILS any PR claiming the reversible lane if its diff touches `src/server/db/migrations/**`, `railway.json`, `nixpacks.toml`, `.github/**`, `scripts/apply-prod-migrations.mjs`, `tools/deploy/**`, or featureFlags.ts default values. Lane membership becomes enforced, not asserted. Small, reversible, testable. This is the top pre-monster-batch item.

**A2 — Flag-flip runbook. RECOMMEND ADOPT.**
A prod flag flip is a behavior change with no PR, no CI, no review (R2), and flag/config drift has already caused one prod incident (D3 enforce) and one booby-trap exists today (CHAT_UI_1 flip would hit deliberately-unapplied migrations 0028/0029 — audit F7). Adopt a per-flip checklist: (1) migration precondition verified against prod schema; (2) partner-flag check (async→reaper; copilot→GROUNDED_CHAT_PROVIDERS); (3) smoke immediately after; (4) named revert step; (5) STATE.md line. Cowork drafts the runbook; CLI adds a per-flag precondition table.

**A3 — Test rollback on a no-op deploy before MODE A. RECOMMEND ADOPT (operator action).**
The Railway GraphQL rollback path is explicitly untested (code comment + audit F2 + R2 agree). Until a live-token rollback has fired once, MODE A must not collapse. One no-op deploy + deliberate rollback closes it.

**A4 — Boundary statement: operator call.** R2 calls it pure ritual. Cost is near zero either way. No recommendation.

**A5 — Rule 11 print-and-wait-`y`: RECOMMEND NARROW, not kill.**
R2 is right that gating reversible bookkeeping edits fights the workflow (Rule 16 already carved an exception). But membership writes that RECLASSIFY (skip, defer, risk-accept) are decision-bearing. Narrow the gate to reclassifications only; routine adds/moves-to-completed run free.

**A6 — Rule 12 (report-commit gating): RECOMMEND ADOPT R2's kill.**
Reports are append-only markdown in git; gating their commit buys nothing. All reports commit by default.

**A7 — Consolidate state representations. RECOMMEND ADOPT.**
Five representations of one fact set (CLAUDE.md header, STATE.md, Desktop mirror, engagement_state.json, handoff briefs); the auto-loaded one is the stalest (R2 + audit F5/F6). Actions: (i) replace the CLAUDE.md "Current state" block with a two-line pointer to STATE.md top (this is COWORK_MAP's own stated principle); (ii) repair engagement_state.json once (stale prod pin, phantom in-progress CHAT-COPILOT-1, obsolete FOLD queue, FOLD-L0-1 verified-contradiction) then demote it to generated-or-retired; (iii) keep STATE.md + one Desktop mirror; (iv) commit COWORK_MAP.md and the July roadmap/dispatches (audit F4).

**A8 — Morning digest for batch runs. RECOMMEND ADOPT.**
For overnight batches, replace per-engagement 15-item close-outs with one digest per run: PRs merged w/ SHAs, migrations queued, flags introduced, self-flagged items, decisions deferred. Individual engagements outside batches keep the current format. Pairs with the audit's OPS-DEADMAN-1 (failed/orphaned-job summary pushed out-of-band) — the digest model only works if failures surface in it.

**A9 — Rule 17 phase branches: RECOMMEND RETIRE (ratify existing practice).**
R2 argues they add ceremony while delaying integration; July practice already lands engagements on main per-PR. Ratify reality.

**A10 — Keep verbatim (reaffirm, no action):** 7-command baseline; no `add -A`; no `reset --hard`; credential rule; contradiction tripwire; evidence-class language; additive-only migrations; default-OFF flags; merge ≠ deploy; §3.1 three-prong FIRE test. Both reviews independently endorse this core.

**A11 — CLONE-REPAIR-1. RECOMMEND ADOPT (attended, not overnight).**
Fetch + fast-forward the local clone, add .gitattributes normalization. The stale clone misled two outside reviewers and would mislead any fresh session (audit F4/F5). Operator-present task.

---

## SECTION B — Roadmap-order decisions (from R1)

**B1 — Does C4-C6 stay first?** R1's strongest structural argument: the thesis ranks matter-state + generator-blind guardrails above drafting, yet the build order puts the conversation page first, guardrails Phase 4, deadline engine Phase 5; R11 makes the order the operator's, but R1 says "if the evidence doesn't bind the order, it was decoration."
Counter-evidence R1 undervalues: Express ask + panel-in-one-place is the named north-star carry (the cross-model paste loop), which no incumbent chat product eliminates; the C4-C6 brief already absorbed thesis conformance (typed unverified-fact state, disposition-as-record, review/verify as primary verbs); invariant 10 screens unverified citations before disposition today.
**Options:** (a) keep order as adopted; (b) R1's alternative (Phases 4+3+5 first, conversation last); (c) middle path — keep C4-C6 first, AND start Phase 3 client-config design + Phase 2 research-lane FIRE packet now in the Cowork lane (design labor is free and unblocks the moment Phase 1 soaks). **RECOMMEND (c).** Operator rules.

**B2 — Express ask before the research lane.** R1: multi-model opinions ship before citation-verification substrate. Mitigations today: panel is advisory, dispositions are attorney's, invariant 10 blocks unverified-citation greening. Gap is real but narrower than claimed. **RECOMMEND:** assemble the RESEARCH-LANE-1 §3.1 packet now (Cowork labor, no build) so Phase 2 is triad-ready the day Phase 1 soaks; add a visible "citation unverified — no snapshot" chip to C.6b acceptance so the limitation is on-screen, not implicit.

**B3 — Second attorney.** Both reviews converge: one real external user generates better prioritization evidence than 234 self-threads; NC-PT-11 (rubber-stamping risk) already requires a design answer before any second user. **RECOMMEND:** schedule the NC-PT-11 design engagement within Phase 1 so the Stage-2 door is open the moment the parity gate is contemplated. Timing is the operator's.

**B4 — Compliance elevation.** R1: xAI ZDR + malpractice-carrier conversation are parked on the parallel operator track while client data fans to four providers; audit F1 adds that the primary pipeline bypasses the egress broker entirely. **RECOMMEND:** (i) EGRESS-UNIFY-1 design engagement (likely FIRE — client-send-safety prong) before further auto-extraction features; (ii) written per-provider ZDR/DPA posture memo (Cowork can draft from provider terms via deep research); (iii) carrier conversation gets a date, not a lane. All operator-gated.

---

## SECTION C — Method notes on the census (from R1; for the record, no build impact)

C1. Thread-count denominator is unweighted by value/risk — treat rank-order claims as conversation-frequency claims only; any future census weights by matter value or exposure class.
C2. 191/234 title-prior classification + partly hand-selected deep reads = confirmation risk; label census rank-order MODERATE, not STRONG, in future citations.
C3. Failure census is survivorship-biased (only caught failures counted); "reviewer-caught outranks self-verification" is directional, not proven — R5 labels should say so where cited.
C4. The disposition-loop universality observation is partially generic to LLM chat; the defensible thesis claims are the persistence/judgment-record layer plus the Phase-4 guardrail set, not the loop itself.
C5. Where R1 misfired (recorded so it isn't re-litigated later): Stage-1 personal-tool identity is a ruling, not a blind spot; Express ask is differentiated from incumbent chat by multi-model arbitration + matter state + audit; thesis-conformance was folded into the C4-C6 brief at ratification, not bolted on.

---

## Suggested disposition order

A3 and A11 today (operator, minutes each). A1, A2, A7 as the next CLI engagements — all pre-monster-batch safety. A5/A6/A8/A9 as one CLAUDE.md amendment PR (diff-gated). B1–B4 whenever the operator wants to rule; none block DEED-STAGE1-SIMPLE-1 or the C.4a start.

---

## OPERATOR DISPOSITION — 2026-07-07

**Ruling: "Accept all recommendations"** (operator, this date, recorded verbatim). Effect per item: A1 ADOPT (CI lane-guard engagement); A2 ADOPT (flag-flip runbook + precondition table); A3 ADOPT (operator rollback drill before any MODE A); A4 NO CHANGE (boundary statement retained — no recommendation was made); A5 ADOPT-NARROWED (Rule 11 `y`-gate limited to reclassifications: skip/defer/risk-accept); A6 ADOPT (Rule 12 retired — reports commit by default); A7 ADOPT (state-truth consolidation: CLAUDE.md header → pointer; state.json one-time repair then demoted; COWORK_MAP + July roadmap/dispatches committed); A8 ADOPT (morning digest for batch runs); A9 ADOPT (Rule 17 phase branches retired — ratifies practice); A10 REAFFIRMED (core invariants verbatim); A11 ADOPT (attended clone repair). B1 OPTION (c) (C4-C6 stays first; Phase 3 client-config design + RESEARCH-LANE-1 §3.1 packet start now in Cowork lane); B2 ADOPT (packet assembled now; "citation unverified — no snapshot" chip added to C.6b acceptance); B3 ADOPT (NC-PT-11 design engagement scheduled within Phase 1); B4 ADOPT (EGRESS-UNIFY-1 design engagement before further auto-extraction; per-provider ZDR/DPA posture memo via Cowork research; malpractice-carrier conversation to receive a calendar date — **date pending operator**). Section C notes recorded for the record.

Implementation: CLI dispatch `docs/engagements/GOV-MECH-1-dispatch.md` (A1/A2/A7 + the CLAUDE.md amendment PR carrying A5/A6/A8/A9 — amendment diff remains operator-gated). Operator items: A3 drill, A11 attended repair, B4 date. Cowork deliverables queued: Phase 3 design draft, RESEARCH-LANE-1 packet, ZDR/DPA memo.

*Cowork memo. Mirrored to Desktop _progress. No repo state mutated beyond adding this file.*
