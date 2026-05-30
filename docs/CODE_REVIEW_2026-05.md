# Lex Law Next — Prioritized Code Review

**Date:** 2026-05-29
**Scope:** Read-only investigation. No source changed, no commits created. Findings only — no fixes recommended or applied.
**Reviewer note on evidence language:** "Confirmed by code inspection" = I read the cited file/lines. "Per exploration agent" = surfaced by a delegated read-only search and not independently re-read by me. "Consistent with" = inference from observed behavior. "Not established" / "not reproduced" = could not be verified within this read-only pass.

> **Status update (2026-05-30).** Several findings in this review have since been addressed and merged to `main` (now at `dc1e98e`):
> - **Information-request generation silently producing empty questionnaires** — fixed by **MR-IR-ERR-1** (failure now visible + retryable) and **MR-IR-GEN-2** (structured-output enforcement + tolerant parsing). Both live-verified.
> - **Sequential reviewer comparison view unreachable (review iteration always 1)** — diagnosed (MR-CAL-3D) and fixed (MR-CAL-3E, merge `dc1e98e`); review iteration is now computed server-side. Live-verified.
>
> **Still open from this review:** the **auth-bypass** flag (`AUTH_BYPASS_ENABLED`) was intentionally skipped and its production-env state is not established; and **outline generation** still shares the same JSON-contract brittleness that MR-IR-GEN-2 fixed for information requests. The findings below are preserved as written for the point-in-time record.

---

## 0. Priority summary

| # | Finding | Severity | Evidence class |
|---|---------|----------|----------------|
| 1 | Standing env-gated **auth bypass** disables all authentication when `AUTH_BYPASS_ENABLED=true`; live prod loaded with no login today | HIGH (confirm prod env) | Code-inspected; prod env not established |
| 2 | `informationRequest.generate` silently leaves the question matrix empty on LLM parse failure (no telemetry) | MED (user-visible) | Code-inspected |
| 3 | `canonicalMutation` revert + `markJobFailed` can both throw, leaving job state undefined | MED–HIGH | Per exploration agent; not independently inspected |
| 4 | Google adapter passes API key as a URL query parameter | LOW–MED | Code-inspected |
| 5 | Provider-output object-wrapper normalization duplicated across 3 adapters | LOW (tech debt) | Code-inspected |
| 6 | Token budget is a `chars/4` heuristic; truncation cuts mid-character | LOW | Code-inspected |
| 7 | Thin direct unit coverage for `assembleContext` tier/truncation math and job-dispatcher lifecycle | LOW–MED | Per exploration agent + spot-checked |

---

## 1. Architecture overview

**Stack (confirmed by code inspection — `package.json`, `src/server/db/connection.ts`):**
- TypeScript throughout. Server in `src/server/`, React 19 client (`.tsx`) in `src/client/`.
- API layer: **tRPC v11** (`router` / `protectedProcedure` in `src/server/trpc.ts`), mounted by **Express 4** at `/trpc`, plus a few REST routes (health/ready, material upload, DOCX export) in `src/server/index.ts`.
- Data layer: **Drizzle ORM** over **TiDB-compatible MySQL** via `mysql2` (pooled, `connectionLimit: 10`, `connection.ts:30`). Schema source of truth: `src/server/db/schema.ts`.
- Auth: **iron-session** cookie + **bcryptjs**. Client data fetching: TanStack Query + tRPC React client + react-router.
- Tests: **Vitest**. Package manager: **pnpm** (`pnpm-lock.yaml` present).

**Domain model & matter-based workflow (confirmed by procedures in `src/server/procedures/`):**
- **Matter** → **Documents** → **Versions** (version history per document).
- **Matter** → **Materials** (`matter_materials`, the draft context source).
- **Matter** → **InformationRequests** (Phase-4b "question matrix" / questionnaire) → **Items** (category / questionText / answerText).
- **Documents** → **ReviewSessions** → **Feedback** rows (reviewer suggestions) + manual selections.

**End-to-end flow:**
1. Create matter (`matters.ts`).
2. Add materials and/or generate+answer an information request (`informationRequest.ts`).
3. Generate a draft (`documents4a.ts`) — context assembled via `assembleContext`.
4. Open a review session (`reviewSession.create`) which fans out one reviewer job and persists parsed feedback.
5. Attorney selects suggestions; `reviewSession.regenerate` re-drafts.
6. Attorney is the final decision-maker — multi-reviewer is gated to exactly one (see §3), and the evaluator/auto-synthesis path is structurally inert.

**Async execution:** LLM operations run through a job dispatcher (`jobs/dispatcher.ts`) and a two-transaction `executeCanonicalMutation` wrapper (`db/canonicalMutation.ts`): txn1 enqueues a job row, the LLM call runs, then txn2 commits (persist result) or reverts (emit failure telemetry).

---

## 2. Materials → drafting context pipeline (the recent-defect area)

**Single authoritative assembler (confirmed — `src/server/context/pipeline.ts`):** `assembleContext()` is the sole context builder (commented R14). Three tiers (`pipeline.ts:169–346`):
- **Tier 1 — pinned materials:** always included; throws `PINNED_OVERFLOW` (`PRECONDITION_FAILED`) if pinned alone exceed budget (`pipeline.ts:195`).
- **Tier 2 — explicit sibling documents:** included in attorney-selected order, truncated to remaining budget.
- **Tier 3 — non-pinned materials:** recency-ordered, truncated to remaining budget.

**Callers (confirmed via grep):** `documents4a.ts` (draft generation, lines 180/496/635), `reviewSession.ts` `_invokeDocumentRegenerate` (line 744), `outline.ts` (62/167), and `contextPipeline.preview` (the only client-callable surface).

**The recent defect and its fix (confirmed):**
- `assembleContext` reads only `matter_materials` (via `listPinnedMaterials` / `listMaterialsForMatter`). Completed questionnaire answers live in the Phase-4b item tables, **not** in `matter_materials` — so before the fix, drafting saw "no client materials."
- Fix: `informationRequest.createMaterialFromCompleted` (`informationRequest.ts:460–519`) converts a completed questionnaire into a draft-visible material, tagged `completed_questionnaire` + `information_request:<matrixId>`, idempotent (one material per matrix, `:489–495`). Requires status `complete` and ≥1 answered item. **Verified end-to-end live earlier today** (see `MR-UAT-MATERIALS-2_live_verification_close_out.md`).

**Positive correction to an earlier hunch:** `listMaterialsForMatter` *does* order by recency (`orderBy(desc(createdAt))`, `materials.ts:77`) and *does* exclude soft-deleted rows by default (`isNull(deletedAt)`, `:70–72`). The Tier-3 "sorted by recency" doc comment is satisfied — no discrepancy.

**Observations (not defects unless noted):**
- **Mislabeled exclusion reason (cosmetic):** an attorney-excluded pinned material is pushed to `excluded` with `reason: 'deleted'` (`pipeline.ts:178`); it is excluded, not deleted. Affects telemetry/diagnostic accuracy only.
- **Heuristic token budget:** `estimateTokens = ceil(len/4)` (`pipeline.ts:52,125`) — not a real tokenizer. Truncation (`truncateToTokenBudget`, `:129`) slices by character count, so a material can be cut mid-word/mid-sentence with no semantic boundary. LOW.

---

## 3. Reviewer-calibration runtime + provider adapters

**Active runtime contract (confirmed — `src/server/llm/parsers/feedbackParser.ts`):**
- Legacy wrapper = `RawSuggestionsArraySchema` = `z.array({ title, body, severity })`.
- `parseFeedbackOutput(raw)` strips ```` ```json ```` fences, `JSON.parse`, Zod-validates, stamps a `crypto.randomUUID()` per item. **Fail-loud**: throws `REVIEWER_OUTPUT_MALFORMED` on parse or schema failure; empty array `[]` is valid.
- Invoked at `reviewSession.ts:215` inside `txn2Commit`.
- `parseFeedbackCardOutput` (MR-CAL-1, `feedbackParser.ts:100`) is a **separate, non-active** native feedback-card parser. Consistent with CLAUDE.md ("NOT native feedback-card runtime").

**Reviewer fan-out (confirmed — `reviewSession.ts:72–312`):**
- `selectedReviewers` schema is gated `.min(1).max(1)` (MR-0G, `:80–84`) — **multi-reviewer disabled at the API boundary**.
- The evaluator branch fires only when `selectedReviewers.length > 1` (`:263–300`), so it is **structurally unreachable** — dead but intentional (documented inert path).
- Reviewer jobs use `structuredOutputSchema: RawSuggestionsArraySchema`, `temperature 0.4`, `maxTokens 16384`, and a **300 000 ms** timeout (raised for GPT-5 TTFT, `:203–211`).
- Calibrated four-track prompt via `buildReviewerSystemPrompt` (`reviewerPrompts.ts`); the legacy parser wrapper keys (title/body/severity) are preserved.

**Four provider adapters (confirmed; dispatched by `registry.ts` on the `provider:` prefix):**
- **OpenAI** (`openai.ts`): `json_object` mode forces an object, so GPT wraps the feedback array. `normalizeOpenAiStructuredOutput` (Rules 1–6) recovers the array from single-key, known multi-key, nested, or singleton wrappers before Zod. Guards on `finish_reason` `content_filter`/`length` and empty content. `gpt-5`/`o`-series use `max_completion_tokens` and omit temperature (`:253`).
- **Anthropic** (`anthropic.ts`): no native structured mode — appends a JSON-only instruction, `stripJsonCodeFenceIfWholeResponse`, then `normalizeAnthropicStructuredOutput` (Rules 1–4). Temperature intentionally omitted (extended-thinking models reject it, `:150–153`).
- **Google** (`google.ts`): `responseMimeType: application/json`; all `SAFETY_SETTINGS` = `BLOCK_NONE` for legal content (`:68–73`); explicit empty-candidate / no-text guards to surface safety blocks (`:145–158`). **No object-wrapper normalization** — assumes Gemini returns the bare array.
- **xAI/Grok** (`xai.ts`): OpenAI-compatible; `normalizeGrokStructuredOutput` mirrors the OpenAI logic (Rules 1–6). Grok disabled by default at seed (decision #43, re-enable via Settings, no deploy).
- All adapters read their API key from env **at invocation time**; a missing key is an `api_error` only when that adapter is actually called (`config.ts:16–20`).

**GPT raw-artifact open issue (consistent with CLAUDE.md):** parse-failure diagnostics are deliberately sanitized to structural shape only (`sanitizeShapeForDiagnostic`, `openai.ts:93`/`xai.ts:96`) — they never include document/feedback content or keys. The adapter re-serializes the *normalized* array for downstream parsing and does **not** persist the *raw* provider output. This is consistent with the note that GPT P8-T1/P8-T6 classifications "could not be auditably reconstructed." Per operating rules, I made no prompt/parser/scoring change.

**Fragility (tech debt):** the wrapper-key constants and normalization functions are near-duplicated across `openai.ts`, `xai.ts` (identical Rules 1–6) and `anthropic.ts` (Rules 1–4 subset). Divergence risk if one is patched. LOW.

---

## 4. Security & credential handling

**Authentication (confirmed — `middleware/session.ts`, `trpc.ts`):**
- iron-session cookie `lex_session`: `httpOnly`, `sameSite: 'lax'`, `secure` only when `NODE_ENV==='production'`, 14-day `maxAge`.
- `SESSION_SECRET` required (≥32 chars per comment); module throws at load if absent (`session.ts:23–28`).
- `userId` is drawn exclusively from `ctx.userId`, never from procedure input — consistently enforced across all procedures read (Ch 35.2). Good.
- Passwords hashed with bcryptjs (dependency; `auth.ts`).

**⚠️ Standing auth bypass — HIGH, flagged per request (confirmed — `middleware/authBypass.ts`, wired in `trpc.ts:79–88` and `index.ts:151/297/494`):**
- When `AUTH_BYPASS_ENABLED === 'true'`, the `isAuthenticated` tRPC middleware returns `userId = getBypassUserId()` **without any session validation** — every `protectedProcedure` becomes unauthenticated. Three REST handlers likewise skip `getSession`.
- Fallback synthetic user `00000000-0000-0000-0000-000000000000` when `AUTH_BYPASS_USER_ID` is unset (DB-backed routes would fail FK lookups; stateless routes work).
- During today's live UAT the deployed app loaded straight into the matter list as user "kelly" with **no login prompt** — *consistent with* the bypass being enabled in the Railway production environment. **I did not inspect Railway env vars; whether `AUTH_BYPASS_ENABLED` is set in production is not established.** If it is enabled in prod, the entire production app is reachable without authentication by anyone with the URL. This is the top item to confirm.

**Credentials:**
- Provider keys are never logged or echoed; read from env at call time. Adapter error strings include the provider HTTP error *body* (e.g. `openai.ts:285`) but not the key.
- **Google adapter places the API key in the URL query string** (`google.ts:96`, `?key=${apiKey}`). This follows Google's API design, but URL-embedded secrets are more prone to landing in logs/proxies than header auth. LOW–MED.
- Diagnostics are sanitized to structure only (no content/keys) — good.
- No secret values in the repo; `.env.example` documents names only.

---

## 5. Error handling, fragility, tech debt

- **Silent empty questionnaire (MED, user-visible — confirmed):** `informationRequest.generate` `txn2Commit` wraps matrix parsing in `try { … } catch {}` and, on failure, "leaves matrix empty" with **no telemetry** (`informationRequest.ts:144–157`). This matches the 0-question matrix observed during today's live UAT — the user gets an empty questionnaire and no signal that generation/parse failed.
- **Cascade failure in canonical mutation (MED–HIGH — per exploration agent, not independently inspected):** in `db/canonicalMutation.ts` (~`330–388`), if `txn2Revert` fails the code calls `markJobFailed`, which can itself throw, potentially leaving job state undefined. Worth a direct read before any change.
- **Fire-and-forget telemetry (LOW):** pervasive `void emitTelemetry(...)`. Per agent, `emitTelemetry` swallows write errors to stderr — telemetry loss is silent. Acceptable by design but worth noting against the "no silent failures" principle.
- **Non-null assertions after filters (LOW — per agent):** `outline.ts` uses `r.data!` after a `.filter(success)` and has empty catch blocks that leave `sections` empty without telemetry.
- **Deprecated timeout constant (LOW — confirmed):** `LLM_FETCH_TIMEOUT_MS` is marked `@deprecated` in favor of `getLlmFetchTimeoutMs()` (`config.ts:41`) but is still imported and `void`-referenced in `anthropic.ts:278`. Dead reference.
- **Dead-but-intentional evaluator path (LOW):** retained inert in `reviewSession.ts:246–300`.
- **Adapter normalization duplication (LOW):** see §3.

---

## 6. Test coverage observations

**~45 test files** across server/client/db (`src/**/__tests__`). Per the test-coverage exploration agent plus my spot checks:

**Well covered:** auth bypass (`mr_auth_bypass_1.test.ts`), the materials-from-questionnaire bridge (`mr_uat_materials_2.code_audit.test.ts`, exercises `createMaterialFromCompleted` + idempotency + tagging), Phase-4b acceptance, the feedback parser and calibration (`mr1.reviewer_path`, `mr_cal_1/2/2a/2d`, `mr_llm_lite_*`, `mr_llm_gpt_1`, `mr_llm_grok_1`), all four adapters (unit), and DOCX export/upload formatting (7+ files).

**Thinner:**
- **`assembleContext` tier/truncation math:** `phase3.acceptance.test.ts:178` tests `PINNED_OVERFLOW` and `:441` asserts the export exists, but the budget/truncation arithmetic is largely **mocked out** in integration tests — no dedicated unit suite. LOW–MED.
- **Job-dispatcher lifecycle:** only the Zod-wall (`jobsZodWall.test.ts`); no end-to-end queue→run→complete test located. LOW–MED.

**Parallel-test stall (matches CLAUDE.md):** per the agent, the culprit is `src/server/__tests__/mr2.s4e_e2e_behavioral.test.ts`, which runs `executeCanonicalMutation` + `parseFeedbackOutput` as production code via `createCaller`; its heavy async chains stall under file parallelism. Workaround `pnpm exec vitest run --no-file-parallelism` (CLAUDE.md). **Not reproduced** here (read-only; tests not run).

**Live adapter tests safely gated (confirmed via agent):** `adapters.live.test.ts` runs only when `RUN_LIVE_TESTS=1`, so default `pnpm test` makes no real provider calls.

---

## 7. CLAUDE.md CONFIRM items (findings; proposed edits delivered separately for approval)

- **Production / Railway:** `railway.json` defines a Dockerfile build with `healthcheckPath: /api/health`; `package.json` has `build:railway` and `start: node dist/server/index.js`. Railway deployment config is **confirmed by code inspection**; auto-deploy-from-`main` is a dashboard setting and is **not establishable from the repo**.
- **API/framework layer:** tRPC v11 procedures in `src/server/procedures/` (auth, matters, documents, documents4a, versions, materials, informationRequest, reviewSession, outline, references, settings, templates, jobs, contextPipeline) — confirmed.
- **DB layer:** Drizzle ORM over TiDB-compatible MySQL (`mysql2`); `matter_materials` and Phase-4b information-request tables confirmed (`materials.ts`, `db/queries/phase4b.ts`).
- **Build/deploy scripts:** `build` / `build:railway` (tsc → vite → esbuild bundle), `start`, Drizzle-kit migration scripts (`db:generate` / `db:migrate` / `db:push`) — confirmed in `package.json`.
- **Stack/tests/PM:** TypeScript, Vitest, pnpm — confirmed (`package.json`, `pnpm-lock.yaml`, `vitest.config.ts`).

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
