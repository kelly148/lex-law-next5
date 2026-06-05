# FOLD-SEND-1 — Phase-A plan (sendability: advisory classifier → deterministic block/warn/pass gate)

**Engagement:** FOLD-SEND-1 · **Type:** Implementation · **§3.1 checkpoint:** FIRE (advisory→blocking sendability gate; client-send-safety + decision-authority). **Status:** plan for external triad review — *no code written.*

---

## 1. One-paragraph context

Whereas is an attorney-supervised legal-AI drafting/review platform (matter → materials → draft → calibrated reviewer passes → attorney decides → finalize). The fold has shipped Layer-0 intake/conflicts, the practice knowledge base, multi-model orchestration, and (just now, on prod) the FOLD-DRAFT-1 drafting primitives (provision provenance, LOI-vs-draft diff, closing package). FOLD-SEND-1 is the last Phase-3 engagement: upgrade **sendability** from today's *advisory LLM classifier* (surfaces possible problems; never blocks anything) to a *deterministic block / warn / pass gate* that can actually **stop** an outbound document on objective, machine-checkable conditions, with an attorney override that is recorded. This is the decision-authority change that makes it a FIRE.

## 2. Current state (confirmed by code inspection 2026-06-05)

- **`reviewSession.checkSendability`** (tRPC query, `src/server/procedures/reviewSession.ts`): runs an **LLM** (`EVALUATOR_MODEL` = `anthropic:claude-opus-4-5`) over the current draft + latest reviewer feedback and returns an **advisory** verdict `{ sendable: boolean, blockers: [{category, severity, summary}], notes? }`. It is a **read-only QUERY** — no persistence, no job row, **degrades to `{available:false}`** on any failure, and is **NOT wired into finalize/export**. The only trace is a `sendability_checked` telemetry event.
- **Categories** (LLM, subjective — `SENDABILITY_BLOCKER_CATEGORY_VALUES`, `src/shared/schemas/phase4b.ts`): `jurisdiction_mismatch`, `missing_material_terms`, `unresolved_blanks`, `missing_party_or_capacity`, `conflicting_provisions`, `business_decision_needed`, `execution_signature_defect`, `counterparty_over_disclosure`, `other`. Severity vocabulary: `BLOCKER/SUBSTANTIVE/STRUCTURAL/PRECISION/POLISH`.
- **UI:** a "Sendability (advisory — does not block finalize)" panel with a "Check sendability" button (review pane).
- **Egress surface:** the only way a document leaves the system today is **`GET /api/documents/:documentId/export`** — a synchronous DOCX export (Phase 6), emits `document_exported`. It is **ungated**. There is **no "send"/email** in the product.
- **Scaffolded-but-unused:** `outboundEligible` / `sendabilityRequired` boolean columns exist on the matter-analysis/state surface (never enforced).
- **No `sendability_rule` / `jurisdiction_rule` tables exist** (the deferral map assigns both to FOLD-SEND).

## 3. Target (per master plan F.5 / acceptance)

> Upgrade sendability from the advisory classifier to the target **block/warn/pass** deterministic gate. **Blocks:** wrong matter ID, stale baseline, missing required signer/open execution item, unverified statute citation in outbound legal assertion. **Warnings:** tone, optional package completeness, low-confidence library match. *Acceptance: defined deterministic categories block; non-blockers warn; attorney override recorded.*

## 4. Proposed design (the thing to pressure-test)

**4.1 A pure deterministic engine** `evaluateSendability(ctx) → { verdict: 'block'|'warn'|'pass', blocks: Block[], warnings: Warning[] }` in `src/server/send/` — no LLM, no I/O; fed structured context assembled by a query wrapper. Each **block** is computed from a machine-checkable source:
- **wrong_matter_id** — the document/version's `matterId` vs the matter it's being exported under (and matter title/parties present). Deterministic.
- **stale_baseline** — the current version is not the reviewed/adopted baseline: open *substantive* items in `open_items`, or a regeneration after the last adopt-ledger entry, or version-number drift. Deterministic from `versions` + `open_items` + `adopt_ledger`.
- **missing_required_signer / open_execution_item** — an execution-class `open_item` is still open, or a required signer/notary block for the document type is absent. Deterministic from `open_items` (execution category) + matter state.
- **unverified_statute_citation** — *the hard one (see §5.2).* Deterministically extract citation-shaped tokens from the draft; if an outbound legal assertion cites a statute not marked verified (cross-checked against `source_authority` tier-1 / an attorney "verified" flag), block.

**Warnings** (non-blocking): tone (reuse the existing LLM advisory classifier as the *warn* layer), optional package completeness (reuse FOLD-DRAFT-1 `closurePackage.getClosureCheck`), low-confidence library/KB match.

**4.2 Data model (additive, nullable owner key).**
- `sendability_rule` — which deterministic checks are enabled and at what verdict (block vs warn), owner-scoped, defaulting to a built-in firm-level rule set; lets the attorney down-rank a block to a warning per matter/document-type without a migration.
- `jurisdiction_rule` — per-jurisdiction execution formalities (e.g., VA vs MD witness/notary requirements) feeding `missing_required_signer`. Seeded read-only; attorney-extensible.
- `sendability_override` — records an attorney override of a block: who, when, which block(s), free-text reason. Append-only; audited.

**4.3 Attachment point.** Gate the **export endpoint** (`/api/documents/:id/export`): on `block`, return the blocks and refuse the export **unless** an `sendability_override` exists for that version+block set; `warn`/`pass` export freely. The override is the recorded attorney decision. (Self-use only; not client-facing yet.)

**4.4 Keep the LLM classifier** as the advisory *warn* layer (tone/soft signals) — clearly separated from the deterministic *block* layer, so a flaky model can never block (degrade-to-unavailable preserved) and a block is never an LLM judgment.

**4.5 Safety / rollout.** Feature flag `SENDABILITY_GATE_ENABLED` **default OFF**; additive migrations only; deterministic engine unit-tested across block/warn/pass; export-gating behind the flag; live-verify before enabling. The attorney is always the final decision-maker (override always available + recorded).

## 5. Open decisions for the triad (ranked)

1. **What "block" should block.** There is no real "send" — DOCX export is the only egress. Is gating export the right surface, or should block attach to a future "send/share" action and leave self-export ungated? (Self-use caveat: client-facing is gated on the broader fold, not this engagement.)
2. **The `unverified_statute_citation` category — can it be deterministic without unacceptable false positives/negatives?** Options: (a) extract citations + require an attorney "verified" mark (deterministic but manual); (b) cross-check against `source_authority` tier-1; (c) **defer this one category** to a later increment and ship the other three blocks first. Recommend a view from reviewers.
3. **Override model.** Block-overridable-with-recorded-reason (proposed) vs hard-block-for-some-categories. Records-management + client-send-safety.
4. **Rule data model.** Attorney-configurable `sendability_rule`/`jurisdiction_rule` vs hardcoded categories for v1. Per-matter vs firm-level. Seeding jurisdiction formalities (VA/MD) safely.
5. **Keep vs retire the LLM advisory classifier.** Proposed: keep as the warn layer. Or fold its signals into warnings differently.
6. **Interaction with GOV-1b egress + the deferred FOLD-DRAFT-1 audience-leak filter**, which "ride FOLD-SEND-1." Does the leak filter belong in this gate as a block category, or stay separate?

## 6. Increment plan (after triad disposition; each reversible build-and-PR onto the phase branch)

- **Inc 1** — data core: `sendability_rule` + `jurisdiction_rule` + `sendability_override` schemas/tables/queries (additive migration); seed the built-in rule set + VA/MD jurisdiction formalities. No behavior change.
- **Inc 2** — the pure `evaluateSendability` engine + the three tractable deterministic blocks (matter-id, stale-baseline, missing-signer/execution) + warnings, fully unit-tested. Read-only `getSendabilityGate` API. Not wired to export.
- **Inc 3** — wire the gate to the export endpoint behind `SENDABILITY_GATE_ENABLED` (default OFF) + the override record/flow + audit.
- **Inc 4** — UI: block/warn/pass surface + the override action (recorded) + render test.
- **(statute-citation block: separate increment or deferred per decision §5.2.)**

## 7. Constraints honored

Additive only (no destructive migration); attorney always final (override always available + recorded); no title/settlement scope; single-operator now with a nullable owner key; feature flag default OFF; deterministic blocks never an LLM judgment; the advisory classifier's degrade-to-unavailable is preserved. CI cannot judge send-safety correctness — hence this review.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
