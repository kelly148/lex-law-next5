# GEMINI-NO-RETURN-1 — Diagnostic (read-only)

**Class.** Diagnostic investigation (read-only). §3 corrected/superseded-diagnosis discipline: "fix shipped, symptom persists" → **diagnostic-first, surface before any behavior fix.** No code fix written. No prod action. No live prod reviewer run (offline harness + direct model-behavior probes only, on synthetic data).

**Subject.** Cowork core-loop UAT (2026-06-20): a 4-model review of a deed draft (matter `ed48c29b` / doc `4a1e6d78`) showed **"No return: Gemini"** while the other three models returned — *despite* GEMINI-BUDGET-CAL-1 + MODEL-RELIABILITY-UAT-1 already being live (reviewerCeiling 32768; `MAX_TOKENS → api_error`; JSON-shape hardening). A follow-up 2-model smoke (Claude + GPT) on the same doc returned 2/2 cleanly, so the issue is isolated to Gemini, not the egress plane or session.

**Date.** 2026-06-20 (America/New_York). **Activation HEAD / prod:** `origin/main = d826cf8` (= prod).

**Bottom line.** The cause is **narrowed but not pinned.** Ruled out: maxTokens wiring fallback, an invalid model slug, and deterministic truncation on a normal-sized deed (all three refuted by live evidence). The failure **did not reproduce** offline — solo or 4-way-concurrent, on either Gemini slug, at 16384 or 32768. It is therefore **conditional or transient**, most consistent with (a) the *real* deed being materially heavier than the calibrated lease / my synthetic, or (b) a one-off rate-limit/timeout in the live run. The single artifact that would pin it — the prod per-lane `failureReason` + the server token-accounting log line for that run — is operator-side. **This does NOT contradict the GEMINI-BUDGET-CAL close-out** (32768 is confirmed sufficient for normal deed reviews). **STOP for operator direction before any fix.**

---

## 1. Method + evidence access

- **Code trace (read-only, 3 parallel agents):** maxTokens wiring; every google.ts "no substantive return" path → errorClass → lane record → UI symptom; the 4-way fan-out concurrency/429/timeout surface.
- **Offline harness** (`tools/calibration/budget_cal1_harness.mjs`, `--measure --budgets=16384,32768`) against a synthetic deed-shaped fixture, 4 tracks, 4-way concurrent — local run, real provider APIs, synthetic data. Artifacts gitignored under `tools/calibration/runs/`.
- **Direct model-behavior probes** (gitignored, throwaway, key-safe): (i) availability of the production reviewer slugs; (ii) the deed run through the *production* Gemini slug at production budgets with full token accounting + a `thinkingBudget`-cap variant.
- **Could NOT access (read-only, no prod):** the real deed input (doc `4a1e6d78`), the prod server logs / `[token-accounting]` line, and the prod per-lane `failureReason` for the failing run.

---

## 2. Findings

### F1 — maxTokens wiring is CORRECT (32768 reaches a valid model). *Wiring-fallback hypothesis: REFUTED.*
For a reviewer run of the Gemini track, `getReviewerCeiling` → `jobs.input` → `buildReviewerCanonicalParams` → `runJob` → `adapter.generate` carries **32768** verbatim to `generationConfig.maxOutputTokens`. No `?? 4096`, no `|| DEFAULT`, no clamp on the path. The `4096` in `google.ts` is a *destructuring default* that is dead for reviewer runs (they always pass an explicit ceiling); `16384` is the hold ceiling for *other* models / the unregistered fallback, never applied to Gemini.
- Evidence: `modelCapabilities.ts:71-78,134-141` (reviewerCeiling 32768 for both `gemini-2.5-pro` and `gemini-3.1-pro-preview`); `reviewSession.ts:276,584`; `reviewerJobFactory.ts:107,149,163-172,316`; `canonicalMutation.ts:544,719`; `google.ts:159,170`; unit `modelCapabilities.test.ts:16`.

### F2 — the production reviewer Gemini model is `google:gemini-3.1-pro-preview`, and it is VALID/AVAILABLE. *Invalid-slug hypothesis: REFUTED.*
The prod reviewer "gemini" track resolves to **`google:gemini-3.1-pro-preview`** (`config.ts:83-88`, `REVIEWER_MODELS`, no env override for full tracks) — *not* `gemini-2.5-pro`. It is flagged *"operator-pending-provider-confirmation (preview-tier)"* (`config.ts:74-86`), the same posture as the prior **REVIEWER-MODEL-VALIDATION-FIX-1 (CR-2)** incident where `gpt_lite`'s `openai:gpt-5.4-mini` *"404'd on every GPT-Lite review (confirmed live 2026-06-15)"* (`config.ts:109-113`). That precedent made the invalid-slug hypothesis attractive — but a **live availability probe refutes it**:

| Model id | HTTP | Note |
| :-- | :-- | :-- |
| `gemini-3.1-pro-preview` (prod reviewer "gemini") | **200** | valid/available |
| `gemini-3.5-flash` (prod reviewer "gemini_lite") | **200** | valid/available |
| `gemini-2.5-pro` (old GA / what the harness tests) | 200 | control |
| `gemini-2.5-flash` (old GA lite) | 200 | control |

> *Note on the brief's premise:* the brief referenced `google:gemini-2.5-pro`; the live prod reviewer is `gemini-3.1-pro-preview` (modernized 2026-06-15). Both carry the 32768 ceiling and both handle the deed cleanly (F4), so the discrepancy does not change the conclusion — but the operator's mental model of "the Gemini reviewer" should be `gemini-3.1-pro-preview`.

### F3 — the unbounded-thinking → output-starvation mechanism is REAL (confirmed live at a tight budget).
Gemini 2.5/3.x are "thinking" models; the adapter sets **no `thinkingBudget`/`thinkingConfig`** (`google.ts:169-181`, asserted by `reviewer_latency_0_tokens_reasoning.test.ts:198-210`). Thinking tokens (`thoughtsTokenCount`) and output tokens (`candidatesTokenCount`) **both draw from the single `maxOutputTokens`** (`tokenAccounting.ts:11,13,135`), so thinking can consume the budget before any output text → `finishReason=MAX_TOKENS` with zero emitted text → (under the schema) `api_error` (`google.ts:239-245`) → lane `failed` → "No return."
- **Confirmed live:** a trivial "ping" at `maxOutputTokens=8` returned `finishReason=MAX_TOKENS` for **all four** Gemini slugs — thinking instantly consumed the 8-token budget. The mechanism exists; the question is only whether it bites at the production 32768.

### F4 — the failure DID NOT REPRODUCE at production budgets (the central finding).
A deed-shaped review at production budgets returned cleanly on both Gemini slugs, solo and 4-way concurrent:

**Probe — production slug `gemini-3.1-pro-preview`, synthetic deed, JSON mode:**

| Variant | finishReason | prompt | thoughts | output | emitted text | wall |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `@16384`, no thinkingBudget | **STOP** | 1342 | 1994 | 1152 | 4855 ch | 25s |
| `@32768`, no thinkingBudget | **STOP** | 1342 | 2188 | 969 | 4016 ch | 24s |
| `@32768`, `thinkingBudget=8192` (fix test) | **STOP** | 1342 | 802 | 1171 | 4830 ch | 17s |

**Harness — `gemini-2.5-pro`, 4-way concurrent, synthetic + deed, 16384 & 32768:** every Gemini cell `ok` / `finishReason=STOP` (reasoning ≈ 2.7k–4.7k, emitted ≈ 3.9k–5.3k, well under budget); **no 429, no timeout, no Gemini truncation** anywhere in the 12-cell grid.

Implications:
- **Deterministic truncation on a normal deed: REFUTED** — ~30k of headroom remained at 32768; finishReason was STOP, not MAX_TOKENS.
- **In-panel 4-way concurrency 429: not observed** — the 4-way harness produced no rate-limit/timeout. (Consistent with Agent C's caveat: a 4-*model* panel is **one** Gemini call, not four, so in-panel concurrency does not multiply Gemini load.)
- **The `thinkingBudget` cap is a viable lever** — accepted by the prod slug (thoughts 2188→802) and **preserves output** (STOP, full text). This is the surgical fix *if* the cause turns out to be truncation.
- **Incidental (not the reported issue):** in the harness, **GPT-5** reasoning-bound *truncated* on the synthetic at 16384 (`emitted=0`, `fr=length`) — a latent risk for the GPT track at its 16384 ceiling (prod uses `gpt-5.5`; harness uses `gpt-5`, so treat as indicative, not confirmed for prod).

### F5 — "No return: Gemini" is a CATCH-ALL symptom, not one failure class.
It is rendered from `denominator.missing` (`ReviewPane.tsx:1541`), where "missing" = intended − reviewers-with-≥1-suggestion (`sessionConsolidation.ts:63-73`, `consolidate.ts:95-99`). So it fires for **every** non-substantive Gemini outcome — `api_error` (MAX_TOKENS / no-text / safety), `parse_error`, `rate_limited` (429), `timeout`, **and a valid empty `[]`** (which shows "No suggestions" on its lane chip but still counts as "missing"). The **per-lane chip disambiguates**: "Failed" (api/parse/rate-limit), "Timed out" (AbortSignal), "No suggestions" (valid `[]`). *Without that chip + the server log line for doc `4a1e6d78`, the exact class is not established.*
- Evidence: `AsyncLaneReviewView.tsx:28-40`; `reviewerLaneState.ts:48-54,194-202`; `sessionConsolidation.ts:63-73`; `consolidate.ts:95-99`; `ReviewPane.tsx:1541`.

### F6 — concurrency/retry surface (credible transient mechanisms, none reproduced).
Fan-out is fully concurrent with **no cap, no stagger** (`reviewSession.ts:664-669,692-694`). Retries are **2×, fixed 500ms/1500ms, NO jitter** (`canonicalMutation.ts:153-158`), so concurrent lanes retry in lockstep and can re-burst the same quota window; `429→rate_limited` is retried but weakly; a sync-mode undici/`AbortSignal` ~300s race can abort a slow run un-retried (`canonicalMutation.ts:166-193`, `llmFetch.ts:22-51`). These are *credible* transient mechanisms for "fails live, works in a clean reproduction," but my 4-way harness did not trip any of them.

---

## 3. Does this contradict the GEMINI-BUDGET-CAL-1 close-out? **No.**
That close-out raised the Gemini reviewer ceiling to 32768 from a **lease** demand curve, as a behavioral snapshot. This diagnostic **confirms** 32768 is sufficient for normal deed-shaped reviews (probe + harness, both Gemini slugs, STOP with large headroom). The single observed "No return" is **out-of-band** — not reproduced — so it neither validates nor refutes the calibration; it sits outside the calibrated distribution (deeds were never in the calibration set). No prior accepted close-out is contradicted; nothing here requires reversing the recorded record.

---

## 4. Conclusion — narrowed, not pinned

**Ruled out (live/code evidence):** maxTokens wiring fallback (F1); invalid/unavailable model slug (F2); deterministic truncation on a normal deed (F4); in-panel 4×-Gemini concurrency 429 (F4).

**Remaining live candidates (could not disambiguate without the prod artifact):**
1. **Real-deed truncation.** The *actual* deed (doc `4a1e6d78`) + the *full* production reviewer prompt (calibrated instructions + matter-state injection + feedback-card output format) may demand far more output than my terse synthetic probe, pushing thinking+output past 32768 → `MAX_TOKENS` → "No return." Plausible, **unconfirmed** (my synthetic deed had ~30k headroom).
2. **Transient.** A one-off 429 (free-tier RPM accumulated across a busy UAT session), a network blip, or a sync-mode timeout race — none reproduce by nature.

**The decisive disambiguator is operator-side** and cheap: from the prod record for the failing run on doc `4a1e6d78`, retrieve **(a)** the reviewer-lane `status`/`failureReason` (the chip: Failed vs Timed out vs No suggestions) and **(b)** the server reviewer/`[token-accounting]` log line (`finishReason`, `thoughtsTokenCount`, `candidatesTokenCount`, `errorClass`). That single data point pins the class and selects the fix. A re-run of the *same* deed (now, solo) would also indicate transient-vs-persistent.

---

## 5. Minimal-fix candidates, keyed to the (still-to-confirm) cause — **DO NOT implement; for operator direction**

- **If MAX_TOKENS truncation (real deed exceeds 32768):** cap the Gemini **`thinkingBudget`** via the already-present-but-unwired `supportsThinkingControl` hook (the deferred L3 increment). Live-confirmed viable on the prod slug and it **preserves output** (F4, variant B). This is the surgical fix — it guarantees output room regardless of reasoning demand — and is **preferable to simply raising the ceiling again** (which the brief explicitly cautioned against). Optionally pair with a modest ceiling bump toward the 65536 provider headroom.
- **If 429 / rate-limit:** add **jitter** to the retry backoff (currently lockstep 500/1500ms) and/or lengthen backoff for `rate_limited`; consider a small fan-out stagger or concurrency cap. (F2 async would also spread the load — see §6.)
- **If timeout (sync undici/AbortSignal ~300s race):** F2 async activation fixes the undici race (long-timeout dispatcher); or, staying sync, align the per-call `AbortSignal` below undici's ceiling.
- **If a valid empty `[]`:** not a provider bug — a UX reconciliation between the "No suggestions" lane chip and the "No return" convergence denominator (`sessionConsolidation.ts:67`).

Each candidate is a behavior change; per the §3 corrected-diagnosis discipline, the **choice is the operator's**, and a model-behavior change (e.g., wiring `thinkingBudget`) may itself warrant the §3.1 triad review if it rises to load-bearing.

---

## 6. F2 async-activation interaction (flagged per the brief)

F2 async **changes the failure surface**: it raises the per-call envelope to 720s and swaps in the long-timeout undici dispatcher (removing the sync ~300s race), and on a restart-driven re-dispatch it spreads lane starts across poll cycles rather than one synchronous burst (`reviewSession.ts:664-669`, `dispatcher.ts:525-546`, `llmFetch.ts:22-39`). So **if the cause is concurrency/429/timeout, activating F2 may incidentally reduce or mask it**; **if the cause is truncation, F2 will not help** (same 32768 budget). Recommendation: treat F2 activation as a variable — if F2 is flipped, **re-observe** the Gemini "No return" rate, because the surface may shift for reasons unrelated to a fix.

---

## Out-of-scope log

- Wrote NO behavior fix. Read-only diagnostic + this doc + gitignored local repro artifacts (synthetic deed fixture, two throwaway probes, one harness run under `tools/calibration/inputs/` and `tools/calibration/runs/`). No prod action, no prod reviewer run, no flag/migration/deploy.
- Could not establish (no prod access): the exact failure class for doc `4a1e6d78` (needs the prod lane chip + token-accounting log line); the real deed's size/output demand.
- Incidental finding logged (GPT-5 reasoning-bound truncation on the synthetic at 16384) — not the reported issue; flagged for a separate look at the GPT track ceiling.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
