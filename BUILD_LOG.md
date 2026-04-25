# Build Log — LEXLAWNEXT 3

This file records architectural decisions, blocker resolutions, and phase-level build events.
It is part of every phase handoff package.

---

## Phase 4b

### D.1.2 — RESOLVED

**Date:** 2026-04-24
**Status:** Resolved — raw SQL migration with five compensating controls

**Blocker:** drizzle-orm 0.30.10 lacks `generatedAlwaysAs()` API. The `information_requests`
and `review_sessions` tables require `GENERATED ALWAYS AS (...) STORED` columns
(`activeMatterKey`, `activeSessionKey`) to enforce the at-most-one-active invariant (R10)
at the database level without relying on application-layer checks alone.

**Resolution:** Raw SQL in migration (`0001_phase4b_matrix_outline_review.sql`) with five
compensating controls:

1. **MySQL/TiDB-compatible syntax.** Migration uses `GENERATED ALWAYS AS (...) STORED` with
   the correct column types (`CHAR(36)` for `activeMatterKey`, `VARCHAR(64)` for
   `activeSessionKey`) and declares the unique indexes in the same migration file.

2. **Schema accuracy and Zod Wall integrity.** `schema.ts` column declarations use the actual
   underlying column types (`char(36)`, `varchar(64)`). The Zod Wall treats these columns as
   read-only; no write path exists in any procedure.

3. **DO-NOT-WRITE comment blocks.** Each generated column in `schema.ts` carries a multi-line
   comment stating: (a) this is a GENERATED column; (b) DO NOT write from application code;
   (c) any INSERT/UPDATE setting this column will be rejected by TiDB; (d) the declaration
   exists for TypeScript type inference on reads only; (e) references R10 and Ch 4.10 / Ch 4.8.

4. **Regression gate.** Integration tests in
   `src/server/__tests__/generatedColumnWriteRejection.test.ts` assert that INSERT and UPDATE
   with an explicit value for either generated column are rejected by the database engine with
   a generated-column write error.

5. **Handoff commitment.** `DEPENDENCY_DEBT.md` (DD-001) records the upgrade path to
   drizzle-orm 0.32+ and `generatedAlwaysAs()`. This file is included in the Phase 7
   Known-Issue List.

**Rationale for deferral of ORM upgrade:** An upgrade to drizzle-orm 0.32+ mid-build would
require regenerating migration snapshots and re-validating schema types across four already-
merged phases (1, 2, 3, 4a). The cascade risk is disproportionate to the compile-time gap
closed by the native builder API. The raw SQL workaround is semantically equivalent and is
guarded by the five controls above.

---

## Phase 7

### Cross-Phase Reconciliation & Packaging

**Date:** 2026-04-24
**Status:** Complete

**Activities:**
1. **Automated Reconciliation Checks:** Extracted all 87 registered tRPC procedures and 74 client tRPC calls. Verified zero phantom client calls. Verified 13 orphan procedures (no client caller) are intentional server-side-only procedures or future UI wirings, all with test coverage. Verified zero `useMutation` escape hatches. Verified zero raw DB `JSON.parse` outside Zod validation layer. Verified canonical job insertion.
2. **R12 TODO Resolution:** Added `COMPLETE_READONLY_EXEMPT` exhaustiveness assertion to Phase 3 acceptance tests. Verified exactly two R12 carve-outs: `document.setNotes` and `document.unfinalize`.
3. **Generated-Column Invariant Verification:** Verified `activeMatterKey` and `activeSessionKey` raw-SQL expressions are correct and evaluate to `NULL` for terminal/archived rows. Verified zero manual SELECT-then-INSERT uniqueness checks in application code.
4. **Final Quality Gate:** Achieved zero TypeScript errors (`pnpm typecheck`), zero lint warnings (`pnpm lint`), and 201 passing tests (`pnpm test`). Scanned for and found zero TypeScript escape hatches (`any`, `as unknown`, `@ts-ignore`, etc.) in implementation files. Clean Vite production build (`pnpm build`).
5. **Runtime Sanity Check:** Verified API health, authentication, matter creation, document creation, and synchronous DOCX export endpoint. All runtime checks passed.

---

## D.1.2 Stop/Repair — 2026-04-25

**Event type:** Stop/Repair (partial smoke test completion)
**Commit:** `328b9c0` (main — Phase 7 merge)
**Detected during:** Step 10 operator-side smoke test

### Blocker

`ANTHROPIC_API_KEY` (and `OPENAI_API_KEY`) are not present in the Manus sandbox environment. Both `.env.local` entries are empty strings. The LLM adapters (`AnthropicAdapter`, `OpenAiAdapter`) perform a non-empty key check at invocation time and throw `LlmProviderError` if the key is absent. As a result, `document.generateDraft` jobs fail immediately with `ANTHROPIC_API_KEY is not set`, blocking smoke test checks 6 (draft generation) and 7 (review session live invocation).

### Options Considered

| Option | Decision |
|---|---|
| Add `OPENAI_BASE_URL` env-var override to `OpenAiAdapter` to route through the Manus proxy | **Rejected** — code change to implementation file outside Phase 7 scope |
| Inject a live API key via chat message for the smoke test session | **Rejected** — operator preference; keys are not to be shared in chat |
| Accept partial completion per Step 10G of the deployment prompt | **Accepted** — documented acceptable outcome when keys are not present in sandbox |

### Verification Gap

The following checks were not exercised in the Manus environment and are deferred to operator-side browser UAT:

- **Check 6 — Draft generation (Step 10G):** `document.generateDraft` end-to-end with Claude. Will be exercised by the Human Operator using `ANTHROPIC_API_KEY` loaded into the operator's session.
- **Check 7 — Review session live invocation (Step 10H):** `reviewSession.create` with at least one enabled reviewer. Will be exercised in browser UAT.
- **Evaluator role end-to-end (Step 10H multi-reviewer path):** Same. Will be exercised in browser UAT.

### Checks Verified in Manus Environment

Checks 1–5 and 8 all passed:

| Check | Result |
|---|---|
| 1 — Health (`GET /api/health`) | PASS |
| 2 — Login (`auth.login`) | PASS |
| 3 — Matter creation (`matter.create`) | PASS |
| 4 — Document creation (`document.create`) | PASS |
| 5 — Material paste (`materials.create`) | PASS |
| 6 — Draft generation | DEFERRED |
| 7 — Review session | DEFERRED |
| 8 — DOCX export (HTTP 200, 9,467 bytes, DRAFT watermark, valid ZIP) | PASS |

### Resolution

No code change required. Verification gap will be closed by operator browser UAT. This event is logged per project Stop/Repair protocol.
