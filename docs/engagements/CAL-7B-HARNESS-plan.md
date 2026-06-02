# CAL-7B-HARNESS — Phase-A Plan (offline calibration harness)

Engagement: CAL-7B-HARNESS
Type: Phase A implementation (plan-first). New engagement inserted ahead of CAL-7B-LIVE; not in the original master plan. Added per operator decision after CAL-7B-LIVE was found not executable through the live app.
Date: 2026-06-02 (America/New_York)

## Why this engagement exists

CAL-7B-LIVE (master plan 8.2) was to run the calibration regression grid. Investigation at the start of CAL-7B-LIVE found that the P8-T scenario cells (Blocks A/B/C of CAL-7B-PLAN) cannot be run faithfully through the live application:

- The original P8-T calibration was run via a self-contained Python harness (run id 20260528T122851Z) that fed engineered scenario fixtures directly to the four provider adapters, not through the app's document pipeline.
- That harness bundle is not in the local clone.
- The live app can only create real document types (POA/contract) via the LLM drafting pipeline; there is no exact-text-set endpoint, and the classifyScenario predicates key on specific markers a loosely-generated draft will not reliably contain.

Operator decision: reconstruct the harness first, as a separately-scoped engagement. Fixtures source decision: Hybrid (re-derive now from in-repo sources, reconcile against the original bundle later if supplied).

Scope split confirmed: this harness covers the scenario cells (Blocks A/B/C) only. The feature cells F1-F5 (sendability, locked decisions, adopt ledger, evaluator, native cards) are live-app behaviors and remain in CAL-7B-LIVE.

## Design

- Runtime: plain Node ESM (node_modules is absent locally; Node 24 global fetch). The reviewer system prompt, the four provider REST call shapes, and the classifyScenario scoring predicates are copied VERBATIM from the in-repo sources at commit 6f69c68 (snapshot, not import). Fidelity caveat: if those sources change, the snapshot must re-sync; the do-not-touch rule means the harness never edits the live sources.
- Providers: openai (chat completions, json_object), anthropic (messages API, JSON-instruction + fence strip), google (generateContent, responseMimeType application/json), xai (OpenAI-compatible). maxTokens 16384 to mirror reviewSession.ts:321 (gpt-5 reasoning tokens count against this; 4096 truncated).
- Fixtures: re-derived P8-T1/T6/T7/T10 inputs containing the markers each scenario is about (VA/CA governing-law mismatch; recourse vs non-recourse seller financing; routine execution blanks; counterparty over-disclosure with a selected 50/50 offer). Labeled a re-derived baseline, NOT the 20260528 originals.
- Scoring: classifyScenario + classifyP8T1/6/7/10 + provider/parse-failure predicates, ported verbatim. PASS/PARTIAL/FAIL/PARSE_FAILURE/NOT_RUN.
- Grid logic: N=3 on full-track scenario cells with majority + "unstable" on disagreement (never smoothed); N=1 lite + smoke; classify-then-tag-and-flag for GPT-P8-T1 (accepted posture PARSE_FAILURE) and GPT-P8-T6 (accepted posture FAIL), flagging any deviation including a now-PASS; run cap 75 (hard ceiling, abort if exceeded); concurrency pool (4).
- Output preservation: per call, raw provider output + normalized output written to tools/calibration/runs/<runId>/ (gitignored; local only). A sanitized grid.summary.json is written per run. Credentials are read from env at call time and never printed, logged, or written to artifacts.
- Modes: default --smoke (bounded build-validation subset); --full (the entire Block A/B/C grid = the CAL-7B-LIVE run).

## Credentials

Provider keys live at Windows User scope. ANTHROPIC_API_KEY was found set at User scope but absent from the Bash process env (stale process snapshot). The harness is run via PowerShell, which injects the four User-scope keys into the child Node process env. Values are never printed.

## Increments

- Increment 1 (proof): one cell end-to-end (P8-T7 x GPT). Result: PASS after raising maxTokens to 16384 (gpt-5 truncated at 4096).
- Increment 2 (full grid driver): all adapters, fixtures, scorers, N=3/majority/unstable, classify-then-flag, run cap, concurrency, summary. Smoke-validated on 7 calls.

## Do-not-touch

New files only under tools/calibration/. No edits to live adapters, prompts, scoring sources, or any server/DB code. No provider-adapter changes.

## Honest caveats

- Snapshot copy (not live-module import) -> drift risk if sources change; parity check is a possible follow-up.
- CI lints/tests src only; tools/ is not covered by CI. The harness is validated by execution.
- Re-derived fixtures = fresh baseline, not a strict regression vs 20260528.
- The harness measures provider + prompt calibration offline; it does not exercise the live app's parse/persist path (covered by feature cells + existing tests).

## Acceptance (Phase A)

Increment-1 proof cell runs end-to-end with preserved + scored output; Increment-2 grid driver smoke-validated across all four providers and all four scorers. Both met (see CAL-7B-HARNESS-phaseA.md). Phase B (push/PR/CI/merge) separately gated. The actual full grid run is CAL-7B-LIVE (separately gated).

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
