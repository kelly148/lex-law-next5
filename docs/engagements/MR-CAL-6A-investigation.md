# MR-CAL-6A — Matter Memory: Investigation

Type: Investigation only (read-only; no code changed).
Date: 2026-06-01 (America/New_York).
Repo state at investigation: main @ 24b75a8 (local == origin/main); working tree clean.
Evidence class: confirmed by code inspection unless explicitly marked otherwise.

---

## 0. Objective

Define what a future "matter memory" feature should store, and answer the master-plan design
questions, grounded in what the codebase already provides. Per the master plan (section 5.1),
acceptance is: (1) data-model options surfaced; (2) UI/provenance requirements surfaced;
(3) privacy/security implications flagged; (4) implementation path scoped.

Matter memory = a persistent, attorney-owned record of decisions and resolved issues for a
matter, fed back into later reviewer/drafter prompts so the system stops re-raising settled
points and respects the attorney's established choices (jurisdiction, business structure,
negotiation posture, "do not re-raise" items).

This is an investigation: it surfaces options and a scoped path. It does NOT decide the product
design or authorize implementation. MR-CAL-6B (locked decisions Phase A) and later are separate,
each gated on operator scope approval.

---

## 1. What already exists (foundation to build on)

Confirmed by code inspection. Schema references are `src/server/db/schema.ts`.

### 1.1 Decision / feedback persistence (document-iteration scoped)
- `feedback` (schema.ts ~830-855): one row per reviewer per document iteration; `suggestions`
  is a JSON array (title, body, severity). Captures everything reviewers proposed.
- `feedback_evaluations` (schema.ts 857-875): the advisory evaluator's output for an iteration;
  `dispositions` JSON array of `{ suggestionId, disposition, synthesisBody? }`. Advisory only —
  it never records the attorney's final decision (MR-CAL-5C). Indexed on (documentId, iterationNumber).
- `feedback_manual_selections` (schema.ts 877-902): THE attorney-decision table today. One row
  per adopted suggestion: `userId, documentId, iterationNumber, reviewSessionId, suggestionId,
  attorneyNote (nullable text), createdAt`. Positive-selection only (R5): an adopted suggestion
  gets a row; a rejected one is the ABSENCE of a row (no explicit rejection record). Unique index
  on (reviewSessionId, suggestionId); also indexed on (documentId, iterationNumber).
- `review_sessions` (schema.ts ~923-969): per-iteration session container; `selections` JSON,
  `selectedReviewers`, `globalInstructions`, `state` (active|regenerated|abandoned).

All Phase-4b tables are read through a single Zod-Wall path (`src/server/db/queries/phase4b.ts`),
which validates every row against its Row schema and enforces `userId` ownership.

### 1.2 Context assembly (where memory would be injected)
- `src/server/context/pipeline.ts` `assembleContext()` (R14, single authoritative path) builds
  context under a per-operation token budget (e.g. draft_generation/regeneration 80K, review 60K),
  in tiers: (1) pinned materials, (2) explicit sibling documents, (3) non-pinned materials by recency,
  truncating to budget.
- Reviewer prompt (`src/server/procedures/reviewSession.ts` ~209-217) currently includes ONLY the
  current document content — not materials, not prior decisions.
- Drafter/regeneration prompt (reviewSession.ts `_invokeDocumentRegenerate` + documents4a.ts)
  includes client name, current draft, attorney instructions, assembled materials, sibling refs.
- Evaluator prompt (`src/server/llm/prompts/evaluatorPrompt.ts`) includes only the iteration's
  reviewer feedback rows.
- CONFIRMED GAP: nothing queries `feedback_manual_selections` (prior adopted decisions) to inject
  them into any later prompt. Each iteration's decisions do not travel forward except as they are
  already baked into the regenerated draft text.

### 1.3 Provenance / audit
- Every decision row carries `userId` (the attorney). `feedback_manual_selections.attorneyNote`
  is the only free-text rationale field today.
- Telemetry (`src/shared/types/telemetry.ts`; emitted across reviewSession.ts) records attorney
  actions: `review_selection_changed` (added/removed adoptions), `regeneration_started`,
  `review_session_abandoned`, etc., each with userId/matterId/documentId/jobId.
- `jobs.input` / `jobs.output` persist the full prompt + LLM output per job (immutable
  `promptVersion` captured at creation), giving an audit trail of exactly what context each model saw.

### 1.4 Matter vs document structure
- `documents.matterId` FK: a document belongs to exactly one matter.
- Matter-level state today is metadata only: `title, clientName, practiceArea, phase, archivedAt,
  completedAt` (schema.ts ~243-278). No matter-level decision/jurisdiction/posture storage.
- Document-level: `notes` (freeform attorney annotation, an R12 carve-out), workflow/version fields.
- All feedback/decision state is document-ITERATION scoped.

### 1.5 Greenfield placeholders already named in the prompt layer
`src/server/llm/prompts/reviewerPrompts.ts` already NAMES the concept but explicitly does NOT
implement it (instructional text only):
- references to "Matter-memory awareness: ... do not re-raise previously resolved or locked
  decisions absent material change", "Cumulative state carry-forward", and a "Mode discipline"
  line that explicitly says NOT to implement matter-memory storage, persistence storage,
  sendability gates, or cumulative adopt ledgers in the current prompt.
- feedback-card field names include `future_memory_instruction`, `persistence_count`,
  `persistence_chain`, and a `matter_memory_correction` critique type — all defined but never
  populated/computed.

Conclusion: the storage + injection of matter memory is 100% GREENFIELD. The reviewer prompt is
pre-wired to CONSUME it (and currently told to ignore it), which lowers downstream prompt risk.

---

## 2. What matter memory should store (proposed taxonomy)

Derived from the master-plan list, mapped to how the app already models decisions.

1. Accepted attorney decisions — already captured per-iteration in `feedback_manual_selections`;
   matter memory would PROMOTE selected ones to durable, matter-level facts.
2. Rejected reviewer suggestions / "do not re-raise" — NOT capturable today (rejection is implicit).
   This is the single biggest gap: to stop re-raising, the system must record an explicit
   "considered and declined / locked" decision with a reason.
3. Client/business choices — e.g. recourse vs non-recourse, entity structure (P8-T10 business
   decisions). Must be stored as the attorney's CHOSEN option, never as a defect.
4. Jurisdiction / governing-law choices — e.g. the P8-T7 sendability blocker, once resolved.
5. Negotiation posture — e.g. "we hold firm on indemnity cap"; matter-level, cross-document.
6. Persistence chain — when an item is re-raised despite a prior disposition, track count/chain
   rather than silently suppressing (fields already named in the card schema).

Each memory item needs, at minimum: a type, the decided value/position, a human rationale, a
provenance link (which suggestion/iteration/document it came from), the deciding attorney + time,
a status (active | superseded | retired), and a scope (matter-wide vs a specific document).

---

## 3. Design questions answered (options surfaced, not decided)

### Q1. Matter level, document level, or both?
RECOMMENDATION (for operator decision): BOTH, with matter level as the primary ledger.
- Matter-level ledger is what makes memory valuable — decisions on document A inform document B in
  the same matter (e.g. jurisdiction, posture, client structure). The schema/indexes are already
  matter-scoped for materials/documents, so this is consistent.
- A document-level override/scope flag handles items that are genuinely document-specific.
- This matches the master plan's later "locked decisions" framing and keeps per-matter granularity
  addable without rework (consistent with the MR-CAL-5B design note about per-matter granularity).

### Q2. How is attorney approval captured?
Memory must be attorney-authored, not auto-derived (consistent with "attorney is always the final
decision-maker"). Options:
- (a) Promote-on-adopt: when the attorney adopts a suggestion in a review session, offer
  "remember this decision for the matter" with a required short rationale.
- (b) Explicit decline/lock: add an explicit "decline & lock (do not re-raise)" action — this is
  the new capability rejection-as-absence cannot provide.
- (c) Direct entry: attorney records a standing decision (jurisdiction, posture) without a
  triggering suggestion.
Provenance: reuse the existing pattern — `userId` + timestamp + a link to the originating
`suggestionId`/iteration/document; rationale in a structured field (richer than today's freeform
`attorneyNote`). The evaluator (advisory) may PROPOSE candidates, but only an attorney action writes
memory.

### Q3. How does memory get included in prompts?
- Add a new context source feeding `assembleContext()` (or a dedicated `assembleMatterMemory()`),
  rendered as a bounded "## Locked / Prior Matter Decisions" section.
- Inject into BOTH the reviewer prompt (so reviewers stop re-raising — the reviewer prompt is
  already pre-wired to consume it) AND the drafter/regeneration prompt (so drafts respect choices).
- Must be budgeted (the pipeline is token-budgeted); memory likely belongs in a high-priority tier
  (akin to pinned materials) since "do not re-raise" guidance is small and high-value.
- The "mode discipline" line in reviewerPrompts.ts that currently disables matter memory would be
  flipped on as part of the IMPLEMENTATION engagement (not now).

### Q4. How is stale memory retired?
- Status lifecycle: active -> superseded (a newer decision overrides) | retired (attorney clears it).
- Supersede on conflict rather than delete, preserving the audit trail (consistent with immutable
  versions + telemetry already in the system).
- A material-change trigger: the reviewer prompt already contemplates "absent material change" —
  the attorney (not the model) decides when a locked item is reopened.

### Q5. How are conflicts surfaced?
- On write: if a new decision contradicts an active memory item (same type/subject), surface it to
  the attorney to confirm supersede vs keep.
- On review: the advisory evaluator is the natural place to flag "reviewer X re-raised a LOCKED
  item" using the existing persistence_count/persistence_chain fields — advisory only, attorney
  decides. This composes with MR-CAL-5C (evaluator) which is now live.

---

## 4. Data-model options (surfaced)

Option A — New matter-level table `matter_decisions` (RECOMMENDED).
- Columns (sketch): `id, userId, matterId, decisionType (enum), subject, decidedValue, rationale,
  status (active|superseded|retired), scope (matter|document), affectedDocumentId (nullable),
  sourceSuggestionId (nullable), sourceIterationNumber (nullable), supersedesId (nullable),
  createdAt, updatedAt`.
- Pros: clean matter-level ledger; reuses the Zod-Wall query pattern; additive (no migration risk to
  existing tables); indexes mirror the existing matter-scoped pattern.
- Cons: new write paths (promote/lock/decline actions) and a new read+inject path.

Option B — Extend `feedback_manual_selections` with a "promote to matter memory" flag + rationale.
- Pros: smallest schema change.
- Cons: that table is document-iteration scoped and positive-selection only; it cannot represent
  rejections/locks, direct standing decisions, or supersession. Poor fit for matter-level memory.

Option C — Reuse `documents.notes` / a matter-level freeform notes field.
- Pros: trivial.
- Cons: unstructured; not queryable; cannot drive prompt injection or conflict detection. Rejected
  except as a stopgap.

Recommendation: Option A, additive nullable-column-free new table, mirroring the migration-free
additive approach used successfully in MR-CAL-4B.

---

## 5. UI / provenance requirements (surfaced)
- A matter-level "Decisions / Memory" view: list active locked decisions with type, value,
  rationale, source link, deciding attorney, date, status.
- In the review pane: a "remember / lock this decision" affordance on adopt, and an explicit
  "decline & lock (do not re-raise)" action (the new capability).
- Provenance display: each memory item shows where it came from (document/iteration/suggestion) and
  who set it — reuse existing userId + telemetry conventions.
- Supersede/retire controls, with the prior value preserved (audit).
- Conflict prompt on contradictory writes.

## 6. Privacy / security implications (flagged)
- No NEW privacy risk class is introduced: matter memory is the attorney's own decisions about
  their own matter, stored under the same `userId` ownership + Zod-Wall scoping as everything else.
- BUT memory content WILL be injected into third-party LLM provider prompts (Anthropic/OpenAI/
  Google/xAI adapters), exactly like materials and draft content are today. There is NO redaction
  layer in the app today. Memory rationales should therefore be written assuming they are sent to
  providers; avoid placing secrets/privileged side-notes in memory rationale fields, or add a
  "do-not-send" internal-only memory class.
- Token-budget safety: memory injection must be bounded so it cannot crowd out the draft/materials
  (the pipeline already enforces budgets; memory needs a tier + cap).
- Audit: writes should emit telemetry (new event types) consistent with the existing attorney-action
  catalog, so memory changes are traceable.

## 7. Implementation path (scoped — NOT authorized here)
Suggested sequencing, each its own operator-gated engagement:
1. MR-CAL-6B (Locked decisions Phase A — already next-but-one in the queue): the WRITE + STORE +
   prompt-inject core. Per master plan 5.2 its acceptance is: locked decisions have provenance;
   reviewer prompt/context receives them; reviewers do not re-raise locked issues absent new facts;
   attorney can unlock/modify; CI passes. Option A table + the reviewer/drafter injection + the
   lock/decline actions realize exactly that.
2. Conflict surfacing + evaluator integration (use persistence_count/persistence_chain; advisory).
3. Supersede/retire lifecycle + matter-level Decisions UI.
4. MR-CAL-6C-LIVE: live verification.

Smallest first increment for 6B: the additive `matter_decisions` table + read/inject into the
reviewer prompt (flip the disabled "mode discipline") + a single "decline & lock" action, default
behavior-preserving until the attorney creates the first locked decision.

---

## 8. Out-of-scope log
- No code modified; no schema/migration written; no prompt changed (the reviewerPrompts.ts
  "mode discipline" that disables matter memory is left intact — flipping it belongs to 6B).
- No product decision made on matter-vs-document scope, capture UX, or retirement policy — these are
  surfaced as options for the operator/attorney to decide at 6B scope time.
- Sendability gate, cumulative adopt ledger, native feedback-card runtime: untouched; separate arcs.

## 9. Acceptance-criteria self-check (master plan 5.1)
- Data model options surfaced — yes (section 4: Options A/B/C, recommendation A).
- UI/provenance requirements surfaced — yes (section 5).
- Privacy/security implications flagged — yes (section 6; key flag: memory flows to LLM providers,
  no redaction layer exists).
- Implementation path scoped — yes (section 7; maps directly onto MR-CAL-6B and beyond).

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
