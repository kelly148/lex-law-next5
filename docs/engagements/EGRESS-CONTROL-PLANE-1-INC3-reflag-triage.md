# EGRESS-CONTROL-PLANE-1 Increment 3 — §3.1 re-flag triage

**Cowork analysis (propose-never-commit). 2026-06-16.** Purpose: decide whether Increment 3 may **ride the parent dispositions** (HI-2/ME-1 + CR-4, both 2026-06-16) as normal automation, or whether any part introduces a **new** load-bearing decision that re-fires the §3.1 FIRE checkpoint. Per CLAUDE.md Rule 13 / EXTERNAL_TRIAD_REVIEW_CHECKPOINTS §3.1, a downstream engagement that only **implements an already-triad-reviewed design does NOT fire**; it MAY re-fire only if it introduces a new uncovered load-bearing irreversible / records-management / ethics / client-send-safety decision — and the reason must be stated.

## Inc 3 scope (from the Inc 2 resume prompt's scope fence)
Inc 3 is the part Inc 2 explicitly deferred: (1) **wire the per-reviewer egress hold gate into the post-commit dispatcher**; (2) **onboard the reviewer fan-out to the egress primitive** (shrink the CI-guard allowlist); (3) **idempotency enforcement**; (4) **hold-lift authorization + a monotonic egress decision**; (5) **send-gate version-binding**; and (6) **the send-gate acknowledgment for hold-blocked partials** (the partial-by-HOLD vs partial-by-non-response split, whose data foundation Inc 2 lays).

## What the parent dispositions already cover (→ rides parent)
The HI-2/ME-1 disposition's unified acceptance criteria already adjudicate, and a triad has already pressure-tested:
- **Items 1–2 (wire hold into dispatcher; onboard reviewer fan-out):** covered. The disposition's coverage criterion (#10) and refinement #3 are explicit — *"any path brought under the plane gets log AND hold from day one,"* and the first slice is *"sendability + reviewer + drafter,"* audit-by-default. Onboarding the reviewer fan-out is the literal implementation of that reviewed design.
- **Item 3 (idempotency):** covered — acceptance #3 (exactly one durable decision row; idempotent audit) + the joint CR-4 seam (idempotency key per (session,lane)).
- **Item 5 (version-binding) and the hold-mid-fan-out behavior:** covered by acceptance #4/#5 (gate immediately-before-dispatch; a hold set after bundle assembly still blocks; precedence tested) and the CR-4 joint seam (refinement #1: a hold mid-fan-out blocks not-yet-sent reviewers, leaves no stuck session, is audited as blocked).
- **Item 4 (hold-lift authorization + monotonic egress decision):** **mostly** covered — fail-closed hold posture (refinement #2) and the audit-of-record establish the decision is monotonic and logged. *Residual:* WHO may lift a hold and by what authority is an access-control sub-question; if Inc 3 introduces an attorney-authorization step for lifting, see below.

## What is NOT fully covered (→ candidate light re-flag)
**Item 6 — the send-gate acknowledgment gate for hold-blocked partials.** This is a **new client-send-safety affordance**:
- The partial-fan-out *policy* was operator-RESOLVED (Kelly): a partial review is always completed + viewable + a notification; the split is at the **send gate** — partial-by-non-response → informational notice; **partial-by-HOLD → a recorded one-click attorney acknowledgment before it counts as send-ready.**
- The HI-2/ME-1 acceptance criteria cover audit + hold + coverage phasing, but they do **not** specify an **attorney-acknowledgment gate as a precondition to send-ready** for a hold-blocked partial. That is a new decision-authority/send-safety contract: it defines a state ("send-ready") and an attorney act that clears it.
- Under §3.1 this meets the conjunctive test: (a) hard to reverse (a send-safety state machine + recorded attorney act), (b) not CI-caught (it's a judgment/authority design), (c) client-send-safety risk. The partial-fan-out *decision* is made, but its **gate design** (what exactly the acknowledgment asserts, what it unlocks, whether it's per-reviewer or per-document, how it interacts with version-binding when the draft changes after acknowledgment) is uncovered.

## Recommendation
**Split Inc 3:**
- **Inc 3a — rides parent (normal automation):** items 1, 2, 3, 5, and the covered part of 4 (wire hold into dispatcher; onboard reviewer fan-out; idempotency; version-binding; monotonic logged decision). Build under normal reversible-lane automation after Inc 2 lands; CI-gated; auto-merge on green per Rule 15.
- **Inc 3b — light FIRE re-flag:** the **hold-blocked-partial send-gate acknowledgment** (item 6) + the hold-lift **authorization** sub-question (the residual of item 4). One focused triad packet — the design is small and the policy is already decided, so the review is narrow: pressure-test the acknowledgment-gate *mechanics*, not the *whether*. Cowork can pre-assemble this packet now so it's ready the moment Inc 2 lands (it depends on Inc 2's partial-by-hold data foundation, so the design is dependency-stable only after Inc 2's data shape is fixed — assemble the packet against Inc 2's approved spec, finalize once Inc 2 merges).

**Net for the execution plan:** Inc 3a is a Wave-1 (reversible) item; Inc 3b is a Wave-2 (FIRE) item with a small, pre-stageable packet. This keeps the CLI building 3a while the 3b triad runs.

## Operator decision requested
Confirm the split (3a rides parent; 3b gets a narrow re-flag), or direct that all of Inc 3 rides the parent (if you judge the acknowledgment gate already adequately covered by the partial-fan-out resolution + the HI-2/ME-1 send-safety criteria).

---
*Cowork triage memo — not a commit. The CLI records the classification per Rule 11 if/when the split is adopted.*
