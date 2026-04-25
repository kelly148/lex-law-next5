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

---

## D.1.3 Stop/Repair — 2026-04-25

**Event type:** Deployment Acceptance Fix (pre-UAT)
**Branch:** `lex-next/deploy-fix-prod-build`
**Merge commit:** `d97bc65` (main)

### Blocker

`pnpm start` (production mode) could not serve the React client because:

1. `src/server/index.ts` had no `express.static` mount or SPA catch-all route. The Express server was API-only; the Vite client had no production serving path.
2. `package.json` `build:server` referenced `tsconfig.server.json` which did not exist, so `pnpm build:server` always failed with a file-not-found error.

### Fix Applied

| File | Change |
|---|---|
| `src/server/index.ts` | Added `import path from 'path'`; added `express.static(dist/)` and `app.get('*', ...)` SPA catch-all after all `/api/*` and `/trpc/*` routes |
| `package.json` | Replaced `tsc -p tsconfig.server.json` with `esbuild src/server/index.ts --bundle --platform=node --target=node22 --format=esm --outfile=dist/server/index.js --packages=external` |
| `DEPLOYMENT.md` | Added esbuild flag documentation; added explicit `pnpm install` prerequisite blockquote in Production Server section |
| `HANDOFF.md` | Updated production build commands and single-port operation instructions |

**Express version:** 4.22.1. `app.get('*', ...)` is safe on Express 4 (path-to-regexp wildcard issue only affects Express 5).

**esbuild `--packages=external` rationale:** CJS packages (express, mysql2, mammoth, etc.) call `require()` internally. In ESM output format (`"type": "module"`), dynamic `require()` is not supported when bundled. `--packages=external` marks all `node_modules` as external — they are not inlined and must be present at runtime via `pnpm install`.

### Verification

All quality gates passed on `lex-next/deploy-fix-prod-build` before merge:

| Gate | Result |
|---|---|
| `pnpm typecheck` | 0 errors |
| `pnpm lint` | 0 warnings/errors |
| `pnpm test --run` | 215 passed, 16 skipped, 0 failures |
| Escape-hatch scan | 0 violations |
| `pnpm build` | Clean Vite build |
| `pnpm build:server` | Exit 0, `dist/server/index.js` 283 KB |
| `pnpm start` binds | `[server] Lex Law Next v1 listening on 0.0.0.0:3001` |
| `/api/health` | HTTP 200 |
| `/trpc/auth.login` | HTTP 200 |
| `/matters` (SPA catch-all) | HTTP 200, `text/html` |
| Static JS asset | HTTP 200, `application/javascript` |
| DOCX export | HTTP 200, 9,494 bytes, `Microsoft Word 2007+`, correct watermark |
| `grep -ri manus dist/` | 0 hits (portability check) |

No tRPC procedure contracts, Zod schemas, database schema, or product behavior changed.

---

## D.1.4 Credential Rotation — 2026-04-25

**Event type:** Operational (credential rotation, no code change)
**Commit:** `d97bc65` (main)

### Event

Operator confirmed credentials rotation is complete. Seed credentials embedded in the previously running Manus-hosted preview instance are no longer valid. No code change required.

### Manus Deployment Stand-Down

The Manus-hosted preview deployment served its purpose: it proved the production-build fix works (single-port serving, esbuild bundling, SPA catch-all, DOCX export, static asset serving, zero Manus URL hardcoding in `dist/`). That verification is captured in D.1.3 above and in the merged PR.

Operator will proceed with UAT locally per Operator Playbook Part 0.5:
- Clone repo to operator machine
- Configure `.env.local` with new credentials and `ANTHROPIC_API_KEY`
- Run `pnpm install`, `pnpm db:migrate`, `pnpm start`
- Perform browser UAT against `localhost:3001`

Deferred verification gaps (draft generation, review session, evaluator path) from D.1.2 will be closed during operator local UAT.

### Resolution

No further deployment work required from the Manus side. Codebase is in a clean, documented, deployable state on `main` at commit `d97bc65`.

---

## D.1.5 Stop/Repair — 2026-04-25

**Event type:** Deployment Blocker (TiDB Cloud database provisioning)
**Branch:** `lex-next/migration-tidb-compat`

### Event

Operator provisioned TiDB Cloud Serverless database `lex_law_next`. Initial migration attempt
(`pnpm db:migrate`) failed with `ER_PARSE_ERROR` on JSON column defaults emitted by
`drizzle-kit generate`.

### Blocker

`drizzle-kit 0.20.x` generates `DEFAULT ('[]')` and `DEFAULT ('{}')` for JSON columns. TiDB
Cloud v8.5.3-serverless rejects these string-literal expressions in favour of function-call
syntax (`DEFAULT (JSON_ARRAY())`, `DEFAULT (JSON_OBJECT())`).

### Fix Applied

Patched `0000_sparkling_firestar.sql` on branch `lex-next/migration-tidb-compat`:

| Column | Table | Change |
|---|---|---|
| `sections` | `document_outlines` | `DEFAULT ('[]')` → `DEFAULT (JSON_ARRAY())` |
| `tags` | `matter_materials` | `DEFAULT ('[]')` → `DEFAULT (JSON_ARRAY())` |
| `selections` | `review_sessions` | `DEFAULT ('[]')` → `DEFAULT (JSON_ARRAY())` |
| `selectedReviewers` | `review_sessions` | `DEFAULT ('[]')` → `DEFAULT (JSON_ARRAY())` |
| `preferences` | `user_preferences` | `DEFAULT ('{}')` → `DEFAULT (JSON_OBJECT())` |

Each fix pre-verified with a probe CREATE TABLE against TiDB Cloud v8.5.3-serverless before
applying. DD-003 added to `DEPENDENCY_DEBT.md`.

---

## D.1.6 Stop/Repair — 2026-04-25

**Event type:** Deployment Blocker (TiDB Cloud migration — second failure)
**Branch:** `lex-next/migration-tidb-compat`

### Blocker

After applying the JSON default fixes from D.1.5, migration still failed with `ER_PARSE_ERROR`
on the `review_sessions` table. The `globalInstructions text NOT NULL DEFAULT ('')` column
definition was rejected by TiDB Cloud v8.5.3-serverless. TiDB does not support any
string-literal DEFAULT expression on TEXT or BLOB column types.

### Fix Applied

Removed the `DEFAULT ('')` clause from `globalInstructions` in `0000_sparkling_firestar.sql`,
keeping `NOT NULL` (Option A). The Zod layer in the `reviewSession.create` procedure supplies
`globalInstructions` with `.default('')`, so the database-level default was never relied upon
by application code.

Pre-verified: `CREATE TABLE _probe_text_test (id char(36) NOT NULL, instructions text NOT NULL,
PRIMARY KEY (id))` succeeded on TiDB Cloud v8.5.3-serverless before applying.

### Full Scan Outcome

A complete scan of both migration files for all string-literal `DEFAULT ('...')` patterns
confirmed this was the only remaining instance. No other TEXT, BLOB, LONGTEXT, MEDIUMTEXT,
TINYTEXT, LONGBLOB, MEDIUMBLOB, or TINYBLOB columns carry string-literal DEFAULT clauses in
either migration file.

DD-003 in `DEPENDENCY_DEBT.md` updated to expand scope from JSON defaults to all string-literal
DEFAULT patterns on JSON and TEXT/BLOB column types.

