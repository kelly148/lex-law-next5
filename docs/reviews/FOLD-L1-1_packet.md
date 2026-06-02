# External Triad-Review Packet — FOLD-L1-1 (Layer-1 Matter-State Engine)

> **Self-contained.** Everything a reviewer needs is inlined below — the decision, the prompt, the design plan, the relevant schema, and the binding constraints. **No repo access required.** Hand parts 1–3 + the inlined design (§A) and schema (§B) to a fresh GPT-5 chat and a fresh independent Claude chat.

---

## ⏸ EXTERNAL-REVIEW CHECKPOINT — FOLD-L1-1 — [S] — the Layer-1 matter-state data model + read contract that every later layer rides

## 1. Decision under review

Whether to build the **Layer-1 Matter-State Engine** as proposed: a single owner-scoped read surface that unifies the already-built MR-CAL pieces (locked decisions, adopt ledger, append-only audit events, advisory evaluator, advisory sendability) and adds three net-new persisted concepts — **source-of-truth tiers**, an **open-item registry**, and **disposition history** — so the engine can answer current-matter / operative-document / locked-decisions / adopted / unresolved / source-currency / safe-to-send. This fixes a load-bearing data model and a privileged-content read surface that is **costly to reverse once matters depend on it**; CI cannot judge whether the model is correct for a legal product. We want the design pressure-tested **before any code or migration is written**.

## 2. Ready-to-paste reviewer prompt

> You are an independent senior reviewer. You did **not** write what follows and you are not on the team that did. You're reviewing **one design decision** in an attorney-supervised legal-AI build (product "Whereas," build repo `lex-law-next5`). I'm Kelly — the managing attorney and product owner. I am **not** a software developer. The primary builder is a separate Claude Code instance. Your job is to **pressure-test the attached plan before we write code** and tell me, concretely, what you would change and why. Do not rubber-stamp; do not pad.
>
> **Where we are:** MR-CAL is complete; Phase 1 of the fold (auth + owner key, tier-name rename, audit Matter Record, retention scaffold) is on `main`. This is the first Phase-2 engagement: **FOLD-L1-1, the Layer-1 Matter-State Engine** — the substrate Layers above it (injection, shared context, intake, knowledge base, sendability hard gate) all depend on.
>
> **The decision under review:** how to model and expose matter state — specifically (a) the source-of-truth tier model, (b) the open-item registry + lifecycle, (c) disposition history, (d) matter- vs document-scope rollup, and (e) the privilege/access posture of a single aggregated read surface over privileged content. The full plan and the existing schema are inlined below (§A, §B).
>
> **Please return, in this order:**
> 1. **Top risks or flaws** in this plan, ranked.
> 2. **Specific changes** you would make, each with its rationale — especially on the five forks (A source-tier model, B open-item registry, C disposition history, D matter-vs-document scope, E privilege/access).
> 3. **Omissions** — what a production legal-AI matter-state model needs here that the plan doesn't address.
> 4. **Keep list** — what you would explicitly NOT change, so I don't over-correct.
> 5. **Bottom line** — one of: *proceed as-is* / *proceed with the named changes* / *stop and rethink*.
>
> **Constraints to respect (flag any violation):** additive only, no destructive migrations; the attorney is always the final decision-maker (the engine reports state, it never auto-resolves/auto-adopts/auto-sends); single-operator now with a **nullable owner key** so a second attorney can be added later without a migration; transactional document-assembly scope only (no title/settlement, no litigation/M&A/advisory); the **source-of-truth "tier" must stay distinct from the context-window `contextPriority`** (pinned/recency) — do not conflate them; reviewers/engine surface options, never make business decisions.

## 3. Document manifest (all inlined below — no repo access needed)

| Item | Why it's needed | Where |
| :-- | :-- | :-- |
| FOLD-L1-1 Phase-A design plan | the artifact under review | §A |
| Existing schema excerpts (locked_decisions, adopt_ledger, audit_events, feedback_evaluations, matters/materials, contextPriority, ownerScope) | so the reviewer sees what's already built and what's net-new | §B |
| Binding governance constraints (CLAUDE.md / master plan) | so reviewers don't propose out-of-bounds changes | §C |

---

## §A — FOLD-L1-1 Phase-A design plan (inlined)

*(Full text of `docs/engagements/FOLD-L1-1-plan.md`.)*

**Objective.** Unify the separate MR-CAL persistence pieces into one owner-scoped **Matter-State Engine** read surface answering, per matter: current-matter; operative-document; locked-decisions; adopted (and survival); unresolved (open items/blockers); source-currency (source-of-truth tier); safe-to-send (advisory sendability as state). FOLD-L1-1 builds the **engine + data model + read API**; injection into model calls is FOLD-L1-2; shared-context substrate L1-3; template registry L1-4; the five explicit acts + dashboard UI L1-5.

**Proposed design (additive, owner-scoped, default-safe).**
- **3.1 Read surface:** `src/server/matterState/` + tRPC `matterState.get(matterId)` (protected, owner-scoped) composing existing queries into one typed `MatterState`. No new authority; reads existing + new tables; document→matter rollup via existing denormalized `matterId`.
- **3.2 Source-of-truth tiers:** a `source_authority_tier` concept **distinct from `contextPriority`** (proposed additive column on `matter_materials`/versions; e.g. `operative | current_draft | counterparty | superseded | reference`) — honors the FOLD-TIER-1 collision constraint and the FOLD-PERSIST-1 deferral of the `Source` schema to FOLD-L1. **[FORK A]**
- **3.3 Open-item registry:** new additive `open_items` table (owner+matter scoped): `{id, userId, matterId, documentId?, category, severity, summary, status: open|resolved|withdrawn, statusSource: auto|attorney, sourceEvent?, timestamps}`; which sendability blockers escalate + lifecycle is **[FORK B]**; auto-detection never closes an attorney-opened item.
- **3.4 Disposition history:** new table or extension capturing the **attorney decision** (accept/override) on evaluator dispositions + open items across iterations (current `feedback_evaluations` is per-iteration advisory). **[FORK C]**
- **3.5 Scope/migrations/safety:** additive migration(s) `0005+` (create `open_items` [+ disposition table], add `source_authority_tier`); **no destructive/altering migration of existing data**; out-of-band prod apply; owner-scoped via `ownerScope`/`assertOwned`; attorney-final/default-safe (engine reports, never auto-resolves/adopts/sends); transactional-doc-assembly scope; no new egress contract (FOLD-GOV-1b parked).

**Acceptance.** Engine reliably answers current-matter / operative-document / locked-decisions / adopted / unresolved / source-currency / safe-to-send; owner-scoped; additive; source-tier name disambiguated from `contextPriority`.

**Forks (load-bearing):** A source-tier model/taxonomy (column vs dedicated `sources` table); B open-item registry categories + lifecycle; C disposition-history shape; D matter- vs document-scope rollup + any write-path change; E privilege/access of the aggregated read surface at single-operator scale (must not pre-empt FOLD-GOV-1b egress decisions).

**NOT in L1-1:** injection (L1-2), shared-context substrate (L1-3), template registry (L1-4), the five explicit acts UI + dashboard (L1-5).

---

## §B — Existing schema excerpts (inlined; what's already built)

**`locked_decisions`** (migration 0002, owner-scoped): `id, userId, documentId, matterId(denormalized), scope('document'), origin('declined'|'adopted'), sourceSuggestionId?, sourceIterationNumber?, reviewSessionId?, summary, rationale?, status('active'|'unlocked'), timestamps`. Active locks injected into reviewer prompts. Unlock preserves the row (audit).

**`adopt_ledger`** (migration 0003, owner-scoped): `id, userId, documentId, matterId(denormalized), sourceSuggestionId, sourceReviewerRole, sourceIterationNumber, reviewSessionId, disposition('adopted_verbatim'|'adopted_modified'), originalText, adoptedText, adoptedIntoVersionId, producedVersionId?, status('active'|'superseded'|'resolved'|'unresolved'), statusSource('auto'|'attorney'), timestamps`. Survival heuristic is advisory; **auto never overwrites attorney status**.

**`audit_events`** (migration 0004, **append-only**, owner+matter-scoped): `id, userId, matterId, documentId?, eventType('model_output'|'adopted'|'rejected'|'locked'|'unlocked'|'sent'|'withheld'|'authority_verified'|'judgment_required'), actor('model'|'attorney'|'system'), actorModel?, summary, payload(JSON)?, reviewSessionId?, sourceSuggestionId?, versionId?, createdAt` (no updatedAt). Written best-effort via `recordAuditEvent()` (never throws).

**`feedback_evaluations`** (advisory): `id, userId, documentId, iterationNumber, jobId, dispositions(JSON: [{suggestionId, disposition:'adopt'|'reject'|'neutral', synthesisBody?}])`. Per-iteration; **no cross-iteration history**.

**Sendability (MR-CAL-8C, advisory, NOT persisted):** verdict `{sendable, blockers:[{category, severity, summary}], notes?}`; 9 categories (jurisdiction_mismatch, missing_material_terms, unresolved_blanks, missing_party_or_capacity, conflicting_provisions, business_decision_needed, execution_signature_defect, counterparty_over_disclosure, other) × 5 severities (BLOCKER/SUBSTANTIVE/STRUCTURAL/PRECISION/POLISH).

**Context pipeline:** `IncludedMaterial.contextPriority: 'pinned'|'recency'` = **context-window** priority (NOT source authority). Assembly order: pinned → explicit siblings → recency, within a token budget.

**`matters`:** `id, userId, title, clientName, practiceArea, phase('intake'|'drafting'|'complete'), archivedAt?, completedAt?`. **`matter_materials`:** `id, userId, matterId, filename, mimeType, textContent, extractionStatus, tags(JSON), pinned(bool), deletedAt?`.

**Owner-scoping (FOLD-AUTH-1):** `ownerScope(table.userId, userId)` is the single filter chokepoint; `assertOwned(row, userId)` throws NOT_FOUND on mismatch; a CI ratchet freezes inline `eq(...userId)` counts. The owner key is nullable to allow a 2nd attorney later without migration.

**NOT yet built:** source-of-truth tier/authority; open-item registry; cross-iteration disposition history; a unified matter-state read surface.

---

## §C — Binding governance constraints (inlined)

- **Attorney is always the final decision-maker.** The engine surfaces state and options; it never makes or alters a business/legal decision, never auto-resolves/auto-adopts/auto-sends.
- **Additive only; no destructive migrations.** Existing tables' data is not altered; new tables/columns only. Prod migrations are applied out-of-band (manual), never automatically.
- **Owner-scoped, private-by-default**, nullable owner key (2nd attorney later, no migration). No RBAC/org/multi-tenant.
- **Scope line:** transactional document-assembly only — title/settlement, litigation/M&A, pure-advisory are OUT.
- **Tier-name discipline:** source-of-truth "tier/authority" must stay distinct from the context-window `contextPriority` (pinned/recency).
- **Privilege minimization:** default to less egress; the aggregated read surface must not pre-empt the parked FOLD-GOV-1b privilege-egress decisions.

---

**Reviewer logistics:** open a fresh GPT-5 chat and a fresh independent Claude chat (not the build session); paste parts 1–3 + §A/§B/§C into each; bring both reviews back and direct adopt/reject/blend. **This checkpoint is a hard stop** — no implementation code or migration is written for FOLD-L1-1 until the operator returns a disposition. Claude Code did **not** self-run or self-approve this review.
