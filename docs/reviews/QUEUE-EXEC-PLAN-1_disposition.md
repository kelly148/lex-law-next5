# QUEUE-EXEC-PLAN-1 — Consolidated triad disposition

**Status:** DISPOSITIONED 2026-06-16. Two independent external reviews returned (Reviewer A and Reviewer B). **Both verdicts: re-sequence with named changes — do NOT run as-is, do NOT throw it out.** Convergence was unusually high; nearly every point is shared. This record consolidates the two reviews into a binding adopt list + a corrected sequence. Cowork synthesis for the operator; the build sequence below supersedes §3.4–§3.6 of the packet.

---

## The one finding everything flows from
Both reviewers independently identified the same internal contradiction: the plan states the correct rule in **§3.7** ("only front-load packets whose design is dependency-stable") and then **violates it** in §3.4 Principle 1 ("assemble **all** outstanding FIRE packets") and §3.6 (stages DEED-1 and INTEG-1 packets). The plan warns against the exact thing it then prescribes. **Resolution: §3.7 wins.** Front-load only dependency-stable reviews; template or defer the rest.

---

## Consensus adopt list (both reviewers — treat as binding unless you override)

1. **Front-load only CONFLICT-TOGGLE-1's triad.** Its sole dependency (L0-1) is built/deployed/live-verified — nothing under it moves; it's the one clean, high-leverage front-load. Both reviewers single it out as correct.
2. **Do NOT front-load DEED-1 or INTEG-1 final packets.** DEED-1 sits on PM-3 (unbuilt) + an unmade scope decision; INTEG-1's whole subject is the egress surface that's actively in flux (Inc 2 building, Inc 3 undecided). Reviewing either now risks a stale disposition — the most costly form of waste (burned operator hours + false comfort). Prepare a DEED-1 **scope memo** and an INTEG-1 **template/checklist** instead.
3. **Resolve the EGRESS Inc 3 re-flag NOW (Wave 0), not as a Wave-1 build item.** Inc 3 is FIRE-with-possible-reflag; filing it as the lead "reversible" item violates Principle 2. The re-flag question (is the hold-blocked-partial acknowledgment gate a new client-send-safety decision?) must be answered before Inc 2 lands or the lane stalls the moment Inc 2 finishes. **This is the most concrete near-term stall.**
4. **Reorder Wave 1: PM-3 first, Inc 3 only after its re-flag resolves.** PM-3 is dependency-free and unblocks DEED-1; building it first gives slack to resolve Inc 3 without the lane ever idling.
5. **Make the deed scope decision before any DEED-1 work** (deciding to defer deeds after assembling/reviewing the packet wastes the most expensive review in the queue). Operator legal call; time-boxed; gates the DEED-1 build slot.
6. **Isolate the SEND-1 live-verification like EGRESS Inc 1** — it's the malpractice-bearing sendability gate; do not bury it in a four-way deploy batch where a failed smoke loses clean attribution.
7. **Reconcile the migration backlog (`0004`–`0042`) before any batch deploy**, with an ordered applied-vs-pending accounting + a stated rollback posture (are migrations forward-only? can code roll back while schema stays forward?). Highest-consequence deploy landmine under manual, hand-applied migrations.
8. **The reversible buffer — not front-loading — is the real parallelism.** With one serial lane and a ~6–8 item heterogeneous residual, "assemble every packet" is speculative inventory; the buffer is what absorbs review latency. Keep a small rolling 2–3 item ready buffer; pull exactly two reviews forward (CONFLICT-TOGGLE-1 + the Inc-3 triage). **Drop the elaborate 3-stage staging machinery** as over-built for this queue size. (Reviewer A: "calibrate it"; Reviewer B: "drop the pipeline." Same direction — adopt the tighter version: keep a well-ordered queue + small buffer, cut the speculative packet inventory.)
9. **Add explicit governance milestones (not deploy-batch line items):**
   - **Egress fail-closed live-verification** — an *observed blocked/held egress event in prod*, after Inc 3. (Inc 1's `egress_events` write proves logging, NOT that the hold holds.) This is the open leg of "governance/egress live-verified."
   - **SEND-1 live-verification** with explicit pass criteria: a known-bad document gets **blocked**, and the gate **fails closed**.
   - **CONFLICT-TOGGLE-1 × SEND-1 × client-facing gate** verified *together*: with conflicts checking OFF, the system drops to self-use-only / blocks sends. The toggle can disable one of the two named client-facing preconditions, so its FIRE must cover this interaction, not the toggle in isolation.
   - **Client-facing readiness gate** as a hard release gate (auth + owner-key + governance/egress + conflicts + sendability all live-verified), not an implied condition.
10. **Reclassify the AUTH-1/GOV-1 review-record note from optional → REQUIRED**, closed before the next deploy batch. It's the access-control + audit supervision evidence; a gap there is the worst one to have open if attorney supervision were ever questioned, and deploys are the supervision events. (Both reviewers; the note's own recommendation is upgraded accordingly.)
11. **Track the distinct states explicitly** for sequencing — merged ≠ migrated ≠ deployed ≠ live-verified ≠ self-use ≠ client-facing. For egress/sendability, "merged/built" is not "safe to depend on." (Reviewer B.)
12. **Confirm whether NOTIFY-1 must be hold/ack-aware.** Its dependency is stated as "ideally the Inc 2 outbox," but if notifications must respect per-reviewer holds / suppress on hold-blocked partials, the dependency elevates to "after Inc 3 lands + basic verify." Cowork to triage the NOTIFY-1 spec against the Inc 3 design before building. (Both.)

## Divergence (minor) and resolution
The only daylight between the reviewers is intensity on the staging machinery: Reviewer A keeps a "tiered front-loading policy" + a Safety Verification Milestone; Reviewer B says drop the 3-stage pipeline outright. These aren't in conflict — both cut "assemble everything." **Adopt the tighter version (B), keep A's Safety Verification Milestone** (it's item 9's egress/SEND-1/toggle bundle under one operator sign-off before Wave 2 deploys). No reconciliation cost.

---

## Revised sequence — build to this (supersedes packet §3.4–§3.6)

**Wave 0 (now, in parallel with the CLI finishing EGRESS Inc 2):**
- Resolve the **EGRESS Inc 3 re-flag** (triage already written; operator decision needed — see below).
- Run the **CONFLICT-TOGGLE-1 triad** (packet ready).
- Make the **deed scope decision** (operator legal call).
- Cowork: triage NOTIFY-1 hold/ack-dependency; reconcile the `0004`–`0042` migration backlog into an applied-vs-pending ledger; downgrade the DEED-1 packet to a scope memo; reclassify the AUTH-1/GOV-1 note to required.

**Deploy (isolated, right after Inc 2 merges):** EGRESS Inc 1 alone — apply `0041`/`0042`, deploy `58cc5ca`, verify an `egress_events` write. Make this + a basic outbox smoke a **blocking prerequisite** for declaring Inc 2 "landed" and opening the Wave-1 buffer.

**Wave 1 (reversible buffer, in this order):**
1. **PM-3** (party/entity — dependency-free; unblocks DEED-1). *First.*
2. **EGRESS Inc 3a** (the rides-parent part) — only after the re-flag clears 3a as non-FIRE; **Inc 3b** (acknowledgment gate) goes to Wave 2 if the re-flag fires it.
3. **NOTIFY-1** — after the Inc 2 outbox is the chosen event bus (and after Inc 3 if it must be hold/ack-aware).
4. **multipart residual** (verify what's left after CHAT-COPILOT-2).
- **CONFLICT-TOGGLE-1 builds here** the moment its triad disposition returns (behind a default-safe kill-switch flag), interleaved — not nominally "Wave 2."

**Governance milestone (operator sign-off before Wave 2 deploys):** egress fail-closed live-verify (observed held egress) · SEND-1 live-verify (known-bad blocked + fails closed) · CONFLICT-TOGGLE × SEND-1 × client-facing-gate interaction.

**Wave 2 (FIRE, build as dispositions return):**
- **EGRESS Inc 3b** (if re-flagged) — narrow acknowledgment-gate triad.
- **DEED-1** — final FIRE packet assembled only after PM-3's interface is frozen AND the scope decision is made; build after PM-3.

**Wave 3 (deferred):** INTEG-1 set — template/checklist now; per-integration FIRE only after the egress plane is landed + deployed + live-verified. **MIGRATE-1** — placeholder only; defer until a second-attorney decision exists.

---

## Impact on the already-staged artifacts
- **CONFLICT-TOGGLE-1 packet** → **vindicated; run now.** Both reviewers endorse front-loading it.
- **EGRESS Inc 3 re-flag triage** → **vindicated; decide now.** Exactly the Wave-0 resolution both demanded; my recommended 3a/3b split stands.
- **FOLD-DEED-1 packet** → **HOLD — do not run.** Downgrade to a pre-FIRE scope memo; assemble the real packet after PM-3 + scope decision.
- **AUTH-1/GOV-1 record note** → **reclassified optional → REQUIRED;** close before the next deploy batch.

## Operator decisions still required (Kelly's calls)
1. **Adopt this disposition** (re-sequence + the 12 named changes) — or blend.
2. **EGRESS Inc 3 re-flag:** confirm the **3a rides-parent / 3b light-FIRE** split (my recommendation), or rule the whole of Inc 3 rides the parent.
3. **Deed scope decision:** is deed drafting in scope as law-firm representational work, or held behind the title/settlement line? Needed before any DEED-1 work — your legal call, not the reviewers'.

---

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
