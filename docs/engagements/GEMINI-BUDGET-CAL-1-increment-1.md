# GEMINI-BUDGET-CALIBRATION-1 — Increment 1 (Measurement Harness)

Date: 2026-06-08 (America/New_York). Engagement: GEMINI-BUDGET-CAL-1, Increment 1.
Branch: `lex-next/gemini-budget-cal-1`. Local commit: `e180405` (not pushed). Base: `main` `93d8799`.
Governing: `GEMINI-BUDGET-CAL-1_consolidated_disposition_2026-06-09.md` (operator-APPROVED) + triad returns.

## Objective

Build the measurement harness (no behavior change) that makes per-model reviewer token budgets
calibratable: a PER-PROVIDER reasoning/output token split, a synthetic large-provision truncation
fixture, a pre-flight token-demand estimate primitive, and the safety-critical assertion that a
truncation classifies as `api_error`, never `parse_error`. Then run it against the synthetic fixture
and the operator's anonymized real-shaped lease and report per-model demand curves BEFORE Increment 2
sets ceilings. Compose with — never regress — MODEL-RELIABILITY-UAT-1.

## What was built (additive; no schema/migration)

- `src/server/llm/tokenAccounting.ts` — per-provider reasoning/output split. OpenAI/xAI: reasoning is
  a SUBSET of completion_tokens (emitted = completion - reasoning). Gemini: thoughtsTokenCount is
  SEPARATE from candidatesTokenCount (budget = candidates + thoughts). Anthropic: no split (null).
  Plus distanceToTruncation, emittedOutputFraction, truncationAxis, and the pre-flight estimate.
- Adapters read the provider reasoning field where reported (openai/xai completion_tokens_details
  .reasoning_tokens; google thoughtsTokenCount); anthropic exposes none. Behavior-neutral.
- Operator-approved truncation-classification fix (the only behavior change): Anthropic
  (stop_reason 'max_tokens') and xAI (finish_reason 'length') now classify a truncation as api_error
  BEFORE parse, at parity with the pre-existing OpenAI 'length' and Gemini 'MAX_TOKENS' guards.
- Best-effort per-call token-accounting log at the canonicalMutation success chokepoint
  (observability only; try/catch; no telemetry/schema change).
- `src/server/llm/__tests__/gemini_budget_cal_1_truncation_classification.test.ts` (truncation ->
  api_error for all four providers; genuine malformation -> parse_error; truncation NOT transiently
  retried) and `tokenAccounting.test.ts`.
- `tools/calibration/fixtures/synthetic_large_provision.{mjs,txt}` (committed, prod-content-free,
  LF-pinned) + `tools/calibration/budget_cal1_harness.mjs` (offline runner; real lease stays local).

Gates: tsc + eslint clean; 27 new tests green; LLM + UAT-1 retry suites unregressed. The only
full-suite failures are pre-existing Windows-local ones (doubled-drive `readdir` path in the
phase2/phase4b source-scanner meta-tests + CRLF assertions + docx rendering) — none touch this diff;
CI/Linux is authoritative. Five-lens adversarial review: unanimous ship; named fixes applied.

## Measured demand curves (deliverable)

Live run runId `2026-06-08T13-48-05` (12 cells) + smoke runId `2026-06-08T13-40-45`. Budget consumed =
reasoning + emitted, against the output ceiling. Real lease ~52k input tokens, 257 provisions.

| Model | Acct. mode | Synthetic @16384 | Lease @16384 | Lease @32768 |
| :---- | :---- | :---- | :---- | :---- |
| GPT-5 | within-output | FAILED (smoke: timeout 280s) | FAILED (fetch failed) | FAILED (fetch failed) |
| Gemini 2.5 Pro | separate | TRUNCATED: think 7222 + out 9147 = 16369 (output-bound; dist 15) | ok: think 6266 + out 4328 = 10594 (dist 5790) | ok: think 5606 + out 4841 = 10447 (dist 22321) |
| Claude Opus 4.5 | none (null) | ok: out 7044 | ok: out 8268 (dist 8116) | ok: out 12321 (dist 20447; 213s) |
| Grok 4 | within-output | ok: 1521 + 340 = 1861 | ok: 738 + 42 = 780 | ok: 982 + 213 = 1195 |

Per-model reading:

- GPT-5 — UNMEASURABLE on these inputs: never returns within the 280-420s window (latency-bound, not
  budget-bound). This is the dominant reliability finding; spun out to GPT5-LATENCY-1 (operator-CRITICAL).
- Gemini — real-lease demand ~10.5k (STOP, no truncation at 16384), of which ~58% is invisible
  thoughtsTokenCount; truncates only on the high-output-volume synthetic. 16384 borderline-adequate;
  ~32k buys headroom. Validates the foundational per-provider-split finding (a completion-only read
  under-counts consumption by ~60%).
- Claude — never truncates; output GROWS with budget (8.3k -> 12.3k = +49% as 16384 -> 32768). A bigger
  ceiling adds output/cost without preventing any truncation. Keep modest.
- Grok — uses <1.2k of 16384; under-produces (42 emitted on the lease). Budget is not its constraint.

Cross-cutting: the single 16384 is mis-matched per model and NOT uniformly "too low." The two-artifact
design works (synthetic forces the output-volume truncation; the real lease shows realistic selective
demand). Only GPT-5 exceeded the 300s prod envelope; every successful cell returned under it.

## GPT-5 finding + code-investigation (futile-retry risk)

- The current adapter wraps any non-abort fetch rejection (incl. undici's `TypeError: fetch failed`
  from its internal ~300s timeout) as `api_error` (openai.ts fetch catch).
- `isTransientRetryable` (canonicalMutation.ts:146) returns true for any message matching
  `/fetch failed|ECONNRESET|...|network/i`. GPT-5's latency failure carries "fetch failed" -> it is
  RETRIED up to MAX_LLM_RETRIES=2 (3 attempts), each re-running the full multi-minute call and failing
  identically -> ~3x wasted wall-clock + cost.
- Borderline race: the same latency wall surfaces as `timeout` (adapter AbortSignal 300s fires first;
  not retried) OR `api_error "fetch failed"` (undici ~300s fires first; retried). Inc-1 saw both faces.

## Implications for Increment 2 (reshaped, in-spec, no re-triad per caution 6)

GEMINI-BUDGET-CAL-1-INC2: write measured per-model ceilings to an additive model-capability registry
+ log distance-to-truncation. Gemini -> ~32k; Claude -> HOLD 16384; Grok -> N/A; GPT-5 -> NOT a budget
lever (its lane is GPT5-LATENCY-1). Plus the separable GPT5-RETRY-SUPPRESS-1 quick win.

## Out of scope / not done

No production GPT-5 fix written (diagnostic only — GPT5-LATENCY-1). Not pushed/merged/deployed. No
schema/migration. The anonymized lease stays local/gitignored; only the prod-content-free synthetic
fixture is committed. Provider keys never printed or written to artifacts.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
