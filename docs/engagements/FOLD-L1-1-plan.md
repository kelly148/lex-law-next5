# FOLD-L1-1 — Phase-A Design Plan: Layer-1 Matter-State Engine

Engagement: FOLD-L1-1 (Whereas fold Phase 2 / F.4). Type: Implementation (design artifact — pre-implementation). Checkpoint: **§3.1 FIRE** (establishes the load-bearing Layer-1 data model + read contract; hard to reverse, not CI-caught, access-control/privilege risk). Status: **plan drafted; auto-assembled into `docs/reviews/FOLD-L1-1_packet.md`; HALTED for external triad review before any implementation.** Gate G5.
Date: 2026-06-02. Repo: `fold/phase-2` branched from `main` `6e486b0`.

> This is a **design proposal for review**, not a built artifact. No code is written until the triad disposition returns and the operator directs adopt/reject/blend. The attorney is the final decision-maker; the engine surfaces state, it never makes business or legal decisions.

---

## 1. Objective

Unify the currently-separate MR-CAL persistence pieces into one coherent **Matter-State Engine** — a single owner-scoped read surface that can reliably answer, for a given matter:

1. **current-matter** — identity/anchor (which matter, its phase).
2. **operative-document** — which document/version is the live baseline.
3. **locked-decisions** — the active locked decisions in force.
4. **adopted** — what has been adopted (and whether it survived into the current draft).
5. **unresolved** — open items / blockers still requiring attorney action.
6. **source-currency** — the source-of-truth tier/authority of the materials in play.
7. **safe-to-send** — the current (advisory, MR-CAL-8C) sendability posture, surfaced as state.

Per the master plan, FOLD-L1-1 builds the **engine + data model + read API**. The *injection* of this state into every model call is **FOLD-L1-2** (not this engagement); the shared-context substrate is L1-3; the template registry L1-4; the five explicit acts + dashboard UI is L1-5.

## 2. Current substrate (from a code map, 2026-06-02)

**Already built (owner-scoped via `ownerScope`/`assertOwned`, additive migrations 0002–0004):**
- `locked_decisions` (0002) — document-scoped, denormalized `matterId`; `status active|unlocked`; injected into reviewer prompts via `listActiveLockedDecisionsForDocument()`.
- `adopt_ledger` (0003) — document-scoped, denormalized `matterId`; `status unresolved|active|superseded|resolved`, `statusSource auto|attorney` (auto-detection never overwrites attorney); survival heuristic is **advisory**.
- `audit_events` (0004) — **append-only** immutable Matter Record; matter-scoped; 9 event types, 3 actors; written best-effort via `recordAuditEvent()`.
- `feedback_evaluations` — evaluator dispositions (JSON), **advisory**, per-iteration (no cross-iteration history).
- Sendability (MR-CAL-8C) — **advisory verdict, NOT persisted**; real-time UI only; 9 blocker categories × 5 severities.
- `context/pipeline.ts` — `contextPriority: 'pinned'|'recency'` (FOLD-TIER-1 rename) = **context-window** priority, distinct from source-of-truth authority.
- `matters` (phase, archivedAt), `matter_materials` (pinned, deletedAt, extractionStatus).

**Not yet built (this engagement's net-new):**
- **Source-of-truth tier / authority** (FOLD-PERSIST-1 deferred the `Source` schema here, carrying the tier-name-collision constraint).
- **Open-item registry** (sendability blockers are not persisted; no lifecycle).
- **Disposition history** (no cross-iteration attorney decision record).
- A **unified matter-state read surface** (the four built pieces are read piecemeal, document-scoped).

## 3. Proposed design (additive, owner-scoped, default-safe)

### 3.1 Matter-State read surface (the "engine")
A read-only aggregation service `src/server/matterState/` + a tRPC `matterState.get(matterId)` (protected, owner-scoped) that composes the existing queries (locked decisions, adopt ledger, audit events, evaluator dispositions, sendability-on-demand) into one typed `MatterState` answering the §1 questions. **No new authority** — it reads existing tables + the new ones below. Document-vs-matter rollup uses the existing denormalized `matterId`.

### 3.2 Source-of-truth tiers (net-new; honors the FOLD-TIER-1 collision constraint)
A `source_authority_tier` concept **distinct from `contextPriority`**. Proposed (FORK A) as an additive column on `matter_materials` (and later document versions) — e.g. `operative | current_draft | counterparty | superseded | reference` — NOT reusing the pinned/recency names. The engine reports source-currency from this.

### 3.3 Open-item registry (net-new)
A new additive table `open_items` (owner+matter scoped): `{ id, userId, matterId, documentId?, category, severity, summary, status: open|resolved|withdrawn, statusSource: auto|attorney, sourceEvent?, createdAt, updatedAt }`. Which sendability blocker categories escalate to persistent open items, and the lifecycle, is **FORK B**. Default-safe: auto-detection never closes an attorney-opened item (mirrors adopt-ledger `statusSource`).

### 3.4 Disposition history (net-new)
Either a new `dispositions` table or an extension capturing the **attorney decision** (accept/override) on evaluator dispositions and open items, across iterations (the current `feedback_evaluations` is per-iteration advisory). **FORK C**.

### 3.5 Scope, migrations, safety
- **Additive only.** New migration(s) `0005+` creating `open_items` (+ any disposition table) and adding `source_authority_tier`. **No destructive/altering migration of existing tables' data.** Out-of-band prod apply (carryforward DEPLOY-MIGRATIONS-NOT-AUTOMATIC; migration 0004 also still pending prod apply).
- **Owner-scoped** via `ownerScope`/`assertOwned` (CI ratchet enforces no inline `eq(...userId)`).
- **Attorney-final / default-safe**: the engine reports; it never auto-resolves, auto-adopts, or auto-sends. Auto-detection is advisory and never overwrites attorney state.
- **Scope line**: transactional document-assembly only (E-2). No new external/egress contract (egress posture is FOLD-GOV-1b, parked).

## 4. Acceptance (from the master plan)
The engine reliably answers: current-matter / operative-document / locked-decisions / adopted / unresolved / source-currency / safe-to-send — owner-scoped, additive, with the source-tier name disambiguated from `contextPriority`.

## 5. Forks for the triad (the load-bearing decisions to pressure-test)
- **FORK A — source-of-truth tier model & taxonomy**: column on `matter_materials` vs a dedicated `sources` table (the deferred PERSIST-1 `Source` schema); the tier vocabulary; how it propagates through context assembly. (Records-management + correctness.)
- **FORK B — open-item registry**: which sendability blocker categories become persistent open items; the lifecycle (open→resolved→withdrawn); auto-vs-attorney resolution. (Client-send-safety.)
- **FORK C — disposition history shape**: new table vs extend `feedback_evaluations`; what the attorney decision record captures. (Audit/records.)
- **FORK D — matter- vs document-scope**: locked_decisions/adopt_ledger are document-scoped with denormalized `matterId`; does L1 roll them up at matter level, and does that change any write path? (Data model.)
- **FORK E — privilege/access**: the aggregated matter state concentrates privileged content under one read surface; confirm owner-scoping is sufficient at single-operator scale and that this doesn't pre-empt FOLD-GOV-1b egress decisions.

## 6. Explicitly NOT in FOLD-L1-1 (deferred to later Phase-2 engagements)
Matter-state **injection** into model calls (FOLD-L1-2); shared-context substrate (L1-3); reusable-template registry (L1-4); the five explicit acts (lock/tier/disposition/send/matter-identity) as deliberate UI commitments + the matter-state dashboard (L1-5).

## 7. Constraints honored
Additive-only; owner-scoped chokepoint; attorney always final; default-safe (no auto-resolve/adopt/send); no destructive migration; transactional-document-assembly scope; no new egress contract.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
