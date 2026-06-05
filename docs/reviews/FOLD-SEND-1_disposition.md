# FOLD-SEND-1 — Triad-review disposition (binding build directives)

**Disposition:** **PROCEED WITH NAMED CHANGES.** Triad complete — three independent lanes (GPT-5 + two independent Claude reviews), all returned "proceed with named changes"; operator consolidated + signed.
**Canonical record (operator-held):** `…\Desktop\Historical_Thread_Extraction\_analytical\phase2\reviews\FOLD-SEND-1_consolidated_disposition_2026-06-04.md`, with the three raw review lanes archived alongside it (operator, Rule 16).
**Recorded by Claude Code:** 2026-06-05. This file is the repo-side record of the **binding decisions** Inc 1+ must build to. It supersedes the open decisions in `docs/engagements/FOLD-SEND-1-plan.md` §5 — **do not re-pick the plan's defaults.**

---

## Binding resolved decisions (build to these)

1. **Export-gate scope.** Build the engine + gate at the **DOCX export boundary**. **v1 hard-stops only `wrong_matter_id`.** `stale_baseline` and `missing_required_signer/open_execution_item` are **warn + record, NOT hard-block** in v1. Architect the engine so a **future real delivery/share action** can reuse it to enforce true blocks. **No export-intent selector in v1** (deferred).
2. **`unverified_statute_citation` — DEFER as a block.** Warn-only for v1, routed through the existing **advisory LLM layer**. No deterministic citation blocking now.
3. **Override model.** Every block is **overridable + recorded** (no non-overridable category — honors "attorney always final"). `wrong_matter_id` override **requires typed confirmation**. The override record is **append-only**, bound to the exact **documentId + versionId + content-hash**, **snapshots the full block payload** at override time, carries a **structured reason-code + free text**, **supersedes on version change**, and is created via a **POST mutation (never the export GET)**.
4. **Shadow mode (add it).** With `SENDABILITY_GATE_ENABLED` **OFF**, still **compute + log every evaluation per category without enforcing.** Define an explicit flip/activation criterion (e.g., flip when `wrong_matter_id` + `stale_baseline` show < X% false-positive over N exports).
5. **Evaluation logging.** Add an **append-only `sendability_evaluation` record** (timestamp, versionId, matterId, verdict, blocks[], warnings[], LLM-component flag, duration, degradation/error) in **Inc 1**, plus **per-category telemetry from the first commit.** Not just override rows.
6. **Fail-to-warn, not fail-to-block.** Any infra/query error during evaluation → a loud **"a check could not run"** warning and **export proceeds.** Distinguish **"ran and found a blocker"** from **"couldn't run."**
7. **`jurisdiction_rule` shape.** **Document-type-scoped + source-tagged + idempotently seeded** — NOT a broad "VA/MD requires X" table. Add a **scope guard** so settlement/title execution formalities can't be pulled in (out of scope). Keep `sendability_rule`/`jurisdiction_rule` tables but **no config UI in v1** — hardcoded **idempotent seeds (owner-null firm defaults).**
8. **LLM classifier = warn layer only** (degrade-to-unavailable, never blocks). Deterministic blocks stay **pure / LLM-free.**
9. **Audience-leak / GOV-1b egress:** **separate, warn-only v1** unless it reduces to an **objective metadata mismatch.** Do not fold semantic leak detection into the deterministic block layer.
10. **Rename in user-facing copy:** "sendability" → **"export safety" / "outbound readiness."** Keep the legacy code name (`sendability_*`) where churn isn't worth it.

## Verify-before-relying items (resolved 2026-06-05)

- **`stale_baseline` severity source — RESOLVED.** Confirmed by code inspection that `open_items` severity **is LLM-derived** in the orchestration path (`divergentOpenItemRegistration` → `mapOrchSeverityToOpenItemSeverity(group.severity)`, where `group.severity` flows from reviewer/LLM suggestion severity). Therefore `stale_baseline` **must not** depend on `open_items` severity. **Pinned predicate:** baseline = the **last attorney-adopted version** (`adopt_ledger`); **export of any version ≠ baseline with an intervening substantive change → warn** (version-drift / regeneration-after-adopt signals only; no LLM-severity dependency). Inc-2 constraint (Inc-1 data core unaffected).
- **Packet inlining — RESOLVED.** `docs/reviews/FOLD-SEND-1_packet.md` did inline all parts (plan in Part 3, code in Part 7, constraints in Part 6, manifest in Part 2). The "only the plan arrived" report was a paste/transmission issue, not a packet defect. **Fix:** paste the entire packet file (not only the plan) to future reviewers.

## Revised increment plan (build order)

- **Inc 1 (CLEARED — build now):** data core — `sendability_rule` + `jurisdiction_rule` + `sendability_override` + **`sendability_evaluation`** + idempotent owner-null seeds; additive migration; per-category telemetry scaffold; `SENDABILITY_GATE_ENABLED` flag **default OFF**. **No behavior change**; reversible PR onto the phase branch.
- **Inc 2:** pure `evaluateSendability` engine — `wrong_matter_id` (block-capable), `stale_baseline` (warn, pinned-predicate), `missing_required_signer/open_execution_item` (warn) + warnings (tone via LLM layer, package completeness, low-confidence match); **fail-to-warn**; **shadow-mode** compute+log; read-only API. Not wired to export enforcement.
- **Inc 3:** wire to the DOCX export boundary behind the flag — **v1 hard-stops only `wrong_matter_id`**; override POST mutation (typed confirm; content-hash-bound; payload snapshot; supersede-on-version) + audit.
- **Inc 4:** UI — "export safety / outbound readiness" block/warn/pass surface + recorded override action + render test.
- **Deferred:** `unverified_statute_citation` block; audience-leak deterministic block; export-intent selector; config UI; flip-to-enforce (operator-gated on shadow-mode FP data).

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
