# REVIEWER-ASYNC-FANOUT-1 — GPT-5 latency diagnostic + locked direction

Date: 2026-06-08 (America/New_York). Branch: `lex-next/gemini-budget-cal-1`.
Harness: `tools/calibration/gpt5_latency_diag.mjs` (node:https, measurement only; no production fix).
Motivation: Inc-1 demand curves showed GPT-5 failing on the real-shaped 52k lease. This diagnostic
isolates WHY and decides the fix.

## The question

GPT-5 is operator-CRITICAL; its review output is non-negotiable, so any fix must preserve full
reasoning + whole-doc context (no effort-cap, no chunking). Does GPT-5 return a full-quality,
full-doc review within a tolerable window, and if so how?

## Matrix (52k lease, max_completion_tokens=32768, via node:https; one knob per row)

| V | Mode / effort | TTFB | TTFT (1st output) | Total wall | Finish | Reasoning | Emitted | Issues |
| :- | :- | :- | :- | :- | :- | :- | :- | :- |
| 1 | non-stream / default, 300s signal | - | - | FAILED @300s | - | - | - | - |
| 2 | stream / default | 227s | 227s | 640s | stop | 9344 | 18483 | 48 |
| 3 | stream / medium | 231s | 231s | 509s | stop | 9216 | 13880 | 36 |
| 4 | stream / low | 56s | 56s | 227s | stop | 2304 | 9715 | 30 |
| 5 | non-stream / default, 15-min signal | 504s | 504s | 504s | stop | 10304 | 15583 | 47 |

## Findings

1. Capability is NOT the blocker. GPT-5 produces a full-quality (47-48 issues), full-doc,
   never-truncated review; it just needs ~8-11 min at default/full effort.
2. The blocker is TRANSPORT (undici timeouts), not the model:
   - Non-streaming (the prod path): GPT-5 sends nothing until the whole response is done (~504s);
     undici headersTimeout (~300s default) fires before headers arrive -> `fetch failed` (the Inc-1
     failure). V1 dies at 300s; V5 proves it completes at full quality once the timeout is lifted.
   - Streaming: headers arrive instantly, but the first BODY byte does not arrive until reasoning
     finishes -- TTFB ~227s (TTFB == TTFT: a 227s byte-SILENT gap). undici bodyTimeout (~300s)
     measures that gap and survives by only ~73s. A harder doc pushing TTFB > 300s reintroduces
     the exact `fetch failed` even WITH streaming. So "streaming fixes it" is FALSE without an
     explicit undici bodyTimeout raise sized from the measured TTFB.
3. Effort vs quality (measured coverage): default 47-48 issues; medium 36 (-25%); low 30 (-37%).
   The ONLY effort tier that beats the 300s envelope is `low` (227s) -- at -37% findings on 1/4 the
   reasoning. Confirms effort-cap is a real quality cut, not a free win.
4. Config audit (prod reviewer path; changed nothing):
   - reasoning_effort: prod sends NONE -> GPT-5 model default, which the diagnostic's "default"
     reproduced (~9.3k reasoning, ~11 min). It is NOT "high"; prod is not over-reasoning. Lower
     tiers exist (minimal|low|medium|high) but none reach near-full quality in-window.
   - temperature: the reviewer intent is 0.4 (reviewSession.ts:322), but openai.ts deliberately
     DROPS temperature for gpt-5/o-series (openai.ts:258) because those models reject it. So GPT-5
     gets no temperature and does not honor it; it is correctly not fought, and is not a latency
     lever regardless (the 11 min is reasoning-token count, which temperature does not govern).
5. Futile-retry pathology (code): openai.ts wraps a non-abort fetch rejection (incl. undici's
   `TypeError: fetch failed`) as api_error; isTransientRetryable (canonicalMutation.ts:146) returns
   true for any message matching /fetch failed/ -> a model-latency failure is RETRIED 2x (3
   attempts), each re-running the ~8-11 min call -> ~24-33 min + 3x cost, all doomed.
6. Reviewer latency split (Inc-1 data, 52k lease @ prod budget 16384): GPT-5 fails @300s; Claude
   148s (~2.5 min); Gemini 91s; Grok 12s. Today only GPT-5 needs async; Claude has ~150s headroom
   to the cliff but is sync-in-window.

## Decision (operator LOCK, 2026-06-08)

Logical box: full-quality GPT-5 needs ~11 min AND the operator will not wait >5 min -> NO
synchronous fix satisfies both. Therefore DECOUPLE delivery from depth.

LOCKED: async + PROGRESSIVE FAN-OUT, reviewer-agnostic (REVIEWER-ASYNC-FANOUT-1). Fire all
reviewers; surface each result as it lands; fast reviewers return in-window; slow/deep reviews
complete in background and NOTIFY; operator never blocked. Threshold-driven, not model-pinned.

REJECTED: (a) naive synchronous timeout-raise (would newly impose an 8-11 min block the operator
will not tolerate -- and big-doc GPT-5 failing at 300s today means that wait was never his
experience); (c) permanent effort-cap / chunking (measured -37% findings / context fragmentation).

Required companions:
- the reviewer-agnostic envelope/undici-timeout raise (so BACKGROUND deep reviews survive past
  300s): undici bodyTimeout >= ~400s (TTFB ~227s + margin), headersTimeout > ~640s, AbortSignal
  ~720s. Without the undici bodyTimeout raise, streaming alone still dies on harder docs.
- REVIEWER-RETRY-SUPPRESS-1 (separable, ship independently): stop the 3x futile retry of a
  model-latency `fetch failed`.

DEFERRED (operator may revisit): two-tier GPT-5 (low-effort preliminary in-window + full-effort
deep async append). Plain async/progressive solves the wait; two-tier only if early in-window
GPT-5 signal is wanted.

## Out of scope / not done

No production fix written (diagnostic only). Not pushed/merged/deployed. The anonymized lease and
all raw provider output stay local/gitignored; provider keys never printed or written. Sequencing:
behind the existing GEMINI-BUDGET queue; nothing pushed until the operator confirms the build.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
