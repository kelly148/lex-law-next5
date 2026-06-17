# Review-record note — FOLD-AUTH-1 and FOLD-GOV-1 (the two FIRE engagements with no recorded triad)

**Cowork analysis (propose-never-commit). 2026-06-16.** Purpose: close the governance-record gap surfaced by the 2026-06-16 map-vs-repo reconciliation — FOLD-AUTH-1 and FOLD-GOV-1 are the only two §3.1 FIRE-classified engagements that shipped with **neither a review packet nor a recorded disposition** in `docs/reviews/`. This note states what happened, why, the residual exposure, and the operator's options. It does **not** decide; it is a record + a decision request.

## The finding
- Every other early fold FIRE engagement was triad-reviewed and the disposition is on record: **L1-1, L0-1, KB-1, ORCH-1** carry a packet on file and a "triad-cleared — PROCEED WITH NAMED CHANGES" line in `docs/STATE.md`; **SEND-1, R2-PRE-CONFLICT-1** have dedicated `_disposition.md` files.
- **FOLD-AUTH-1** (Inc 1 bypass removal + always-enforce + changePassword, PR #97; Inc 2 owner-access chokepoint + CI ratchet, PR #98) and **FOLD-GOV-1a** (audit-as-Matter-Record, PR #100/#102) have **no packet and no recorded disposition**.

## Most-likely cause (benign, evidence-based)
The §3.1 **packet-auto-assemble machinery did not exist yet** when AUTH-1 and GOV-1a were built. `docs/STATE.md` shows Phase 1 (AUTH-1 / TIER-1 / GOV-1a / PERSIST-1) was **already merged on `main`** when the governance layer that makes FIRE checkpoints auto-assemble a packet and halt was introduced (PR #109, 2026-06-02 late) alongside the tightened three-prong §3.1 criterion (#106). So these engagements were FIRE-classified *in the plan* but built in the window before the gate could mechanically fire and leave an artifact. This is a **process-timing gap, not evidence the work is wrong.**

## Residual exposure (why it's low, honestly stated)
- **AUTH-1** shipped a conservative, CI-guarded design: the bypass code path was **deleted** (a regression test asserts `AUTH_BYPASS_ENABLED` is now inert); ownership kept the existing `userId` owner key (no risky new column); access centralized through the `ownerScope` chokepoint with a **CI guard that fails new inline owner-filters** and a ratcheting baseline. G1 was live-verified (unauth → 401; incognito login works). The decisions a triad would have pressure-tested are visible, narrow, and machine-enforced.
- **GOV-1a** shipped only the **audit slice** (immutable `audit_events` Matter Record + best-effort instrumentation) — additive, no destructive surface. GOV-1's genuinely risky half — **privilege-egress posture** (per-provider retention terms, per-matter egress control, pre-send context preview) — was **deliberately parked** ("GOV-1b parked on operator legal decisions") and is **now being built and triad-reviewed properly** as the egress-control-plane (HI-2/ME-1 disposition, 2026-06-16). So the egress decision is getting its external review, just under a different engagement name.

## Operator options (Kelly's call)
1. **Formally waive, with rationale recorded.** Note in `docs/STATE.md` that AUTH-1 and GOV-1a were FIRE-flagged but built pre-machinery; the implementations are conservative + CI-guarded + (AUTH-1) live-verified; GOV-1's egress half is under live triad review; therefore no retroactive review is warranted. Lowest effort; defensible given the evidence. **Recommended** unless you want the paper trail.
2. **Retroactive triad of AUTH-1 only.** If you want the security posture independently blessed for the record (reasonable given GLBA Safeguards exposure on client NPI), Cowork can assemble a *post-hoc* AUTH-1 packet (the design is already implemented, so it's a "review what shipped" pass, not a pre-build gate). Cost: one triad round-trip; upside: a complete record on the most security-critical engagement.
3. **Do nothing now.** Carry it as a known, documented record-gap; revisit if/when a second attorney or a client audit makes the record matter.

## Recommendation
**Option 1 for GOV-1a** (its risky half is already getting proper review via the egress plane) and **Option 1 or 2 for AUTH-1** depending on how much you value an independent security sign-off on the auth posture for the GLBA record. Either way this is **low urgency** and should not preempt the live build queue — it's bookkeeping, not a blocker.

## What Cowork can do on your word
- Draft the one-paragraph `docs/STATE.md` waiver note (Option 1), for the CLI to commit; **or**
- Assemble the post-hoc AUTH-1 review packet (Option 2) for you to run.

---
*Cowork record note — not a commit. The waiver text or the post-hoc packet ships only on operator direction; the CLI does the commit.*
