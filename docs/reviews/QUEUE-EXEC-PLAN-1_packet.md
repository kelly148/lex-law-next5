# External Triad-Review Packet — QUEUE-EXEC-PLAN-1 (build-queue sequencing + parallelization strategy)

> **§3 EXTERNAL-REVIEW CHECKPOINT — Class S (process/sequencing) — HALT for review.** Self-contained: reviewable with **no repo access** — every fact the review turns on is inlined. This is **not** a single-engagement design review; it asks two independent reviewers to pressure-test the **execution plan** for the remaining Whereas build — the order of work, how FIRE reviews and deploys are batched, and whether the plan actually keeps the one build lane saturated without anyone idle-waiting.

- **Owner:** Kelly Satterwhite — managing attorney + product owner; **not a software developer**.
- **Builders:** a separate Code/Ultracode CLI (sole committer); a Cowork "propose-never-commit" lane (assembles packets/specs, reads the repo, drives UAT, verifies CLI output). The operator (Kelly) runs FIRE triads, approves FIRE/architecture merges and all deploys, applies DB migrations, flips flags.
- **Goal of this review:** confirm the plan is dependency-correct and that its parallelization actually works, OR tell us where it stalls, wastes a review, or ships something out of order.

---

## 1. Decision under review

We want the CLI to **always be building something**, and the operator + Cowork to **always be preparing or verifying the next thing** — never the line stopping because a needed FIRE review, spec, or migration wasn't ready. The proposed strategy to achieve that: **front-load all outstanding FIRE review packets now** (so the slow external round-trips run as a batch, in parallel with building), **keep a pre-filled "ready-to-build" buffer** of engagements that need no further review (reversible work + FIRE-cleared work), and **batch deploys/verifications at boundaries** instead of stopping the build line for each.

The risk if this is wrong: we waste external-review effort on designs that later change; we build in the wrong order and hit a missing dependency; or we over-invest in "parallel prep" when the true bottleneck is a single serial build lane that prep can't speed up.

---

## 2. Ready-to-paste reviewer prompt

> You are an independent senior reviewer (one of two — the other is a different model). You did **not** write this plan. I'm Kelly, managing attorney and product owner of an attorney-supervised legal-AI build ("Whereas," repo `lex-law-next5`); I am **not** a developer. A separate build CLI is the only thing that commits code; a second "Cowork" assistant prepares review packets/specs and verifies output but never commits; I personally run the external reviews, approve the high-risk merges, and run all deploys. Pressure-test the **execution plan below** — the sequencing and parallelization of the remaining work — before we commit to running it. Don't rubber-stamp; don't pad.
>
> **The core constraint:** there is effectively **one serial build lane** (parallel builds collide on DB-migration numbers and a tracked table-manifest, so the CLI builds one engagement at a time). The slowest step in the system is a **FIRE review**: certain high-risk engagements must halt for an external GPT+Claude review of their design *before* any code is written, and that review is a human round-trip I run by hand. Deploys are manual and operator-gated (merge ≠ deploy; DB migrations are applied to prod by hand *before* the code that needs them). I want to never have the build lane idle waiting on a review or a spec.
>
> **The proposed plan:** (a) Cowork assembles **every outstanding FIRE packet up front** so I can run those reviews as a batch while the CLI builds other things; (b) the CLI is always pointed at the next item in a **pre-filled ready-to-build buffer** — work that is either reversible (no review needed) or FIRE-already-cleared; (c) deploy + live-verify are **batched at phase boundaries**, not run per engagement; (d) Cowork runs a 3-stage pipeline — prepare engagement N+1's packet, while the CLI builds N, while Cowork verifies N-1.
>
> **Please return, in this order:**
> 1. **Top risks / flaws** in this sequencing, ranked. In particular: is front-loading FIRE packets a false economy — i.e., does reviewing a design *before its dependencies are built* risk reviewing a design that then changes, wasting the review and my time?
> 2. **Where the plan actually stalls** despite its intent — name the specific points where the single build lane, a dependency, or a required-before-deploy migration would still force a wait, and how to reorder to avoid it.
> 3. **Dependency / ordering errors** you can see in the wave schedule (§4 of the plan) given the stated dependencies (§3 of the plan).
> 4. **Is the parallelism real or illusory?** With one serial build lane, "parallel prep" only helps if prep is the bottleneck. Tell me honestly whether the plan is optimizing the right thing, or whether I'd get more by just keeping one well-ordered build queue and not over-investing in staging packets I may have to redo.
> 5. **What a production legal-AI build should sequence that this plan omits** — e.g., when the conflicts-at-intake and sendability gates must be live-verified before anything is client-facing; deploy/migration safety; review-record completeness.
> 6. **Keep list** — what's right and I shouldn't second-guess.
> 7. **Bottom line:** run the plan as-is / run with the named changes / re-sequence first.
>
> **Constraints to respect (flag any violation):** one serial build lane; FIRE = external review before code, run by me, never self-approved; reversible work auto-merges on green CI but FIRE/architecture merges and ALL deploys are mine; Railway auto-deploy is OFF (merge ≠ deploy); migrations are manual and must precede the code that needs them; the attorney is always the final decision-maker; nothing is client-facing until auth + owner-key + governance/egress and conflicts-at-intake are live-verified (self-use only until then); scope is transactional document-assembly (title/settlement excluded as a drafting scope line, pending an operator decision for the deed vertical).

---

## 3. Inlined plan — current state, dependencies, classifications

### 3.1 What's already built (so the reviewer knows the starting line)
Verified against `origin/main` on 2026-06-16. The entire Phase 1–3 backbone is merged: real per-user auth + owner-key access chokepoint (AUTH-1); audit-as-Matter-Record (GOV-1a); the Layer-1 Matter-State Engine + injection + shared-context + reusable-artifact gate + five-explicit-acts dashboard (L1-1..L1-5); Layer-0 intake + deterministic conflicts engine (L0-1, **deployed + live-verified, self-use gate cleared**); the practice knowledge base (KB-1); multi-model orchestration (ORCH-1, live-verified); drafting primitives (DRAFT-1, live-verified); the export-safety/sendability engine (SEND-1, build-complete shadow). Plus practice-management pieces PM-1 (deadlines, awaiting live-verify), PM-2 (extraction), PM-4 (portfolio) and the chat-copilot + async-reviewer infrastructure. **Migrations `0004`–`0042` exist; several are not yet applied to prod.**

### 3.2 The remaining work (the actual queue this plan sequences)

| Item | FIRE? | Built? | Blocking dependency |
| :-- | :-- | :-- | :-- |
| **EGRESS Inc 2** (durable outbox + stuck-session/CR-4 root cause; the post-commit dispatcher) | FIRE-covered (HI-2/ME-1 + CR-4 dispositions in hand) | in progress (plan approved) | none — building now |
| **EGRESS Inc 3** (wire per-reviewer egress hold into the dispatcher; onboard reviewer fan-out; send-gate acknowledgment for hold-blocked partials) | FIRE — rides parent; **possible light re-flag** for the hold-lift authorization + acknowledgment gate (new client-send-safety affordance) | not started | EGRESS Inc 2 |
| **EGRESS Inc 1 deploy** (apply migrations `0041`/`0042`, deploy `58cc5ca`, verify an `egress_events` write) | n/a (deploy) | merged, **not deployed** | operator deploy + migration |
| **CONFLICT-TOGGLE-1** (Settings on/off slider for the conflict gate; audited; default-safe) | FIRE (ethics/conflicts + access-control; lowers the barrier to disabling conflicts checking) | not started | reconcile with L0-1 (built) |
| **FOLD-PM-3** (party/entity/contact model + cross-matter identity) | normal automation (rides L0-1 conflicts review) | not started | none material |
| **FOLD-NOTIFY-1** (async completion notifications; in-app → tab → opt-in OS) | normal automation | not started (spec only) | async jobs (built); **ideally** the EGRESS Inc 2 outbox as the event source |
| **FOLD-DEED-1** (AI deed drafting vertical; verbatim legal description; recordability gate) | FIRE (client-send-safety + records risk) | not started (spec only) | **PM-3** (party/entity) + KB-1/L1/SEND-1 (built) + an operator scope decision (deed vs. title/settlement line) |
| **FOLD-INTEG-1** (Gmail / Box / Drive / DocuSign / calendar — each) | FIRE each (new external contract + egress surface) | not started | the egress-control-plane fully landed (Inc 2/3) + deployed |
| **FOLD-MIGRATE-1** (single-operator → multi-user data migration) | FIRE (data mutation) | not started | only if/when a 2nd attorney is added — **conditional; likely defer** |
| **PM-1 / SEND-1 live-verification; R2-PRE-CONFLICT-1 activation** | n/a (verify/deploy) | built | operator deploy + verify pass |

### 3.3 Operating constraints (the rules the sequence must obey)
- **One serial build lane.** Parallel CLI builds collide on migration numbers + the tracked `EXPECTED_TABLES` manifest. Isolated worktrees help attribution but merges still serialize. So "parallelism" = prepare/verify ahead, not build-two-at-once.
- **FIRE = external review before code, operator-run.** The long pole. Cannot be self-approved or self-run.
- **Reversible lane auto-merges on green CI;** FIRE/architecture merges and **all** deploys are operator-gated.
- **Railway auto-deploy OFF** (merge ≠ deploy). **Migrations are manual and must be applied to prod *before* the code that needs them.**
- **Self-use only** until auth/owner-key/governance-egress + conflicts-at-intake are live-verified (auth + L0-1 already are; the egress plane is the open piece).

### 3.4 The strategy (how we keep the line moving)

**Principle 1 — front-load the slow thing.** The FIRE round-trip is the long pole, so convert it from a stop-the-line event into a batch: Cowork assembles **all** outstanding FIRE packets now (CONFLICT-TOGGLE-1; DEED-1; the INTEG-1 set; a re-flag check for EGRESS Inc 3), and Kelly runs those triads in one or two sittings **while the CLI builds the reversible/cleared buffer**. A returned disposition just drops that engagement into the build buffer.

**Principle 2 — never point the CLI at an unreviewed FIRE item.** The build buffer only ever contains work that is (a) reversible/normal-automation, or (b) FIRE-already-cleared. The CLI is never the thing waiting on a review.

**Principle 3 — batch deploy + verify at boundaries.** Don't halt the build line per engagement. Accumulate merged work; run an operator deploy batch (migrations first), then a live-verify pass. EGRESS Inc 1's deploy is the one near-term exception (do it soon, isolated, for clean attribution).

**Principle 4 — Cowork runs three stages at once.** Prepare N+1's packet · CLI builds N · Cowork verifies N-1. The operator's only blocking duties are the FIRE triads (batched) and the gated merges/deploys.

### 3.5 The wave schedule (proposed build order on the one lane)

**Wave 0 — in flight now:** EGRESS Inc 2 (CLI building). In parallel: do the EGRESS Inc 1 deploy (isolated), and Cowork assembles the Wave-2 FIRE packets.

**Wave 1 — reversible buffer (no new review), build in this order after Inc 2 lands:**
1. EGRESS Inc 3 (confirm no new decision → rides parent; if the acknowledgment gate is judged a new client-send-safety decision, it jumps to Wave 2 as a quick re-flag).
2. FOLD-PM-3 (party/entity model — also unblocks DEED-1).
3. FOLD-NOTIFY-1 (best after the Inc 2 outbox exists as the event source).
4. multipart-upload residual (verify what's left after CHAT-COPILOT-2 ephemeral attachments; likely small).

**Wave 2 — FIRE, build as each disposition returns (packets prepared during Waves 0–1):**
5. CONFLICT-TOGGLE-1 (no build dependency; build as soon as its triad clears — can interleave early).
6. FOLD-DEED-1 (triad can clear early, but **build slots after PM-3**; Phase-5 vertical; also needs the operator scope decision).

**Wave 3 — later/conditional (packets prepared but not urgent):**
7. FOLD-INTEG-1 set (after the egress plane is fully landed + deployed; one FIRE each).
8. FOLD-MIGRATE-1 (only on a multi-user decision; defer the packet until then).

**Interleaved, operator-gated:** EGRESS Inc 1 deploy (now); then a deploy/verify batch covering EGRESS Inc 2 + PM-1 + SEND-1 + R2-PRE-CONFLICT activation at the next boundary.

### 3.6 The Cowork prep backlog (what gets staged now, so nothing is ever missing)
1. This plan + its triad review (the gating artifact).
2. CONFLICT-TOGGLE-1 FIRE packet (highest-leverage unbuilt FIRE; operator already firm-yes on the feature).
3. EGRESS Inc 3 design + re-flag triage (rides-parent vs. new decision).
4. FOLD-DEED-1 FIRE packet (can be reviewed ahead even though build waits on PM-3).
5. FOLD-INTEG-1 packet(s) — at least the first integration.
6. The optional post-hoc record note closing the AUTH-1 / GOV-1 review-record gap (from the 2026-06-16 reconciliation).

### 3.7 Honest risks / assumptions (for the triad to test)
- **Front-loading may waste reviews.** A FIRE design reviewed before its dependency lands (e.g., DEED-1 before PM-3, or INTEG-1 before the egress plane settles) could change after build, invalidating the review. Mitigation: only front-load packets whose design is **dependency-stable**; hold the rest.
- **The bottleneck might be the single build lane, not prep.** If so, elaborate staging buys little; a simple well-ordered queue would do. The triad should call this.
- **EGRESS Inc 3's acknowledgment gate** may be a new load-bearing client-send-safety decision the parent disposition didn't cover → may need its own re-flag (cost: one more review).
- **Deploy batching trades attribution for speed.** Bundling deploys makes a failed smoke harder to attribute; the EGRESS Inc 1 deploy is kept isolated for that reason.
- **Operator throughput** is finite: front-loaded FIRE triads still all land on Kelly. Batching helps scheduling but doesn't remove the human-review hours.

---

## 4. Document manifest (all inlined above; listed for completeness)
- This packet (self-contained).
- `outputs/RECONCILIATION_map-vs-repo_2026-06-16.md` — the build-state audit this plan is built on (what's merged/deployed/verified).
- `docs/WHEREAS_FOLD_master_plan.md` — the canonical queue + FIRE classifications + standing constraints (Rules 8/14/15/17/18).
- `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §3.1 — the FIRE criterion the classifications use.
- `docs/reviews/HI-2_ME-1_triad_disposition_2026-06-16.md` + `CR-4_triad_disposition_2026-06-16.md` — the dispositions EGRESS Inc 2/3 ride.
- `docs/engagements/FOLD-DEED-1-spec.md`, `FOLD-NOTIFY-1-spec.md`; the CONFLICT-TOGGLE-1 entry in the master plan — the unbuilt specs.

---

**HALT.** packet ready for QUEUE-EXEC-PLAN-1. Awaiting the operator's external triad disposition (run GPT + an independent Claude on §2) before adopting the sequence. This review gates the *plan*; the reversible work in Wave 0/1 can proceed in parallel under normal automation regardless of the outcome.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
