# Claude Code Workspace Setup — Running Notes

Repo: `C:\Users\Kelly\Documents\lex-law-next5-local`  ·  Started: 2026-05-29  ·  Phase: **inspection only (no changes applied yet)**

## A. Environment inspection (confirmed by command output)

| Tool | Status | Location / note |
|------|--------|-----------------|
| OS | Windows 11 Pro | |
| Shell | git-bash (MINGW64) for Bash tool; PowerShell 5.1 also available | |
| node / npm / npx | **MISSING** | not on PATH; no global install found |
| pnpm / tsc | **MISSING** | `pnpm-lock.yaml` present (pnpm is the intended PM) but not installed |
| python / pip | present | Python 3.13 (`...\Programs\Python\Python313`) |
| uv / uvx | **MISSING** | needed for Serena MCP |
| git | present | `C:\Program Files\Git\cmd\git.exe` |
| gh (GitHub CLI) | present + **authenticated as `kelly148`** | `C:\Program Files\GitHub CLI\gh.exe` (verified earlier this session) |
| claude (CLI) | **not found on PATH** | Claude Code is clearly running (this session); `~/.claude/` and `~/.claude.json` exist. CLI binary not PATH-discoverable → shell `claude mcp add` likely unavailable; config via files instead |
| codegraph | present + **working** | `...\codegraph\current\bin\codegraph.cmd`; index built (149 files / 1,956 nodes / 4,159 edges); configured as a **global MCP server** in `~/.claude.json` |

### Existing config files
- `CLAUDE.md` (repo root) — present, rich; currently has uncommitted edits (CONFIRM updates).
- `.claude/settings.local.json` — present; `permissions.allow` list only (accumulated this session). **No hooks. No repo `.claude/settings.json`.**
- `~/.claude.json` — present (user-global, 22.7 KB). `mcpServers`: **only `codegraph`** globally; **no** project-scoped servers for this repo; **no Serena, no GitHub MCP**.
- No repo-level `.mcp.json`.
- `.gitignore` — covers `.env*`, `node_modules`, `dist`, sqlite, logs, etc. **Does NOT ignore `.codegraph/`** (currently untracked + committable).
- `.env.example` present; no `.env` (good).
- `package.json` scripts: `dev`, `build`, `build:railway`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `lint` (`eslint`), `db:*`, `start` — all require node/pnpm (currently missing locally).

## Blockers (require operator action before C/D/F can complete)
1. **No Node toolchain** → blocks: npx-based GitHub MCP server; local lint/test/typecheck hooks (they invoke pnpm/tsc/vitest/eslint).
2. **No `uv`** → blocks Serena MCP (standard launch is `uvx ... serena-mcp-server`).
3. **GitHub MCP** also needs an auth decision (gh is authed, but the MCP server transport needs a runtime and/or a token/OAuth).

## What is safe to do now (no new runtimes, fully reversible) — pending approval
- **B (CodeGraph):** already installed + indexed + working + MCP-registered. Only action: add `.codegraph/` to `.gitignore` (propose diff).
- **E (CLAUDE.md):** review against checklist; propose a **minimal patch** for any missing items (do not rewrite).
- **F (hooks, runtime-free subset):** propose a destructive-command-block hook + a task-completion summary hook (no node needed). Defer lint/test/typecheck hooks until Node exists.
- This running log.

## Applied (approved 2026-05-29)
- **uv installed:** `python -m pip install uv` → `uv 0.11.17` at `...\Python313\Scripts\uv.exe` (on PATH).
- **Serena verified:** `uvx --from git+https://github.com/oraios/serena serena start-mcp-server --help` → exit 0 (73 pkgs built/installed); entrypoint `serena start-mcp-server --project …` confirmed. Serena MCP server can start.
- **`.mcp.json` created** (repo root): registers `serena` MCP server (uvx launch, `--context ide-assistant --project <repo>`).
- **`.gitignore`** patched: added `.codegraph/`.
- **`CLAUDE.md`** minimal patch: added a "Code intelligence (CodeGraph / Serena)" section (no rewrite). Pre-existing coverage confirmed for security (no credential exposure / no destructive git without approval), repo commands (pnpm typecheck/lint/test, build, db:*), and project specifics.
- **CodeGraph (B):** already installed + indexed (149 files) + global MCP server; verified working. No change except the `.gitignore` ignore above.

## Decisions
- **GitHub MCP (D): SKIPPED by recommendation.** Rely on the already-OAuth-authenticated `gh` CLI (kelly148). The npx GitHub MCP server needs a PAT, which `CLAUDE.md` forbids; PAT-free hosted/OAuth GitHub MCP can be revisited later if deeper integration is wanted.

## Applied (round 2, approved 2026-05-29)
- **Hooks (F):** created `.claude/hooks/guard.py` (Python; blocks `rm -rf`, `git reset --hard`, `git clean -f*`, force-push, `--no-verify`, `git restore .`, `git checkout -- `) + `.claude/settings.json` (PreToolUse→Bash→guard.py, exec form, `${CLAUDE_PROJECT_DIR}`). Active after next Claude Code restart. Does NOT touch existing `settings.local.json`.
  - Dropped the Stop "summary" hook: Stop stdout goes to debug log, not transcript (per docs) — no visible value.
  - lint/test/typecheck hooks still deferred until Node present.
- **Node.js:** `winget install OpenJS.NodeJS.LTS` attempted from here (background job). Result + verification to be recorded on completion.

## Verification steps (operator)
- **Serena:** restart Claude Code → approve the new `serena` MCP server when prompted (`.mcp.json`). First launch builds via uvx (already cached).
- **Hooks:** after restart, a destructive Bash command (e.g. `git reset --hard`) should be blocked with the guard message.
- **CodeGraph:** already live (`codegraph status` → 149 files).
- **Node (once installed):** new terminal → `node -v`, `corepack enable pnpm`, `pnpm install`, then `pnpm typecheck`/`lint`/`test`.
