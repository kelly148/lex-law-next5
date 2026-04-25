# Lex Law Next v1 — Phase 7 Final Handoff

This document summarizes the final state of the `lex-law-next5` repository at the conclusion of Phase 7 (Cross-Phase Reconciliation & Packaging).

## 1. Final Environment Variables List

To run the application, the following environment variables are required. See `DEPLOYMENT.md` for the complete list of optional variables.

| Variable | Description |
|---|---|
| `DATABASE_URL` | TiDB-compatible MySQL connection string. Format: `mysql://user:pass@host:port/db?ssl=true` |
| `SESSION_SECRET` | iron-session secret used to sign cookies. Must be ≥ 32 characters. |
| `SEED_USERNAME` | Username for the initial attorney user (e.g., `kelly`). |
| `SEED_PASSWORD_HASH` | bcrypt hash of the initial attorney password. |
| `ANTHROPIC_API_KEY` | Required for Claude models (the default for drafting and evaluation). |

*Note: For local testing, these can be placed in a `.env.local` file at the project root.*

## 2. Run Commands

### Development Mode
```bash
# Install dependencies
pnpm install

# Run database migrations (idempotent)
pnpm db:migrate

# Start the dev server (API on 3001, Vite client on 5173)
pnpm dev
```

### Production Build & Run
```bash
# Build client and server
pnpm build
pnpm build:server

# Start the production server
pnpm start
```

### Quality Gates
```bash
pnpm typecheck
pnpm lint
pnpm test --run
```

## 3. Smoke-Test Checklist

After deploying or starting the dev server, verify the following core flows:
- [ ] **API Health:** `GET /api/health` returns `{"status":"ok"}`.
- [ ] **Authentication:** Login via the UI with the seed credentials succeeds.
- [ ] **Matter Creation:** Creating a new matter succeeds and it appears in the dashboard.
- [ ] **Document Creation:** Creating a new document under a matter succeeds.
- [ ] **Material Upload:** Uploading a reference material to a matter succeeds.
- [ ] **DOCX Export:** Clicking "Download DOCX" on a document detail page downloads a valid Word file.

## 4. Known Issues & Dependency Debt

### DD-001: drizzle-orm `generatedAlwaysAs()` API
- **Status:** Deferred to future cleanup (post-Phase 7).
- **Description:** `drizzle-orm` 0.30.10 lacks the native `generatedAlwaysAs()` builder API. The `activeMatterKey` and `activeSessionKey` columns currently use a raw SQL workaround in the migration file to enforce the at-most-one-active invariant (R10) at the database level.
- **Compensating Controls:** The raw SQL migration uses correct TiDB syntax. The `schema.ts` declarations include explicit DO-NOT-WRITE warnings. The Zod Wall prevents application-layer writes. Regression tests (`d1_2_generated_column.regression.test.ts`) verify that explicit writes are rejected by the database.
- **Resolution Path:** Upgrade `drizzle-orm` to 0.32+ and replace the schema declarations with `.generatedAlwaysAs(sql`...`, { mode: 'stored' })`.

## 5. Phase 7 Reconciliation Summary

- **tRPC Procedures:** 87 registered procedures, 74 client calls. Zero phantom calls. 13 intentional orphan procedures (server-side only or future UI wirings, all with test coverage).
- **TypeScript & Linting:** 0 errors, 0 warnings. 0 escape hatches (`any`, `as unknown`, `@ts-ignore`, etc.) in implementation files.
- **Test Suite:** 201 tests passed, 16 skipped (0 failures).
- **Zod Wall:** 100% compliance. All DB reads pass through Zod validation. No raw `JSON.parse` on DB rows outside the validation layer.
- **Mutations:** All client mutations correctly use `useGuardedMutation`. No direct `useMutation` calls.
