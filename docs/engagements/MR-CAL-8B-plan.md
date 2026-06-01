# MR-CAL-8B — Sendability Gate, Phase A: Plan

Type: Implementation (Phase A planning document; NO code written yet).
Date: 2026-06-01 (America/New_York).
Repo state: main @ e141565 (local == origin/main); working tree clean.
Scope authorization: operator approve scope:MR-CAL-8B (granted 2026-06-01).
Predecessors: MR-CAL-8A investigation (docs/engagements/MR-CAL-8A-investigation.md, merged b16127d);
patterns proven by MR-CAL-5C evaluator (LLM call + structured output) and 6B/7B (prompt + tRPC + UI).

Delivered for operator review BEFORE any implementation. No source modified. On plan acceptance,
implementation proceeds in the increments below; Phase B (push/PR/CI/merge) remains separately gated.

---

## 0. Operator design decisions (final; settled with Kelly before this plan)

1. ENGINE: LLM CLASSIFIER. A dedicated model call at the checkpoint reads the whole current document
   (+ the latest iteration's reviewer feedback as signal) and returns a structured sendability verdict.
   Built DEFENSIVELY: classifier failure NEVER breaks finalize/export; the verdict is advisory.
2. STRICTNESS: ADVISORY-ONLY, NO GATE. The verdict is displayed; there is no acknowledge step and it
   never blocks finalize/export. Preserves attorney authority by construction.
3. OVERRIDE STORE: NONE in Phase A. No sendability_overrides table, no acknowledge action -> NO new
   DB table -> NO migration -> NO prod-migrate step before 8C-LIVE. (An override store can be added
   later if ever wanted.)
4. UI: BOTH surfaces. A SendabilitySection in ReviewPane (beside 6B locked-decisions + 7B adopt-ledger)
   AND the verdict surfaced at the finalize boundary on DocumentDetail (near the existing
   FinalizeDiagnosticBanner / WorkflowControlsSection).

CONSEQUENCE (honest): with no override record and no acknowledgment, the only trace that the attorney
saw the sendability result is TELEMETRY (a 'sendability_checked' event when the classifier runs).
Acceptable for advisory-only; flagged so it is a conscious choice, not an oversight.

---

## 1. Objective and acceptance criteria (master plan 7.2)

Objective: add an advisory sendability checkpoint.
Acceptance: (1) sendability result visible before finalize/export/send; (2) attorney can override if
appropriate; (3) gate does not silently block; (4) gate preserves attorney decision authority;
(5) CI passes.

Mapping to the chosen design:
- (1) visible before finalize -> shown on the DocumentDetail finalize surface + in ReviewPane.
- (2) "attorney can override if appropriate" -> satisfied trivially: the gate is advisory and imposes
  nothing, so the attorney is free to proceed regardless. (No override RECORD by decision #3; nothing
  to override against because nothing blocks.)
- (3) does not silently block -> it never blocks at all (advisory-only).
- (4) preserves attorney authority -> by construction.
- (5) CI green -> Phase B.

## 2. The classifier (server)

A new read-only tRPC QUERY (no persistence, computed on demand) — NOT wired into finalize itself, so
it cannot affect the finalize transaction (honors advisory-only + "never breaks finalize"):

- Procedure: e.g. `document.checkSendability({ documentId })` on the document4a router (or the
  reviewSession router). protectedProcedure, userId-scoped via getDocumentById.
- Inputs assembled server-side: the current version content (getVersionById on doc.currentVersionId)
  + the latest review iteration's reviewer feedback for signal (listFeedbackForDocument) — the
  classifier sees the actual draft, which the evaluator does NOT (that was the 8A reason to prefer a
  classifier over extending the evaluator).
- Model: EVALUATOR_MODEL (anthropic:claude-opus-4-5; the env-fixed non-attorney-selectable model,
  decision #41) is the natural choice — it is the existing "synthesis/assessment" model. (Open to
  PRIMARY_DRAFTER_MODEL; EVALUATOR_MODEL recommended.)
- New prompt module `src/server/llm/prompts/sendabilityPrompt.ts`: a sendability-classifier system
  prompt enumerating the 8A gate categories (jurisdiction mismatch, missing material terms, unresolved
  blanks, missing party/capacity, conflicting provisions, business decision needed, execution/signature
  defects, counterparty over-disclosure, P8-T7 governing-law blocker) and instructing an ADVISORY,
  non-decisionmaking verdict (it assesses; the attorney decides). Reuses the calibration language
  already in reviewerPrompts.ts (BLOCKER = sendability fail) for consistency.
- Structured output: a `SendabilityVerdictSchema` (shared/schemas) e.g.
  { sendable: boolean, blockers: [{ category, severity, summary }], notes?: string }, enforced via the
  adapter's structuredOutputSchema (same mechanism as the evaluator; mind the Anthropic
  object-vs-array normalization fix from MR-CAL-5D — an object-shaped schema is fine post-fix).
- A tolerant parser `sendabilityOutputParse.ts` (mirrors evaluatorOutputParse): on malformed output,
  THROW -> the query returns a typed "unavailable" result (NOT an exception that breaks the client),
  so a flaky/parse-failing classifier degrades to "sendability check unavailable, proceed with
  attorney judgment" rather than an error. This directly addresses the reviewer-reliability problems
  seen live in 5D/6C/7C.
- Timeout: explicit 300_000 ms (lesson from MR-CAL-5D; do NOT inherit the 120s default).
- Telemetry: 'sendability_checked' ({ sendable, blockerCount, blockerCategories }) — the only audit
  trace per decision #3.

DO-NOT-TOUCH: the finalize/acceptSubstantive/acceptSubstantiveUnformatted procedures themselves are
NOT modified (the classifier is a separate query the client calls); no change to locked_decisions/6B,
adopt_ledger/7B, evaluator scoring, reviewer scoring/taxonomy, the feedback parser/card contract,
multi-reviewer gating.

## 3. Client (UI — both surfaces)

- A `useSendability(documentId)` hook calling the new query (lazy/on-demand; not auto-run on every
  render — triggered when the review pane opens its section and when the finalize surface mounts).
- SendabilitySection in ReviewPane.tsx (beside LockedDecisionsSection + AdoptLedgerSection): renders
  the verdict — a clear sendable / not-yet badge, the blocker list (category + severity + summary),
  and an explicit "Advisory only — you decide; this does not block finalize" note. A manual "Re-check"
  control (since it is on-demand).
- DocumentDetail.tsx finalize surface (near FinalizeDiagnosticBanner / WorkflowControlsSection): show
  the same verdict (compact) so it is visible at the actual send boundary. It does NOT disable or gate
  the Finalize / Accept Substantive buttons (advisory-only).
- Loading + "unavailable" states handled gracefully (classifier may be slow/unavailable).

## 4. Tests
- Schema: SendabilityVerdictSchema accepts the canonical shape; rejects bad blocker severity/category.
- Parser: sendabilityOutputParse tolerates wrapped/object output; throws on malformed (caller degrades
  to "unavailable").
- Prompt: sendability system prompt is advisory/non-decisionmaking and enumerates the gate categories.
- Source-audit (reviewSession/document4a + ReviewPane + DocumentDetail): the query exists; finalize
  procedures are UNCHANGED (assert no gating added); the verdict surfaces in BOTH UI places; advisory
  note present; finalize buttons not disabled by sendability.
- Default-safe / no-regression: the new query is additive; nothing in the existing finalize/review
  paths changes behavior. (No create-path mock-stub issue this time, since the classifier is a new
  standalone query — but verify no existing test calls the finalize path in a way that now hits it.)
- CI authoritative (no local pnpm/vitest).

## 5. Increments
INCREMENT 1 (server): SendabilityVerdictSchema + sendabilityPrompt.ts + sendabilityOutputParse.ts +
the checkSendability query (EVALUATOR_MODEL, 300s timeout, degrade-to-unavailable on parse failure) +
telemetry + tests. Purely additive; no existing procedure changed.
INCREMENT 2 (client): useSendability hook + SendabilitySection in ReviewPane + the verdict on the
DocumentDetail finalize surface + tests. No gating of finalize.

## 6. Risks / honest notes
- LLM-CLASSIFIER RELIABILITY: a new model call inherits the provider-reliability issues seen live this
  session (GPT-Lite parse errors, slow/timeout runs; Gemini bad JSON). Mitigations baked in: advisory-
  only (never blocks), best-effort (degrade to "unavailable", never throw to the finalize path),
  explicit 300s timeout, object-schema parse-fix (5D) in play. Net: a failed classifier shows
  "sendability check unavailable," it never harms finalize.
- COST/LATENCY: an extra Opus call per check. Mitigated by on-demand (not auto-run) + manual re-check.
- ADVISORY VERDICT IS NON-DETERMINISTIC: the model may differ run-to-run. That is acceptable for an
  advisory aid; 8C-LIVE acceptance ("known blocker detected; non-blocker not over-escalated") is a
  behavioral check, inherently probabilistic — note this for the live verify.
- NO AUDIT TRACE beyond telemetry (decision #3). Re-stated for the operator.
- PRIVACY: the whole document already flows to LLM providers on draft/review; the classifier adds no
  new data class (same posture as existing reviewer/evaluator calls).

## 7. Acceptance-criteria mapping (7.2)
1. Result visible before finalize -> DocumentDetail finalize surface + ReviewPane. By design.
2. Attorney can override -> advisory-only imposes nothing; attorney proceeds freely. By design.
3. Does not silently block -> never blocks. By design.
4. Preserves attorney authority -> by construction (advisory, non-decisionmaking prompt).
5. CI passes -> Phase B.

## 8. Out-of-scope log (this plan)
No code/schema/migration/prompt changed. No new table (decision #3) -> no migration. Finalize
procedures untouched. No override store, no hard/soft gate. The aggregator alternative, an override
table, and any finalize-gating are explicitly out of scope for this Phase A. MR-CAL-8C-LIVE (live
verify) is a separate gate.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
