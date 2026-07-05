# TITLE-EXAM-1 — Phase A overnight autonomous build runlog

**Standalone engagement OUTSIDE the fold queue (run like ULTRABUILD).** Design of record:
`docs/title-exam/TITLE-EXAM-1_design_spec_v2_2026-07-04.md` (v2.1, incl. §4a Express Mode + §4b
provider-agnostic role bindings). Adopted §3.1 disposition:
`docs/reviews/TITLE-EXAM-1_consolidated_disposition_2026-07-04.md` (PB-1..3, NC-1..12). Operator start
authorization recorded 2026-07-05 (overnight). Checkpoint triage: FIRE dispositioned + adopted — no re-fire;
downstream implementation rides the parent reviews.

## Standing constraints (built as controls)
- ALL code flag-dark behind `TITLE_EXAM_ENABLED` (default OFF; flag-off byte-neutral).
- NO live provider calls in this batch — lanes/reconciler tested against fixtures/mocks only.
- NO real matter content — synthetic anonymized fixtures only; the real client files under `docs/title-exam/`
  (GOLD_RUN_*, the four client PDFs/docx, FirstAm capture) are NEVER used/copied/committed.
- FATIC knowledge gated by the entity-attribute hat (Universal Title only, PB-1 interim) — gate built; no
  FATIC content loaded.
- Express Mode (§4a) is wiring-only — inherits the platform loop behind
  `AUTO_REVIEW_LOOP_ENABLED` + `EXPRESS_DURABLE_RECORDS_ENABLED` + the E8 gate; no independent activation path.
- §4b provider-agnostic role bindings — role→model resolved from `src/server/llm/config.ts` at runtime,
  never a model-ID literal in module code or prompts; a unit test asserts no literal in the module.
- ADDITIVE-ONLY migrations, registered OUTSIDE the `apply-prod-migrations.mjs` auto-apply allowlist
  ("operator-applied out-of-band"), NEVER applied to prod by this batch — enumerated in the final summary.

## Build environment
- Isolated worktree `C:\Users\Kelly\Documents\lex-tex1-wt` off `origin/main` (`4375d78`), with a
  `node_modules` junction so local gates (tsc/eslint/vitest) run. Branch per increment `lex-next/tex1-<n>`,
  commit `feat(title-exam): TEX1-<n> — <summary>`, squash-merge to `main` on green CI (Rule 15), delete branch.
- NOTE: the primary clone was on a stale branch behind `origin/main`; all builds are on the worktree at
  `origin/main`, which is authoritative.

## Increment log

### T1 — additive title-examination data model (spec §5) — MERGED (PR #500, squash `6acfe24`)
Branch `lex-next/tex1-1` off `origin/main` (`4375d78`). CI green (Lint + Type Check + Tests); auto-merged
under Rule 15; branch deleted.
Files:
- `src/server/config/featureFlags.ts` — `isTitleExamEnabled()` (default OFF; byte-neutral OFF documented).
- `src/server/db/schema.ts` — three additive, matter-scoped tables + their §5 enum vocabularies + type
  exports: `title_exam_matter_attribute` (NC-12 NPI posture + §2 DC caveat ack), `title_exam_session`
  (the §4 exam-run container; NC-10 completeness/lane-failure; §4b per-role model provenance),
  `title_exam_finding` (§5 data model: NC-8 typed source basis + downgrade, NC-9 OCR pincite, NC-4
  sendability, §5 classification, NC-1/2 reconciliation + escalate-only lifecycle, NC-7 contamination,
  adopt-ledger + audit_events decision linkage).
- `src/server/db/migrations/0054_title_exam_1_data_model.sql` — additive CREATE TABLE IF NOT EXISTS,
  idempotent, NOT on the apply-prod-migrations allowlist (operator-applied out-of-band).
- `src/server/db/queries/titleExam.ts` — owner-scoped (`ownerScope()`) query layer + exported
  `writeXxxTx` mock-tx seams; the §2 `deriveDcExamVisibility` pure helper + DC-session counter.
- `src/server/db/queries/matterPurge.ts` — registered all three matter-scoped tables in the purge cascade
  (required by `lln_prod_cleanup_1_purge.test.ts`).
- `src/server/__tests__/title_exam_1.test.ts` — §5 vocabulary completeness, flag-default byte-neutral,
  §2 DC-visibility helper, mock-tx write shape/defaults, migration additive-only + out-of-band, purge coverage.

Design notes carried forward:
- FORK-C: audit_events stays the single source of truth for attorney decisions; `title_exam_finding` holds
  operational STATE + a `decisionEventId` pointer (mirrors express_ledger_entry.revertedByEventId). T4/T6
  write the audit_events decision rows.
- The §4a "durable adopt ledger" maps to the Express E4b tables at T8, NOT to MR-CAL adopt_ledger; the
  finding's nullable `adoptLedgerId` is a forward-safe linkage, not a coupling.
- NC-9 source-page pincites are carried per-finding (`ocrSourcePagePincite`) for the fixture-tested Phase A;
  a page-structured OCR store, if needed, is a T2 decision.

### T2 — intake + completeness guard (spec §3; NC-9/NC-10) — MERGED (PR #501, squash `c466967`)
Branch `lex-next/tex1-2` off `origin/main` (`6acfe24`). CI green; auto-merged under Rule 15; branch deleted. Establishes the `src/server/titleExam/` pure-module
directory. Flag-dark by construction (pure library code nothing live imports until the exam is wired in T3+).
Files:
- `src/server/titleExam/coverageChunker.ts` — NC-10 coverage-GUARANTEED chunker (deliberate opposite of the
  silent-truncation analysis-context builder): every input char lands in exactly one contiguous chunk, with
  machine-readable coverage accounting (coveredChars vs totalChars, droppedRanges).
- `src/server/titleExam/intakeCompleteness.ts` — NC-10 incompleteness verdict combining chunk coverage with
  upstream drops (page cap, OCR-failed pages, lane char budget); emits the session completeness /
  incompletenessReason (enumerated causes) / droppedPageCount banner state. A truncated exam never reads complete.
- `src/server/titleExam/ocrHonesty.ts` — NC-9 OCR honesty: critical fields (parties, instrument/recording
  refs, dates, testacy, legal description) asserted from OCR are flagged OCR-derived with a source-page
  pincite; sub-floor (60) values are WITHHELD (field + confidence stay visible), mirroring the intake floor.
  `toFindingOcrBasis` maps to the T1 finding posture (ocr_extracted + downgraded until instrument reviewed).
- `src/server/__tests__/title_exam_2_intake.test.ts` — chunker no-drop invariant, completeness verdicts +
  causes + dropped counts, OCR withhold-below-floor + pincites.
- `src/server/__tests__/title_exam_no_model_literal.test.ts` — §4b guard: scans the whole `titleExam/` module
  and asserts NO provider/model-family literal appears (roles resolve via config.ts). Auto-covers future files.

Design notes:
- Reuse boundary (NC-10 gotcha): the shared /api/materials upload + OCR pipeline is ALWAYS-ON and is NOT
  touched — flag-off byte-neutrality is preserved by building a separate pure title-exam intake layer over
  already-extracted text (fixtures in tests). Live re-OCR of raw bytes is out of scope for Phase A.
- The OCR confidence floor is mirrored locally (60) rather than imported from the OCR-deps-heavy intake
  module, to keep the title-exam module self-contained and testable in isolation.

### T3 — two-lane exam orchestration (spec §4; §4b; PB-3; NC-10) — MERGED (PR #502, squash `203fbf1`)
Branch `lex-next/tex1-3` off `origin/main` (`c466967`). CI green; auto-merged under Rule 15; branch deleted.
Flag-dark library + seam-based orchestration; mocks only (no live provider call). Files:
- `src/server/llm/config.ts` (edit) — §4b provider-agnostic role bindings: `TITLE_EXAM_ROLES`,
  `resolveTitleExamRoleKey`/`resolveTitleExamModel` (role → reviewer key → model STRING via
  `resolveReviewerModel`; per-role env override so ANY provider can fill ANY role by config alone; default
  examiner-A=Claude/manual-anchored, examiner-B=GPT/research-capable). Boot validation in `validateLlmConfig`.
- `src/server/titleExam/roles.ts` — re-exports the config role API (module never names a model).
- `src/server/titleExam/lanePrompts.ts` — the two ported v2 master lane instructions (A manual-anchored, B
  research-capable) sharing one doctrine block (recorded-instrument-controls, jurisdiction non-blending,
  source hierarchy, source-basis tagging + classification + sendability, escalation five-field); the PB-3
  egress rule embedded in B; `buildExamRecordSet` (the IDENTICAL record both lanes receive; seed facts
  labeled NC-7 hypotheses). Prompts embedded as constants because `docs/title-exam/` is untracked (local-only).
- `src/server/titleExam/laneEgressGuard.ts` — PB-3 pure guard: flags client identifiers (addresses, party
  names + bare surnames, case/instrument numbers) in a retrieval query; `PB3_EGRESS_RULE` text.
- `src/server/titleExam/laneOutput.ts` — Zod lane-finding contract (vocabulary single-sourced from the T1
  enums) + fail-loud `parseTitleExamLaneOutput` (empty [] valid; malformed/out-of-taxonomy throws).
- `src/server/titleExam/examOrchestrator.ts` — `runTwoLaneExam` over an injected `LaneExaminer` port: both
  lanes get the byte-identical record; a lane error OR malformed output → single-lane mode + a PROMINENT
  banner (NC-10), never silent; honest N-of-2 lane results with per-lane model provenance.
- `src/server/__tests__/title_exam_3_lanes.test.ts` — role resolution + env override, lane-doctrine + PB-3
  presence, egress guard, output parser, orchestrator identical-record + single/both-lane fallback (19 tests).

Design notes:
- §4b: the model string is NEVER a literal in the module — resolved via `config.resolveTitleExamModel`; the
  `title_exam_no_model_literal` guard scans the whole module (it caught a "GPT-lane" prose token in a comment,
  reworded to the role-based "research-capable lane" framing).
- No tRPC surface yet — the orchestration is a pure/seam library (byte-neutral). A thin flag-gated router
  for operator live-verification is deferred to a later increment (T6/T8).

### T4 — fresh-context reconciler (NC-1/NC-2/NC-4) — MERGED (PR #503, squash `36e3a57`)
Branch `lex-next/tex1-4` off `origin/main` (`203fbf1`). CI green; auto-merged under Rule 15; branch deleted.
Pure reconciliation + mock-tx decision logging. Files:
- `src/server/titleExam/judgmentTopics.ts` — the NC-1 two-tier taxonomy: the escalate-only JUDGMENT topic
  recognizers (vesting/tenancy, marital rights, estate/fiduciary/entity authority incl. "PR deed"/"estate"
  but not "real estate", insurability, lien sufficiency/release theory, deed construction, requirement/
  exception change) + the record-resolvable/housekeeping categories; `classifyConflictTier` OVER-escalates
  (reconciler flag OR topic match) so a mislabel can never cause a silent auto-adopt.
- `src/server/titleExam/reconciler.ts` — the fresh-context system prompt (no memory of its own lane;
  steelman requirement; §10.5 watch-list) + `reconcileLaneFindings`: the DETERMINISTIC NC-1 apply — judgment
  conflicts escalate-only (never auto-resolved even if the reconciler proposes housekeeping); concordance
  RE-DERIVED from the actual lane presence (a bad ref is not trusted as "both", groupFromEvaluator
  discipline); full visibility (every finding, incl. auto-resolved with rationale); NC-4 sendability matrix.
- `src/server/db/queries/titleExamDecisions.ts` — the attorney ADOPT/MODIFY/HOLD logging (Fork-C): one
  audit_events disposition row (the deciding act) + the finding's escalationState + decisionEventId pointer,
  in one tx; pure builder + mock-tx write seam. A changed disposition is a NEW audit row (no update/delete).
- `src/server/__tests__/title_exam_4_reconciler.test.ts` — judgment taxonomy + over-escalation + real-estate
  exclusion; escalate-only override; record-resolvable auto-resolve with rationale; concordance re-derivation;
  full visibility + sendability matrix; decision audit-row shape + mock-tx write + disposition→state mapping.

Design note: a T4 test surfaced (and fixed) an under-escalation gap — the DC "PR deed required" scenario
(a seeded failure class) wasn't caught by the estate pattern; strengthened the recognizer (escalate-only is
fail-toward-escalation; under-escalation is the dangerous error per the disposition).

### T5 — contamination guards (NC-7) — MERGED (PR #504, squash `31b09ab`)
Branch `lex-next/tex1-5` off `origin/main` (`36e3a57`). CI green; auto-merged under Rule 15; branch deleted.
Pure guard + mock-tx import logging. Files:
- `src/server/titleExam/contaminationGuard.ts` — `evaluateContamination` (a seed fact is a HYPOTHESIS:
  auto-flag on a source-matter-ID mismatch, or when a seed would support a requirement/exception/vesting
  conclusion until re-verified); `assessReconciliationClosure` (reconciliation CANNOT close while any
  contamination-flagged finding lacks a completed import-justification); `resolveImport` (import requires a
  non-empty justification — silence is not import; do-not-import records the exclusion).
- `src/server/db/queries/titleExamContamination.ts` — the logged import / do-not-import resolution (Fork-C):
  one audit_events disposition row + the finding update (importJustification/importResolved, clears the block),
  in one tx; pure builder + mock-tx write; refuses to write an unjustified import.
- `src/server/__tests__/title_exam_5_contamination.test.ts` — seed hypothesis auto-flag (mismatch /
  requirement / vesting), flag-clears-on-re-verify, non-seed never flagged, reconciliation-close block +
  release, resolveImport validation, logged-resolution audit shape + mock-tx write + refusal.

### T6 — outputs + gates (spec §7; NC-3) — MERGED (PR #505, squash `3ad9051`)
Branch `lex-next/tex1-6` off `origin/main` (`31b09ab`). CI green; auto-merged under Rule 15; branch deleted. Files:
- `src/server/titleExam/internalMemo.ts` — the internal exam memo assembler: AI-ASSISTED / NON-FINAL label;
  NC-10 banners first; BLUF; escalations in the FIVE-FIELD format with a route; requirements / exceptions /
  notes; curative roadmap (identification only); auto-resolved items shown (full visibility); sendability
  matrix; scope note. (Not client-facing → not subject to the render-blocks.)
- `src/server/titleExam/renderBlocks.ts` — NC-3e structural render-BLOCKS for client/underwriter-facing output
  (a block, not a label): forbidden assurances ("clear/marketable title", "nothing in the land records",
  "free and clear", absolute no-liens), drafts-only annotation markers ([[ ]]/NOTE:/TODO), and UNVERIFIED
  citations (a cite with no [externally verified]/[instrument-confirmed] marker). Fail-closed aggregate.
- `src/server/titleExam/clientDelivery.ts` — the client-artifact generation GATE: `buildMemoVersionHash`
  (NC-3b version-lock), `buildClientEmailDraft`/`buildBrandedReportDraft` generate DRAFTS from the approved
  client body, run the render-blocks (fail-closed), add non-editable disclaimers + attorney-of-record framing
  with NO affirmative AI disclosure (operator resolution). NO send path — drafts the attorney transports.
- `src/server/titleExam/reconciler.ts` (edit) — carry NC-8/NC-9 provenance (downgraded, ocrSourcePagePincite)
  onto the reconciled finding so the internal memo can surface it.
- `src/server/db/schema.ts` + `0055_..._client_delivery_approval.sql` — the additive, append-only,
  content-hash-bound `title_exam_client_delivery_approval` table (mirrors express_approval_attestation).
- `src/server/db/queries/titleExamApproval.ts` — the durable Approve-for-Client-Delivery attestation (Fork-C):
  one audit_events approval row + the attestation row (version-lock hash + pointer), in one tx; mock-tx seam.
- `src/server/db/queries/matterPurge.ts` (edit) — registered the new table in the purge cascade.
- `src/server/__tests__/title_exam_6_outputs.test.ts` — memo (label/banners/five-field/scope), render-blocks
  (assurances/markers/citations), client-delivery gate (version-lock, attorney-of-record, no-AI-disclosure,
  render-block fail-closed), attestation audit shape + mock-tx write, migration additive-only + out-of-band,
  purge coverage (14 tests).

Migration inventory (out-of-band): 0054 (T1), **0055 (T6)** — additive, NOT on the auto-apply allowlist.

### T7 — hat gating + knowledge scoping (NC-5, PB-1) — MERGED (PR #506, squash `6abd1c2`)
Branch `lex-next/tex1-7` off `origin/main` (`3ad9051`). CI green; auto-merged under Rule 15; branch deleted.
Pure gate; loads NO FATIC content. Files:
- `src/server/titleExam/hatGate.ts` — `resolveHat` (only an affirmative `title_settlement_agent` election is
  the Universal Title hat; everything else is the conservative law-firm hat); `resolveFaticAvailability`
  (PB-1 interim: UT-hat only until the written agency/underwriter basis exists — builds the gate, loads no
  content); hat-scoped `accessibleKnowledgeLanes` (each hat sees its own matter lane + public authority +
  cross-hat-approved, never the other hat's matter lane; underwriter-derived = title seat); `canSeedAcrossHats`
  (cross-hat default NO both directions, only an affirmative promotion allows it); `resolveTemplateFamily` /
  `resolveDisclaimerSet` / `isAdvicePermitted` (title hat frames requirements + not-your-attorney disclaimer,
  advice off; law-firm hat may advise); `resolveHatProfile` ties it together.
- `src/server/__tests__/title_exam_7_hatgate.test.ts` — hat resolution, PB-1 FATIC gate, knowledge-lane
  scoping + cross-hat default NO, template/disclaimer/advice posture, full profile (6 tests).

### T8 — Express Mode wiring (§4a) — IN PROGRESS
Branch `lex-next/tex1-8` off `origin/main` (`6abd1c2`). Wiring-only; rides the platform Express loop (no new
flag); byte-neutral when AUTO_REVIEW_LOOP_ENABLED is OFF. Files:
- `src/server/express/protectedSpans.ts` (edit) — `DocumentType` += `title_exam`; `TITLE_EXAM_PROTECTED_SPAN_LABELS`
  + widened `ProtectedSpanLabel` (additive union — deed labels unchanged); `TITLE_EXAM_RECOGNIZERS` marking the
  exam memo's escalation / ADOPT-MODIFY-HOLD / requirements / exceptions / incompleteness-banner regions;
  `buildProtectedSpans` now dispatches on document type.
- `src/server/procedures/expressReviewLoop.ts` (edit) — `SUPPORTED_DOCUMENT_TYPES` += `title_exam` (rides the
  existing `isAutoReviewLoopEnabled` gate; no independent title Express flag, §4a).
- `src/server/express/decisionLedger.ts` (edit) — added the title span labels to `SPAN_RISK_WEIGHT` (ordering
  only; never flips a route) so the widened label union stays exhaustive.
- `src/server/titleExam/expressProfile.ts` — the title ALWAYS-ESCALATE profile: `shouldAlwaysEscalate` (the
  additive `modelEscalates` hint for the non-locus properties — judgment conflicts, abstract-only/OCR-only
  basis, unverified externally-verified citation, cross-matter seed). It can only RAISE an escalation, never
  authorize an auto-adopt (widening the platform Class-A safe harbor is deliberately NOT done — a potential
  §3.1 re-fire). The NC-1 auto-disposition stays inside the T4 reconciler.
- `src/server/__tests__/title_exam_8_express.test.ts` — DocumentType/SUPPORTED include title_exam (no new
  flag); memo protected spans; deed regression + unsupported-type empty; always-escalate profile coverage.

Regression: the full Express suite (E1..E8 locus gate, ledger, corpus) — 719 tests — stays green; the deed
E8 gate-hole count is unchanged (0). Design note: §4a's "durable adopt ledger" is the Express E4b tables, not
MR-CAL adopt_ledger; T8 introduces no new decision record (audit_events stays the source of truth). E8 remains
the operator-only ship gate — this wiring ships byte-neutral (flag OFF) and never self-clears E8.
