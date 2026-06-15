# CHAT-PANEL-REVIEWER-FAILURE-1 — Investigation report

Type: investigation-only (read + diagnose; no code change). Date: 2026-06-15 (America/New_York).
Trigger: live Phase-6 UAT — the CHAT-COPILOT-2-INCB multi-model review panel reached all three reviewer
vendors (GPT/Gemini/Grok) but every call failed.

## Repo state

- `origin/main = 3d2e422` (>= `4d02abf`; includes CHAT-COPILOT-2-INCB #313, the panel under investigation).
- Read-only investigation worktree off `origin/main`. No source modified. This report is the only artifact.

## Objective

Diagnose why all three panel reviewer lanes reached the providers but failed (egress decision `allowed`,
status `FAILED`, empty output) while the anthropic primary chat succeeded on the same matter; and confirm
the secondary UI bug (lanes shown as "success" while the egress failed). No fix in this engagement.

## Symptom (operator-observed, reproduced twice, prod 4d02abf)

- Panel dispatched to GPT (`openai:gpt-5`) + Gemini (`google:gemini-2.5-pro`) + Grok (`xai:grok-4`).
- Supervision egress log: all three `kind=chat_panel`, `decision=allowed`, `status=FAILED`, NPI 0, attach 0.
- Per-lane raw feedback: "No output returned for this reviewer."
- Panel result: correctly degraded to "no reviewers available — (this is not agreement — no panel ran)".
- Primary (`anthropic:claude-opus`): `chat_primary status=SUCCESS` on the same matter (anthropic key + egress OK).

The egress control plane is healthy (allow decision correct, logged, minimized). The failure is in the
provider call/response for the three non-anthropic tracks.

## Source map

- Panel reviewer dispatch: `src/server/procedures/chatReviewPanel.ts` (`panelSend` -> `egressClient.send` ->
  `executeCanonicalMutation`).
- Legacy reviewer dispatch: `src/server/procedures/reviewSession.ts` (`reviewer_feedback` jobs).
- Egress broker: `src/server/llm/egressClient.ts`. Canonical dispatch: `src/server/db/canonicalMutation.ts`.
- Adapters: `src/server/llm/{openai,google,xai}.ts`. Error classes: `src/server/llm/types.ts`.
- Reviewer model config: `src/server/llm/config.ts`.

## Findings

### A. Two confirmed code defects (independent of the provider root cause)

**A1 — laneStatus mislabel (the secondary UI bug), confirmed; ~one-line fix.** Traced end to end:

1. On a terminal provider error, `executeCanonicalMutation` RETURNS `{ status: 'failed' }` — it does NOT
   throw (`canonicalMutation.ts:761-787`). A 400/404 is non-retryable (`isTransientRetryable` false for
   `auth_error`/`api_error`); it fails fast on the first attempt.
2. `egressClient.send` then writes the `status='failed'` audit row but RETURNS NORMALLY (no throw)
   (`egressClient.ts:199-217`). It only throws when `executeCanonicalMutation` itself throws.
3. `panelSend` DISCARDS `egress.result.status` — it returns only `{ egressEventId, rawOutput }`, and
   `rawOutput` is `''` because `txn2Commit` (which captures output) runs only on success
   (`chatReviewPanel.ts:108-146`).
4. In `runReview` the `try` block therefore does not throw, and the lane is hard-coded
   `laneStatus: 'success'` with empty text (`chatReviewPanel.ts:~313`). This is exactly the symptom:
   failed egress + "success" lane + empty output. The panel still degraded correctly because
   `suggestions.length === 0` (no suggestions parsed from the empty output), not because the lane was
   marked failed.

Fix (future engagement): have `panelSend` check `egress.result.status !== 'completed'` and either throw
(so the `runReview` catch maps it to `laneStatus='failed'`) or return the status and condition the
assignment. Converts "success + empty + failed egress" into the correct "failed + null + failed egress".

**A2 — observability gap: the real provider error is not in the egress log.** The actual provider error
(e.g. "model does not exist") is written to `jobs.errorMessage` / `jobs.errorClass`
(`canonicalMutation.ts:781`). But `egressClient` writes only the string `'failed'` to
`chat_egress_events.failureReason` (`egressClient.ts:~213`), and `panelSend` discards the `jobId`, so there
is no link from the panel run to the `jobs` row. This is why the supervision log shows no useful error.
Part of the fix: propagate the real error into `failureReason` / `chat_review_raw_outputs.laneFailureReason`
and keep the `jobId` link.

### B. Provider root cause — leading hypothesis and the open fork

The configured reviewer model ids resolve IDENTICALLY for the panel and the legacy reviewer tracks via the
same `resolveReviewerModel` / `config.ts` (`openai:gpt-5`, `google:gemini-2.5-pro`, `xai:grok-4`). Two
readings are consistent with the code:

- LEADING (shared-provider / model-currency): the three model ids were retired/renamed by the providers
  while the system was dark, so each returns HTTP 404 -> `api_error` -> `status='failed'`, empty output.
  This cleanly explains all three failing identically, the `FAILED` status (not `timeout`), and anthropic
  alone working. Most symptom-consistent.
- ALTERNATIVE (panel-specific): the panel passes a different `structuredOutputSchema` than legacy and reuses
  `jobType:'chat_turn'`, which gets the default 120s timeout vs legacy's 300s for `reviewer_feedback`. The
  timeout divergence is a real latent bug (GPT-5 TTFT can exceed 120s) but it predicts a `timeout` status,
  not `FAILED`, and would not hit fast Gemini/Grok identically — so probably not this symptom. The
  schema-shape difference is weaker (both paths use structured output; only the shape differs).

Assessment: the code most strongly supports shared-provider model-currency, but this cannot be proven from
code alone; the panel does carry a real latent timeout-undersizing issue worth fixing regardless. Two
operator-run checks settle it (live provider runs and prod log/DB access are operator-driven):

1. Decisive query (do first). On prod TiDB:
   ```sql
   SELECT modelString, status, errorClass, errorMessage, createdAt
   FROM jobs
   WHERE jobType='chat_turn' AND status='failed'
     AND modelString IN ('openai:gpt-5','google:gemini-2.5-pro','xai:grok-4')
     AND createdAt >= '2026-06-15 13:40:00'
   ORDER BY createdAt DESC LIMIT 20;
   ```
   `errorMessage` shows the real per-provider error: `404 ... model does not exist` -> model-currency; a
   Zod/parse error -> schema; `timed_out` -> timeout. Also: Railway logs around the run timestamps for
   `LlmProviderError`.
2. Legacy fork. Run a normal Request Review (`reviewSession.create`) on a synthetic doc selecting
   GPT/Gemini/Grok. Legacy also fails -> shared-provider (model-currency/keys). Legacy succeeds ->
   panel-specific.
3. Optional (only if 1+2 inconclusive): a per-provider model smoke (a minimal provider call validating each
   model id) — a live provider call, operator-run.

## Recommended fix path (separate, scoped engagement — not this one)

- Always (regardless of root cause): A1 (laneStatus check) + A2 (propagate the real error; keep the `jobId`
  link). These make the panel honest about failures.
- If model-currency (most likely): update the reviewer model ids in `config.ts` to current provider ids —
  note this is a shared reviewer-model-currency fix (it also repairs the legacy reviewer tracks), not
  panel-specific; the operator supplies the current ids.
- Latent regardless: give the panel the reviewer timeout budget (`timeoutMs` ~300s) instead of the 120s chat
  default.

## Recommendation on the flag

Recommend `CHAT_REVIEW_PANEL_ENABLED` OFF until fixed — low urgency. It is safe (degrades to "no reviewers
available"; no data/egress risk beyond the failed calls), so leaving it on is acceptable. But it is
currently non-functional and the A1 mislabel shows green "success" lanes for calls that actually failed,
which is misleading in the attorney's supervision/audit view. OFF is the cleaner posture until the fix ships.

## Out-of-scope log

Did not modify source. Did not run live provider calls or access prod logs/DB (operator-driven; prepared
the exact steps above instead). No fix attempted — a fix is a separate, scoped engagement after the root
cause is confirmed by the operator-run query and/or legacy fork.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
