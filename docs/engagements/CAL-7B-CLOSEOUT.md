# CAL-7B-CLOSEOUT — Formal MR-CAL Program Close-Out

Engagement: CAL-7B-CLOSEOUT
Type: Formal close-out / documentation (master plan 8.3)
Date: 2026-06-02 (America/New_York)
Final main: 9a0ebc3
Status: this is the LAST engagement in the MR-CAL completion plan; on acceptance the queue is empty and the MR-CAL program is complete.

## 1. Scope completed

The MR-CAL completion loop ran as a gated engagement sequence. 29 engagements completed across the master-plan phases:

- Phase 0 — adjacent workflow reliability: LLN-OUTLINE-GEN-1, LLN-UX-ITER-LABEL-1, LLN-REVIEW-DEFAULT-1.
- Phase 1 — GPT focus / artifact capture: MR-CAL-2F, MR-CAL-2G, MR-CAL-2I-LIVE.
- Phase 2 — core reviewer workflow close-out: MR-CAL-3F-LIVE, MR-CAL-CORE-CLOSEOUT.
- Phase 3 — native feedback-card display: MR-CAL-4A, MR-CAL-4B, OPS-DEPLOY-PIPELINE-1, MR-CAL-4C-LIVE, LLN-FEEDBACK-CARD-UX-1.
- Phase 4 — evaluator / multi-reviewer topology: MR-CAL-5A, MR-CAL-5B, MR-CAL-5C, MR-CAL-5D-LIVE.
- Phase 5 — locked decisions: MR-CAL-6A, MR-CAL-6B, MR-CAL-6C-LIVE.
- Phase 6 — cumulative adopt ledger: MR-CAL-7A, MR-CAL-7B, MR-CAL-7C-LIVE.
- Phase 7 — sendability gate (advisory): MR-CAL-8A, MR-CAL-8B, MR-CAL-8C-LIVE.
- Phase 8 — full calibration regression: CAL-7B-PLAN, CAL-7B-HARNESS, CAL-7B-LIVE, CAL-7B-CLOSEOUT (this).

## 2. Calibration posture (from CAL-7B-LIVE, run 2026-06-02T13-35-17-930Z)

Posture statement: the live system behaves ACCEPTABLY across the calibration grid as of 6f69c68. This is a live behavioral snapshot, not a locked, regression-protected calibration. Fixtures were a re-derived baseline (not the 20260528T122851Z originals).

Scenario grid (26 cells / 58 calls): PASS 13 / PARTIAL 5 / unstable 6 / PARSE_FAILURE 2.
- P8-T10 (business-decision separation): STRONG across tracks.
- P8-T7 (governing-law / sendability blocker): STRONG.
- P8-T1 (suppress routine execution blanks): GOOD.
- P8-T6 (counterparty over-disclosure): SOFT SPOT — reviewers flag the audience risk and preserve the selected offer but under-tag the SUBSTANTIVE/DRAFTING taxonomy the PASS predicate requires (PARTIAL, not failure).

Feature systems (live): locked decisions (F2) and adopt ledger (F3) PASS; native-card display (F5) PASS; advisory evaluator (F4) PASS-qualified (fires, advisory dispositions only, NO automatic decision); sendability (F1) PARTIAL (blocker detection verified; sendable:true not observed).

Active runtime contract (unchanged by this program at the calibration layer): legacy JSON-array wrapper parsed by parseFeedbackOutput, with feedback-card detail embedded in the suggestion body and an ADDITIVE display-only native-card projection (MR-CAL-4B/4C). This is NOT a native feedback-card runtime.

## 3. Remaining failures classified

- P8-T6 taxonomy precision: PARTIAL (under-tagging), not a clean failure. Candidate for a future prompt-calibration engagement.
- GPT-P8-T6 (full): majority FAIL -> ACCEPTED_RISK (matches the standing accepted posture; see section 4).
- GPT-P8-T1: now majority PASS -> FLAGGED as an improvement over the accepted PARSE_FAILURE posture (not auto-absorbed).
- PARSE_FAILURE / NOT_RUN / unstable cells: genuine reviewer-RELIABILITY behavior (GPT-5 intermittent empty responses; Claude/Gemini intermittent non-strict JSON), artifact-confirmed, NOT calibration misses. Tracked as open reliability follow-ups (section 5).

No un-accepted clean FAILs remain.

## 4. Accepted risks (explicit)

- GPT-P8-T1 — execution-blank suppression parse/shape instability (parse-class). Accepted 2026-05-30 (MR-CAL-2I-LIVE). NOTE: CAL-7B-LIVE observed GPT-P8-T1 now PASSING (majority) under re-derived fixtures -- an improvement signal flagged for operator attention; the accepted-risk entry is retained until confirmed against original fixtures.
- GPT-P8-T6 — counterparty over-disclosure substantive failure. Accepted 2026-05-30 (MR-CAL-2I-LIVE). CAL-7B-LIVE GPT-P8-T6(full) majority FAIL is consistent with this posture.

## 5. Deferred items (explicit)

- Offline reproducible regression suite: the CAL-7B harness is a live-behavioral-snapshot tool with re-derived fixtures. A TRUE regression against the 20260528T122851Z baseline is deferred pending the original fixture bundle; a live-import (vs verbatim-snapshot) parity check for the harness prompt/scoring is also deferred.
- Native feedback-card RUNTIME: only additive display/projection shipped (4B/4C); the full native-card runtime remains deferred.
- Per-matter granularity (Option 2) for multi-reviewer / memory: data models carry a scope column so this is addable without destructive migration; deferred.
- P8-T6 taxonomy-precision prompt calibration: deferred (CAL-7B is observe-and-classify only; no prompt changes).
- F1 sendable:true negative control and F4 two-substantive-input cross-reviewer synthesis: not observed; deferred.
- Reviewer-reliability follow-ups (open): GEMINI-STRUCTURED-OUTPUT-INVALID-JSON; STUCK-ACTIVE-SESSION-ON-REVIEWER-FAILURE; Claude intermittent non-strict JSON; GPT-5 intermittent empty responses; EVALUATOR-RENDER-EYEBALL.
- Operational follow-ups: DEPLOY-MIGRATIONS-NOT-AUTOMATIC (no deploy-time migrate step); TELEMETRY-RETENTION (raw reviewer output written per review); REVIEWER-AUDIENCE-ARRAY (align prompt to emit array).
- LLN-PROD-CLEANUP-1: synthetic test data accumulated on prod across the program (matters/documents/sessions; locks 45dfac64 + 995c3a37; adopt_ledger entries 62f132c1 + 1005d218; many synthetic versions on doc cbf83ad7). Operator-approved cleanup only.

## 6. SECURITY (escalation)

AUTH_BYPASS_ENABLED has been TRUE on the public production URL (https://lex-law-next-app-production.up.railway.app) for the entire multi-day arc -- a legal-document application sitting publicly unauthenticated. MULTI_REVIEWER_ENABLED=true and EVALUATOR_ENABLED=true are also live. With the heavy live-verification phase now complete, the recommended operator action is to set AUTH_BYPASS_ENABLED=false in the Railway dashboard (case-sensitive exact lowercase 'true' is the only on-value). Claude does not toggle Railway/security settings. Tracked as AUTH-BYPASS-DISABLE.

## 7. Next non-MR-CAL product phase (candidates; operator decides)

MR-CAL is complete. Claude does not choose the next business direction; candidate next phases, in rough priority:

1. SECURITY hardening: disable AUTH_BYPASS_ENABLED and validate the real authentication path before any non-synthetic use (highest priority; gating for real client data).
2. Reviewer-reliability hardening: Gemini structured-output JSON (same class MR-IR-GEN-2 fixed for questionnaires), the stuck-active-session state transition, and GPT-5 empty-response handling -- these caused most of the CAL-7B instability and recur across live verifications.
3. P8-T6 taxonomy-precision calibration: the one substantive calibration soft spot.
4. Production data hygiene: LLN-PROD-CLEANUP-1 (remove accumulated synthetic test data).
5. Optional depth: native feedback-card runtime; per-matter granularity; a true offline regression suite reconciled to the original fixtures.

## 8. Repo docs to update to final MR-CAL state

- docs/MR_CAL_engagement_state.json: CAL-7B-CLOSEOUT -> completed; queue empty (this transition).
- CLAUDE.md "Current state" section: STALE (still references main at dc1e98e and the pre-Phase-5 state). Recommend a refresh to the final state (main 9a0ebc3; Phases 5/6/7 done; Phase 8 calibration regression complete; MR-CAL program closed). This is a diff-gated CLAUDE.md change requiring separate operator approval -- NOT applied as part of this close-out.
- docs/MR-CAL_program_history.md: append the Phase 5-8 narrative + program-complete note (recommended; not blocking).

## 9. Acceptance (master plan 8.3)

- Calibration posture documented: section 2.
- Remaining failures classified: section 3.
- Accepted risks explicit: section 4.
- Deferred items explicit: section 5.
- Next non-MR-CAL product phase identified: section 7.
- Repo docs updated to final MR-CAL state: tracker updated this transition; CLAUDE.md + program-history refresh recommended as gated follow-ups (section 8).

## 10. Disposition

CAL-7B-CLOSEOUT -> awaiting_operator_acceptance. On operator approve accept:CAL-7B-CLOSEOUT, CAL-7B-CLOSEOUT -> completed_engagements, the queue is empty, and the MR-CAL completion program is COMPLETE.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
