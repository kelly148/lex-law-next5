# REVIEW-LOOP-UX-1 — review-loop UX (R1 inline adopt/reject · R2 single-reviewer re-run · R3 version compare) — spec

**Status:** spec / build-ready. Cowork (propose lane), 2026-06-16. **Classification: normal automation (reversible, additive)** — overnight-batch-eligible, with one dependency note on R2. Tightens the core attorney decision loop over engines that already exist.

## Objective
Make the per-suggestion attorney decision faster and more legible: act on individual reviewer suggestions in-pane (R1), re-run one reviewer without the whole panel (R2), and compare draft versions to see what changed (R3). All preserve "the attorney is the final decision-maker" and "automate the labor, never the judgment."

## R1 — Inline adopt / reject per suggestion (build first; most independent)
- **Reuse:** the **adopt ledger** (MR-CAL-7C; written through the `reviewSession` adopt flow / `phase4b` queries) and the locked-decisions surface (MR-CAL-6C). The ledger already records adoptions cumulatively.
- **Build:** in the review pane, each reviewer suggestion gets an explicit **adopt / reject / defer** affordance that writes the existing adopt ledger (adopt) or records a reject/defer disposition; surface the running adopt-ledger state ("what you've adopted on this document") inline. Convergent-bucket bulk actions keep the FOLD-ORCH-1 constraint (bulk-adopt requires at least a scroll-acknowledge; divergent items force per-item decisions).
- **Additive:** new UI + the disposition write paths over existing tables; no schema change beyond (optionally) a reject/defer disposition reason (additive column or reuse the existing disposition event).
- **Acceptance:** adopting a suggestion writes the adopt ledger and reflects immediately; reject/defer is recorded and auditable; bulk-convergent still requires acknowledgment; attorney remains final.

## R2 — Single-reviewer re-run / regenerate one lane
- **Build:** a "re-run this reviewer" action on a single lane (e.g., a flaky Gemini/Grok return, or after editing the draft) that re-dispatches just that reviewer's job, leaving the other lanes intact; the lane shows Queued→Running→Returned live (reuses the #328 live-refresh).
- **DEPENDENCY (sequencing):** this touches the **reviewer dispatch path that EGRESS Inc 2 is rebuilding (outbox/dispatcher)**. **Build R2 AFTER Inc 2 merges + Inc 3a lands**, and route the single re-dispatch through the new outbox factory (`reviewerJobFactory`) — do NOT fork a second dispatch path. Until then, R2 is **blocked**; R1 and R3 are not.
- **Additive once on the new dispatcher:** reuses the idempotency key per (session, reviewer) from Inc 2 so a re-run is deduped/clean.
- **Acceptance:** re-running one reviewer leaves the others' cards intact; no stuck session; the new lane updates live; idempotent (no double transmit).

## R3 — Version history + compare
- **Reuse:** the **LDD compare engine** (`src/server/db/queries/lddKeyTerm.ts` — `listLddKeyTermsForVersion` / `listLddKeyTermsForDocument`) and the existing document version model.
- **Build:** a version-history list per document + a **compare view** (vN vs vN-1, or any two versions) showing what changed, leveraging the LDD/key-term diff primitives already built for LOI-vs-draft. Read-only over versions + the compare engine.
- **Additive, read-only.** No schema change.
- **Acceptance:** selecting two versions of a synthetic document renders a clear diff; provenance (which reviewer round / adoption produced a change) is traceable where the data exists; owner-scoped.

## Dependencies & sequencing
- **R1** — independent (adopt ledger built). Build anytime; overnight-eligible.
- **R3** — independent (LDD engine + versions built). Build anytime; overnight-eligible.
- **R2** — **gated on EGRESS Inc 2 + Inc 3a** (shared dispatch path); build after, on the new outbox factory. Not overnight-eligible until then.
- **Suggested order:** R1 → R3 (both reversible now) → R2 (after the egress dispatch settles).

## Do-not-touch
The CLEARED-only conflict gate predicate; the FOLD-ORCH-1 bulk-adopt acknowledgment constraint (no one-click mass adopt of divergent items); the reviewer dispatch path before Inc 2 lands (R2 waits); calibration/scoring semantics (R1 is a decision-surface, not a scoring change); attorney stays the final decision-maker.

---
*Reversible/additive spec; R1 + R3 are overnight-eligible now, R2 after the egress dispatch settles. Cowork spec — the CLI builds; no commit here.*
