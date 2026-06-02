# External Triad-Review Checkpoint Protocol

For the Whereas build (`lex-law-next5`). Owner: Kelly Satterwhite. Status: proposed (not yet wired into the loop — see §9).

**Scope: this protocol governs the entire build plan** — the MR-CAL completion tail *and* the fold that follows it (auth replacement, Layer 1 matter memory, Layer 0 intake, the practice knowledge base, integrations, and any later architecture work). Every present and future engagement that meets the §3 criteria inherits a checkpoint automatically; nothing needs to be re-listed by hand as the plan grows.

---

## 1. Why this exists

The build has run as a single-reviewer process: Claude Code drafts plans and writes code, and the operator (a non-developer) approves on the strength of Claude Code's own reasoning. CAL-7B-PLAN proved the gap — running that plan past an independent GPT and an independent Claude surfaced concrete improvements neither the operator nor Claude Code would have caught alone.

This protocol makes that external review fire **at the high-leverage moments**, hands the operator a **ready-to-paste prompt**, and names the **exact documents** to upload so the outside reviewers have full context. It is the Whereas product thesis — Claude drafts, other models review, the attorney decides — applied to the construction of Whereas itself.

It does **not** add review to every step. That would be noise. It fires before work that is expensive to unwind, and when the build hits genuine difficulty.

---

## 2. Roles

- **Claude Code** — primary builder. Drafts investigations, plans, and code in the repo.
- **Reviewer A** — a fresh **GPT-5** instance, full context, independent.
- **Reviewer B** — a fresh **independent Claude** instance, full context, independent (not the build session).
- **Operator (Kelly)** — sole decision-maker. Reads the two external reviews, adopts / rejects / blends, then directs Claude Code. Never delegates the decision.

The symmetry with Whereas's own reviewer topology (Claude default-primary, others review, attorney final) is deliberate. This is dogfooding.

---

## 3. When a checkpoint fires — two classes

### Class S — Scheduled ("before we pour concrete")

Fires when Claude Code has produced a **design artifact** (an `-investigation.md` or a `-plan.md`) that **establishes or changes a load-bearing decision meeting the §3.1 three-prong criterion** (hard to reverse · not CI-caught · access-control/privilege/ethics/send-safety/data-destruction risk), and the **next step is code that is costly to reverse**. Examples that typically qualify:

- a new or changed **DB table / migration** (e.g. `locked_decisions`, `adopt_ledger`, matter-memory tables);
- a **new** **prompt-injection or output-contract** (not an extension of a proven one);
- an **advisory-vs-blocking / decision-authority** call (sendability gate, evaluator behavior);
- the **calibration regression grid**;
- a **fold engagement that itself fixes a new load-bearing architecture decision** meeting the criterion (auth/access-control, the matter-memory data model, intake/conflicts, knowledge-base privilege handling, data migration) — **NOT every fold engagement**: a downstream engagement that only implements an already-reviewed design rides the parent's review and does not fire (see §3.1).

One review per design decision, at the **last design artifact before code** — usually the `-plan.md`. If an `-investigation.md` itself carries the architecture fork (e.g. sendability advisory-vs-blocking), review at the investigation and don't separately re-review the plan unless the plan reopened a fork.

### Class T — Triggered ("we hit rebar")

Fires regardless of queue position when any of these occur:

- an engagement is **BLOCKED**, or a **live verification FAILS**;
- a **diagnosis is corrected or superseded** — a prior conclusion turned out wrong (the MR-CAL-5D-LIVE pattern: three wrong diagnoses before the real adapter bug);
- **two or more failed attempts** at the same step;
- a decision touches a **DB migration, auth/security** (e.g. `AUTH_BYPASS_ENABLED`), **provider-adapter behavior**, or anything **irreversible**;
- **scope is ambiguous**, or a **settled decision is in tension**;
- an **accepted-risk reclassification**.

Rule of thumb: **S = before expensive work. T = when the work fights back.**

---

## 3.1 Checkpoint triage — deciding whether a checkpoint fires (keep it rare)

Class-T triggers are objective and always fire — they're the moments the build already told you it's in trouble. All the judgment lives in Class S, so screen every S candidate through this triage at plan/investigation acceptance, *before* implementation. **The bias is deliberately toward NOT firing.** External review is worth its round-trip only when being wrong is expensive and hard to undo; reversible, low-stakes work is built and fixed forward, not reviewed.

The prior version of this triage fired on "any fold architecture engagement," which swept in nearly the whole queue and defeated the signal. The criterion below (operator-tightened 2026-06-02) replaces that.

**The FIRE criterion — all three prongs must hold.** An engagement fires the triad review ONLY if it **establishes or changes a load-bearing decision** that is:

- **(a) hard to reverse once shipped** — a persisted data shape, a security/access-control posture, a published/external contract; not something you can edit-forward in a later PR;
- **(b) not caught by CI** — being right here is a human / legal / design judgment, not something `tsc` + `vitest` + `eslint` can catch; AND
- **(c) carries access-control, privilege/confidentiality, ethics/conflicts, client-send-safety, or data-destruction risk.**

If any one prong is absent, **do not fire.** Build it under the normal reversible-lane automation (auto-merge on green CI per CLAUDE.md Rule 15; stop only on a surfaced decision or a hard stop).

**Ride-the-parent — explicitly do NOT fire.** A downstream engagement that **implements an already-triad-reviewed design** rides its parent's review and does not re-fire. **Mechanical, additive, or reversible** build does not fire. You **MAY** re-flag such an engagement as FIRE only if it introduces a **new** load-bearing irreversible / records-management (RPC) / ethics decision its parent's review did not cover — and you must **state why** in the triage line.

**Never fire:** UI copy / labels / cosmetics; test-only changes, docs, config toggles with no data effect; reuse of a pattern already built **and live-verified** in this repo; any engagement that only implements a parent's already-reviewed design.

**Output.** At each engagement's start, Claude Code prints one line alongside the repo-state baseline: `Checkpoint triage: [FIRE | skip] — <reason>`. On a re-flag, the reason must name the new uncovered decision. The operator can override either way.

**Worked calls (tightened criterion).** FOLD-AUTH-1 (access-control posture; irreversible-ish; CI can't judge) → **FIRE**. FOLD-GOV-1 (audit + privilege-egress governance; confidentiality + records) → **FIRE**. FOLD-L1-1 (matter-memory data model + injection — the substrate everything rides) → **FIRE**. FOLD-MIGRATE-1 (data migration; data-destruction risk) → **FIRE**. By contrast: FOLD-TIER-1 (mechanical rename; CI-caught; reversible) → **skip**. FOLD-PERSIST-1 (additive scaffold; placeholders; no destructive SQL) → **skip**. FOLD-L1-2…L1-5 (implement the FOLD-L1-1-reviewed Matter-State design) → **skip — ride parent**. FOLD-PM-1/2/3 (additive engines / CI-testable ingestion / entity model) → **skip**. Across the whole fold expect the §8 survivors to fire — a handful — not one per engagement.

**Interaction with `/autopilot-next`.** A §3.1 **FIRE** is a HARD STOP under the controlled autopilot (`docs/AUTOPILOT_NEXT_SPEC.md`). Autopilot runs this triage at startup, prints `Checkpoint triage: [FIRE | skip] — <reason>`, and on FIRE **auto-assembles the review packet (§4) to `docs/reviews/` + the phase2 mirror, then halts** for external triad review *before* implementation — it does not self-approve past a fired checkpoint. This is what stops autopilot from blowing past the high-stakes plans the protocol exists to catch.

---

## 4. What Claude Code does at a checkpoint

At a checkpoint, **before proceeding past it**, Claude Code **auto-assembles a self-contained review packet** (it does the labor; it does not do the review). The packet contains:

1. **Banner** — `⏸ EXTERNAL-REVIEW CHECKPOINT — <engagement-id> — [S|T] — <one-line why>`.
2. **Decision under review** — 2–4 sentences: what Claude Code proposes and what is at stake if it's wrong.
3. **Ready-to-paste reviewer prompt** — the §6 template, filled in for this situation.
4. **Document manifest** — the §7 list, each entry with a one-line "why it's needed".
5. **Inlined Phase-A plan** — the full `docs/engagements/<id>-plan.md` (or the investigation artifact carrying the fork), pasted in, not just referenced.
6. **Relevant diffs / code** — the actual diff or code excerpts the decision turns on, pasted in.

**Self-contained requirement.** The packet must be reviewable by a reviewer with **no repo access** — every document the manifest names is **inlined** (plan, schema/diff excerpts, the relevant constraints from `CLAUDE.md`), not linked. A reviewer should never need to open the repo.

**Where it's written.** Claude Code writes the packet to `docs/reviews/<ENGAGEMENT-ID>_packet.md` **AND** mirrors a copy to `C:\Users\Kelly\Desktop\Historical_Thread_Extraction\_analytical\phase2\reviews\<ENGAGEMENT-ID>_packet.md` (creating the directory if missing). If the mirror path is unavailable, it still writes the repo copy and says so.

**Then it halts** and tells the operator `packet ready for <ENGAGEMENT-ID>`. Claude Code does **not** write code past the checkpoint, and it does **not** self-run, self-review, or self-approve the review. The operator runs the two external reviews, brings the feedback back, and directs the adopt/reject/blend. **The labor is automated; the decision is not** — this remains a hard stop.

This is a **confirmation gate** in the existing engagement-loop sense (CLAUDE.md "Confirmation-gate decisions Kelly always wants surfaced"). It does not replace the existing Phase A → acceptance → Phase B gates; it sits **in front of** the implementation of the engagements that meet §3.

---

## 5. The operator's loop at a checkpoint

1. Open a fresh GPT-5 chat and a fresh Claude chat (independent of the build session).
2. Paste the §3-supplied prompt into both.
3. Upload the manifest documents to both.
4. Read both reviews. Note where they agree (high-signal), where they diverge (a real fork worth a beat of thought), and what each would change.
5. Decide. Bring the disposition back to Claude Code as plain instructions ("adopt items 1 and 3, reject 2, here's why").
6. Claude Code proceeds under the normal Phase A/B gates.

You stay the synthesizer. The two reviewers surface options; they don't get a vote.

---

## 6. The reviewer prompt template

> You are an independent senior reviewer. You did **not** write what follows and you are not on the team that did. You're reviewing **one design decision** in an attorney-supervised legal-AI build (product "Whereas," build repo `lex-law-next5`). I'm Kelly — the managing attorney and product owner. I am **not** a software developer. The primary builder is a separate Claude Code instance. Your job is to **pressure-test the attached plan before we write code** and tell me, concretely, what you would change and why. Do not rubber-stamp; do not pad.
>
> **Where we are:** `<1–2 sentences: phase, what just got decided, why it matters now>`
>
> **The decision under review:** `<what Claude Code proposes>`
>
> **Attached documents:** `<list each file + one line on what it is>`
>
> **Please return, in this order:**
> 1. **Top risks or flaws** in this plan, ranked.
> 2. **Specific changes** you would make, each with its rationale.
> 3. **Omissions** — what a production legal-AI system needs here that the plan doesn't address.
> 4. **Keep list** — what you would explicitly NOT change, so I don't over-correct.
> 5. **Bottom line** — one of: *proceed as-is* / *proceed with the named changes* / *stop and rethink*.
>
> **Constraints to respect (flag any violation):** additive only, no destructive migrations; the attorney is always the final decision-maker; no title/settlement scope; single-operator now with a nullable owner key so a second attorney can be added later without a migration; feature flags default OFF; reviewers surface options and never make business decisions.

Fill the four angle-bracket fields per checkpoint. Everything else is fixed.

---

## 7. Document manifest

### Base set — attach at every checkpoint

- **The artifact under review** — `docs/engagements/<ID>-plan.md` or `<ID>-investigation.md`. *The thing being critiqued.*
- **`docs/MR_CAL_completion_master_plan.md`** — *the roadmap, so reviewers see where this decision sits and what's downstream.*
- **`docs/MR_CAL_engagement_state.json`** — *current state: what's done, blocked, queued, and the accepted-risk list.*
- **`CLAUDE.md`** (repo root) — *governance + hard constraints, so reviewers don't propose out-of-bounds changes.*

### Adds by decision type

| Decision type | Add to the base set |
| :--- | :--- |
| **Adopt ledger / matter memory / locked decisions** | `docs/engagements/MR-CAL-6A-investigation.md` and `MR-CAL-6B-plan.md` (the ledger interacts with locked decisions); the relevant `src/server/db/schema.ts` excerpt for the affected tables |
| **Sendability gate** | `docs/engagements/MR-CAL-8A-investigation.md`; `docs/LLN_Reviewer_Prompt_Specifications.docx`; `docs/Reference_Taxonomies_v1_3_Proposal.docx` (source-of-truth tiers and the P8-T7 blocker class feed sendability) |
| **Calibration regression (CAL-7B)** | `docs/engagements/CAL-7B-PLAN-plan.md`; `docs/LLN_Reviewer_Calibration_Test_Plan.docx.docx`; `docs/Reference_Taxonomies_v1_3_Proposal.docx`; `src/server/__tests__/mr_cal_2d_calibration_scoring.test.ts` (the authoritative scoring predicates) |
| **Provider-adapter / output-contract** | the adapter file under review; `docs/failure_mode_patterns_inventory_v1_3.md`; the relevant schema file |
| **Fold engagements (post-MR-CAL)** | `Historical_Thread_Extraction/_analytical/phase2/LLN_FOLD_VS_SCRATCH_GAP_MAP_2026-05-30.md` and its relevant Appendix (A=intake, B=routing, C=matter memory, D=knowledge base, F=fold procedure); `Historical_Thread_Extraction/_analytical/phase2/LEXLAW_NEXT_FINAL_SYNTHESIS_post_review.md` |

Keep the upload set tight. Reviewers do better with the artifact + roadmap + constraints than with the whole repo. If a reviewer asks for a specific file to answer well, add it on the second pass.

---

## 8. Checkpoint schedule — the entire build plan

This is the canonical, self-extending schedule. It lists the remaining MR-CAL steps and the known fold engagements. **As the fold plan is fleshed out post-MR-CAL, each new engagement that meets §3 inherits its class automatically — it does not need to be added here by hand.** The §3 criteria, not this table, are authoritative; the table is the current snapshot.

MR-CAL is at its final steps. The tracker JSON (`MR_CAL_engagement_state.json`, last updated 2026-06-01) understates progress: the `engagements/` folder and `CAL-7B-PLAN-plan.md` (2026-06-02, operator-accepted) show 7A/7B/8A/8B planned and all five advisory features (4C/5D/6C/7C/8C) built and live-verified. So the live checkpoints from here are few in MR-CAL and many in the fold.

Current snapshot under the tightened §3.1 criterion (operator-set 2026-06-02). MR-CAL tail (CAL-7B-LIVE results review, CAL-7B-CLOSEOUT) is **complete** — historical, no longer pending.

| Engagement | Fire? | Why (which prong) |
| :--- | :--- | :--- |
| **FOLD-AUTH-1** | **FIRE** | access-control posture; irreversible-ish; CI can't judge correctness |
| **FOLD-GOV-1** | **FIRE** | privilege/confidentiality + immutable Matter Record; egress posture |
| **FOLD-L1-1** | **FIRE** | matter-memory data model + injection — the substrate downstream rides |
| **FOLD-L0-1** | **FIRE** | intake + conflicts-at-intake (ethics/conflicts); RPC-mandatory |
| **FOLD-KB-1** | **FIRE** | knowledge-base privilege/currency; no auto-use in outbound assertions |
| **FOLD-SEND-1** | **FIRE** | advisory→blocking sendability gate (client-send-safety, decision-authority) |
| **FOLD-INTEG-1** | **FIRE** (each) | new external contract + egress surface |
| **FOLD-MIGRATE-1** | **FIRE** | data migration — data-destruction risk |
| FOLD-TIER-1 · FOLD-PERSIST-1 · FOLD-L1-2…L1-5 · FOLD-DRAFT-1 · FOLD-PM-1/2/3 | **skip** (normal automation) | implement an already-reviewed design, or mechanical/additive/reversible build — ride the parent's review; auto-merge on green CI per Rule 15 |
| FOLD-ORCH-1 | **FIRE** (re-flagged; operator to confirm) | introduces a **new** decision-authority / judgment-automation contract (bulk-adopt must require acknowledgment; divergent items can't auto-close) not covered by FOLD-L1-3's shared-context substrate review — §3.1 re-flag, reason stated |
| FOLD-REBASELINE-1 | **FIRE** (parent design map; complete) | the re-baseline design others build against; already reviewed/waived |
| FOLD-PM-4 · FOLD-SEED-1 | **skip / triage-per-entry** | UI over existing data; library seeding rides FOLD-KB-1's review |
| FOLD-VERIFY-1 | n/a | end-to-end live verification, operator-driven (Pattern 16) |

The CAL-7B-LIVE grid run is also a standing **T** source: if cells stick (the `SESSION_ALREADY_EXISTS` bug), or Gemini throws invalid JSON, that's a difficulty signal — but those are *known* carryforwards, so they only warrant a fresh external review if they block the grid rather than just degrade a cell.

---

## 9. Wiring — how to make it actually fire

This file is inert until the loop references it. **Apply the tracked-file edits (steps 2 and 3) from inside the Claude Code build session, not from an outside tool** — editing `CLAUDE.md` / the master plan / the state JSON externally dirties the working tree and trips Claude Code's repo-state baseline mid-engagement. The clean path is to hand Claude Code one instruction at a clean point between engagements:

> "Wire in the external triad-review checkpoint protocol per `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §10 and §11: add the CLAUDE.md gate bullet and operating rule, add the master-plan governing note, and annotate the remaining queue entries. Diff-gated; show me the diffs first."

Four steps, all gated, all yours to approve:

1. **Drop this file in `docs/`.** (Additive; currently an untracked file in your working tree. Commit it on your normal report-commit gate.)
2. **Add the gate bullet + operating rule to `CLAUDE.md`** — see §10. This is what makes Claude Code surface the checkpoint. Diff-gated.
3. **Add the governing note to `docs/MR_CAL_completion_master_plan.md`** — see §11. Puts the checkpoint in the controlling roadmap so it survives into the fold plan.
4. **(Optional) Annotate the queued engagements** in `MR_CAL_engagement_state.json` with a `"checkpoint": "S"` or `"T"` field so `/next-engagement` sees it mechanically. State-JSON membership-adjacent write — Rule 11 gate applies.

Minimum viable wiring is steps 1–3. Step 4 is polish.

---

## 10. Proposed `CLAUDE.md` insertion (diff-gated — not yet applied)

Add to the **"Confirmation-gate decisions Kelly always wants surfaced"** list:

```
- External triad-review checkpoint reached (see docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md):
  before implementing an engagement that creates/changes a DB migration, a prompt-injection
  or output contract, a decision-authority (advisory-vs-blocking) call, the calibration grid,
  or any fold architecture engagement; and on any blocked engagement, failed live verification,
  corrected diagnosis, or >=2 failed attempts. At the checkpoint, STOP and surface: (1) the
  decision under review, (2) a ready-to-paste reviewer prompt, (3) the exact document manifest
  to upload to the external GPT and Claude reviewers. Do not write code past the checkpoint
  until the operator returns a disposition.
```

And add to the **engagement-loop "Operating rules"** numbered list:

```
13. External triad-review checkpoint. Before the implementation phase of any engagement meeting
    the §3 criteria in docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md, and on any §3 Class-T trigger,
    emit the four-part checkpoint block (banner / decision / reviewer prompt / document manifest)
    and wait for the operator's external-review disposition before proceeding.
```

---

## 11. Proposed `docs/MR_CAL_completion_master_plan.md` insertion (not yet applied)

Add a short governing note to the master plan's **"Global operating rules"** section so the checkpoint lives in the controlling roadmap and carries into the fold plan:

```
External triad-review checkpoint (see docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md).
Before the implementation phase of any engagement that creates or changes a DB migration,
a prompt-injection or output contract, a decision-authority (advisory-vs-blocking) call,
the calibration grid, or any fold architecture engagement — and on any blocked engagement,
failed live verification, corrected diagnosis, or >=2 failed attempts — Claude Code surfaces
a four-part checkpoint (banner / decision under review / ready-to-paste reviewer prompt /
document manifest) for independent GPT + Claude review and waits for the operator's
disposition before proceeding. This applies to every phase below and to all future fold
engagements without needing to be restated per engagement.
```

---

## 12. Appendix — filled-in packets for the next checkpoints

These are ready to paste. Fill nothing; just attach the listed files to a fresh GPT-5 chat and a fresh Claude chat.

### 12.1 CAL-7B-LIVE results review (Class T — on result)

> You are an independent senior reviewer. You did not write what follows and are not on the team that did. You're reviewing the results of a calibration regression run for an attorney-supervised legal-AI build ("Whereas," repo `lex-law-next5`). I'm Kelly — managing attorney and product owner, not a software developer. A separate Claude Code instance ran the grid. Your job: tell me whether these results actually support declaring the calibration program closed, and what I should not let pass. Don't rubber-stamp.
>
> Where we are: this is the program-closing behavioral snapshot (CAL-7B-LIVE). It's a live production snapshot, not a replayable offline suite — reviewer output is non-deterministic, so even N=3 cells are a snapshot, not a proof.
>
> The decision under review: whether to accept this grid as sufficient to close MR-CAL and move to the fold.
>
> Attached: `CAL-7B-PLAN-plan.md` (grid definition), `CAL-7B-LIVE-closeout.md` (results), `MR_CAL_engagement_state.json` (accepted-risk list + state), `Reference_Taxonomies_v1_3_Proposal.docx` (classification vocab), `mr_cal_2d_calibration_scoring.test.ts` (scoring predicates), `CLAUDE.md` (constraints).
>
> Return, in order: (1) ranked concerns about whether these results justify closure; (2) any cell to re-run or distrust — especially `unstable` cells, any FAIL/PARSE_FAILURE, and the GPT-P8-T1/T6 accepted-risk cells if they moved in *either* direction; (3) what the grid didn't test that a production legal-AI system should; (4) what's solid and I shouldn't second-guess; (5) bottom line — close as-is / close with named follow-ups / don't close yet.
>
> Constraints to respect (flag violations): attorney is final decision-maker; advisory features never auto-decide; the grid observes only — no prompt/parser/scoring/adapter changes; accepted risks are surfaced, not silently absorbed.

### 12.2 Fold checkpoint #1 — auth replacement (Class S)

The first fold engagement and the most security-critical: it replaces the development auth bypass (`AUTH_BYPASS_ENABLED`, currently ON on a public production URL) with real per-user authentication on an app about to hold privileged client matter data.

> You are an independent senior security reviewer. You did not write this plan and are not on the team that did. You're reviewing the plan to replace a development auth bypass with real authentication in an attorney-supervised legal-AI app ("Whereas," repo `lex-law-next5`) that will hold privileged client matter data across multiple legal matters. I'm Kelly — managing attorney and product owner, not a software developer. A separate Claude Code instance wrote the plan. This is security-critical: the app currently runs with the auth bypass ON on a public production URL. Pressure-test the plan before any code is written. Do not rubber-stamp.
>
> Where we are: MR-CAL is closed; this is the first fold engagement. The public production URL currently has no real authentication (the bypass was left on through the build for live verification).
>
> The decision under review: how to replace the bypass with real per-user authentication — session model, route/endpoint protection, secret handling, and the per-user ownership model that must let a second attorney be added later without a destructive migration.
>
> Attached: the auth-replacement plan doc (`docs/engagements/<auth-engagement-id>-plan.md`); `LLN_FOLD_VS_SCRATCH_GAP_MAP_2026-05-30.md` Appendix F (fold procedure) and Appendix C (shared-context/ownership model); `LEXLAW_NEXT_FINAL_SYNTHESIS_post_review.md` (the 6-layer spec); `docs/CODE_REVIEW_2026-05.md` (notes the bypass and auth state); `CLAUDE.md` (constraints); `MR_CAL_engagement_state.json` (state + the AUTH-BYPASS-DISABLE carryforward).
>
> Return, in order: (1) ranked security risks in this plan; (2) specific changes, each with rationale; (3) omissions a legal app holding privileged data needs — session expiry/rotation, CSRF, transport/TLS, secret storage, audit logging, per-user tenant isolation, password/credential handling, account recovery; (4) keep list — what not to over-engineer for a single-operator app; (5) bottom line — proceed as-is / proceed with named changes / stop and rethink.
>
> Constraints to respect (flag any violation): single-operator now, but every core object (matters, knowledge base, the new MR-CAL tables) must carry a nullable owner/user key so a second attorney can be added later without a migration; do NOT hardcode "owner = only viewer"; additive changes only; the attorney is the final decision-maker; no title/settlement scope; secrets are never logged, echoed, or committed.

The other fold engagements (Layer 1 matter memory, Layer 0 intake, knowledge base, integrations) use the §6 template with the §7 fold add-set; fill them in when each plan is produced. Ask and I'll pre-write any of them.

---

## 13. Honest limitations

- This adds **operator latency only at the checkpoints that fire.** Under the tightened §3.1 criterion (all three prongs), the §8 fire set is a handful — auth, governance/egress, the Layer-1 matter-memory model, intake/conflicts, the knowledge base, the sendability hard gate, integrations, data migration — not one per engagement. Downstream implementers and mechanical/additive/reversible work are built and fixed forward under normal reversible-lane automation (Rule 15), never reviewed.
- External reviewers see a **snapshot**, not the live repo. They can't run the code. Their value is design judgment, omission-spotting, and constraint-checking — not finding runtime bugs.
- The protocol depends on Claude Code **running the §3.1 triage honestly.** The Class-T triggers (blocked / failed / corrected / 2×-failed) are objective; the three-prong FIRE criterion carries judgment but is conjunctive (all three prongs, or it does not fire) and is printed as a one-line `FIRE | skip — <reason>` decision you can override in the moment — so a borderline call is visible up front, not discovered as a missed checkpoint later. A re-flag must name the new uncovered decision; when in genuine doubt whether all three prongs hold, fire.

End of protocol.
