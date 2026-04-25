# Deployment Guide — Lex Law Next v1

> **Portability guarantee.** This application is a standard Node.js web application.
> It has no dependency on any Manus-specific API, SDK, storage API, or runtime service.
> All configuration is via environment variables. The server binds to `0.0.0.0` with
> the port from the `PORT` env var (default `3001`).

---

## Required Environment Variables

Copy `.env.example` to `.env.local` (development) or set these in your deployment
environment. All variables without defaults are **required** to boot.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | TiDB-compatible MySQL connection string. Format: `mysql://user:pass@host:port/db?ssl=true` |
| `SESSION_SECRET` | — | iron-session secret. Must be ≥ 32 characters. |
| `SEED_USERNAME` | `kelly` | Username for the initial attorney user (used by migration seed). |
| `SEED_PASSWORD_HASH` | — | bcrypt hash of the initial attorney password. Generate: `node -e "const b=require('bcryptjs');console.log(b.hashSync('yourpassword',12))"` |
| `ANTHROPIC_API_KEY` | — | Required if using any `anthropic:*` model. |
| `OPENAI_API_KEY` | — | Required if using any `openai:*` model. |
| `GOOGLE_API_KEY` | — | Required if using any `google:*` model. |
| `XAI_API_KEY` | — | Optional. Grok models are omitted from the UI when absent. |
| `PRIMARY_DRAFTER_MODEL` | `anthropic:claude-opus-4-5` | Model for document drafting. Must be on the whitelist in `src/server/llm/config.ts`. |
| `EVALUATOR_MODEL` | `anthropic:claude-opus-4-5` | Model for the evaluator pass. Env-only — never attorney-selectable (Decision #41). |
| `DRAFTER_PROMPT_VERSION` | `1.0` | Prompt version captured at job creation. |
| `EXTRACTOR_PROMPT_VERSION` | `1.0` | Prompt version captured at job creation. |
| `OUTLINE_PROMPT_VERSION` | `1.0` | Prompt version captured at job creation. |
| `MATRIX_PROMPT_VERSION` | `1.0` | Prompt version captured at job creation. |
| `REVIEWER_PROMPT_VERSION` | `1.0` | Prompt version captured at job creation. |
| `EVALUATOR_PROMPT_VERSION` | `1.0` | Prompt version captured at job creation. |
| `DISPATCHER_POLL_INTERVAL_MS` | `2000` | Job dispatcher poll interval in ms (±20% jitter applied). |
| `STORAGE_BACKEND` | `filesystem` | `filesystem` or `s3`. |
| `S3_BUCKET` | — | Required when `STORAGE_BACKEND=s3`. |
| `S3_REGION` | — | Required when `STORAGE_BACKEND=s3`. |
| `S3_ACCESS_KEY_ID` | — | Required when `STORAGE_BACKEND=s3`. |
| `S3_SECRET_ACCESS_KEY` | — | Required when `STORAGE_BACKEND=s3`. |
| `S3_ENDPOINT` | — | Optional. For MinIO or S3-compatible endpoints. |
| `PORT` | `3001` | Server port. Binds to `0.0.0.0`. |

---

## Database Migration

Apply all pending migrations before starting the server:

```bash
pnpm db:migrate
```

This runs `src/server/db/migrate.ts` via `tsx`. The migration applies all SQL files
in `src/server/db/migrations/` in order. It is idempotent — safe to re-run.

---

## Dev Server (Manus smoke testing)

Starts the Express API server and the Vite dev client concurrently:

```bash
pnpm dev
```

- API server: `http://localhost:3001` (or `PORT` env var)
- Vite dev client: `http://localhost:5173`
- Vite proxies `/trpc` and `/api` to the API server automatically.

**Access URL in browser:** `http://localhost:5173`

When running inside Manus, expose port `5173` to get a public URL for browser access.

---

## Production Build

Build the client assets (Vite) and run a type check:

```bash
pnpm build
```

This runs `tsc --noEmit` (type check) followed by `vite build`. Built client assets
are emitted to `dist/assets/` and `dist/index.html`.

Bundle the server (esbuild):

```bash
pnpm build:server
```

This runs `esbuild` to bundle `src/server/index.ts` into `dist/server/index.js`.
The following flags are used:

| Flag | Reason |
|---|---|
| `--bundle` | Inline all application imports into a single output file |
| `--platform=node` | Target the Node.js runtime (no browser shims) |
| `--target=node22` | Emit syntax compatible with Node.js 22 (the installed version) |
| `--format=esm` | ESM output, required because `package.json` sets `"type": "module"` |
| `--outfile=dist/server/index.js` | Output path expected by `pnpm start` |
| `--packages=external` | Mark all `node_modules` as external — they are not inlined into the bundle and must be present at runtime. This is required because several dependencies (express, mysql2, mammoth, docx, etc.) contain CJS `require()` calls that are incompatible with ESM bundling. All externals are in `dependencies` and will be present in `node_modules` at runtime. |

Output: `dist/server/index.js` (approx. 283 KB — application code only, no node_modules).

---

## Production Server

> **Runtime prerequisite:** `pnpm build:server` uses `--packages=external`, which means all `node_modules` dependencies are **not bundled** into `dist/server/index.js`. Run `pnpm install` before `pnpm build:server` and `pnpm start` to ensure `node_modules` is present at runtime.

After installing dependencies and building both client and server:

```bash
pnpm install          # required — node_modules must be present at runtime
pnpm build
pnpm build:server
pnpm start
```

This runs `node dist/server/index.js`. The server:
- Serves the built Vite client from `dist/` via `express.static`
- Handles all `/api/*` REST endpoints
- Handles all `/trpc/*` tRPC calls
- Returns `dist/index.html` for all other routes (SPA catch-all for React Router)

**Single-port operation:** client and API are served on the same port (default `3001`).
No separate Vite process is needed in production.

**Access URL in browser:** `http://0.0.0.0:${PORT}` (or the host's public address)

---

## Running Locally Outside Manus

**Development mode (two ports):**

1. Clone the repository.
2. Install dependencies: `pnpm install`
3. Copy `.env.example` to `.env.local` and fill in all required variables.
4. Start a TiDB-compatible MySQL instance (TiDB Serverless free tier, PlanetScale, or local MySQL 8).
5. Run migrations: `pnpm db:migrate`
6. Start the dev server: `pnpm dev`
7. Open `http://localhost:5173` in your browser.

**Production mode (single port):**

1. Complete steps 1–5 above (includes `pnpm install`).
2. Build: `pnpm build && pnpm build:server`
3. Start: `pnpm start` (`node_modules` must be present — see Production Server note above)
4. Open `http://localhost:3001` in your browser.

---

## Dev / Prod Code Sharing

Dev mode and production mode share **all application code** (`src/`). They differ
only in:

| Aspect | Dev | Production |
|---|---|---|
| Client serving | Vite dev server (HMR, port 5173) | Express serves `dist/` (built assets) |
| Server runner | `tsx watch` (TypeScript, hot reload) | `node` (compiled JS from `dist/`) |
| Build command | None (interpreted) | `pnpm build && pnpm build:server` |
| Start command | `pnpm dev` | `pnpm start` |
| Env file | `.env.local` | Deployment environment variables |

No application logic, database queries, tRPC procedures, LLM routing, or business
rules differ between dev and production.

---

## Minimum Provider Credentials to Boot

To start the server and reach the login page with no LLM calls:

```
DATABASE_URL=mysql://...
SESSION_SECRET=<32+ chars>
SEED_USERNAME=kelly
SEED_PASSWORD_HASH=<bcrypt hash>
```

LLM API keys are only required when a job is dispatched. The server will start
without them but `validateLlmConfig()` will throw at startup if a configured
model string is not on the whitelist.

---

## Known Issues / Dependency Debt

See `DEPENDENCY_DEBT.md` for deferred items. Key item: drizzle-orm upgrade to
0.32+ for native `generatedAlwaysAs()` support (DD-001, deferred from Phase 4b).

---

*This file was updated in the deploy-fix-prod-build branch to reflect the esbuild-based server build and single-port production serving.*
