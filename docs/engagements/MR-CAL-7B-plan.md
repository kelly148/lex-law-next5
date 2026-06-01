# MR-CAL-7B — Cumulative Adopt Ledger, Phase A: Plan

Type: Implementation (Phase A planning document; NO code written yet).
Date: 2026-06-01 (America/New_York).
Repo state: main @ 861807b (local == origin/main); working tree clean.
Scope authorization: operator approve scope:MR-CAL-7B (granted 2026-06-01).
Predecessors: MR-CAL-7A investigation (docs/engagements/MR-CAL-7A-investigation.md, merged 861807b);
pattern proven by MR-CAL-6B locked decisions (merged 75d864f, live-verified 6C-LIVE).

Delivered for operator review BEFORE any implementation. No source modified. On plan acceptance,
implementation proceeds in the increments below; Phase B (push/PR/CI/merge) remains separately gated.

---

## 0. Operator design decisions (settled with Kelly before this plan)

1. ADOPT CAPTURE: store the ADOPTED TEXT plus a verbatim/modified flag; keep the ORIGINAL suggestion
   text for provenance. (Not pointer-only.)
2. REVIEWER-PROMPT INJECTION: YES — inject a bounded "Previously Adopted" section into the reviewer
   userPrompt so later reviews treat adopted changes as intended state (feeds the existing-but-unfed
   "cumulative state carry-forward" instruction in reviewerPrompts.ts).
3. SURVIVAL / SUPERSEDED STATUS: ATTEMPT AUTO-DETECTION — but per the plan author's honest caveat,
   built DEFENSIVELY (see section 3.3): auto-detection yields an ADVISORY status, never deletes/hides
   a ledger entry, and the attorney can OVERRIDE. Operator to confirm this defensive framing at plan
   acceptance.
4. (Settled at 7A) LEDGER vs LOCKED DECISIONS: SEPARATE tables, distinct semantics, NO auto-coupling.

---

## 1. Objective and acceptance criteria (master plan 6.2)

Objective: persist adopted suggestions and track them across regeneration.
Acceptance: (1) adopted suggestions remain visible; (2) regeneration does not lose adopted changes
silently; (3) later reviewer passes can see adopted context; (4) superseded/resolved/unresolved
states are distinguishable; (5) CI passes.

## 2. Data model (additive; no destructive migration)

New table `adopt_ledger` (src/server/db/schema.ts), mirroring the proven 6B locked_decisions
conventions (char(36) ids, userId/documentId scoping, mysqlEnum, timestamps, Zod-Wall):

- `id` char(36) PK
- `userId` char(36) notNull            — owner/attorney (provenance + Zod-Wall scoping)
- `documentId` char(36) notNull
- `matterId` char(36) notNull          — denormalized (consistency with locked_decisions)
- `sourceSuggestionId` varchar(64) notNull       — the adopted reviewer suggestion
- `sourceReviewerRole` varchar notNull           — e.g. gpt_lite (provenance; denormalized)
- `sourceIterationNumber` int notNull            — iteration the suggestion came from
- `reviewSessionId` char(36) notNull             — adopting session (provenance)
- `disposition` enum('adopted_verbatim','adopted_modified') notNull   — decision #1
- `originalText` text notNull          — the suggestion text as the reviewer wrote it (provenance)
- `adoptedText` text notNull           — what the attorney actually adopted (== original when verbatim)
- `adoptedIntoVersionId` char(36)      — the document version current at adopt time (the regeneration
                                          INPUT version); deterministic anchor for status
- `producedVersionId` char(36) nullable          — the version produced by the regeneration that
                                          consumed this adoption (set when known)
- `status` enum('active','superseded','resolved','unresolved') notNull default 'active'
- `statusSource` enum('auto','attorney') notNull default 'auto'   — decision #3: who set status
- `createdAt` / `updatedAt` timestamps

Indexes: `(documentId, status)` (the prompt-injection + UI read path), `(userId, documentId)`,
unique `(reviewSessionId, sourceSuggestionId)` (one ledger entry per adopted suggestion per session,
mirroring feedback_manual_selections' unique index).

Migration `0003_mr_cal_7b_adopt_ledger.sql`: additive CREATE TABLE IF NOT EXISTS only; no ALTER/DROP.
Zod Wall: `AdoptLedgerRowSchema` + `AdoptLedgerRow` in shared/schemas/phase4b.ts; parse helper +
userId-scoped queries in db/queries/phase4b.ts.

Status enum semantics (decision #4 / acceptance #4):
- active     = adopted and believed present in the current draft
- superseded = a newer version exists and auto-detection believes the adopted text is no longer present
- resolved   = attorney explicitly marked it handled/closed
- unresolved = adopted but not yet carried into a regeneration (no producedVersion yet)

## 3. Write paths + behavior

### 3.1 Capture on adopt (decision #1)
The ledger is written when the attorney adopts during regeneration (the existing commit point that
already calls insertManualSelection in reviewSession.regenerate / regenerateSingleReviewer). Add an
`insertAdoptLedgerEntry` alongside it (additive; selections remain the per-iteration picker). The
adopt action gains an optional edited-text field:
- verbatim adopt -> disposition='adopted_verbatim', adoptedText == originalText
- edited adopt   -> disposition='adopted_modified', adoptedText = attorney's edited text
`adoptedIntoVersionId` = doc.currentVersionId at adopt time. status='unresolved' until a regeneration
produces a version (then 'active').

### 3.2 Reviewer-prompt injection (decision #2)
In reviewSession.create, after loading active locked decisions (6B), also load the document's
ledger entries with status in (active, unresolved) and build a bounded "## Previously Adopted
(treat as intended; do not re-flag as new defects)" section appended to each reviewer userPrompt.
Bounded exactly like 6B (cap count + truncate each adoptedText). OMITTED entirely when the ledger is
empty (byte-identical to pre-7B). The reviewerPrompts.ts "cumulative state carry-forward" instruction
already exists; it is now fed data (no prompt-text change needed beyond what 6B already did, though we
may add one clarifying clause — see do-not-touch caveat).

### 3.3 Survival / superseded auto-detection (decision #3 — built DEFENSIVELY)
On regeneration commit (in _invokeDocumentRegenerate's txn2Commit, after the new version is inserted):
- set `producedVersionId` on the ledger entries consumed by that regeneration; flip 'unresolved' -> 'active'.
- ADVISORY auto-detection: run a transparent, conservative heuristic comparing each active entry's
  adoptedText against the new version content (normalized whitespace/case; substring or high-overlap
  token match). If the adopted text is NOT detected, set status='superseded', statusSource='auto'.
  If detected, leave 'active'.
- SAFETY RAILS (non-negotiable in this plan): auto-detection NEVER deletes or hides an entry; it only
  sets an advisory status with statusSource='auto'. The attorney can override any status via the UI
  (updateAdoptLedgerStatus sets statusSource='attorney', which auto-detection then never overwrites).
  The UI labels auto statuses as best-effort. This honors the operator's auto-detection choice while
  protecting against the LLM-paraphrase false-negative problem the 7A report flagged.
- HONEST NOTE retained from 7A: exact-match survival detection is inherently unreliable against an LLM
  drafter that paraphrases; expect false 'superseded' calls. That is why it is advisory + overridable,
  not authoritative. Operator may, at plan acceptance, downgrade to deterministic-version-tag-only.

### 3.4 tRPC procedures (reviewSession router; pure DB, no LLM job; evaluator never writes)
- listAdoptLedger({ documentId }) — UI + read.
- updateAdoptLedgerStatus({ adoptLedgerId, status }) — attorney override (statusSource='attorney').
- (capture is internal to the regenerate path, not a standalone public mutation, to keep one commit point.)

## 4. Client (ReviewPane)
- On adopt: allow an optional "edit before adopting" text field (drives verbatim vs modified).
- A per-document "Adopted changes" ledger panel: each entry shows source reviewer + suggestion, the
  adopted text (+ "modified" badge), the version it was adopted into, and its status
  (active / unresolved / superseded / resolved) with the auto-vs-attorney source; attorney can change
  status. Reuses the 6B Locked Decisions panel patterns. Note that adopted text is shared with reviewers.

## 5. Tests
- Zod: AdoptLedgerRowSchema accepts canonical shape incl. both dispositions + all statuses; rejects bad enums.
- Query layer: insert/list/status-update round-trip; userId scoping; unique (reviewSessionId, sourceSuggestionId).
- Prompt injection (source-audit + default-safe): "## Previously Adopted" section assembled when entries
  exist, OMITTED when none (byte-identical to pre-7B); bounded (cap + truncate).
- Survival heuristic: unit tests for present/absent/paraphrase cases asserting advisory status only and
  attorney-override precedence (statusSource='attorney' not overwritten by auto).
- Regression: create-path behavioral tests get the new query stubbed (lesson from 6B: those tests
  vi.resetAllMocks() and mock phase4b — must stub listAdoptLedgerForPrompt in both factory and beforeEach).
- CI authoritative (no local pnpm/vitest).

## 6. Increments
INCREMENT 1 (server foundation): table + migration 0003 + Zod Row + queries + capture-on-adopt +
producedVersion/status-on-regen (advisory auto-detect) + reviewer-prompt injection + tests. Default-safe
(empty ledger => prompt byte-identical to today).
INCREMENT 2 (client): adopt-edit field + Adopted-changes panel + status override + tests.

## 7. Do-not-touch / honoring boundaries
- DO NOT modify: locked_decisions/6B behavior, evaluator scoring, severity taxonomy, business-decision
  calibration text, the feedback parser/card contract, multi-reviewer gating, sendability, matter-level
  rollout, native card runtime.
- reviewerPrompts.ts: the "cumulative state carry-forward" line already exists and already permits
  consuming provided context (6B narrowed the mode-discipline line). Phase A should need at most a
  minimal clarifying clause; avoid scoring/taxonomy edits.
- Selections (feedback_manual_selections) keep their current role; the ledger is additive, not a rewrite.

## 8. Risks / honest notes
- Survival auto-detection is heuristic and WILL mislabel against a paraphrasing drafter; mitigated by
  advisory-only + attorney override + never-hide. This is the riskiest design choice; flagged for
  explicit operator sign-off at plan acceptance (you may downgrade to deterministic-version-only).
- Privacy: adoptedText/originalText flow to third-party LLM providers via the reviewer prompt (no
  redaction layer; same posture as 6B). UI must say so.
- Token budget: "Previously Adopted" + "Locked Decisions" sections now both consume reviewer-prompt
  budget; both are capped/truncated.
- Storage growth: adopted text duplicated from feedback bodies (cf. TELEMETRY-RETENTION follow-up).
- DEPLOY: 7B adds table -> migration 0003 must be applied to prod TiDB out-of-band before MR-CAL-7C-LIVE
  (carryforward DEPLOY-MIGRATIONS-NOT-AUTOMATIC); 6C-LIVE proved this is required.

## 9. Acceptance-criteria mapping (6.2)
1. Adopted suggestions remain visible — ledger + UI panel. By design.
2. Regeneration does not silently lose adopted changes — producedVersion link + advisory superseded
   status surfaced to attorney (never silent). By design.
3. Later reviewer passes see adopted context — "## Previously Adopted" prompt injection. By design.
4. Superseded/resolved/unresolved distinguishable — status enum + statusSource. By design.
5. CI passes — gated in Phase B.

## 10. Out-of-scope log (this plan)
No code/schema/migration/prompt changed. No product decision beyond the four settled constraints
(section 0). Phase B and MR-CAL-7C-LIVE are separate gates.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
