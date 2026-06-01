# MR-CAL-7A — Cumulative Adopt Ledger: Investigation

Type: Investigation only (read-only; no code changed).
Date: 2026-06-01 (America/New_York).
Repo state at investigation: main @ 664b7b4 (local == origin/main); working tree clean.
Evidence class: confirmed by code inspection unless explicitly marked otherwise.

---

## 0. Objective

Define a "cumulative adopt ledger" — a durable record of which reviewer suggestions the attorney
ADOPTED (verbatim or modified), tracked across regeneration cycles, including whether each adopted
change still survives in the current draft or was superseded. Per master plan 6.1, acceptance is:
(1) data model and UI plan documented; (2) relationship to locked decisions clarified; (3)
implementation path scoped.

This is an investigation: it surfaces options and a scoped path. It does NOT decide the product
design or authorize implementation. MR-CAL-7B (adopt ledger implementation) is a separate,
operator-gated engagement.

---

## 1. The required ledger fields, mapped to what exists today

Master plan 6.1 lists the ledger item fields. Mapping each to current reality:

| Ledger field | Exists today? | Where / gap |
| --- | --- | --- |
| source reviewer | YES | derivable via `feedback.reviewerRole` (join from suggestionId) |
| source suggestion | YES (pointer) | `feedback_manual_selections.suggestionId` — pointer only, no text |
| attorney disposition | PARTIAL | only as `locked_decisions.origin` when locked; selections have no disposition field |
| adopted/modified text | NO | GREENFIELD — selections store a suggestionId pointer + optional `attorneyNote`; the suggestion text lives in `feedback.suggestions[].body`; a *modified* adopt is not capturable |
| target document version | NO | GREENFIELD — no version FK on a selection |
| regeneration result | NO | GREENFIELD — nothing records "this adoption made it into version N" |
| current status | NO | GREENFIELD — no status column on selections |
| superseded status | NO | GREENFIELD — no supersession tracking; deletion is the only state change |

Net: the system has *adoption recording* and (new, from 6B) *decision locking*, but NO cumulative
adopt ledger. The pieces exist in fragments and are not wired into a durable, version-aware model.

## 2. What exists today (confirmed by code inspection)

### 2.1 Adoption / selection — `feedback_manual_selections`
Schema (src/server/db/schema.ts ~877-902): columns id, userId, documentId, iterationNumber,
reviewSessionId, suggestionId (VARCHAR 64), attorneyNote (TEXT nullable), createdAt.
- POINTER-BASED: stores `suggestionId` + optional `attorneyNote`, NOT the adopted text. The
  suggestion's actual title/body/severity lives in the `feedback` row's `suggestions` JSON.
- PER-ITERATION: bucketed by iterationNumber + reviewSessionId. Positive-selection only (R5):
  an adopted suggestion gets a row; declining leaves no row.
- NO "modified adopt": if the attorney edits a suggestion before adopting, there is no field for
  the edited text (attorneyNote is commentary, not adopted content).
- NO status/supersession: rows are flat; `deleteManualSelection` is the only state change.
- Queries (src/server/db/queries/phase4b.ts): listManualSelectionsForSession (~643),
  listManualSelectionsForDocument (~660), insertManualSelection (~677), deleteManualSelection (~695).

### 2.2 Regeneration flow (src/server/procedures/reviewSession.ts)
- `reviewSession.regenerate` / `regenerateSingleReviewer`: resolve each selected suggestionId to its
  full feedback text, `insertManualSelection()` to commit the selections durably, build an itemized
  "Apply the following N selected suggestion(s): …" instruction block, transition the session to
  'regenerated', then call `_invokeDocumentRegenerate`.
- `_invokeDocumentRegenerate`: assembles context, builds the drafter prompt (current draft +
  instructions + materials), runs the drafter via executeCanonicalMutation, and on commit
  `insertVersion({ content, generatedByJobId, iterationNumber })` + updates currentVersionId.
- KEY GAPS: nothing reads the selections back AFTER regeneration to record whether the adopted
  change actually landed; the new version links to the job (`generatedByJobId`) but there is NO
  reverse link from a selection/adoption to the version it targeted or produced; `consolidationMode`
  ('all_reviewers' | 'single_reviewer') is audit metadata only.

### 2.3 Versions — `versions` (schema ~405-432; queries src/server/db/queries/versions.ts)
- Columns: id, userId, documentId, versionNumber (sequential), content (MEDIUMTEXT, immutable),
  generatedByJobId (nullable FK to jobs), iterationNumber, createdAt.
- Immutable after insert (no UPDATE). versionNumber increments per write; iterationNumber is the
  review/regeneration cycle counter. This is the natural anchor for "target document version" and
  for computing "superseded" (an adoption targets version N; later versions may or may not retain it).

### 2.4 Locked decisions — `locked_decisions` (MR-CAL-6B, just shipped)
Schema (~993-1049): id, userId, documentId, matterId, scope('document'), origin('declined'|'adopted'),
sourceSuggestionId, sourceIterationNumber, reviewSessionId, summary, rationale, status('active'|'unlocked'),
timestamps. Queries/procedures: insertLockedDecision / listLockedDecisionsForDocument /
listActiveLockedDecisionsForDocument / unlockLockedDecision / updateLockedDecision; tRPC lockDecision
/ listLockedDecisions / unlockDecision / updateDecision.
- INDEPENDENT from selections: locking and adopting are separate attorney actions. A suggestion can
  be adopted without being locked, or locked without being adopted (decline-&-lock).
- The `origin='adopted'` ("lock on adopt") row is a PARTIAL adopt-ledger entry: it records that the
  attorney memorialized an adopted decision (with provenance + summary + rationale), but NOT which
  version it targets, nor whether the adopted text survives in the current draft.

### 2.5 Prompt injection / "cumulative state"
- Reviewer prompt (reviewSession.create) now injects active LOCKED decisions (6B) as a bounded
  "## Locked Decisions" section. It does NOT inject a list of prior ADOPTIONS.
- reviewerPrompts.ts already contains: "Cumulative state carry-forward: when reviewing regenerated
  drafts, treat prior adopted changes as part of the current intended state and do not flag adopted
  changes as new defects." This instruction is ASPIRATIONAL — nothing currently feeds the reviewer a
  list of what was adopted, so the reviewer cannot reliably know which changes are intentional.
  This is the single clearest place a real adopt ledger would plug in (mirrors how 6B fed locked
  decisions into the same prompt).
- Regeneration drafter prompt likewise receives no adoption history.

## 3. Design questions answered (options surfaced, NOT decided)

### Q1. Is the ledger SEPARATE from feedback rows, or DERIVED from them?
RECOMMENDATION (operator decision): a SEPARATE durable table (`adopt_ledger`), populated at adopt/
regenerate time, NOT a pure derivation. Rationale: a derived view cannot capture *modified* adopted
text, the target version, regeneration result, or supersession — all of which are point-in-time facts
that must be written when they happen. Selections (feedback_manual_selections) remain the
lightweight per-iteration picker; the ledger is the durable cross-iteration record. (A pure-derived
read view was considered and rejected for exactly the modified-adopt / version-targeting reasons.)

### Q2. Does the ledger track MODIFIED adopts?
YES (this is a core reason the ledger must store text, not just a pointer). Needs an adopted-text
field plus a flag/enum distinguishing verbatim vs modified, and ideally the original suggestion text
for provenance. This is fully greenfield.

### Q3. Does the ledger feed REVIEWER context?
YES — this is the highest-value behavioral payoff and it slots into the exact mechanism 6B already
built. Inject a bounded "## Previously Adopted (treat as intended; do not re-flag)" section into the
reviewer userPrompt, finally giving the existing "cumulative state carry-forward" instruction real
data. Must be budgeted/capped like the locked-decisions section.

### Q4. Does the ledger feed REGENERATION?
PARTIALLY already (selected suggestions are itemized into the drafter prompt today). The ledger adds:
(a) carrying *prior-iteration* adoptions forward so they are not silently dropped on a later regen,
and (b) marking each ledger entry's regeneration result/target version after the new version is
produced. Phase A can start with persistence + reviewer injection and defer automatic
"did-it-survive" diffing.

### Q5. How does the ledger interact with LOCKED DECISIONS (6B)?
This is the crux and must be settled before 7B. The two overlap at `locked_decisions.origin='adopted'`.
Clarified relationship (recommended):
- DISTINCT PURPOSES: locked decisions = "do not re-raise this" (suppression directive to reviewers);
  adopt ledger = "this change was adopted and is part of the intended current state" (positive
  carry-forward + survival tracking). Different prompt sections, different semantics.
- AVOID DOUBLE-SOURCING: do NOT make the ledger silently auto-create locks or vice versa. Keep them
  separate tables; if the attorney both adopts-into-ledger AND locks, that is two explicit acts.
- A future convenience ("adopt → also lock") can link the two by id, but Phase A should NOT couple
  them. Recommendation: 7B builds the ledger as its own table and leaves 6B locks untouched;
  reviewer prompt then carries BOTH a "Locked Decisions" section and a "Previously Adopted" section.

## 4. Data-model options (surfaced)

Option A — New `adopt_ledger` table (RECOMMENDED), additive, version-aware.
Sketch columns: id, userId, documentId, matterId, sourceSuggestionId, sourceReviewerRole,
sourceIterationNumber, reviewSessionId, disposition (enum: adopted_verbatim | adopted_modified),
originalText, adoptedText, targetVersionId (the version this adoption was applied INTO / produced),
status (enum: active | superseded | resolved | unresolved), supersededByVersionId (nullable),
createdAt, updatedAt. Indexes mirror existing Phase-4b conventions ((documentId, status),
(userId, documentId)). Additive migration; Zod-Wall Row schema + userId-scoped queries; same pattern
as 6B's locked_decisions (which is now proven end-to-end).
- Pros: captures every required field; clean separation from selections + locks; reuses the proven
  6B table+query+prompt-injection pattern.
- Cons: new write wiring at adopt/regenerate; "did it survive" status needs a heuristic (see risks).

Option B — Extend `feedback_manual_selections` with text + status + version columns.
- Pros: fewer tables.
- Cons: that table is per-iteration positive-selection-only and is rewritten each regen; bolting
  cross-iteration durable status onto it muddies its role and risks regressions to the live selection/
  regeneration path. Rejected as the primary model.

Option C — Derive a read-only ledger view from feedback + selections + versions.
- Pros: no new writes.
- Cons: cannot represent modified-adopt text, explicit supersession, or regeneration result; these
  are point-in-time facts. Useful only as a supplementary read, not the model. Rejected.

Recommendation: Option A.

## 5. UI plan (surfaced)
- A per-document "Adopted changes" ledger view: each entry shows source reviewer + suggestion, the
  adopted text (and "modified" badge if edited), the iteration/version it was adopted into, and its
  status (active / superseded / resolved). Reuses the provenance + list patterns from the 6B Locked
  Decisions panel.
- Inline at adopt time: when the attorney adopts (or adopts-and-edits) a suggestion, write a ledger
  entry; optionally let them tweak the adopted text.
- Status surfacing: show which adoptions still appear to be present vs superseded by a later regen.

## 6. Privacy / security
- Same posture as 6B: ledger content (adopted text, original suggestion text) WILL be injected into
  third-party LLM provider prompts if Q3 is implemented (no redaction layer exists). Surface that in
  UI copy; avoid privileged side-notes in ledger free-text. userId-scoping + Zod Wall as everywhere.
- Storage growth: adopted text is duplicated from feedback bodies; bound prompt injection (cap count
  + truncate) exactly as 6B does, and consider a retention view (cf. the existing TELEMETRY-RETENTION
  follow-up).

## 7. Implementation path (scoped — NOT authorized here)
Maps onto master plan 6.2 (MR-CAL-7B, acceptance: adopted suggestions remain visible; regeneration
does not silently lose adopted changes; later reviewer passes see adopted context; superseded/
resolved/unresolved distinguishable; CI passes).
1. MR-CAL-7B INCREMENT 1 (server foundation): additive `adopt_ledger` table (Option A) + Zod Row +
   userId-scoped queries + write at adopt/regenerate (capture disposition + adopted/modified text +
   targetVersionId) + reviewer-prompt injection of a bounded "## Previously Adopted" section (giving
   the existing carry-forward instruction real data). Default-safe: zero ledger entries => prompt
   byte-identical to today.
2. INCREMENT 2 (status/supersession + UI): compute/track status across regenerations; per-document
   ledger UI with provenance.
3. MR-CAL-7C-LIVE: live verification.
DEPLOY NOTE (carryforward DEPLOY-MIGRATIONS-NOT-AUTOMATIC): 7B adds a table, so the migration must be
applied to prod TiDB out-of-band (TiDB SQL editor or a Railway one-off pnpm db:migrate) before
MR-CAL-7C-LIVE, exactly as required for 6B.

A "did the adopted change actually survive in the latest draft?" determination (status=active vs
superseded) is the genuinely hard part: the drafter is an LLM and may paraphrase, so exact text
matching is unreliable. Phase A should record targetVersionId deterministically and treat survival
status as best-effort / attorney-confirmable rather than a guaranteed automatic diff. Flag for the
operator at 7B scope time.

## 8. Out-of-scope log
No code, schema, migration, or prompt changed. No product decision made on the ledger-vs-locks
coupling, modified-adopt capture UX, or survival-status policy — surfaced as options for the operator/
attorney at 7B scope time. Sendability gate (Phase 7), native feedback-card runtime, matter-level
rollout: untouched.

## 9. Acceptance-criteria self-check (master plan 6.1)
- Data model and UI plan documented — yes (sections 4 and 5).
- Relationship to locked decisions clarified — yes (section 3, Q5: distinct purposes, keep tables
  separate, prompt carries both sections, no silent auto-coupling).
- Implementation path scoped — yes (section 7; maps onto MR-CAL-7B and 7C-LIVE; deploy-migration
  caveat carried forward).

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
