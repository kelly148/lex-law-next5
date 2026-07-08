# GOV-MECH-1 C-3 — CLAUDE.md amendment SPEC (exact before/after, operator-applied)

**Status: NOT APPLIED to CLAUDE.md.** This spec authors the C-3 amendment exactly per `GOV-MECH-1-dispatch.v2` §C-3, but the CLAUDE.md edit itself was **deliberately not applied autonomously.** Two reasons, both binding: (1) the dispatch's own surviving hard stop — "**NO merge of any CLAUDE.md change without operator diff approval**"; (2) editing CLAUDE.md is the agent modifying its own oversight config to loosen gates, which the harness self-modification guard correctly blocks. So C-3 is delivered as an exact, apply-ready spec; **the operator applies these edits and approves the diff.**

**Amendment authority:** operator "Accept all recommendations" on `OUTSIDE-REVIEW-DISPOSITION-1_2026-07-07` + "ADOPT AND RECORD" on `GOV-MECH-1_redteam_consolidated_disposition_DRAFT`. **RETAINED verbatim, explicitly untouched:** the boundary statement (A4), the contradiction-with-prior-close-out tripwire, and the A10 core (red-team item 7).

---

## Change 1 — Replace the "Current state (as of …)" block with a STATE.md pointer (A5)

**PRUNE (verbatim):** the entire `## Current state (as of 2026-06-24) — …` section through its `### Immediate next action` and `### Open carryforwards` bullets (down to, but not including, the `---` before `## Repository and deployment`). It is volatile state that `docs/STATE.md` now owns.

**REPLACE WITH:**
```
## Current state — pointer (volatile state lives in STATE.md)

The authoritative current state is the TOP of **`docs/STATE.md`** (newest-first running log, Rule 16; mirrored to `…\_progress\STATE.md`). This file no longer restates volatile state — read STATE.md's newest entries for the current `main`/prod HEADs, the live queue and open gates, accepted risks and carryforwards, and the latest phase-boundary handoff brief in `…\_progress\HANDOFF_BRIEF_<date>_*.md`. (GOV-MECH-1 C-3 / A5.)
```

## Change 2 — Rule 11 narrowed (A5)

**PRUNE (verbatim):**
```
11. **State-transition gate.** Before every state.json write that changes engagement list membership, print plain-English transition and wait for `y`. Exception: history-log appends from `operator approve` decisions.
```
**REPLACE WITH:**
```
11. **State-transition gate (narrowed — GOV-MECH-1 C-3 / A5).** A `docs/MR_CAL_engagement_state.json` write needs the operator print-and-wait `y` ONLY for a **reclassification** — skip, defer, or risk-accept / ACCEPTED_RISK. **Routine adds and moves-to-`completed` run FREE** (no `y`). History-log appends from `operator approve` decisions remain free.
```

## Change 3 — Rule 12 retired (A6)

**PRUNE (verbatim):**
```
12. **Report-commit discipline.** Investigation and architecture-planning reports commit by default. Phase A / Phase B / live-verification reports deliver to chat first; commit only on `operator approve commit-report:<id>` or natural-language equivalent.
```
**REPLACE WITH:**
```
12. **Report-commit discipline — RETIRED (GOV-MECH-1 C-3 / A6): all reports commit by default.** Investigation, architecture, Phase A/B, and live-verification reports all commit as durable records; there is no `operator approve commit-report:` gate. (Batch runs fold per-increment close-outs into the single morning digest — Rule 19.)
```

## Change 4 — Rule 15 supplemented with the compensating gate (A1 + red-team item 7, verbatim)

**In Rule 15, INSERT the following sentence immediately before "Unchanged backstops: scope-expansion halt; …":**
```
**COMPENSATING GATE (GOV-MECH-1 C-3 / A1 + red-team item 7): auto-merge additionally requires the `reversible-lane-guard` CI job GREEN, AND auto-merge is UNAVAILABLE for any PR that introduces migrations, new flags, protected-path changes, egress/provider changes, auth/permission changes, or carries self-flagged items — regardless of CI status. An operator ack label never restores auto-merge eligibility (it only lets CI complete; merge then needs `operator approve accept:`).**
```
(Nothing in Rule 15 is removed; this is additive. The `reversible-lane-guard` job is GOV-MECH-1 Part A, PR #552.)

## Change 5 — Rule 17 retired (A9)

**PRUNE (verbatim):** the entire Rule 17 line beginning `17. **Per-phase integration branches + per-phase merges.** Each fold phase gets one integration branch …` (through its end `… Start phase branches at **Phase 2** (\`fold/phase-2\`, FOLD-L1-1 onward).`).
**REPLACE WITH:**
```
17. **Per-phase integration branches — RETIRED (GOV-MECH-1 C-3 / A9): engagements land on `main` via per-engagement PRs; per-phase `fold/phase-<n>` branches are no longer used.** Each engagement is its own PR into `main` (auto-merge per Rule 15 or `operator approve accept:`), with per-engagement revert on `main`.
```

## Change 6 — Add Rule 19, the morning digest (A8 + red-team item 7)

**INSERT after Rule 18 (as a new operating rule):**
```
19. **Morning digest (GOV-MECH-1 C-3 / A8 + red-team item 7).** For a batch run, ONE morning digest REPLACES the per-engagement 15-item close-outs (non-batch engagements keep the current close-out format). The digest is post-run **REPORTING, never a gate substitute** — it MUST surface every OPERATOR-RESOLVE item, state discrepancy, held PR (with the exact gate it awaits), migration queued, flag introduced, self-flagged item, and skip-with-reason.
```

## Change 7 — Prune the superseded confirmation-gate list entries

**AMEND (verbatim OLD):**
```
- Merge to main — from **Phase 2 onward** this is the **per-phase merge** (`fold/phase-<n>` → `main`, one merge at the phase boundary on full-CI-green; Rule 17), auto under Rule 15 only when no unresolved decision/residual surfaced across the phase, else `operator approve accept:`. Within a phase, engagements merge onto the **phase branch**, not `main`. (Phase 1 finishes on `main` as-is.)
```
**→ NEW:**
```
- Merge to main — `operator approve accept:` unless the Rule-15 reversible-lane auto-merge applies (per-phase `fold/phase-<n>` branches RETIRED — Rule 17 / A9).
```

**PRUNE (verbatim, remove the line entirely — subsumed by the narrowed Rule 11 + the existing "Reclassifying…"/"Skipping or deferring…" gates above it):**
```
- Any state.json write changing list membership (Rule 11)
```

---

## Retained (do NOT touch)

- The boundary statement (A4) — CLAUDE.md line ~179 and Rule 9.
- The contradiction-with-prior-close-out tripwire — the STUCK CONDITIONS bullet and every reference.
- The A10 core (red-team item 7).
- Rule 18 (deploy-trigger prompts) and the deploy gates — unchanged.
- Confirmation-gate: "Any append to this CLAUDE.md file (diff-gated)" — KEEP (this very amendment is diff-gated).

*GOV-MECH-1 C-3. Apply-ready spec; the CLAUDE.md edit is operator-applied under the mandatory diff-approval gate + the self-modification guard. Every pruned line is quoted verbatim above so over-pruning is visible when you apply the diff.*
