# MR-CAL-2E-LIVE Formal Corrected Close-Out

**Author of close-out:** Claude (Cowork), preparing the formal close-out at user direction **Date:** 2026-05-28 **Scope:** Formal close-out only; evidence source is the local validation run identified below. **Halt classification:** None triggered. **Evidence source:** MR-CAL-2E-LIVE local execution, run\_id `20260528T122851Z`, executed from Kelly's local Windows PowerShell against the Manus-shipped self-contained handoff bundle. **Bundle baseline:** `mr_cal_2e_live_harness_bundle.zip`, SHA-256 `588f42a85433c84dc249b1ff221639670debc4cc3526e5c9195b873d0fff9a0a`, checksum-matched against `mr_cal_2e_live_harness_bundle.sha256.txt` as published by Manus.

---

## Formal close-out disposition

| Close-out item | Disposition |
| :---- | :---- |
| Engagement | MR-CAL-2E-LIVE Clean-State Post-Scoring Live Calibration Validation |
| Engagement status | Completed under repaired MR-CAL-2D scoring |
| Halt condition triggered | No |
| Live validation completed | Yes |
| Authorized 10-cell matrix executed | Yes |
| Cells NOT\_RUN | 0 |
| Substantive calibration evidence obtained | Yes |
| Provider-readiness halt | Not encountered |
| Acceptance-ready as live close-out | Yes, with mechanical issue log preserved |
| Repository / code implementation work performed | No |
| MR-CAL-3, CAL-7B, or follow-on implementation work performed | No |

---

## Preserved substantive validation findings

The following items are preserved from the validation run as mechanical facts and are not subject to interpretation in this close-out:

1. The authorized 10-cell matrix ran.  
2. All 10 cells returned provider output.  
3. No cell was NOT\_RUN.  
4. Aggregate result: PASS \= 8, FAIL \= 1, PARSE\_FAILURE \= 1, NOT\_RUN \= 0\.  
5. P8-T10 business-decision separation was fully validated across all four reviewer tracks:  
   - P8-T10\_\_GPT \= PASS  
   - P8-T10\_\_Claude \= PASS  
   - P8-T10\_\_Gemini \= PASS  
   - P8-T10\_\_Grok \= PASS  
6. GPT provider-path stability is still not established:  
   - P8-T1\_\_GPT \= PARSE\_FAILURE  
   - P8-T6\_\_GPT \= FAIL  
   - P8-T7\_\_GPT \= PASS  
   - P8-T10\_\_GPT \= PASS  
7. Non-GPT preservation spot checks passed:  
   - P8-T1\_\_Claude \= PASS  
   - P8-T6\_\_Gemini \= PASS  
   - P8-T7\_\_Grok \= PASS  
8. No credential values were printed or included in the report.  
9. No repository files were modified.  
10. No DB, Railway, GitHub write, production/staging mutation, code/prompt/schema/parser/UI change, MR-CAL-3, CAL-7B, or follow-on implementation occurred.

---

## Authorized matrix verification

The MR-CAL-2E dispatch authorized matrix and the executed matrix are identical in shape. No matrix-shape mismatch was introduced by the local execution.

| Matrix category | Authorized dispatch | Executed | Disposition |
| :---- | :---- | :---- | :---- |
| P8-T10 | GPT, Claude, Gemini, Grok | GPT, Claude, Gemini, Grok | Match |
| GPT preservation | P8-T1, P8-T6, P8-T7 under GPT | P8-T1, P8-T6, P8-T7 under GPT | Match |
| Non-GPT preservation | One non-GPT cell each for P8-T1, P8-T6, P8-T7 | P8-T1\_\_Claude, P8-T6\_\_Gemini, P8-T7\_\_Grok | Match |
| Total cells | 10 | 10 | Match |
| All eight reviewer keys used | No | No | Match (not invoked) |

---

## Repo-state snapshot — original working tree

Captured by Manus prior to clean-state worktree creation, preserved as evidence in the handoff bundle at `fixtures/mr_cal_2e_live_corrected_halt_closeout.md`.

| Command | Captured result |
| :---- | :---- |
| `git rev-parse HEAD` | `4cda450f2943e85bb8e1b380e15c86329ada5cba` |
| `git log --oneline -5` | `4cda450 fix(cal): MR-CAL-2D — repair calibration scoring and fixtures`; `baa580b MR-CAL-2A Phase A business-decision calibration (#45)`; `8fcdbf9 feat(cal): MR-CAL-2 — calibrate four-track reviewer prompts`; `f8be9b1 feat(cal): MR-CAL-1 — add feedback-card contract foundation`; `fe96ffb fix(auth): MR-AUTH-BYPASS-1 — add temporary environment-gated auth bypass (#42)` |
| `git status --porcelain` |  `M src/server/__tests__/mr_cal_2a_business_decision_calibration.test.ts`;  `M src/server/llm/prompts/reviewerPrompts.ts` |
| `git branch --show-current` | Empty output in captured artifact |
| `git rev-parse origin/main` | `50dbf25f05d7b0a57a4eeb1a099f1d41ece5c183` |

---

## Repo-state snapshot — clean inspection state / source snapshot

Captured by Manus at the clean inspection worktree and preserved as read-only provenance copies inside the handoff bundle at `source_snapshot/`. Local execution did not modify these files.

| Command | Captured result |
| :---- | :---- |
| `git rev-parse HEAD` | `50dbf25f05d7b0a57a4eeb1a099f1d41ece5c183` |
| `git log --oneline -5` | `50dbf25 fix(cal): MR-CAL-2D — repair calibration scoring and fixtures`; `baa580b MR-CAL-2A Phase A business-decision calibration (#45)`; `8fcdbf9 feat(cal): MR-CAL-2 — calibrate four-track reviewer prompts`; `f8be9b1 feat(cal): MR-CAL-1 — add feedback-card contract foundation`; `fe96ffb fix(auth): MR-AUTH-BYPASS-1 — add temporary environment-gated auth bypass (#42)` |
| `git status --porcelain` | Empty output |
| `git branch --show-current` / detached-state equivalent | Empty branch output; detached-state equivalent recorded as `DETACHED`; refreshed `rev-parse --abbrev-ref HEAD` returned `HEAD` |
| `git rev-parse origin/main` | `50dbf25f05d7b0a57a4eeb1a099f1d41ece5c183` |

---

## Preserved dirty-file protection

| Preserved dirty file | Original status | Protection result during MR-CAL-2E-LIVE local execution |
| :---- | :---- | :---- |
| `src/server/__tests__/mr_cal_2a_business_decision_calibration.test.ts` | Modified in original working tree | Not reset, cleaned, stashed, discarded, overwritten, staged, or committed. Not accessed during local execution. |
| `src/server/llm/prompts/reviewerPrompts.ts` | Modified in original working tree | Not reset, cleaned, stashed, discarded, overwritten, staged, or committed. Not accessed during local execution. |

The local validation ran from the self-contained handoff bundle and not from the original dirty working tree. The bundle is self-contained for execution per the bundle README; it does not require running inside a checkout of the Lex Law Next repository. Source snapshots inside `source_snapshot/` are read-only provenance copies of the prompt, parser, schema, provider adapter, and repaired scoring test files from the clean inspection worktree at origin/main commit `50dbf25f05d7b0a57a4eeb1a099f1d41ece5c183`. Local execution did not modify them.

---

## Source-material review

| Scenario | Phase 8 source section used (bundle path) | Preserved as |
| :---- | :---- | :---- |
| P8-T1 — execution-blanks suppression | `fixtures/phase8_selected_scenarios.txt`, source lines 25–45 | Embedded in `mr_cal_2e_live_harness.py`; fixture file retained for provenance |
| P8-T6 — counterparty-facing over-disclosure | `fixtures/phase8_selected_scenarios.txt`, source lines 133–154 | Embedded in `mr_cal_2e_live_harness.py`; fixture file retained for provenance |
| P8-T7 — final sendability blocker escalation | `fixtures/phase8_selected_scenarios.txt`, source lines 155–175 | Embedded in `mr_cal_2e_live_harness.py`; fixture file retained for provenance |
| P8-T10 — business decision escalated to attorney | `fixtures/phase8_selected_scenarios.txt`, source lines 220–242 | Embedded in `mr_cal_2e_live_harness.py`; fixture file retained for provenance |

Prompt / spec / taxonomy materials referenced as read-only provenance:

| Material | Bundle path | Captured SHA-256 |
| :---- | :---- | :---- |
| Reviewer prompts | `source_snapshot/src/server/llm/prompts/reviewerPrompts.ts` | `fe5c2e83ac0d74e8ffa1e63954b897f8e449fe71051942094c42c67801bd176c` |
| Model / track configuration | `source_snapshot/src/server/llm/config.ts` | `aeb51248573b4d39781fffe36a7197a84f87eebf7b53b7c63195be47e463e266` |
| Review-session procedure | `source_snapshot/src/server/procedures/reviewSession.ts` | `a06687d4d777075492ef3f8ab57a4d6fd5c453a972363e88debad357b9c45d98` |
| Legacy feedback parser | `source_snapshot/src/server/llm/parsers/feedbackParser.ts` | `de053751e87045ae453a57f96f585c74e9e7037aa39cd22e6a94e959535eefea` |
| Feedback-card schema | `source_snapshot/src/shared/schemas/feedbackCards.ts` | (preserved in bundle) |
| OpenAI provider adapter | `source_snapshot/src/server/llm/openai.ts` | `73f3aeab0d9127e08fd107bf359bc86423fb914b72067270ff57003099724d79` |
| Anthropic provider adapter | `source_snapshot/src/server/llm/anthropic.ts` | `893f2f23ff786dd662fc8b7d27e3a48a79990337bb3f205cf7a38d389e854fcd` |
| Google provider adapter | `source_snapshot/src/server/llm/google.ts` | `4d3e82ec09679206cbda5f3a60028459d8547b1efc97049b2ff6bbc7da926706` |
| xAI provider adapter | `source_snapshot/src/server/llm/xai.ts` | `679add9b989260fb25aa6d566409311777665703844a224a3303e4eaaaa6f22c` |
| Repaired MR-CAL-2D calibration scoring test | `source_snapshot/src/server/__tests__/mr_cal_2d_calibration_scoring.test.ts` | (preserved in bundle) |
| MR-CAL-2A business-decision calibration test (original tree dirty) | `source_snapshot/src/server/__tests__/mr_cal_2a_business_decision_calibration.test.ts` | (preserved in bundle; not modified) |

---

## Runtime-path inspection

| Inspection item | Captured result |
| :---- | :---- |
| Provider / API path used | Direct outbound HTTPS calls to OpenAI, Anthropic, Google, and xAI APIs via the Python `requests` library; no provider SDKs invoked. |
| Provider routing observed | OpenAI returned dated variant `gpt-5-2025-08-07` on all GPT cells. Anthropic returned dated variant `claude-opus-4-5-20251101` on all Claude cells. Google returned `gemini-2.5-pro` as advertised. xAI internally routed `grok-4` to `grok-4.3` on Grok cells. No provider flagged instability. |
| Reviewer-model resolution path | `reviewerRole` resolved via `resolveReviewerModel`; system prompt built via `buildReviewerSystemPrompt(reviewerRole as AnyReviewerKey)`; structured-output schema `RawSuggestionsArraySchema`. Mirrored from the clean inspection worktree’s server path, outside the repository. |
| Active legacy wrapper parse path used | Legacy JSON-array wrapper via `parseFeedbackOutput`. Feedback-card detail embedded inside legacy suggestion body. No switch to native target feedback-card runtime. |
| Repaired MR-CAL-2D scoring method used | Yes. The repaired calibration-scoring predicates implemented in `mr_cal_2d_calibration_scoring.test.ts` were applied to the parsed legacy-wrapper output to classify PASS / PARTIAL / FAIL / PARSE\_FAILURE / NOT\_RUN. |
| Singleton normalization applied | Yes. Each cell produced both a `_raw.txt` and a `_normalized.txt` provider-output file. For nine of ten cells, raw and normalized byte sizes are equal, indicating no further normalization was required. P8-T1\_\_Claude returned a 2-byte empty valid output (suppression scenario) consistent with intended behavior. |
| DB-backed job path used | No. The harness mirrored prompt construction, provider call semantics, and legacy `parseFeedbackOutput` behavior without using the DB-backed review-session mutation path. No DB writes, no Railway calls. |
| Output location | Bundle-local `outputs/` directory only. No artifact written outside the bundle folder. |

---

## Selected scenario mapping

| Scenario | Scenario subject | Required surface (per fixtures) | Required suppress (per fixtures) |
| :---- | :---- | :---- | :---- |
| P8-T1 | Execution-blanks suppression | No required surface feedback (suppression test). | No feedback item targeting signature/date/notary/witness blanks; no BLOCKER for execution blanks; no item where `routine_blank_flag = false` on those blanks. |
| P8-T6 | Counterparty-facing over-disclosure | One SUBSTANTIVE/DRAFTING feedback item with critique\_type audience-shift or overstatement; suggested revision removes over-disclosure while preserving 50/50 offer; `requires_attorney_decision = false`. | No feedback recommending change to the 50/50 split; no feedback withdrawing the substantive legal position. |
| P8-T7 | Final sendability blocker escalation | One BLOCKER feedback item identifying VA/CA governing-law mismatch; `requires_attorney_decision = true`; flagged for Sendability Gate. | No required suppression. |
| P8-T10 | Business-decision escalation to attorney | One SUBSTANTIVE/BUSINESS feedback item with both recourse and non-recourse paths surfaced; `requires_attorney_decision = true`; reviewer does not pick a path. | Reviewer must not pick recourse/non-recourse; reviewer must not regenerate the note with structure changed. |

---

## Formal validation matrix

| Cell label | reviewer\_key | scenario\_id | provider:model (requested → returned) | status under repaired MR-CAL-2D scoring | recorded basis |
| :---- | :---- | :---- | :---- | :---- | :---- |
| P8-T10\_\_GPT | gpt | P8-T10 | openai:gpt-5 → `gpt-5-2025-08-07` | PASS | "Both paths were surfaced, attorney selection was required, and business choice was separated from drafting." |
| P8-T10\_\_Claude | claude | P8-T10 | anthropic:claude-opus-4-5 → `claude-opus-4-5-20251101` | PASS | "Both paths were surfaced, attorney selection was required, and business choice was separated from drafting." |
| P8-T10\_\_Gemini | gemini | P8-T10 | google:gemini-2.5-pro | PASS | "Both paths were surfaced, attorney selection was required, and business choice was separated from drafting." |
| P8-T10\_\_Grok | grok | P8-T10 | xai:grok-4 → `grok-4.3` | PASS | "Both paths were surfaced, attorney selection was required, and business choice was separated from drafting." |
| P8-T1\_\_GPT | gpt | P8-T1 | openai:gpt-5 → `gpt-5-2025-08-07` | PARSE\_FAILURE | "Legacy wrapper parsing failed before substantive calibration scoring." |
| P8-T6\_\_GPT | gpt | P8-T6 | openai:gpt-5 → `gpt-5-2025-08-07` | FAIL | "Output fails to preserve the selected business offer or misses the audience-risk issue." |
| P8-T7\_\_GPT | gpt | P8-T7 | openai:gpt-5 → `gpt-5-2025-08-07` | PASS | "Governing-law mismatch is escalated as blocker/legal-sufficiency with attorney decision before send." |
| P8-T1\_\_Claude | claude | P8-T1 | anthropic:claude-opus-4-5 → `claude-opus-4-5-20251101` | PASS | "Empty valid output correctly suppresses routine execution blanks." |
| P8-T6\_\_Gemini | gemini | P8-T6 | google:gemini-2.5-pro | PASS | "Output flags counterparty-facing over-disclosure while preserving the selected 50/50 offer." |
| P8-T7\_\_Grok | grok | P8-T7 | xai:grok-4 → `grok-4.3` | PASS | "Governing-law mismatch is escalated as blocker/legal-sufficiency with attorney decision before send." |

---

## Mechanical carryforward facts

The following are recorded as mechanical facts only. They are not recommendations for a next engagement, fix, retest, or follow-on work.

| Fact | Mechanical statement |
| :---- | :---- |
| P8-T10 business-decision separation | Fully validated across all four reviewer tracks under repaired MR-CAL-2D scoring in this run. |
| GPT provider-path stability | Not established by this run. One PARSE\_FAILURE (P8-T1\_\_GPT), one FAIL (P8-T6\_\_GPT), two PASS (P8-T7\_\_GPT, P8-T10\_\_GPT). |
| Non-GPT preservation behavior | Each non-GPT preservation spot check in this run passed: P8-T1\_\_Claude, P8-T6\_\_Gemini, P8-T7\_\_Grok. |
| GPT P8-T1 parse outcome | Provider returned non-empty output (4,184 completion tokens). Legacy JSON-array wrapper did not parse the output. No substantive calibration scoring was applied to that cell. |
| GPT P8-T6 substantive outcome | Provider returned parseable output. Repaired MR-CAL-2D scoring classified the output as FAIL on the preservation criterion. |
| GPT P8-T7 substantive outcome | Provider returned parseable output. Repaired MR-CAL-2D scoring classified the output as PASS. |
| Active runtime contract | Legacy JSON-array wrapper. Feedback-card detail embedded inside legacy suggestion body. No native target feedback-card runtime in use. |
| MR-CAL-2D scoring framework | Applied as the classifier for PASS / FAIL / PARSE\_FAILURE / NOT\_RUN in this run. |
| Bundle integrity | Checksum-matched against published `mr_cal_2e_live_harness_bundle.sha256.txt`. |
| Provider credential handling | Read from process environment variables only. Not printed, not persisted, not written into any artifact retained for this close-out. |

---

## Calibration issue log

| Issue | Cell | Mechanical disposition |
| :---- | :---- | :---- |
| GPT P8-T1 parse failure | P8-T1\_\_GPT | Recorded. Legacy wrapper parsing failed before substantive calibration scoring. Provider returned non-empty output (4,184 completion tokens). |
| GPT P8-T6 substantive preservation failure | P8-T6\_\_GPT | Recorded. Output failed to preserve the selected business offer or missed the audience-risk issue under repaired MR-CAL-2D scoring. |
| GPT stability | Across GPT cells | Not established by this run. |
| P8-T10 business-decision separation | All four tracks | No issue remains under this validation run. |

---

## Verification of no unauthorized work

| Prohibited category | Verification result |
| :---- | :---- |
| Repository files modified | No repository files were modified. The local execution ran from the self-contained handoff bundle outside the repository. |
| Branch created | No branch created by this close-out. |
| Commit created | No commit created. |
| GitHub write API call | No GitHub write API call performed. |
| Database access or writes | No database access or writes performed. |
| Railway call | No Railway call performed. |
| Production / staging mutation | No production or staging mutation performed. |
| Prompt / schema / parser / UI modification | No prompt, schema, parser, or UI modification performed. |
| Confidential client / user materials used | No confidential client or user materials used. |
| MR-CAL-3, CAL-7B, or follow-on implementation work | Not performed. |

---

## Credential and artifact safety

| Safety item | Result |
| :---- | :---- |
| Credential names checked as set/unset only | Yes. Per-credential verification printed status and length only; no value printed. |
| Credential values printed in formal close-out | No. |
| Credential values committed, staged, or written into repository files | No. |
| Credential values written into local result artifacts retained for close-out | No. The harness reads credential values only from process environment variables. Error messages are sanitized for common secret-bearing fragments before being written to result artifacts. The `error_message` field is empty on every cell row. |
| Raw provider outputs storage location | Stored locally under `outputs/raw_provider_outputs/` inside the handoff bundle. Outside any repository working tree. |
| Confidential client / user materials used | No. Fixture content is corpus-derived or corpus-inspired test material; not live client/user materials. |

---

## Halt log

No halt conditions triggered during MR-CAL-2E-LIVE local execution.

The prior AHC-CAL-2E-credentials / provider-readiness failure recorded against the hosted-sandbox attempt does not apply to this run. All four provider credentials were present and accepted by their providers at the local execution environment. No cell halted on credential or provider-readiness.

---

## References

The following bundle-local artifacts are retained as evidence:

| Reference | Bundle path |
| :---- | :---- |
| Run summary (stdout transcript) | `transcript_run.txt` |
| Per-cell result rows (immutable run) | `outputs/mr_cal_2e_results_20260528T122851Z.json` |
| Per-cell result rows, CSV | `outputs/mr_cal_2e_results_20260528T122851Z.csv` |
| Per-cell result rows, latest pointer | `outputs/mr_cal_2e_results_latest.json` |
| Per-cell result rows, latest pointer, CSV | `outputs/mr_cal_2e_results_latest.csv` |
| Raw provider outputs (20 files: 10 raw \+ 10 normalized) | `outputs/raw_provider_outputs/20260528T122851Z_<reviewer_key>_<scenario_id>_{raw,normalized}.txt` |
| Runtime path inspection | `outputs/runtime_path_inspection.md` |
| Phase 8 scenario sources | `fixtures/phase8_selected_scenarios.txt` |
| Prior provider-readiness halt close-out (for provenance) | `fixtures/mr_cal_2e_live_corrected_halt_closeout.md` |
| Bundle validation manifest | `outputs/bundle_validation.txt` |
| Read-only source snapshots | `source_snapshot/` (clean inspection state at origin/main `50dbf25f05d7b0a57a4eeb1a099f1d41ece5c183`) |

End of formal close-out. Any content below this line is platform-injected and not part of the engagement output.  
