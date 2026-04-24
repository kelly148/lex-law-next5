# Lex Law Next v1

AI-assisted legal drafting system for The Satterwhite Law Firm PLLC.

## Stack

- **Frontend:** React 19 + Vite + TypeScript + TailwindCSS
- **Backend:** Express + tRPC + TypeScript
- **Database:** TiDB (MySQL-compatible) + Drizzle ORM
- **Authentication:** iron-session (cookie-based)
- **Testing:** Vitest
- **LLM Providers:** Anthropic (Claude), OpenAI (GPT), Google (Gemini), xAI (Grok)

## Development Setup

### Prerequisites

- Node.js 22+
- pnpm 10+
- A TiDB Cloud cluster (or local MySQL 8+)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
# Edit .env.local with your credentials
```

Required variables:
- `DATABASE_URL` — TiDB/MySQL connection string
- `SESSION_SECRET` — At least 32 characters, random
- `ANTHROPIC_API_KEY` — For Claude (primary drafter + evaluator)
- `OPENAI_API_KEY` — For GPT reviewer
- `GOOGLE_API_KEY` — For Gemini reviewer

### 3. Run migrations

```bash
pnpm db:migrate
```

This creates the schema and seeds the attorney user account.
Set `SEED_USERNAME` and `SEED_PASSWORD_HASH` in `.env.local` before running.

Generate a password hash:
```bash
node -e "const b=require('bcryptjs');console.log(b.hashSync('yourpassword',12))"
```

### 4. Start development servers

```bash
pnpm dev
```

- Client: http://localhost:5173
- Server: http://localhost:3001
- Health check: http://localhost:3001/api/health

## Testing

```bash
pnpm test          # Run all tests once
pnpm test:watch    # Watch mode
pnpm test:coverage # With coverage report
```

## Build

```bash
pnpm build         # Type-check + Vite production build
pnpm typecheck     # Type-check only (tsc --noEmit)
```

## Database

```bash
pnpm db:generate   # Generate migration files from schema changes
pnpm db:migrate    # Apply pending migrations
pnpm db:studio     # Open Drizzle Studio (visual DB browser)
```

## Architecture

See the Lex Law Next v1 Specification for full architecture documentation.

### Key invariants

- **Zod Wall (Ch 35.1):** Every database read of a JSON or enum column passes through a Zod schema parse in `server/db/queries/*.ts` before any application code touches the value.
- **Session userId (Ch 35.2):** `userId` in every procedure handler comes from `ctx.userId` (session-derived). Procedures never accept `userId` as input.
- **useGuardedMutation (Ch 35.13):** Every mutation button uses this hook to prevent double-fire.
- **No silent failures (Ch 35.9):** Every caught exception emits telemetry.

## Branch strategy

- `main` — integration branch; all PRs merge here
- `lex-next/phase-N` — phase feature branches
- Phase 4 splits into `lex-next/phase-4a` and `lex-next/phase-4b`
