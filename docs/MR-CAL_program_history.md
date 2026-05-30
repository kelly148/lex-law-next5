# MR-CAL Program History

This document preserves the original MR-CAL program brief (Part 1\) as the historical narrative of the calibration track, followed by a current-state update (Part 2\) reflecting work completed since the brief was written. A new session should read both: Part 1 for background and intent, Part 2 for where things actually stand now.

---

# PART 1 — Original program brief (historical record)

We are working on the Lex Law Next MR-CAL Reviewer Calibration Program.

This is part of a larger legal AI product called Lex Law Next. The specific current track, MR-CAL, is focused on calibrating the reviewer-model workflow before moving into the more advanced multi-reviewer/evaluator architecture. The key objective is to make sure GPT, Claude, Gemini, and Grok reviewer outputs are reliable, properly structured, and legally calibrated before we build additional architecture on top of them.

Current high-level status (as of original brief): We have completed and accepted MR-CAL-0, MR-CAL-1, MR-CAL-2, MR-CAL-7A, MR-CAL-2A, MR-CAL-2C, and MR-CAL-2D. We are currently stuck on MR-CAL-2E-LIVE, which is a read-only live validation run after MR-CAL-2D.

The immediate issue is not product code, not a broken production site, and not a prompt rewrite issue. The current blocker is environment/credential/harness execution.

We need help to get the MR-CAL-2E-LIVE validation harness running from an environment that has all four provider API credentials available, most likely Kelly's local Windows PowerShell session, because Manus's hosted sandbox does not have the credentials.

## 1\. What Lex Law Next / MR-CAL is trying to do

Lex Law Next is a legal drafting/review platform that uses multiple LLM reviewer tracks. The intended workflow is:

1. Attorney generates or uploads a legal document.  
2. One reviewer model reviews it.  
3. Attorney decides what feedback to accept.  
4. Document is regenerated or revised.  
5. Another reviewer model may review the next iteration.  
6. Attorney remains the final decision-maker.

The MR-CAL program is designed to calibrate the reviewer behavior before building more complex features.

The intended eventual CAL architecture includes:

- feedback-card data contracts;  
- structured reviewer output;  
- severity and critique-type taxonomies;  
- source-of-truth tiering;  
- attorney-decision protection;  
- matter-memory / locked-decision handling;  
- cumulative adopt ledger;  
- sendability gate;  
- multi-reviewer/evaluator topology;  
- full calibration regression grid.

We are not there yet. We are still in the prompt/scoring/live-validation portion of the work.

## 2\. Completed MR-CAL work so far (as of original brief)

**MR-CAL-0 — architecture audit.** Status: accepted / complete. Main finding: the existing reviewer system was legacy-shaped. It produced a JSON array of suggestions with title/body/severity, not native target feedback cards. The audit concluded that prompt work alone would be structurally risky until schema/parser/data-contract foundations were in place.

**MR-CAL-1 — feedback-card contract foundation.** Status: accepted / complete. Added target feedback-card schema foundation; added a target parser entry point; preserved the active legacy parser path; added legacy compatibility helpers; did not switch the product runtime to native target cards. Important continuing fact: the active runtime path remains a legacy JSON array wrapper. Feedback-card detail is embedded inside the legacy suggestion body.

**MR-CAL-2 — four-track reviewer prompt calibration.** Status: accepted / merged. Merge: origin/main reached `8fcdbf98e2057a17a533a46d22114223f8f498db`. Installed calibrated reviewer prompt layer for the four reviewer tracks (GPT, Claude, Gemini, Grok); preserved the legacy wrapper output contract.

**MR-CAL-7A — limited live calibration pilot.** Status: accepted / complete with findings. Result: 16-cell pilot, 10 PASS / 0 PARTIAL / 3 FAIL / 3 NOT RUN. Key findings: P8-T10 business-decision separation was not validated; GPT stability was not established; P8-T1 execution-blank suppression showed positive behavior in scored non-GPT cells; P8-T6 counterparty over-disclosure showed positive behavior in scored non-GPT cells; P8-T7 final sendability blocker escalation showed positive behavior across all four tracks after targeted GPT singleton normalization; active runtime remained the legacy JSON array wrapper.

**MR-CAL-2A — business-decision prompt calibration correction.** Status: accepted / merged. Phase A commit: `ca910605a4eeb76e74b4fe4ac4ae5bbec27dce75`. Phase B merge: `baa580b1b56aa1784e77fc1b2fb807cd25f487bf`. Added narrow prompt language for P8-T10 business-decision separation; specifically targeted recourse/non-recourse seller financing; instructed reviewer to surface both paths and not choose for the attorney; instructed reviewer to mark/state attorney decision required; preserved legacy wrapper path.

**MR-CAL-2A-LIVE — post-2A live rerun.** Status: accepted with findings. The post-correction live rerun still did not validate P8-T10. Final corrected findings: 10 intended cells, 3 PASS / 2 PARTIAL / 3 FAIL / 2 NOT RUN. P8-T10 not validated (GPT \= NOT RUN, Claude \= FAIL, Gemini \= PARTIAL, Grok \= FAIL). GPT provider-path stability not established. P8-T1 and P8-T6 preservation spot checks did not support preservation; P8-T7 did.

**MR-CAL-2C — live-failure diagnosis and corrective scope.** Status: accepted / investigation complete. Diagnosis: the issue did not appear to be simple prompt placement or a shadow prompt path. The dominant problem appeared to be scoring/evaluator mismatch, fixture/expected-output insufficiency, harness instability, and GPT execution/output-contract instability. Conclusion: some live outputs (especially Claude and Grok on P8-T10) may have been substantively aligned but were failed by overbroad or brittle scoring criteria; Gemini appeared partial mainly due to critique-type/taxonomy rigidity.

**MR-CAL-2D — calibration scoring / fixture / harness repair.** Status: accepted / merged. Phase A commit: `4cda450f2943e85bb8e1b380e15c86329ada5cba`. Phase B squash merge: `50dbf25f05d7b0a57a4eeb1a099f1d41ece5c183`. Added local calibration scoring / fixture / harness tests in `src/server/__tests__/mr_cal_2d_calibration_scoring.test.ts`. Did not modify product prompt, parser, schema, UI, DB, provider adapters, model configuration, deployment, migrations, package files, or governance docs. Repaired classification of: P8-T10 business-decision PASS/PARTIAL/FAIL behavior; parse failure vs substantive failure; provider NOT\_RUN vs prompt failure; GPT instability; preservation scoring for P8-T1, P8-T6, P8-T7. Under repaired scoring, stored-output validation reclassified P8-T10 as partially validated (GPT \= NOT\_RUN, Claude \= PARTIAL, Gemini \= PASS, Grok \= PARTIAL) — but this was stored-output/scoring evidence, not a fresh live validation.

## 3\. MR-CAL-2E-LIVE (as originally scoped)

Target: MR-CAL-2E-LIVE — Clean-State Post-Scoring Live Calibration Validation. Baseline: origin/main \= `50dbf25f05d7b0a57a4eeb1a099f1d41ece5c183`. Read-only validation only — no code/prompt/schema/parser/UI changes, no DB, no Railway, no production/staging mutation, no GitHub writes, no MR-CAL-3, no CAL-7B.

Authorized 10-cell live validation matrix:

- Primary P8-T10: P8-T10\_\_GPT, P8-T10\_\_Claude, P8-T10\_\_Gemini, P8-T10\_\_Grok  
- GPT stability / prior-NOT-RUN: P8-T1\_\_GPT, P8-T6\_\_GPT, P8-T7\_\_GPT  
- Preservation spot checks: one non-GPT P8-T1, one non-GPT P8-T6, one non-GPT P8-T7

## 4\. What MR-CAL-2E-LIVE tests

Most important scenario is P8-T10 (business-decision separation): reviewer should identify seller-financing recourse/non-recourse structure as an attorney/client business decision when not selected — surface both paths, not choose, not rewrite to change structure, classify as SUBSTANTIVE/BUSINESS, mark requires\_attorney\_decision \= true, distinguish business choice from drafting defect.

Preservation checks: P8-T1 (suppress ordinary execution blanks; empty valid output may be correct); P8-T6 (flag counterparty-facing over-disclosure as substantive drafting/audience risk; preserve the selected business offer); P8-T7 (identify VA PSA / CA governing-law mismatch as blocker/legal-sufficiency; require attorney decision before send).

## 5\. The blocker (as of original brief)

Credential/environment mismatch. The offline validation harness needs four provider credentials (OPENAI\_API\_KEY, ANTHROPIC\_API\_KEY, GOOGLE\_API\_KEY, XAI\_API\_KEY) in the environment where it runs. Manus's hosted sandbox lacked valid credentials and correctly halted under AHC-CAL-2E-credentials / provider-readiness failure. Kelly's local PowerShell had all four set, making the local route viable. Environment variables in local PowerShell do not appear in the hosted Manus sandbox — they are separate environments.

## 6\. Clean-state concern (as of original brief)

The original Manus working tree had two preserved dirty files (`src/server/__tests__/mr_cal_2a_business_decision_calibration.test.ts` and `src/server/llm/prompts/reviewerPrompts.ts`) which must not contaminate the validation run. Ideal: run against a clean checkout at origin/main \= `50dbf25f05d7b0a57a4eeb1a099f1d41ece5c183`.

## 7\. Decision posture (as of original brief)

Do not move to MR-CAL-3 yet. MR-CAL-2E-LIVE had not yet produced live validation under repaired scoring; P8-T10 only partially validated under stored-output scoring; GPT stability not established; live validation blocked by credentials/harness environment.

---

# PART 2 — Current-state update (as of 2026-05-30)

Everything below happened after the original brief and supersedes its "current status," "blocker," and "decision posture" sections. Detailed evidence lives in the close-out documents in this `docs/` folder.

## MR-CAL-2E-LIVE — COMPLETED

Run id `20260528T122851Z`, executed locally on Kelly's Windows machine via a self-contained harness bundle exported from Manus (the credential boundary was resolved by running where the keys live, not by injecting keys into Manus).

Result: **8 PASS / 1 FAIL / 1 PARSE\_FAILURE / 0 NOT\_RUN.**

- **P8-T10 business-decision separation: FULLY VALIDATED across all four tracks** (GPT, Claude, Gemini, Grok all PASS). This resolves the question that had been open since MR-CAL-2A-LIVE.  
- **GPT stability: NOT established.** P8-T1\_\_GPT \= PARSE\_FAILURE; P8-T6\_\_GPT \= FAIL; P8-T7\_\_GPT \= PASS; P8-T10\_\_GPT \= PASS.  
- **Non-GPT preservation: 3/3 PASS** (P8-T1\_\_Claude, P8-T6\_\_Gemini, P8-T7\_\_Grok).  
- Models exercised: `openai:gpt-5`, `anthropic:claude-opus-4-5`, `google:gemini-2.5-pro`, `xai:grok-4`.  
- See `docs/MR-CAL-2E-LIVE_formal_close_out.md`.

## MR-CAL-2F / MR-CAL-2G — GPT evidence retrieval \+ credential validation

MR-CAL-2F attempted to reconstruct accepted GPT artifacts from preserved files and could not (no accepted-run raw/normalized GPT outputs available). MR-CAL-2G then tried a keyed GPT rerun, which Manus failed with `401 invalid_api_key`. Operator-side PowerShell validation proved the OpenAI key is **valid locally** (`/v1/models` PASS, `gpt-4.1-mini` visible, chat completion PASS). Conclusion: the key is good; Manus's 401 is a Manus-side credential-ingestion problem, not key validity. No GPT calibration rerun authorized on that basis. See `docs/MR-CAL-2G_formal_close_out.md`.

## MR-CAL-3C — MERGED + LIVE-VERIFIED (reachability delivered via MR-CAL-3E)

Sequential reviewer comparison view. Phase B completed locally (git-bundle handoff from Manus → local push via GitHub CLI OAuth as `kelly148`). PR \#47 squash-merged into `main` at commit **`703ff40`**. Files: `ReviewPane.tsx`, `reviewSession.ts`, `phase4b.ts`, behavioral test. See `docs/MR-CAL-3C_Phase_B_addendum.md`. **Live verification was initially blocked** because the comparison view (`HistorySection`) was never reachable — review iteration was always 1 — which became the MR-CAL-3D investigation and the MR-CAL-3E fix below. With MR-CAL-3E merged, the view is **live-reachable and verified PASS** on production at `dc1e98e`.

## MR-CAL-3D — INVESTIGATION (root cause of comparison-view unreachability)

Diagnosed why the MR-CAL-3C comparison view could not be reached: review iteration was derived from `(officialSubstantiveVersionNumber ?? 0) + 1`, which stays 1 throughout drafting, so `HistorySection` (which renders only prior-iteration feedback, `fb.iterationNumber < currentIterationNumber`) had no rows to show. Read-only; produced the fix specification consumed by MR-CAL-3E.

## MR-CAL-3E — MERGED + LIVE-VERIFIED

Decoupled review iteration from `officialSubstantiveVersionNumber`. `reviewSession.create` now computes the iteration server-side via `getNextIterationNumberForDocument(documentId)` (= max prior-session iteration + 1, else 1), and the client renders `HistorySection` against the real persisted `session.iterationNumber`. A second review pass creates **iteration 2** and the prior-feedback comparison section renders iteration-1 feedback. Phase B initially HALTED on CI (5 integration tests mocked `phase4b` but not the newly-called `getNextIterationNumberForDocument`); the test-only correction **FIX1** added the missing mock returns (no production change), after which Phase B resumed and squash-merged into `main` at commit **`dc1e98e`**. Live-verified PASS on production at `dc1e98e`.

## MR-UAT-MATERIALS-2 — MERGED + LIVE-VERIFIED

Convert a completed questionnaire / information request into a draft-visible matter material. Phase A accepted commit `9c0a972a…`. Phase B completed locally via the same bundle-handoff \+ local-OAuth path. PR \#48 squash-merged into `main` at commit **`e4d7dd3`**. Files: `informationRequest.ts`, `InformationRequestPage.tsx`, `mr_uat_materials_2.code_audit.test.ts`. **Live-verified PASS:** a completed questionnaire was added to Client Materials and consumed by POA drafting with no placeholder warning. See `docs/MR-UAT-MATERIALS-2_Phase_B_addendum.md`.

## MR-IR-ERR-1 / MR-IR-GEN-2 — information-request generation repair (MERGED + LIVE-VERIFIED)

Two-step repair of questionnaire (information-request) generation, which had been silently producing empty questionnaires. **MR-IR-ERR-1** (merge `832d569`) made failures visible: a failed/empty generation now surfaces a visible error, archives the empty matrix in the revert path, and stays retryable. **MR-IR-GEN-2** (merge `4a989ad`) fixed the underlying cause by enforcing structured output and adding tolerant parsing (`src/server/procedures/informationRequestParse.ts` → `parseGeneratedMatrixItems` + `InformationRequestItemsSchema`, passed as `structuredOutputSchema`). Both live-verified: generation now reliably produces usable questions. Note: outline generation shares the same latent JSON-contract pattern and has **not** been hardened.

## Current `main`

`dc1e98e` (`dc1e98ebeeb0f82e67f0a5935fc32495f65a1fc1`) — or later if newer work has merged.

## Recurring lesson — credential handoff

The blockers across MR-CAL-2E-LIVE, 2G, and 3C were all the same class: credentials that work in one environment failing to reach Manus's hosted sandbox intact. The durable resolution was to run credential-dependent work locally, where the provider keys (User-scope env vars) and GitHub auth (`gh` OAuth) already live, rather than hand-carrying secrets into the sandbox. This is the rationale behind moving the workflow to a local agent.

## Current decision posture

- P8-T10 is now live-validated under repaired scoring across all four tracks — the original blocker is cleared.  
- GPT stability remains **not** established (open P8-T1 parse-shape and P8-T6 substantive issues).  
- MR-UAT-MATERIALS-2 is merged **and live-verified** — the outstanding UAT item is closed.  
- The MR-CAL-3C / 3D / 3E arc is **closed end-to-end**: the sequential comparison view is merged, reachable, and live-verified at `dc1e98e`.  
- The information-request generation repair chain (MR-IR-ERR-1 → MR-IR-GEN-2) is merged and live-verified.  
- No blocking item remains. Whether to proceed to MR-CAL-4 / CAL-7B or to disposition the GPT-track open items is an operator decision that is **not yet made**; do not begin either without authorization.

