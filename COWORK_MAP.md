# COWORK_MAP — orientation for a new Cowork thread

**Purpose:** help a fresh Cowork thread find things fast. This is a **navigation map, not a state snapshot** — it points to the live, authoritative sources rather than restating volatile facts (HEAD SHA, what's deployed, which flags are on), so it can't drift on facts. For current state, always read the sources it points to.

**To orient at thread start:** (1) skim `CLAUDE.md` (auto-loaded; the standing governance + build-loop brief); (2) read the **top** of `docs/STATE.md` (newest-first running narrative — the real current state); (3) run the git baseline (`git fetch`; `git log origin/main --oneline -10`; `git status`). That's enough to know where things stand.

---

## Authoritative state sources (read these for facts — never trust a paraphrase)

- **`docs/STATE.md`** — newest-first running narrative; one dated paragraph per closed engagement. The human-readable current state.
- **`docs/MR_CAL_engagement_state.json`** — machine-readable engagement tracker.
- **`CLAUDE.md`** — standing governance: the lane, the operating rules, the FIRE/triad checkpoint criteria, the deploy posture, the close-out format. Large and CLI-build-oriented.
- **`src/server/config/featureFlags.ts`** — the truth on every feature flag (all default OFF; this file says what each gates).
- **Handoff briefs** — `docs/HANDOFF_BRIEF_*` and the Desktop `_progress/` mirror — full phase-boundary context.

## The Cowork ↔ CLI division of labor (important)

- **Cowork (this surface)** plans, designs, inventories, writes docs, and produces **CLI dispatch prompts**. It has file tools + a Linux sandbox, but **no GitHub CLI and no build toolchain** — it cannot push, open PRs, run CI, or reliably touch `.git`.
- **The Claude Code CLI** does the actual building: branches, edits, local gates, CI, and PRs (GitHub auth `kelly148`, account-scoped). Every prior engagement shipped from there.
- So the pattern is: **Cowork writes the dispatch → you paste it into the CLI → the CLI builds + opens the PR → you accept-gate the merge.** Dispatches are saved as `CLI_PROMPT_*.md` at the repo root.

## Deploy posture (pointer)

Railway, **auto-deploy OFF** — merge ≠ deploy; deploy is operator-gated (`operator approve deploy:`). A pre-deploy migration runner (`scripts/apply-prod-migrations.mjs`, additive allowlist) applies additive migrations on deploy. For the current deployed commit, ask — it's not recorded here on purpose.

---

## Workstreams & where they live

**Deterministic deed agent (DEED-DRAFT-AGENT-1)** — flag `DEED_DRAFT_AGENT_ENABLED`.
- Server: `src/server/deed/` (assemblers, `deedKbVa`/`deedKbLocalitiesVa`/`deedKbRonVa`, `deedIngestExtract.ts`, `deedSourceFacts.ts`), `src/server/procedures/deedDraftAgent.ts`.
- Client: `src/client/pages/QuickDeedPage.tsx`, `src/client/components/DeedIntake.tsx`, `src/client/pages/quickDeedCategoryForms.tsx`.
- Materials/UAT: `deed-materials/` (gitignored — local + Drive only), `docs/reviews/LIVE-9_*`.

**Express Deed (DEED-EXPRESS-1)** — the drop+describe+generate redesign of Quick Deed.
- Design: `docs/EXPRESS_DEED_design_2026-06-29.md`. Dispatch: `CLI_PROMPT_deed-express-1_inc1-gift_2026-06-29.md`.

**Express auto-review loop (EXPRESS-AUTO-REVIEW-LOOP-1)** — flag `AUTO_REVIEW_LOOP_ENABLED` (E8 ship-gate NOT cleared). Server: `src/server/express/`. Client: `ExpressReviewPane.tsx`, `ExpressCandidateBanner.tsx`.

**Reviewers + chat copilot** — flags `MULTI_REVIEWER_ENABLED`/`EVALUATOR_ENABLED` (on), `CHAT_COPILOT_ENABLED` (off).
- `src/server/procedures/reviewSession.ts`, `chatCopilot.ts`, `chatDispatch.ts`; grounding `src/server/llm/chatGrounding.ts`; client `ReviewPane.tsx`.

**Knowledge Backbone** — the firm "second brain" program (two phases).
- Plan: `docs/KNOWLEDGE_BACKBONE_program_plan_v2_2026-06-29.md`. FIRE packet: `docs/reviews/KNOWLEDGE-BACKBONE-PHASE2_packet.md`. I1 dispatch (gated): `CLI_PROMPT_knowledge-backbone-p2_inc1-capture_2026-06-29.md`.
- Existing KB substrate it builds on: `src/server/practiceKb/` (`surface.ts`, `gate.ts`, `retention.ts`, `profileInjection.ts`), `practice_memos` + `authority_source` (migrations 0008/0038/0039), the deed KB, `kb_events` (0010), adopt ledger (`adopt_ledger`, 0003), locked decisions (`locked_decisions`, 0002).

## Common locations

- **Migrations:** `src/server/db/migrations/` (numbered; additive allowlist in `scripts/apply-prod-migrations.mjs`).
- **Feature flags:** `src/server/config/featureFlags.ts`.
- **tRPC procedures:** `src/server/procedures/`. **DB queries:** `src/server/db/queries/`. **Schemas:** `src/shared/schemas/`.
- **Client pages/components:** `src/client/pages/`, `src/client/components/`.
- **Engagement reports / reviews:** `docs/engagements/`, `docs/reviews/`. **Dispatches:** `CLI_PROMPT_*.md` (repo root).

## Governance lane (one paragraph — detail in CLAUDE.md)

Reversible build-and-PR; **attorney-final**; nothing client-facing or deployed without an operator gate; CI is the authoritative quality gate. Load-bearing decisions with privilege/access/client-send-safety risk **FIRE** a §3.1 external triad review (packet → halt → disposition → build accept-gated). Merge to main needs `operator approve accept:` + green CI. Deploy is separate and always operator-gated. Product is **self-use only** until the conflicts-at-intake gate (FOLD-L0-1) is live-verified.

---

*Keep this map pointer-based. If you're tempted to write a fact here (a SHA, a deployed state, a flag value), point to its source instead — that's what keeps the map from going stale.*
