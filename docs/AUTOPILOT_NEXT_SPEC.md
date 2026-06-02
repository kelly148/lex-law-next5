# /autopilot-next — corrected paste-ready spec

This file is the source you copy from. Paste the prompt below into Claude Code. It asks for the addition as a **diff-gated** `CLAUDE.md` change (per your own rule that CLAUDE.md appends are gated), so Claude Code won't write until you approve the diff.

Changes folded in from the draft you reviewed: (1) a §3.1 **FIRE** checkpoint is now a hard stop, with the triage printed at startup, so autopilot can't blow past an external-review checkpoint; (2) autopilot is scoped to the build-and-PR lane and never executes live production runs; (3) local edits require an already-approved per-engagement allowlist (no allowlist = stop); (4) assertion-changing test edits are a stop; (5) approve-token idiom matched to the existing `risk-accept:` / `live-verified:` history; (6) an explicit note that this is a behavioral layer, not an enforcement layer — the guard hook and permission prompts stay on for the irreversible band; (7) batch "walk-away" framing tempered (stops at every merge). Everything irreversible stays gated exactly as it is today.

---

## Prompt to paste into Claude Code

> Propose an addition to `CLAUDE.md` — **do not write it yet; show me the diff first and wait for my `y`**, per the CLAUDE.md-append gate. It must sit alongside the existing operating rules, not replace any of them. Also add the reciprocal one-line pointer noted at the end. Here is the content to add:

---

### `/autopilot-next` — Controlled MR-CAL Autopilot (phase-fenced)

Runs the MR-CAL loop (and, post-MR-CAL, the fold) with reduced check-ins. Authorizes the next safe segment of work up to the next hard gate. It does NOT authorize the entire master plan, and it does NOT change which steps are irreversible — it only changes which *reversible* steps may be self-approved.

**This is a behavioral discipline layer, not an enforcement layer.** It reduces check-ins; it does not replace the PreToolUse guard hook or the tool-permission prompts, which remain the actual technical gate for irreversible actions. Keep permission prompts ON for the irreversible band (merge, reset/clean, migrations, credentials) even under autopilot; relax them only for the reversible lane (read, local edit, push, PR, CI wait).

#### Authorization model

Two modes:

- `/autopilot-next` — advance the current engagement through its safe phase, stop at the next hard gate. (One engagement.)
- `run batch <explicit fence>` — advance through multiple engagements within the named fence, self-approving the reversible steps below, stopping at each hard gate. The fence must be explicit (e.g. "run batch CAL-7B-PLAN → CAL-7B-LIVE prep"). **Never infer a wider fence than I named.** Note: because merge is a hard stop, a multi-engagement batch stops at *every* merge — batch's hands-off value is the investigation → plan → push → PR → CI stretch, not chaining merges.

#### Scope of autopilot

Autopilot operates only in the **local-build + remote-PR/CI lane**. It NEVER executes live production runs — no reviewer runs, no calibration-grid execution, no Chrome/tRPC against production, no creation of synthetic production sessions. All live/production verification is operator-driven end to end.

#### Required startup (every invocation)

1. Read `CLAUDE.md`, `docs/MR_CAL_completion_master_plan.md`, `docs/MR_CAL_engagement_state.json`, `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md`.
2. Report: current engagement, current phase, queue head, and anything awaiting acceptance / live verification / blocked / deferred.
3. Run the 7-command repo-state baseline.
4. Run the §3.1 checkpoint triage for the current/next engagement and print one line: `Checkpoint triage: [FIRE | skip] — <reason>`.

#### May self-approve (within an already-approved engagement scope)

- read files; inspect code; grep / CodeGraph / Serena;
- draft investigation or implementation plans;
- local source edits — ONLY within an allowlist already approved for this specific engagement. **If no allowlist exists for the engagement, that is a stop, not a judgment call;**
- run tests if toolchain available;
- local commits with explicit per-file staging only;
- push the feature branch to origin (reversible);
- open a PR and draft its title/body (reversible — nothing on main changes);
- wait on / report CI status;
- write close-outs to chat;
- prepare the next proposed state transition (but not write it — see hard stops).

#### HARD STOPS — never self-approve; stop and ask

- a §3.1 external-review checkpoint that returns **FIRE** — stop for external triad review (GPT + independent Claude) BEFORE implementation (see `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md`);
- squash-merge to main;
- delete a branch;
- any Railway config/env change;
- any DB migration or production/staging data mutation;
- any production cleanup or data deletion;
- any execution of a live production run (reviewer run, grid run, prod Chrome/tRPC) — operator-driven only;
- any credential handling;
- declaring a user-visible feature live-verified (Pattern 16 sign-off is always mine);
- classifying any result as ACCEPTED_RISK;
- skipping, deferring, or deprioritizing an engagement;
- starting any new architecture scope (MR-CAL-N / fold-engagement kickoff);
- a test edit that changes an assertion or expected behavior (adding a mock/stub for a new signature is fine; changing an assertion is a stop and must be surfaced);
- any write to `docs/MR_CAL_engagement_state.json` that changes list membership (Rule 11; history-log appends from `operator approve` decisions remain the allowed exception);
- any append to `CLAUDE.md`.

#### STUCK CONDITIONS — stop and surface immediately

- CI red, or a test failing for a reason not clearly in-scope and local;
- merge conflict;
- unexpected dirty working tree, or any untracked file you didn't create;
- a tool, credential, auth, or provider error;
- `SESSION_ALREADY_EXISTS` or a stuck `active` review session that one normal abandon doesn't clear;
- any scope ambiguity — if unsure whether something is in scope, it is a stop, not a judgment call;
- a finding that contradicts a prior accepted close-out or the recorded state.json history. If a new result cannot be true while leaving the accepted record intact, **STOP and surface the contradiction explicitly** — do not reconcile it yourself, do not proceed on the new finding, and do not overwrite the prior record. (The confidently-wrong tripwire: the 5D-class failures were not ambiguous, they were certain and wrong, and only a human at a gate caught them.)

#### When stopping

Ask for exactly one decision, in the form:

`operator approve <action>:<engagement-id>`

(e.g. `operator approve merge:CAL-7B-LIVE`, `operator approve live-verified:CAL-7B-LIVE`, `operator approve risk-accept:<id>`, `operator approve state-transition:<id>`, `operator approve checkpoint:<id>` once the external review is dispositioned.)

State in plain English what will happen if approved, and what remains after.

#### Never

- Never `git add -A` or `git add .`.
- Never `git reset --hard` or `git clean -fd`.
- Never print, echo, log, or commit a credential value.
- Never continue a broken or contradicted run to "finish the plan." Completion is never a reason to pass a gate or a stuck condition.
- Never rely on Claude Code's built-in auto/permission mode in place of these project rules — the generic classifier does not model this project's risk surface (legal product decisions, manual prod migrations, accepted-risk reclassification, state-file queue mutations, external-review checkpoints).

---

> Reciprocal pointer: in `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md`, confirm the note that a §3.1 FIRE is a hard stop under `/autopilot-next` (already added). Show me the diff against the current `CLAUDE.md` and wait for approval before writing. Don't touch `state.json` or anything else as part of this.

---

## Practical first run

`run batch` is the "walk away" mode, but run your first batch on something low-stakes — the CAL-7B-PLAN revisions — and watch how it handles the first hard stop before trusting it on a phase with merges in it. Confirm the fence holds once with your eyes on it, then let it run.
