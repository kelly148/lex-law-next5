# R2-PRE-CONFLICT-1 — Triad disposition (BINDING; supersedes the packet's open fork)

**Status:** DISPOSITIONED — `operator approve checkpoint:R2-PRE-CONFLICT-1` returned 2026-06-05. Implementation authorized. This record is the repo-side binding source; the full reasoning is in the Cowork workspace `…\_analytical\phase2\reviews\R2-PRE-CONFLICT-1_consolidated_disposition_2026-06-05.md` (+ the three raw lanes + `R2-PRE-CONFLICT-1_triad-returns.md`).

**Triad:** fresh-Claude synthesis · GPT-5 (Thinking) · Grok — all three returned. **Verdict: PROCEED with the hybrid; the gate-overload fix is the true headline.**

## Chosen design (build to this — not the packet's open a/b fork)

**Hybrid, in-table, screen-early, confirmation-gated:**
1. Auto-create the client party from `matters.clientName` (when non-empty and no `role='client'` party) as a `matter_parties` row: `role='client'`, `confirmed=false`, `source='auto_from_clientName'`.
2. It IS included in the deterministic conflict check **immediately** (the client is always actually screened).
3. It **cannot satisfy clearance** until confirmation (`confirmed=true`, an explicit logged attorney act). "Automate the labor (row creation), never the judgment (party identity)."

## Named constraints (the spec — §3 of the consolidated)
- **(A) Gate overload is the headline.** Replace the overloaded boolean with an **affirmative clearance state**. Clearable ⇔ (a check exists) ∧ (it included a `confirmed` `role='client'` party) ∧ (no undispositioned BLOCKER) ∧ (current vs the party set). "No check" and "unconfirmed/absent client party" are **distinct non-cleared states**, never silently `false`. Every transition requires affirmative CLEARED, never "not BLOCKED."
- **(B) Predicate = structural, not name-match.** Gate on existence of a `confirmed` `role='client'` party. Normalized-name match vs `clientName` is an **advisory** soft-warning at confirm time only (overridable) — never a gate (real legal names produce false-negatives). Side-by-side `clientName`-vs-party attestation at confirm.
- **(C) Guard ALL four transitions, one shared server-side predicate:** `cleared` disposition (root), `lockPlan`, advance-to-drafting, export/send. No per-procedure copies.
- **(D) Check-party snapshot.** Persist the evaluated party-id set on a terminal check; a party mutation after a clear **invalidates** it (re-check).
- **(E) Retroactive: migrate + flag, never silent-clear, never unwind history.** Matters with `clientName` + no `role='client'` party → insert `role='client'`, `source='migration'`, `confirmed=false`; surface in a "Conflicts Compliance Review" queue. Preview (count + sample) + staging first. No auto-confirm.
- **(F) Schema (additive).** `matter_parties`: `confirmed`, `confirmedAt`, `confirmedByUserId` (+ existing `source`, reused with `auto_from_clientName`/`migration` tags). `conflict_checks`: `checkedPartyIds` snapshot. `addParty` → `confirmed=true`. **No hard `role='client'` DB constraint** (co-clients legitimate).
- **(G) Consumer audit.** No reader of `matter_parties` may treat an `unconfirmed` row as an attorney-asserted party (display/export/authorization). Unconfirmed = screened-but-not-vouched.

## Six BLOCK-until items (must all hold before close)
1. No path to `cleared`/lockPlan/advance/export bypasses the gate (full static + runtime caller audit).
2. The unconfirmed auto-party is fed into the check from creation AND cannot satisfy clearance.
3. Retroactive migration previewed + tested on prod-like data (empty-clientName skip, idempotent, no dup, no auto-confirm, no auto-flip of prior checks).
4. Check-party snapshot + stale-clear invalidation implemented.
5. Confirmation UX low-friction + first-class + immutably logged (confirmations and guard triggers).
6. Consumer audit (G) complete.

## Increment plan (each a reversible PR; Inc 5 data-migration is operator-gated/staged)
- **Inc 1 — schema (F):** migration `0020` (`matter_parties.confirmed/confirmedAt/confirmedByUserId`, `conflict_checks.checkedPartyIds`); Zod; `insertMatterParty` default `confirmed=true`. *(this PR)*
- **Inc 2 — auto-create + screen-early (§2, #2).**
- **Inc 3 — gate-overload fix + 4-transition guard + confirm act + consumer audit (A,B,C,G; #1,#5,#6).**
- **Inc 4 — snapshot + invalidate (D; #4).**
- **Inc 5 — retroactive migration + compliance-review queue (E; #3) — operator-gated/staged.**

---

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
