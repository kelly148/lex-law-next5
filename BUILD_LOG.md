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
