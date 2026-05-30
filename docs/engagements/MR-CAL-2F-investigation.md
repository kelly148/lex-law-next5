# MR-CAL-2F - Investigation Report (consolidating)

Engagement: MR-CAL-2F (Phase 1, item 1.1) - GPT raw-output capture / evidence recovery
Type: Investigation only (no code changes, no live provider calls)
Date: 2026-05-30 (America/New_York)
Repo state at investigation: main @ 08dffe8, working tree clean except the local tracker.

## Objective

Capture raw and normalized GPT outputs for the unstable calibration scenarios
(P8-T1, P8-T6, P8-T7, P8-T10), or give a clear explanation why it is impossible;
classify each GPT failure (parser / adapter / prompt / substance / artifact /
unknown); and scope the narrow next correction. No prompt, parser, scoring,
adapter, or model changes in this engagement.

## Headline result

Capturing the previously-accepted GPT artifacts is impossible, and this is now
established with the root cause identified. Fresh capture is not achievable in
the current environment. The single highest-leverage next action is an
observability change (artifact preservation), not a prompt/parser/scoring patch.

## Evidence situation (why capture-from-preserved-files is impossible)

1. Prior attempt already reached this conclusion. MR-CAL-2F was attempted in the
   earlier program and could not reconstruct accepted GPT artifacts because no
   accepted-run raw/normalized GPT outputs were preserved
   (docs/MR-CAL_program_history.md:111-113). MR-CAL-2G then tried a keyed GPT
   rerun that failed in the Manus sandbox with a 401 credential-ingestion error;
   the OpenAI key was separately proven valid locally. No GPT rerun was
   authorized on that basis. See docs/MR-CAL-2G_formal_close_out.md.

2. No artifacts exist in the repository. A read-only scan found no raw/normalized
   GPT output files anywhere - tracked, untracked, or ignored. There is no
   calibration run directory and no run-id artifact (e.g. the MR-CAL-2E-LIVE run
   20260528T122851Z) present locally.

3. The provider adapter does not persist raw output. src/server/llm/openai.ts
   contains no file-write or raw-output logging. Nothing is captured at runtime
   for later audit. This is the proximate root cause of "could not be
   reconstructed": the outputs were never preserved because the code path does
   not preserve them.

4. The in-repo "calibration" is synthetic unit tests, not a live-capture harness.
   src/server/__tests__/mr_cal_2d_calibration_scoring.test.ts scores
   hand-constructed inputs (helpers legacyItem / structuredBody) against the
   active parser parseFeedbackOutput; it never calls GPT. Its ProviderInstability
   taxonomy (lines 7-13) enumerates the candidate failure modes - timeout, empty
   provider response, singleton-object normalization, JSON-mode / wrapper-shape,
   harness-specific behavior, insufficient evidence - but does not itself capture
   provider output.

5. The harness that produced the one good live run is not available. MR-CAL-2E-LIVE
   was executed via a self-contained harness bundle exported from Manus and run on
   the operator's Windows machine; that bundle is not in the repository and is not
   present locally.

6. The local toolchain is unavailable. Node/pnpm is not installed locally, so even
   the in-repo Vitest tests cannot be run here, and any TypeScript capture harness
   could not be executed locally without that toolchain.

## Answers to the engagement's diagnostic questions

- Did GPT return malformed JSON? For P8-T1 (PARSE_FAILURE) this is the most likely
  family, but it cannot be confirmed without the raw artifact. The failure was at
  the parse boundary, meaning the output did not conform to the legacy JSON-array
  wrapper that parseFeedbackOutput expects.
- Did the provider adapter normalize incorrectly? Indeterminate without the raw
  pre-normalization output. The 2d taxonomy explicitly lists "singleton-object
  normalization issue" and "JSON-mode / wrapper-shape issue" as live candidates.
- Did the parser fail? For P8-T1 the parse step is where the failure surfaced;
  whether the parser is at fault or merely received non-conforming input is
  exactly what cannot be decided without the raw artifact.
- Did GPT produce substantively wrong feedback? Yes for P8-T6 (FAIL): the output
  parsed but the substantive classification was wrong (counterparty-facing
  over-disclosure not handled as required). This is a substance-class issue,
  distinct from P8-T1's parse-class issue.
- Did the harness lose the artifact? Effectively yes - more precisely, the artifact
  was never persisted, because neither the provider adapter nor the runtime path
  writes raw/normalized outputs.
- Is the failure repeatable? Not establishable here. The documented MR-CAL-2E-LIVE
  outcomes are a single run; no repeated runs and no preserved outputs exist to
  judge repeatability.

## Failure classification (from documented MR-CAL-2E-LIVE evidence)

Documented GPT outcomes (docs/MR-CAL_program_history.md:106; run 20260528T122851Z,
model openai:gpt-5):

- P8-T1 GPT = PARSE_FAILURE -> class: PARSER / ADAPTER / PROVIDER-SHAPE,
  indeterminate among these without the raw artifact. Output did not satisfy the
  legacy-array parse contract.
- P8-T6 GPT = FAIL -> class: SUBSTANCE. Output parsed but was substantively
  misaligned on counterparty over-disclosure.
- P8-T7 GPT = PASS -> no issue (sendability blocker escalation correct).
- P8-T10 GPT = PASS -> no issue (business-decision separation correct).

Two distinct failure classes are present (parse/shape on P8-T1; substance on
P8-T6). Per the master plan, that pattern is the trigger condition for the
optional MR-CAL-2H (separate corrections for separate classes) - but no correction
is authorized by this investigation, and 2H remains on-demand only.

## Narrow next correction (scoped, not implemented)

Prerequisite before ANY GPT prompt/parser/scoring change: artifact preservation.

Recommended next action - an observability-only change (a future Phase A) that
captures, for each reviewer invocation, the raw provider output and the normalized
parser input/output, written to a durable location keyed by scenario/run. This
maps to the master plan's MR-CAL-2G "artifact-preservation fix if the problem is
observability" path. Rationale:

- It is the only candidate that is code-only and toolchain-light, and it is not
  blocked by the missing historical artifacts.
- It is the necessary precondition for definitively classifying P8-T1's
  PARSE_FAILURE (parser vs adapter vs provider-shape) on the next live run.
- It changes no prompt, parser logic, scoring, model selection, or adapter
  request behavior - it only records what already flows through the path.

Explicitly NOT recommended now: any prompt patch, parser patch, scoring patch,
model switch, or CAL-7B work. Those must wait until a fresh, artifact-preserved
live GPT run exists, because the current evidence cannot tell adapter-normalization
from provider-shape from parser fault for P8-T1.

## Scope and evidence class

- Investigation only. No source files modified. No live provider calls made.
- Mechanism claims confirmed by code inspection at main @ 08dffe8 and by the
  prior close-out documents (file/line references given).
- The GPT pass/fail outcomes are operator-accepted prior findings from the
  MR-CAL-2E-LIVE close-out, not re-run in this engagement.
- "Impossible to reconstruct from preserved files" is confirmed; "fresh capture
  is blocked" reflects the current missing-harness + unavailable-toolchain state,
  not a permanent impossibility.

## Out-of-scope log

None. The only forward action proposed is the artifact-preservation scope above,
which is left for a separately-authorized future engagement (MR-CAL-2G or a 2H
split, operator's decision).

---
End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
