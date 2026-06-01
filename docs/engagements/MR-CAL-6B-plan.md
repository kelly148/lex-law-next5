# MR-CAL-6B — Locked Decisions, Phase A: Plan

Type: Implementation (Phase A planning document; NO code written yet).
Date: 2026-06-01 (America/New_York).
Repo state: main @ ed7485b (local == origin/main); working tree clean.
Scope authorization: operator approve scope:MR-CAL-6B (granted 2026-06-01).
Predecessor: MR-CAL-6A investigation (docs/engagements/MR-CAL-6A-investigation.md, merged e7bf5f0).

This plan is delivered for operator review BEFORE any implementation. No source has been
modified. On plan acceptance, implementation proceeds in the increments below; Phase B
(push/PR/CI/merge) remains separately gated.

---

## 0. Operator design decisions (settled with Kelly before this plan)

These were chosen by the operator and are the fixed constraints for the build:

1. SCOPE: DOCUMENT-LEVEL ONLY. A locked decision applies only to the document it was made on.
   (The data model will still carry a scope column so matter-level can be added later without a
   destructive migration, but Phase A behavior is document-scoped only.)
2. CAPTURE: TWO entry points — (a) "decline & lock" (record a considered-and-declined suggestion as
   do-not-re-raise; this is the new capability) and (b) "lock on adopt" (mark an adopted suggestion
   as a remembered/locked decision). NO direct standing-entry in Phase A.
3. STRICTNESS: "RESPECT UNLESS NEW FACTS." Reviewers are instructed not to re-raise a locked item
   absent a material new fact; if they re-raise it deliberately, they mark it as persistence rather
   than suppress silently. NOT hard-suppress.

---

## 1. Objective and acceptance criteria (master plan 5.2)

Objective: allow the attorney to lock decisions that reviewers should respect.

Acceptance criteria:
1. Locked decisions have provenance.
2. Reviewer prompt/context receives locked decisions.
3. Reviewers do not re-raise locked issues unless new facts justify it.
4. Attorney can unlock/modify.
5. CI passes.

---

## 2. Key code facts this plan relies on (confirmed by inspection)

- The reviewer system prompt ALREADY contains, verbatim, the "respect unless new facts" rule:
  reviewerPrompts.ts:107 — "Matter-memory awareness: check provided matter context for locked
  decisions and do not re-raise previously resolved or locked decisions absent material change."
  And reviewerPrompts.ts:108 — the persistence rule (persistence_count/persistence_chain). BUT no
  matter context with locked decisions is ever assembled or passed to the reviewer. So strictness
  (3) is largely already authored; Phase A's job is to FEED it the data.
- reviewerPrompts.ts:128 "Mode discipline" currently says to NOT implement matter-memory storage.
  This line is a v1 guard; Phase A will narrow it (allow consuming provided locked decisions) WITHOUT
  turning on persistence storage / sendability / cumulative ledgers (those remain out of scope).
- The reviewer user prompt is built in reviewSession.ts (~209-217) and currently contains only the
  document title + current version content. This is the injection point for a "## Locked Decisions
  (do not re-raise absent new facts)" section.
- Attorney decisions persist today only in feedback_manual_selections (positive-selection only;
  insertManualSelection at phase4b.ts:673). There is NO table that can represent a DECLINED/locked
  item or a lock's rationale/status. That is the core gap Phase A closes.
- All Phase-4b tables use the Zod-Wall read pattern (phase4b.ts) with userId ownership; new table
  must follow the same pattern (Row schema + parse helper + userId-scoped queries).

---

## 3. Data model (additive; no destructive migration)

New table `locked_decisions` (Drizzle, src/server/db/schema.ts), mirroring the existing Phase-4b
table conventions (char(36) ids, userId/documentId scoping, JSON where needed, createdAt/updatedAt):

Columns (Phase A):
- `id` char(36) PK
- `userId` char(36) notNull            — owner/attorney (provenance + Zod-Wall scoping)
- `documentId` char(36) notNull        — the document this lock applies to (DOCUMENT-LEVEL scope)
- `matterId` char(36) notNull          — denormalized for future matter-level rollout + scoping
- `scope` varchar enum ['document']    — Phase A always 'document'; column exists so matter-level
                                          is addable later without migration
- `origin` varchar enum ['declined','adopted']  — how the lock was created (decline&lock vs lock-on-adopt)
- `sourceSuggestionId` varchar(64) nullable      — provenance link to the originating feedback suggestion (nullable for safety)
- `sourceIterationNumber` int nullable           — provenance: which review iteration it came from
- `reviewSessionId` char(36) nullable            — provenance: originating session
- `summary` text notNull               — short attorney-facing statement of the locked decision (what not to re-raise)
- `rationale` text nullable            — attorney's reason (provenance; NOTE: flows to LLM providers — see privacy)
- `status` varchar enum ['active','unlocked'] notNull default 'active'  — unlock = set 'unlocked' (preserve row for audit)
- `createdAt` timestamp notNull default CURRENT_TIMESTAMP
- `updatedAt` timestamp notNull default CURRENT_TIMESTAMP

Indexes:
- `idx_locked_decisions_document` on (documentId, status) — the read path for prompt injection
- `idx_locked_decisions_user_document` on (userId, documentId)
- unique `(documentId, sourceSuggestionId)` WHERE sourceSuggestionId not null — prevents duplicate
  locks for the same suggestion (mirrors the manual-selections unique index pattern)

Migration: additive new table only (drizzle-kit generate). No change to existing tables. Consistent
with the migration-free additive approach used in MR-CAL-4B/5C.

Zod Wall: add `LockedDecisionRowSchema` + `LockedDecisionRow` type in shared/schemas/phase4b.ts,
a `parseLockedDecisionRow` helper and userId-scoped query functions in db/queries/phase4b.ts
(insertLockedDecision, listActiveLockedDecisionsForDocument, updateLockedDecisionStatus).

## 4. Server: write paths (tRPC, on the existing reviewSession router or a sibling)

Two capture actions (per operator decision), both attorney-initiated, both writing only the
attorney's own decision (advisory evaluator never writes here):

- `lockedDecision.declineAndLock({ sessionId, suggestionId, summary, rationale? })`
  - Validates session/doc ownership (existing patterns), resolves the suggestion, writes a
    locked_decisions row with origin='declined', scope='document', status='active', provenance
    fields populated. Emits a telemetry event (new event type, e.g. 'locked_decision_created').
- `lockedDecision.lockOnAdopt({ sessionId, suggestionId, summary?, rationale? })`
  - Same as above with origin='adopted'. May be invoked alongside the existing adopt/selection flow
    (it does NOT replace insertManualSelection; it is additive — adoption still recorded as today).
- `lockedDecision.unlock({ lockedDecisionId })` and `lockedDecision.update({ lockedDecisionId, summary?, rationale? })`
  - Satisfies acceptance criterion 4 (attorney can unlock/modify). Unlock sets status='unlocked'
    (row preserved for audit/provenance); update edits summary/rationale.
- `lockedDecision.listForDocument({ documentId })` — read for the UI.

All mutations go through the existing canonical/ownership patterns; no LLM call is involved in
locking (these are pure DB writes), so no executeCanonicalMutation/job is needed.

## 5. Server: read + prompt injection (the behavioral core)

- In reviewSession.create (reviewSession.ts), BEFORE building each reviewer's userPrompt:
  load `listActiveLockedDecisionsForDocument(documentId, userId)`.
- Build a bounded "## Locked Decisions (do not re-raise absent a material new fact)" section listing
  each active lock's summary (+ origin, + short rationale), and append it to the reviewer userPrompt
  (after document content). Bound the number/length to protect the token budget (e.g. cap count and
  truncate rationale), consistent with the budgeted-context philosophy.
- Narrow reviewerPrompts.ts:128 "mode discipline" so consuming provided locked decisions is allowed
  (the :107 rule already instructs the behavior); do NOT enable persistence storage, sendability, or
  cumulative ledgers. This is a minimal, surgical prompt edit — no scoring/severity/taxonomy change.
- Strictness is "respect unless new facts": we rely on the already-present :107/:108 rules; we do not
  hard-filter reviewer output. (Optional, deferred: surface a deliberate re-raise via the evaluator's
  persistence fields — NOT in Phase A.)

DO-NOT-TOUCH (out of scope for 6B Phase A): evaluator scoring/dispositions logic, severity taxonomy,
business-decision calibration text, the feedback parser/card contract, multi-reviewer gating,
sendability gate, cumulative adopt ledger, matter-level rollout, native feedback-card runtime.

## 6. Client (ReviewPane)

- On each reviewer suggestion: add a "Decline & lock (do not re-raise)" control (captures summary +
  optional rationale) and a "Lock on adopt" affordance alongside the existing adopt/select control.
- A per-document "Locked Decisions" list showing active locks with provenance (origin, source
  suggestion/iteration, who/when) and unlock/modify controls.
- Client-only display; reuses existing tRPC query/mutation hooks. No change to the existing selection
  model or regeneration flow.

## 7. Tests

- Schema/Zod: LockedDecisionRowSchema accepts the canonical shape; rejects bad enums.
- Query layer: insert/list-active/unlock round-trip; userId scoping enforced; unique-suggestion guard.
- Prompt injection (source-audit + unit): reviewSession.create assembles the locked-decisions section
  and passes it into the reviewer userPrompt when active locks exist; omits the section when none.
- Prompt text guard: reviewerPrompts.ts retains the :107 "do not re-raise ... locked decisions" rule
  and the narrowed mode-discipline line still excludes persistence/sendability/ledger.
- Regression: default behavior with NO locked decisions is byte-identical to today (no section added).
- CI is authoritative (no local pnpm/vitest).

## 8. Increments (for implementation, post plan-acceptance)

INCREMENT 1 (server foundation, behavior-preserving when no locks exist):
  schema table + Zod Row + query functions + write mutations (declineAndLock/lockOnAdopt/unlock/
  update/list) + read+inject in reviewSession.create + the narrowed mode-discipline line + tests.
INCREMENT 2 (client): ReviewPane controls + locked-decisions list + provenance display + tests.

Each increment is default-safe: with zero locked decisions, reviewer prompts and behavior are
unchanged from main.

## 9. Acceptance-criteria mapping
1. Provenance — locked_decisions carries userId, origin, sourceSuggestionId, sourceIterationNumber,
   reviewSessionId, timestamps. PASS by design.
2. Reviewer receives locked decisions — read + inject into reviewer userPrompt. PASS by design.
3. No re-raise absent new facts — relies on the already-present :107/:108 reviewer rules now actually
   fed the data; "respect unless new facts" (not hard suppress) per operator decision. Verified live
   at MR-CAL-6C-LIVE.
4. Attorney can unlock/modify — unlock/update mutations + UI. PASS by design.
5. CI passes — gated in Phase B.

## 10. Risks / honest notes
- "Respect unless new facts" is a PROMPT-level instruction to the reviewer LLMs; it is not a hard
  guarantee. A reviewer could still re-raise. That is by design (true blockers must be able to
  surface) and is exactly what MR-CAL-6C-LIVE verifies. The data/injection layer is deterministic and
  testable; the model-adherence layer is verified live.
- PRIVACY: rationale + summary are injected into third-party LLM provider prompts (no redaction layer
  exists; flagged in 6A). UI copy should make clear that lock text is sent to reviewers; avoid
  privileged side-notes in these fields.
- Document-level scope means a lock does not carry to sibling documents; acceptable per operator
  decision and reversible later via the scope column.

## 11. Out-of-scope log (this plan)
No code, schema, migration, or prompt changed. No product decision beyond the three operator-settled
constraints. Phase B (push/PR/CI/merge) and live verification (MR-CAL-6C-LIVE) are separate gates.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
