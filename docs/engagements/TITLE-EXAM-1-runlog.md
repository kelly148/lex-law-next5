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

### T4 — fresh-context reconciler (NC-1/NC-2/NC-4) — IN PROGRESS
Branch `lex-next/tex1-4` off `origin/main` (`203fbf1`). Pure reconciliation + mock-tx decision logging. Files:
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
