# MR-CAL-8A — Sendability Gate: Investigation

Type: Investigation only (read-only; no code changed).
Date: 2026-06-01 (America/New_York).
Repo state at investigation: main @ 98e3ad3 (local == origin/main); working tree clean.
Evidence class: confirmed by code inspection unless explicitly marked otherwise.

---

## 0. Objective

Define a "sendability gate" — a pre-send/finalize checkpoint that tells the supervising attorney
whether a document is safe to release — define its gate categories, and answer the master-plan 7.1
design questions. Acceptance (7.1): gate role approved; advisory-vs-blocking defined; UI placement
defined; dependencies identified.

This is an investigation: it surfaces options and a recommended path. It does NOT decide the product
design or authorize implementation. MR-CAL-8B (sendability implementation) is a separate,
operator-gated engagement. The attorney is always the final decision-maker; a sendability gate must
never override that (master plan + CLAUDE.md).

---

## 1. Headline finding

The system already has the SEMANTIC anchor for sendability. Reviewers are instructed (verbatim,
reviewerPrompts.ts:94):

  "BLOCKER = sendability fail or issue that prevents responsible attorney release."

So "sendability" is already the definition of the top severity tier. What is missing is not the
concept but (a) an AGGREGATOR that turns per-suggestion BLOCKERs (+ a few rule checks) into one
document-level "is this sendable?" signal, (b) a pre-send CHECKPOINT in the UI, and (c) an OVERRIDE
RECORD. The finalize/export lifecycle, the severity taxonomy, an acknowledge-before-finalize gate
precedent, and the override/provenance pattern all already exist. Estimate: ~60% of the
infrastructure is in place.

## 2. Gate categories, mapped to what exists

Master-plan 8A categories vs current taxonomy (reviewerPrompts.ts severity + critique_type;
shared/schemas/feedbackCards.ts fields):

| Category | Maps to today | Exists? |
| --- | --- | --- |
| jurisdiction mismatch | critique_type=legal_sufficiency + requires_attorney_decision; the P8-T7 governing-law blocker calibration | PARTIAL (reviewer can flag; no rule) |
| missing material terms | severity=BLOCKER + critique_type=under_inclusion_or_omission | EXISTS (reviewer-flagged) |
| unresolved blanks | routine_blank_flag (false = non-routine, flaggable); suppress_by_default | EXISTS (routine vs non-routine already modeled) |
| missing party/capacity | severity=BLOCKER + legal_sufficiency | EXISTS (reviewer-flagged) |
| conflicting provisions | critique_type=cross_document_consistency / structural | EXISTS |
| business decision needed | requires_attorney_decision=true + severity_subtype=BUSINESS (P8-T10) | EXISTS |
| execution/signature defects | routine_blank_flag (routine signature/date/notary blanks are suppressed pre-execution per P8-T1) | PARTIAL (suppression exists; a non-routine execution-defect rule is new) |
| counterparty over-disclosure | audience_affected includes 'counterparty' + severity (P8-T6) | PARTIAL (audience modeled; aggregation rule new) |
| P8-T7-style blocker | severity=BLOCKER (the canonical sendability blocker) | EXISTS |

Conclusion: most categories already map onto BLOCKER severity + existing critique_type/flags. The
genuinely-new work is a small set of deterministic RULE checks (jurisdiction set?, non-routine
blanks present?, execution defects) plus an AGGREGATOR — not a new taxonomy.

## 3. Finalize / export / send path (where the gate sits)

Lifecycle (schema.ts ~300-308): documents.workflowState enum
  drafting -> substantively_accepted -> finalizing -> complete (-> archived).
Key procedures (src/server/procedures/documents4a.ts): acceptSubstantive (sets
officialSubstantiveVersionNumber), finalize (-> finalizing, enqueues a formatting job;
on commit -> complete, sets officialFinalVersionNumber), acceptSubstantiveUnformatted (-> complete,
skips formatting), and unfinalize (documents.ts; one of the only paths out of complete, R12).

THE LAST HUMAN STEP before a document leaves the system is the attorney clicking Finalize (or Accept
Unformatted) on the document view, then exporting/downloading DOCX. The sendability checkpoint
belongs at that boundary — surfaced BEFORE finalize/accept-unformatted fires (and the result also
visible in the review pane). This is exactly where the existing staleness-acknowledgment gate already
operates (see section 6).

## 4. Reviewer vs evaluator vs new classifier (the gate's "home")

- REVIEWERS (reviewerPrompts.ts): per-suggestion feedback, run per-iteration, SEE THE WHOLE DOCUMENT,
  advisory. They already emit BLOCKER severity = sendability fail. They are the SOURCE of most
  sendability signal but produce per-suggestion items, not a document-level verdict. Note: the
  reviewer mode-discipline line already RESERVES a "sendability-only mode" (reviewerPrompts.ts) that
  is defined-but-not-activated.
- EVALUATOR (MR-CAL-5C; evaluatorPrompt.ts, reviewSession.ts): synthesizes across reviewers, advisory,
  dual-gated (EVALUATOR_ENABLED + >1 reviewer). LIMITATION: it sees only the reviewer SUGGESTIONS, not
  the full document, and only runs with multiple reviewers — so it is a poor sole home for a gate that
  must work on a single-reviewer or zero-open-review document at finalize time.
- STANDALONE CLASSIFIER: does not exist. Would be a dedicated step that, at the finalize checkpoint,
  aggregates the current iteration's BLOCKER-severity items + a few deterministic rule checks + open
  locked-decision/adopt-ledger context into one { sendable, blockers[], overridable } result.

RECOMMENDATION (options surfaced, operator decides at 8B scope):
- Option A (RECOMMENDED for Phase A / MVP): a DETERMINISTIC AGGREGATOR, not a new LLM call. At the
  finalize checkpoint, compute sendability from data already persisted: count unresolved BLOCKER-
  severity suggestions on the current version's latest review iteration (+ optionally non-routine
  unresolved blanks). No new model latency/cost, fully testable, no provider-reliability dependency
  (important given the GPT-Lite/Gemini reliability issues seen in 5D/6C/7C live runs). Display the
  blockers + an override.
- Option B (later): a dedicated sendability LLM classifier/job that reads the whole document for a
  richer verdict (e.g. jurisdiction-set detection). More capable but adds an LLM call at finalize and
  inherits reviewer-reliability risk; better as a Phase 2 enhancement.
- Option C: extend the evaluator. Rejected as the SOLE home (sees only suggestions; multi-reviewer-
  gated), though the evaluator could later contribute a sendability disposition.

## 5. Advisory vs blocking (the central policy question)

RECOMMENDATION: ADVISORY-WITH-ACKNOWLEDGMENT, never a hard block. Rationale: the attorney is always
the final decision-maker (CLAUDE.md / product principle), and master-plan 8B acceptance explicitly
requires "gate does not silently block" and "gate preserves attorney decision authority." So:
- The gate SHOWS sendability blockers before finalize/accept-unformatted/export.
- If blockers exist, the attorney must ACKNOWLEDGE (an explicit "proceed / accept risk" action with
  optional rationale) — it does not silently prevent send, and it cannot finalize behind the
  attorney's back either.
- This mirrors the existing staleness gate (section 6), which the system already uses successfully.
Hard-blocking is explicitly NOT recommended.

## 6. Precedents to reuse (so 8B is low-risk)

- ACKNOWLEDGE-BEFORE-FINALIZE GATE ALREADY EXISTS: documents4a.ts emits 'staleness_acknowledged'
  ({ staleReferenceIds, finalizeContext: 'finalize' | 'acceptUnformatted' }) at ~line 930 and ~1028 —
  i.e. the attorney already acknowledges stale references before finalize today. The sendability gate
  should follow this exact pattern: a 'sendability_acknowledged' telemetry event with blocker
  count/categories + finalizeContext.
- OVERRIDE + PROVENANCE PATTERN ALREADY EXISTS (twice): locked_decisions (6B) status active|unlocked;
  adopt_ledger (7B) status + statusSource auto|attorney, attorney override via updateAdoptLedgerStatus,
  userId-scoped Zod-Wall queries, lifecycle telemetry. A sendability override record should copy this:
  a row (or document columns) capturing who/when/why an override happened, statusSource attorney,
  preserved for audit (never deleted).

## 7. Native feedback cards — dependency question answered

NOT BLOCKED on native-card runtime. Current state: reviewers EMIT STRUCTURED_FEEDBACK_CARDS embedded
in the legacy body; the active runtime persists via the legacy JSON-array wrapper (feedbackParser.ts
RawSuggestionsArraySchema) and DISPLAYS native fields by extracting them at read time
(extractEmbeddedFeedbackCards, used in reviewSession.get). severity (incl. BLOCKER) is available
TODAY from the legacy suggestion + embedded cards. So a sendability aggregator can read BLOCKER
severity now.
CAVEAT (honest): because cards are not persisted as normalized columns, a deterministic aggregator
that wants to key on requires_attorney_decision / routine_blank_flag / audience_affected must read
them from the extracted (display-schema) cards, which are lenient/best-effort. severity is reliable;
the finer flags are softer. A future native-card persistence layer would make a richer classifier
cleaner — desirable, NOT required for Phase A. Recommendation: build the MVP on severity=BLOCKER
(reliable) and treat the finer-flag rules as enhancement.

## 8. UI placement (defined)

RECOMMENDATION: BOTH a review-pane section AND a pre-finalize surface, because the review pane is
dismissible but finalize is the actual send boundary:
- A SendabilitySection in ReviewPane.tsx, alongside the existing LockedDecisionsSection (6B) and
  AdoptLedgerSection (7B) — same provenance/list patterns, contextually near the review.
- The authoritative checkpoint at the finalize boundary on the document view
  (DocumentDetail.tsx WorkflowControlsSection, where Finalize / Accept Substantive live, next to the
  existing FinalizeDiagnosticBanner): show sendability blockers before the finalize mutation fires; if
  blockers exist, require the explicit acknowledge/override action (mirrors the staleness gate).
Avoid a pure modal-only design that the review pane can't also reflect; avoid hiding it only in the
review pane that may be closed at finalize time.

## 9. Data-model options (surfaced; for 8B)

- Option A (RECOMMENDED): a small additive sendability_overrides table (mirrors 6B/7B): id, userId,
  documentId, matterId, versionId (which version was sent), blockerCategory/summary snapshot,
  override ('acknowledged'|'accepted_risk'), rationale, statusSource='attorney', timestamps. Clean
  audit; reuses the proven Zod-Wall pattern; additive migration (the now-familiar prod-migrate step
  applies before 8C-LIVE).
- Option B: two columns on documents (sendabilityAcknowledgedAt, sendabilityOverrideRationale) — only
  records the latest ack, loses per-blocker/per-version audit. Acceptable as a minimum but weaker.
- The sendability VERDICT itself is computed at checkpoint time from existing feedback data and need
  not be persisted in Phase A (recompute on demand), keeping the write surface to the override record.

## 10. Acceptance-criteria self-check (master plan 7.1)
- Gate role approved -> proposed: a deterministic, advisory pre-finalize aggregator over existing
  BLOCKER-severity signal (section 4, Option A) — operator to approve at 8B scope.
- Advisory vs blocking behavior defined -> ADVISORY-with-acknowledgment, never silent block (section 5).
- UI placement defined -> ReviewPane SendabilitySection + finalize-boundary checkpoint on
  DocumentDetail (section 8).
- Dependencies identified -> NOT blocked on native cards (section 7); reuses staleness-ack gate +
  6B/7B override/provenance + finalize lifecycle (sections 3, 6); a prod migration for any new table
  (carryforward DEPLOY-MIGRATIONS-NOT-AUTOMATIC).

## 11. Implementation path (scoped — NOT authorized here)
Maps onto master plan 7.2 (MR-CAL-8B, acceptance: sendability result visible before
finalize/export/send; attorney can override; gate does not silently block; preserves attorney
authority; CI passes):
1. 8B INCREMENT 1 (server + aggregator): a deterministic sendability computation (count unresolved
   BLOCKER-severity items on the current iteration; optionally non-routine blanks) exposed via a tRPC
   query; additive sendability_overrides table (Option A) + Zod-Wall queries + an
   acknowledge/override mutation; 'sendability_acknowledged' telemetry mirroring the staleness gate.
2. INCREMENT 2 (UI): SendabilitySection in ReviewPane + the finalize-boundary checkpoint + override
   form on DocumentDetail; do NOT hard-block finalize.
3. MR-CAL-8C-LIVE: live verification (acceptance 7.3: gate flags a real blocker, attorney can
   override and send, gate never silently blocks).
DEPLOY NOTE: a new table => migration applied to prod TiDB out-of-band before 8C-LIVE (same as 0002/0003).

## 12. Out-of-scope log
No code/schema/migration/prompt changed. No product decision made on aggregator-vs-classifier,
advisory-vs-blocking, UI surface, or override storage — surfaced as options for the operator at 8B
scope time. Native feedback-card runtime, full calibration regression (Phase 8), matter-level rollout:
untouched.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
