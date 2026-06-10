# PROJECT_REVIEW.md — Comprehensive Read-Only Review

**Date:** 2026-06-09
**Scope:** Full repository at `C:\Users\Kelly\Documents\lex-law-next5-local`, branch `main` @ `d7a03fa` (current as of today). Read-only — no source files were modified; this report is the only file created.
**Evidence discipline (per Operating Plan Rule 3):** every finding is labeled — `(verified — direct read)` I read the cited lines myself; `(verified — test run)` I ran it; `(agent-verified)` surfaced by a delegated read-only exploration agent with file:line citations, spot-checked where load-bearing; `(unverified)` could not be confirmed this pass and is labeled as such.
**Test baseline this review:** full suite run locally (`vitest run --no-file-parallelism`): **2,136 passed / 11 failed / 17 skipped (2,164)**. The 11 failures are the documented pre-existing Windows-local CRLF source-scan failures (green on Linux CI; e.g. `src/server/__tests__/phase4b.acceptance.test.ts:113` asserts `\n`-sensitive file content). No new failures.

---

## 1. Executive Summary

Lex Law Next ("Whereas") is in **substantially better shape than its own documentation says it is**. The two top risks from the May 2026 internal review — the production auth bypass and IDOR exposure — are genuinely fixed: the bypass module is deleted (test-enforced), every sampled query is owner-scoped through a single chokepoint with a CI ratchet, all 25 migrations are additive, no secrets are tracked in git or its history, and the Zod Wall invariant holds everywhere sampled. The governance process (engagement loop, triad reviews, additive-only deploy runner, Pattern-16 live verification) is unusually disciplined for a one-attorney project and has demonstrably caught real defects.

**No CRITICAL findings.** The highest-severity problems cluster in one theme: **the system is not durable around its long-running LLM work and its client files.**

1. **Original uploaded files are never stored anywhere** — only extracted text reaches the DB; the `storageKey` written to the DB points to nothing. Background OCR holds the only copy of a scanned document's bytes in process memory; a deploy or crash mid-OCR strands the material in `processing` forever with the content unrecoverable. For a law firm, losing the original client document is a records-management problem, not just a bug. (HIGH)
2. **Free-text draft generation silently truncates.** The truncation guards added for reviewers (structured output) do not cover the drafter/regeneration/formatting paths: a will or trust that exceeds the 8,192-token output budget is cut off mid-sentence and saved as a normal version, with the truncation visible only in a server console log. This is the exact failure class the project spent S11/S12 fixing on the reviewer path. (HIGH)
3. **No recovery for stuck jobs/sessions.** Orphan detection is a startup `console.log` stub; terminal-state writes in the canonical mutation are themselves unguarded; async reviewer fan-out is in-process fire-and-forget; the actual DB-backed dispatcher polls every 2 s with zero registered handlers (dead code burning DB queries). The documented "stuck active session" carryforward is a direct consequence. (HIGH)

Strategically: **the architecture is right for the goals; nothing needs a rewrite.** The one re-architecture worth doing is routing background LLM work through the already-built (currently dormant) job dispatcher to get restart-durability. The biggest imbalance is that **process is over-built relative to runtime durability**: the repo has ~70 governance documents and a 4,000-word JSON "state" field, while production has no blob storage, no automated DR posture (everything `PENDING ATTORNEY SIGN-OFF`), and no job reaper. The first five actions (§6) are: job/session reaper → persist original file bytes → drafter truncation guard → migration-allowlist automation → state/doc reconciliation + dependency patches.

---

## 2. Project Understanding (Phase 1)

### (a) Stated purpose and goals
An **attorney-supervised legal AI drafting and review platform** for The Satterwhite Law Firm PLLC (operator: Kelly Satterwhite, Esq.), scoped to **transactional document assembly** (estate planning instruments, deeds; explicitly NOT title/settlement, litigation, M&A, or advisory). Matter-based workflow: create matter → intake parties/conflicts → add materials → generate draft → calibrated multi-model reviewer passes → attorney adopts/declines/locks → finalize/export. Two non-negotiable product invariants recur in every document: **the attorney is always the final decision-maker** ("automate the labor, never the judgment"), and **the five explicit acts** (lock, tier, disposition, send, matter identity) must never become ambient inference.

### (b) Intended architecture
Single TypeScript codebase (`kelly148/lex-law-next5`): React 19 + Vite client, Express 4 + tRPC v11 server, Drizzle ORM over TiDB Cloud (MySQL-compatible), iron-session cookie auth, four LLM provider adapters (Anthropic primary drafter; GPT/Gemini/Grok/Claude as calibrated reviewers) behind a registry, all LLM work through a two-transaction `executeCanonicalMutation` job pattern, deployed on Railway via Dockerfile with an additive-only pre-deploy migration runner. The "Whereas fold" roadmap (`docs/WHEREAS_FOLD_master_plan.md`) extends this with a Matter-State Engine (Layer 1), intake/conflicts (Layer 0), practice knowledge base, multi-model orchestration, deterministic sendability gate, and a practice-management spine — Phases 0–4 of which are now substantially built.

### (c) Key design constraints and invariants the documents commit to
- **Zod Wall** (every JSON/enum DB read passes a Zod parse in `db/queries/*`), **session-derived `userId`** (never from input), **`useGuardedMutation`** on every mutation button, **no silent failures** (telemetry on every caught exception).
- **Owner-scoping on all core objects** post-FOLD-AUTH-1, private-by-default, ownership as a first-class relationship.
- **Additive-only automated migrations**; destructive DDL is operator-gated and manual.
- **Merge ≠ deploy** (Railway auto-deploy OFF); deploy is always operator-gated; **Pattern 16**: code-level closure ≠ live verification.
- **Audit as Matter Record** (immutable `audit_events`, never purged), advisory-not-blocking gates rolled out shadow-first behind flags (sendability, conflicts, deadline engine).
- Governance: two-phase engagements, FIRE/triad review for load-bearing irreversible decisions, evidence-class labeling, no credential exposure.

### Ambiguities/contradictions in the documents (flagged per request)
1. **CLAUDE.md's "Current state (as of 2026-06-02)" is five+ phases stale** — it says "queue head = FOLD-AUTH-1" and "MR-CAL COMPLETE; WHEREAS FOLD queue OPEN," but FOLD-AUTH-1 through FOLD-PM-1, DOC-CLIENT-TARGET-1, MATERIALS-DROPZONE-1 A+B, REVIEW-UX-REDESIGN-1 etc. are all merged. The reviewer-models table in CLAUDE.md (Opus 4.5/GPT-5/etc.) matches code, but the "Immediate next action" section actively misdirects a fresh session.
2. **`docs/MR_CAL_engagement_state.json` self-acknowledges drift** — `"state.json completed/queue arrays STILL pending reconciliation"`; its `queue` still lists three engagements (GEMINI-BUDGET-CAL-1-INC2, REVIEWER-ASYNC-FANOUT-1, REVIEWER-RETRY-SUPPRESS-1) that merged on 2026-06-08, and `completed_engagements` omits the most recent ~10. CLAUDE.md calls this file "the authoritative HEAD/queue source" — it is not currently authoritative, which is precisely the "contradiction tripwire" condition the governance rules treat as a hard stop.
3. **Operating Plan v1.9 says "AUTHORITATIVE"** but describes the Manus-as-build-agent / PAT-in-URL era that CLAUDE.md's Claude-Code-native rules have superseded in practice (e.g., v1.9 §1.4 PAT-in-URL vs CLAUDE.md "Do NOT use or request personal access tokens"). Nothing states which document wins; a fresh agent reading `docs/` first would follow the wrong process.
4. **`DEPLOYMENT.md` / `.env.example` document a `STORAGE_BACKEND` (filesystem/S3) that does not exist in code** (zero references in `src/server`; uploads are memory-only — see finding H2).
5. **README.md** still describes the project as "Lex Law Next v1" with phase-branch strategy and "Multi-reviewer disabled at the API boundary" — superseded by the fold; harmless but stale.

---

## 3. Architecture Map — What Is Actually Built (Phase 2)

### Server (`src/server/`, ~209 source files)
- **Entry** `index.ts` (~790 lines): Express app; REST routes `/api/health`, `/api/version`, `/api/ready` (unauthenticated health), `POST /api/materials/upload`, `GET /api/documents/:id/export`, `POST /api/upload-format` (all three session-authenticated, ownership-checked); static SPA serving; tRPC at `/trpc`; dispatcher startup.
- **API layer**: 25 tRPC routers / ~174 procedures (`router.ts:43-85`), all `protectedProcedure` except `auth.login`. Domains: auth, matters, documents (+4a generation), versions, materials, references, templates, information requests, outline, review sessions, matter state, shared context, reusable artifacts, matter intake/conflicts, practice KB, orchestration, provision provenance, LDD key terms, closure packages, sendability gate, deadlines (flag-gated), jobs, settings, context pipeline. (agent-verified, spot-checked)
- **Auth**: iron-session cookie (`middleware/session.ts`), `SESSION_SECRET` required at boot, `ctx.userId` injected by `isAuthenticated` middleware (`trpc.ts:78-99`). **Auth bypass removed** — no `authBypass.ts` exists; `mr_fold_auth_1.test.ts` asserts the env flag has no effect. (agent-verified + test run)
- **Ownership**: single `ownerScope()` chokepoint + `assertOwned()` (`db/ownerScope.ts:38-54`) with a frozen-baseline CI ratchet (`mr_fold_auth_2.test.ts`) forbidding new inline `eq(*.userId, …)` filters. All sampled reads filter by owner. (agent-verified)
- **Data layer**: ~35 tables in `db/schema.ts` (~2,400 lines); no DB-level FKs (app-enforced ordering, e.g. `matterPurge.ts` children-before-parent cascade in one transaction); generated columns enforce one-active-matrix/session invariants; soft-delete via `deletedAt`/`archivedAt`; Zod Wall on every sampled JSON read with `zod_parse_failed` telemetry. 25 migrations (0000–0024), **all additive**. (agent-verified)
- **LLM layer**: registry-dispatched adapters (`anthropic.ts`, `openai.ts`, `google.ts`, `xai.ts`), per-model ceilings in `modelCapabilities.ts` (Gemini reviewer 32,768; all others 16,384), structured-output truncation guards in all four adapters, bounded transient retry (2 retries, 500/1500 ms, undici-timeout suppressed) in `canonicalMutation.ts:108-161`, 300 s sync / 720 s async reviewer envelopes with an undici long-timeout dispatcher (`llmFetch.ts`). Prompts hardcoded in `llm/prompts/*` with version *labels* (not text) snapshotted per job. (agent-verified, truncation guards + ceilings spot-checked by direct read)
- **Job execution**: `executeCanonicalMutation` two-transaction pattern (txn1 enqueue → LLM call with heartbeats → txn2 commit/revert). **All real work runs inline in the request (or fire-and-forget in async mode); the polling dispatcher (`jobs/dispatcher.ts`) starts at boot but has zero registered handlers** (verified — direct read; `registerJobHandler` has no non-test callers, `index.ts:775` starts it anyway).
- **Feature flags** (`config/featureFlags.ts`): multi-reviewer ON, evaluator ON (sync only), conflict gate ON, sendability gate SHADOW/OFF, deadline engine OFF, reviewer-async OFF.

### Client (`src/client/`, 43 components/pages)
8 routes behind `AuthGuard`; tRPC + TanStack Query with jittered job polling that stops on terminal states; `useGuardedMutation` used on **100% of sampled mutations**; `PanelErrorBoundary` around review panes (no root-level boundary); errors surfaced inline (no toast system). Largest components: `ReviewPane.tsx` (2,005 lines), `DocumentDetail.tsx` (1,358). (agent-verified; the one "silent error" claim the agent made about `InformationRequestPage` is **disproven** — the failure banner renders at `InformationRequestPage.tsx:588-591`.)

### Ops
Dockerfile 3-stage build with per-commit cache-busting and a baked `/api/version` stamp; `railway.json` `preDeployCommand` runs the additive-only allowlist migration runner (`scripts/apply-prod-migrations.mjs`) — deploy fails (previous version keeps serving) if a migration fails; CI = tsc + vitest + eslint on every PR/push; post-deploy smoke workflow + `tools/deploy/smokeCore.mjs` (auto-rollback path documented as untested against a live token); offline calibration harnesses in `tools/calibration/`.

### Spec-vs-reality divergences
| # | Documented | Reality | Direction |
|---|---|---|---|
| D1 | `STORAGE_BACKEND` filesystem/S3 with `/uploads/<matterId>/…` paths (DEPLOYMENT.md, .env.example) | No storage backend exists; files are never persisted; `storageKey` is a fabricated path (`index.ts:219-222`) | Docs ahead of code (fiction) |
| D2 | "Job dispatcher (Ch 8)" as the async execution spine | Dispatcher runs but is handler-less dead code; real work is inline/fire-and-forget | Docs ahead of code |
| D3 | CLAUDE.md current-state + queue-head | ~5 phases stale (see §2 ambiguity 1) | Docs behind code |
| D4 | `state.json` "authoritative tracker" | Self-acknowledged unreconciled queue/completed arrays | Docs behind code |
| D5 | Operating Plan v1.9 "AUTHORITATIVE" (Manus/PAT process) | Superseded in practice by CLAUDE.md engagement loop | Unresolved supersession |
| D6 | README v1 invariants ("multi-reviewer disabled", phase branches) | Multi-reviewer ON; fold-era branching | Docs behind code |
| D7 | Prior review's HIGH "auth bypass" and MED "silent empty questionnaire" | Both fixed and test-covered (`mr_fold_auth_1.test.ts`; MR-IR-ERR-1/GEN-2 + visible failure banner) | Code ahead of stale findings |

---

## 4. Findings (Phase 3)

**No CRITICAL findings.** (CRITICAL reserved for: exploitable unauthenticated access, secrets exposure, or active data corruption. None found — auth enforced everywhere sampled, no tracked secrets in git or history (`git log --all --diff-filter=A -- .env*` empty), migrations additive.)

### HIGH

**H1 — Free-text LLM outputs (drafts) silently truncate and persist.** *(verified — direct read)*
- Evidence: the Anthropic truncation guard sits **inside** the `if (structuredOutputSchema)` branch (`src/server/llm/anthropic.ts:208-223`); free-text calls return `rawText` regardless of `stop_reason` (`anthropic.ts:298`). Draft generation, regeneration, and formatting pass `maxTokens: 8192` (`src/server/procedures/documents4a.ts:571,715,1198`) with no schema. On return, the only consumer of the stop reason is a best-effort `console.info` token-accounting log explicitly wrapped so it "can never affect the job outcome" (`src/server/db/canonicalMutation.ts:680-702`). `txn2Commit` persists the truncated content as a normal version.
- Impact: a long will/trust exceeding ~8k output tokens is saved cut-off mid-sentence with no UI signal. The project's own history shows this failure class is real (S11: "live-verified insufficient on a Last Will Testament" — fixed for *reviewers* only). An attorney could plausibly miss a truncated tail in a long instrument.
- Proposed fix: in `executeCanonicalMutation` (single chokepoint), treat `stopReason/finishReason ∈ {max_tokens, length, MAX_TOKENS}` on **non-structured** jobs as either (a) a hard `api_error` (parity with reviewers), or (b) persist-with-flag: store a `truncated` marker on the version and render an unmissable banner. Also raise the drafter budget to the model ceiling via `modelCapabilities.ts` (the registry already exists).

**H2 — Original uploaded client files are never persisted; background OCR can permanently lose content; no stale-`processing` recovery.** *(verified — direct read)*
- Evidence: uploads use `multer.memoryStorage()` (`src/server/index.ts:153-156`); only extracted text is written to `matter_materials`; `storageKey` is fabricated from a placeholder UUID and no write to disk/S3 exists anywhere (`index.ts:219-222`; `grep STORAGE_BACKEND|writeFile src/server` → no hits outside tests). For images/scanned PDFs the only copy of the bytes is captured in an in-process fire-and-forget closure (`src/server/intake/ocrPipeline.ts:1-100`); the file's own comment concedes a failed DB write "leaves the row 'processing' for a backfill sweep to retry" — but no sweep exists (`grep processing src/server/db/queries/materials.ts` → comment only) **and a sweep could never succeed because the bytes are gone**. A deploy (Railway restarts on every deploy), crash, or OCR error after the DB write path → material stuck `processing` forever; client polls indefinitely.
- Impact: (a) silent permanent loss of client-document content with a 201-success already returned to the user; (b) records-management exposure — the firm cannot re-export or re-process the original instrument it was given; the retention/client-file-return posture (`docs/retention_dr_posture.md`) presumes materials exist to return; (c) misleading `storageKey` column invites future code to trust a path that points to nothing.
- Proposed fix (ordered): (1) persist original bytes at upload time (TiDB LONGBLOB is acceptable at this scale; S3/R2 later) and make `storageKey` real or remove it; (2) run OCR from the persisted bytes so it is retryable; (3) add a startup + periodic sweep marking `processing` rows older than N minutes as `failed` with a user-visible "please re-upload" message. Also note `MAX_INFLIGHT_OCR = 8` × 50 MB uploads (`ocrPipeline.ts:22`) can pin ~400 MB of heap on a small Railway instance — bound by bytes, not count, once persistence exists.

**H3 — No recovery path for stuck jobs and review sessions; orphan detection is a stub; async fan-out is restart-fragile by design.** *(verified — direct read, corroborated by two agents)*
- Evidence: (a) `logOrphanedJobs()` prints a startup message only — "Phase 3+ concern," no query, no reaper (`src/server/jobs/dispatcher.ts:74-88`); (b) every revert-failure catch in `executeCanonicalMutation` awaits `markJobFailed` **unwrapped** — if it throws (likely when the DB is the reason the revert failed), the job stays `running` forever (`canonicalMutation.ts:548,575,599,644`); (c) `updateJobHeartbeat` at `canonicalMutation.ts:619` is awaited unguarded **between a successful LLM call and txn2-commit** — one transient DB blip there discards a completed (paid-for) LLM result and strands the job; (d) async reviewer fan-out is in-process `void promise.catch(console.error)` (`procedures/reviewSession.ts:408-416`), with the restart loss documented as a v1 limitation (`config/featureFlags.ts:60-62`); (e) the documented `STUCK-ACTIVE-SESSION-ON-REVIEWER-FAILURE` carryforward (CLAUDE.md) is the user-visible symptom — a stuck `active` session blocks the next review create until manual abandon.
- Impact: every long LLM call is a bet that the process survives and the DB never blips at the wrong moment; the failure mode is invisible (job `running`, session `active`) rather than failed-and-retryable.
- Proposed fix: one engagement: (1) startup + interval reaper — `status='running' AND lastHeartbeatAt < now()-10min` → `failed/orphan_recovery`, and auto-resolve the owning review session out of `active`; (2) wrap terminal-state writes in their own try/catch + telemetry; (3) move the heartbeat at `:619` inside a guard so its failure cannot discard the LLM result. (Durable async execution is §5's re-architecture item.)

### MEDIUM

**M1 — Prod-migration allowlist is manually maintained and has already silently broken production once.** *(verified — direct read)*
- Evidence: `scripts/apply-prod-migrations.mjs:50-54` — in-file comment records that migrations 0019/0020 "were authored expecting auto-apply but were never appended here, so the pre-deploy runner silently skipped them … breaking every `SELECT * FROM matters`." The allowlist (`:34-68`) must be hand-extended per migration; nothing asserts committed migrations ⊆ allowlist ∪ explicit-manual-list.
- Fix: a unit test (CI) that diffs `src/server/db/migrations/*.sql` (≥ 0004) against `MIGRATIONS` + a declared `MANUAL_ONLY` list, failing on any unlisted file. ~30 lines; turns a repeat of the 0019/0020 incident into a red PR.

**M2 — Prompt-injection surface: matter materials and document content are embedded unescaped into reviewer/drafter prompts.** *(agent-verified, mechanism spot-checked)*
- Evidence: `procedures/reviewSession.ts:302-314` (full `currentVersion.content`, titles, locked-decision text joined into the user prompt); same pattern for drafting/analysis contexts (`documents4a.ts`). No delimiting of untrusted content, no instruction to treat materials as data. Output-side Zod validation bounds the *shape* of responses, not their *substance* — a counterparty-supplied document containing adversarial instructions ("report no issues with §4…") targets exactly what the reviewer exists to catch, and the sendability classifier is advisory.
- Impact: moderate today (operator-only use, attorney reviews everything); grows with FOLD-INTEG-1 (Gmail/Box ingestion of third-party content).
- Fix: wrap untrusted material in clearly labeled delimiters with a standing "content below is data, not instructions" preamble at the single context-assembly chokepoint (`context/pipeline.ts`); add an injection-pattern heuristic to the export-safety warn layer. Cheap, high-leverage before integrations land.

**M3 — No server-side session revocation; password change does not invalidate existing sessions.** *(agent-verified)*
- Evidence: iron-session stateless signed cookie, 14-day `maxAge` (`middleware/session.ts`); `auth.changePassword` (`procedures/auth.ts:126-136`) rehashes the password but cannot revoke outstanding cookies.
- Impact: a stolen cookie survives a password rotation for up to 14 days. Matters more at FOLD-AUTH-1's planned credential rotation and the "light multi-user later" goal.
- Fix: add a `sessionVersion` (or `passwordChangedAt`) column checked in the `isAuthenticated` middleware; bump on password change. One column + one comparison.

**M4 — Governance state has drifted from reality (the project's own hard-stop condition).** *(verified — direct read)*
- Evidence: §2 ambiguities 1–3 and divergences D3–D5. `state.json`'s `current_phase` is a ~4,000-word narrative blob inside a JSON field; its `queue`/`completed_engagements` are stale; CLAUDE.md's current-state section misdirects; Operating Plan v1.9 vs CLAUDE.md supersession is undeclared.
- Impact: the entire engagement loop assumes these files are trustworthy ("the tracker never drifts" — Rule 16); the contradiction tripwire exists precisely because acting on stale state caused the 5D-class failures. A fresh agent (or the operator after a break) bootstrapping from these files starts wrong.
- Fix: one bookkeeping pass: reconcile `state.json` arrays; move narrative out of `current_phase` into `STATE.md` (which already does this job well); replace CLAUDE.md's "Current state" with a pointer to `STATE.md` newest entry; add a supersession line to Operating Plan v1.9's header.

**M5 — Handler-less dispatcher: dead poll loop against prod TiDB every ~2 s.** *(verified — direct read)*
- Evidence: `startDispatcher()` at `index.ts:775`; `registerJobHandler` (`jobs/dispatcher.ts:66`) has zero non-test callers; the loop queries `getQueuedJobs()` forever on a jittered ~2 s interval for jobs that can never be handled.
- Impact: wasted DB load on a serverless-billed cluster; architectural confusion (Ch 8 docs describe it as the execution spine); any code that ever *enqueues* a queued-status job would hang silently.
- Fix: either stop starting it until it has handlers, or (better — see §5) make it real by routing async reviewer work through it.

**M6 — Dependency vulnerabilities: 1 high / 3 moderate.** *(verified — `pnpm audit --prod` this review)*
- Evidence: `qs` (via express) ≤ 6.15.1 — high (GHSA-q8mj-m7cp-5q26, TypeError crash on crafted query strings); `react-router` < 6.30.4 — moderate open redirect (GHSA-2j2x-hqr9-3h42); +2 moderate.
- Impact: contextually modest (single-operator app behind auth) but the qs one is reachable pre-auth via query-string parsing.
- Fix: routine bump engagement (`express`/transitive override, `react-router-dom` ≥ 6.30.4); both are reversible build-and-PR lane.

### LOW

**L1 — Google adapter passes the API key as a URL query parameter** (`src/server/llm/google.ts:179`) *(verified — direct read)*. Google-sanctioned, but URL-position secrets leak into proxies/logs more easily; Gemini accepts the `x-goog-api-key` header. One-line change.

**L2 — Hardcoded `'anthropic:claude-opus-4-7'` at the formatting call site bypasses `WHITELISTED_MODELS`** (`src/server/procedures/documents4a.ts:1178`) *(verified — direct read)*. Known/intentional (MR-PROMPT-1) but undocumented at the whitelist itself; route it through `modelCapabilities.ts` to keep one source of truth.

**L3 — Adapter normalization duplication**: fence-strip + object-unwrap logic copied across the four adapters (Rules 1–6 identical in `openai.ts`/`xai.ts`, subset in `anthropic.ts`/`google.ts`) *(agent-verified; consistent with the May review)*. Intentional isolation, but a patch to one (as happened in MR-CAL-5D) must be hand-mirrored. Extract to a shared `llm/normalize.ts` with per-adapter parameters when next touched.

**L4 — Test-quality: heavy reliance on source-scan tests.** *(verified — test run)* The 11 Windows-local failures are all source-audit tests asserting file text (e.g. `phase4b.acceptance.test.ts:113` `toContain('resolveModel(\n…')`) — CRLF-fragile and implementation-asserting rather than behavior-asserting. The ratchet pattern (`mr_fold_auth_2.test.ts`) is a clever compensating control, but the proliferation of "assert the source contains this string" tests couples the suite to formatting. Prefer behavioral assertions where feasible; normalize line endings in the scan helpers (one shared `readSourceNormalized()` would green all 11 on Windows).

**L5 — Stale/contradictory peripheral docs**: D1 (STORAGE_BACKEND fiction), D6 (README), root-level `Phase3_*/Phase4a_*` verification snapshots and `HANDOFF.md` presented without "historical" banners; key references (`LLN_Reviewer_Prompt_Specifications.docx`, handoff docx) are binary `.docx` unreadable by repo tooling — CLAUDE.md itself flags one as possibly stale. Add a `docs/ARCHIVE/` or status banners; convert load-bearing .docx references to Markdown.

**L6 — Token budgeting is still `chars/4` with mid-character truncation in the context pipeline** (`context/pipeline.ts`) *(unverified this pass — carried forward from the 2026-05-29 review; the file was not re-read line-by-line)*. Low impact; revisit when touching the pipeline.

**L7 — No root-level React error boundary; no toast system** *(agent-verified)*. `PanelErrorBoundary` protects review panes only; a render error elsewhere white-screens. Small addition at `App.tsx`.

**L8 — Untested auto-rollback path** *(documented in CLAUDE.md Rule 18 caveat; not independently verified)*: the Railway GraphQL rollback in `tools/deploy/smokeCore.mjs` has never run against a live token; smoke secrets are absent (MODE B). First real RED will exercise unproven code at the worst moment. Provision the smoke account/token or keep treating rollback as manual.

### Disproven / not reproduced this pass
- **"InformationRequestPage swallows generation errors"** (client agent claim) — **disproven**: failure banner renders at `InformationRequestPage.tsx:588-591` via `generateMutation.error`.
- Prior review's auth-bypass (HIGH) and silent-empty-questionnaire (MED) findings — fixed, test-enforced (D7).
- No IDOR found: ~40 sampled queries/procedures all owner-filtered; CI ratchet guards regressions (agent-verified).

---

## 5. Strategic Judgment (Phase 4)

### Is the current plan and architecture right for the stated goals?
**Yes.** For a single-attorney (→ 2–3 attorney) transactional drafting tool, the modular monolith — tRPC + Drizzle + flags + additive migrations + shadow-first gates — is the correct weight class. The product-shaped decisions are consistently right: attorney-always-decides is enforced structurally (positive-selection only, advisory gates, no auto-adoption); the audit spine is permanent; deploys are reversible. The Whereas fold queue (PM-2/3/4 → INTEG → SEED → VERIFY) is the right order, with one amendment: **none of it should proceed ahead of the durability fixes in §6**, because every later layer (PDF ingestion, integrations, seeding) deepens dependence on exactly the two weak substrates (file persistence, background execution).

### Rewrite vs. incremental
**Nothing warrants a rewrite.** One targeted re-architecture is justified:

- **Durable background execution via the existing dispatcher** (the only "re-architecture"; really a completion). *Problem solved:* H3's restart fragility — in-flight reviews/OCR die with the process, jobs/sessions stick. *Mechanism:* persist dispatch intent — enqueue reviewer/OCR jobs as `queued` rows, register handlers, let the already-built poll loop claim them with its conditional-UPDATE pickup; a restart simply re-claims queued work, and the reaper (H3 fix) handles `running` orphans. *Rough effort:* 3–5 focused increments (~1–2 weeks at this project's cadence) — the dispatcher, job table, heartbeats, and conditional-update pickup already exist and are tested-adjacent. *Risk of NOT doing it:* every deploy mid-review silently eats work; the flagged-OFF async fan-out can't be safely enabled, so the GPT-5 ~11-minute reviews the diagnostic showed remain blocked; OCR loss (H2) keeps its worst failure mode. *Cheapest credible alternative:* keep sync-only reviews (flag stays OFF), ship only the reaper + stale-`processing` sweep, and accept that deep reviews and OCR remain restart-lossy. That is defensible for the next month; it is not defensible once clients (or FOLD-INTEG-1 inbound email) depend on background work.

Everything else — H1, H2 storage, M1–M6 — is incremental, mostly single-engagement work.

### Over-engineered vs. under-built
**Over-engineered (relative to goals):**
- **Governance documentation mass**: ~70 docs, a 350-line CLAUDE.md rule set, an operating plan whose supersession is itself ambiguous, and a state tracker whose `current_phase` field holds a 4,000-word essay. The *process* demonstrably works (it caught the 5D-class failures), but its artifacts have outgrown their maintenance budget — the project now violates its own Rule 16 ("the tracker never drifts"). Trim the artifact surface, keep the discipline: STATE.md + a slim state.json + CLAUDE.md-as-pointer is enough.
- **Source-scan test ratchets** beyond the two or three that earn their keep (L4).
- **Four full sibling clones** (`-local`, `-cgo`, `-dropzone`, `-landing`) as a parallelism mechanism — STATE.md already records a shared-worktree near-miss ("Hazard (recovered)"). `git worktree` or stricter session/branch discipline would remove a whole failure class.
- The dormant dispatcher poll loop (M5) — infrastructure running with no function.

**Under-built (relative to goals):**
- **File/blob persistence** (H2) — the firm's source documents are the one asset the system cannot regenerate.
- **Durability of background work** (H3, above).
- **DR/backup posture** — every value in `docs/retention_dr_posture.md` is `PENDING ATTORNEY SIGN-OFF`, including TiDB backup cadence; this needs an hour of attorney decision-making more than it needs code.
- **Truncation surfacing on the drafter path** (H1).
- **Session revocation** (M3) before the second attorney account exists.

### If I took this project over tomorrow — first five actions, in order
1. **Ship the stuck-state reaper + guarded terminal writes** (H3, parts 1–3). Smallest fix for the most user-visible failure (stuck sessions); prerequisite for trusting anything async.
2. **Persist original upload bytes + stale-`processing` sweep** (H2). Stops ongoing silent client-file loss; unblocks retryable OCR; FOLD-PM-2 (PDF ingestion) is queued next and would otherwise build on the broken substrate.
3. **Drafter truncation guard** (H1) — one chokepoint change in `canonicalMutation` + a version flag/banner; the legal-product risk (truncated instrument reads as complete) outweighs its tiny effort.
4. **Migration-allowlist CI assertion + dependency bumps** (M1, M6) — two small reversible PRs that close a proven prod-breaking gap and a public advisory.
5. **State/doc reconciliation pass** (M4) — reconcile state.json, fix CLAUDE.md's current-state pointer, declare Operating Plan v1.9 superseded, banner the stale root docs. An afternoon of bookkeeping that restores the governance system's core premise: that what it says is true.

Then re-open the fold queue (FOLD-PM-2 onward), with the dispatcher-completion re-architecture scheduled before or alongside FOLD-INTEG-1.

---

## 6. Proposed Remediation Sequence

| Order | Item | Findings | Lane | Effort |
|---|---|---|---|---|
| 1 | Orphan/stuck-state reaper; wrap `markJobFailed`/`markJobCompleted`/heartbeat writes; auto-resolve stuck `active` sessions | H3 | Reversible build-and-PR | S |
| 2 | Persist upload bytes (DB blob now, S3 later); real `storageKey`; OCR from persisted bytes; stale-`processing` sweep; memory bound | H2, D1 | Build-and-PR + one additive migration | M |
| 3 | Non-structured truncation guard at the canonical-mutation chokepoint + version `truncated` flag + UI banner; drafter budgets via `modelCapabilities` | H1 | Reversible build-and-PR | S |
| 4 | CI test: every committed migration ≥0004 is allowlisted or declared manual | M1 | Reversible build-and-PR | XS |
| 5 | Dependency bumps (`qs`/express chain, `react-router-dom` ≥6.30.4, 2 moderates) | M6 | Reversible build-and-PR | XS |
| 6 | Governance reconciliation: state.json arrays, CLAUDE.md current-state pointer, v1.9 supersession banner, stale-doc banners / ARCHIVE | M4, D3–D6, L5 | Docs-only | S |
| 7 | Untrusted-content delimiting at context assembly + injection heuristic in export-safety warn layer | M2 | Reversible build-and-PR | S |
| 8 | `sessionVersion` check on auth middleware (before 2nd account / credential rotation) | M3 | Build-and-PR + additive migration | XS |
| 9 | Dispatcher completion: enqueue + handlers for async reviewers/OCR; then enable `REVIEWER_ASYNC_ENABLED` | H3 (durable), M5 | Multi-increment engagement | M–L |
| 10 | Hygiene batch: Google key header (L1), formatting-model registry route (L2), shared adapter normalize (L3), CRLF-normalized scan helper (L4), root error boundary (L7), smoke/rollback provisioning (L8) | L1–L4, L7–L8 | Reversible build-and-PR | S |

Items 1–5 are independent and could land as one short phase; item 9 is the only one that warrants triad-style design review (it changes the execution contract for LLM work).

---

*End of review. Read-only engagement: no source files modified; this report (`PROJECT_REVIEW.md`) is the only file created. Test run, dependency audit, and all cited line numbers are against `main` @ `d7a03fa`, 2026-06-09.*
