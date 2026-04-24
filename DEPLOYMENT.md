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

```bash
pnpm build
```

This runs `tsc --noEmit` (type check) followed by `vite build`. The built client
assets are emitted to `dist/`. The server is compiled separately:

```bash
pnpm build:server
```

---

## Production Server

After building:

```bash
pnpm start
```

This runs `node dist/server/index.js`. The server serves the built Vite client
from `dist/` and the tRPC API at `/trpc`.

**Access URL in browser:** `http://0.0.0.0:${PORT}` (or the host's public address)

---

## Running Locally Outside Manus

1. Clone the repository.
2. Install dependencies: `pnpm install`
3. Copy `.env.example` to `.env.local` and fill in all required variables.
4. Start a TiDB-compatible MySQL instance (TiDB Serverless free tier, PlanetScale, or local MySQL 8).
5. Run migrations: `pnpm db:migrate`
6. Start the dev server: `pnpm dev`
7. Open `http://localhost:5173` in your browser.

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

*This file is built incrementally during Phases 5–6 and finalized in Phase 7.*
