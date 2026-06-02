# FOLD-AUTH-1 — Phase-A Plan (Real per-user auth + owner-key model)

Engagement: FOLD-AUTH-1 (Whereas fold Phase 1 / F.3; gate G3)
Type: Implementation (architecture). Checkpoint: §3.1 FIRE (auth/security). Status: Phase-A plan — NO code written.
Date: 2026-06-02. Repo: main 7538ca2.
Operator decisions settled: scope approved (operator approve scope:FOLD-AUTH-1). This plan is the FIRE artifact for external triad review before implementation.

## Objective
Replace the (now-disabled) single-operator bypass with real per-user authentication for a small set of trusted attorney accounts, and make ownership a first-class, owner-scoped, private-by-default model — built so a second attorney can be added later WITHOUT a destructive migration, and a sharing layer can be added later without rework. NOT SSO / enterprise IdP / RBAC / org / multi-tenant.

## Current state (from FOLD-REBASELINE-1 + the G1 auth diagnosis)
- Auth that EXISTS and is sound (keep, do not rebuild): iron-session cookie (`lex_session`, httpOnly, sameSite=lax, secure-in-prod, 14d, `SESSION_SECRET`); bcrypt (`bcryptjs` cost 12); `auth.login/logout/me`; client `AuthGuard`/`useAuth`/`LoginPage`. G1 live-verified these (unauth → 401; incognito login works).
- Bypass: `middleware/authBypass.ts` (`isAuthBypassEnabled()` === 'true') wired into the tRPC `isAuthenticated` middleware (`trpc.ts` ~79-88) and three REST handlers (`index.ts` ~151/297/494). Currently OFF in prod (G1) but the CODE PATH still exists.
- Ownership today: every core table carries `userId char(36) NOT NULL` (FK users.id); reads filter by `userId` through the Zod-Wall query wrappers (`src/server/db/queries/*`). Single seeded user (kelly). No account-creation flow (seed-only via `migrate.ts` `SEED_USERNAME`/`SEED_PASSWORD_HASH`); `updateUserPassword` query exists but is unexposed.
- Core matter-scoped tables (carry userId today): matters, documents, versions, matter_materials, review_sessions, feedback, feedback_manual_selections, feedback_evaluations, locked_decisions, adopt_ledger, jobs, information_requests, information_request_items, document_outlines, document_references, templates(+versions/variable_schemas).

## Design forks for triad + operator decision (this plan SURFACES; does not pre-decide)

### FORK A — owner key: repurpose `userId` vs add `ownerUserId`
The fold asks for a "nullable owner key, backfilled to operator." Today `userId` already is the de-facto owner and is populated on every row — but it is `NOT NULL` and the access check is a hardcoded `userId === current` scattered across query wrappers.
- **A1 (recommended): keep `userId` as the owner key; do NOT add a parallel column.** Treat `userId` as `ownerUserId` semantically. Leave it NOT NULL (every row has a real owner; "nullable" was to avoid a backfill migration when adding account #2 — but the column already exists and is populated, so a 2nd account needs no column migration regardless). Add the access-relationship abstraction (Fork B) so sharing is addable later. Lowest-risk, additive, no column change.
- **A2: add a separate nullable `ownerUserId`** distinct from a `createdByUserId`, backfilled to userId. Only worth it if "creator" and "owner" must diverge now (they don't at single-operator scale).
- Honest note: A1 satisfies "addable without migration" (column present + populated) and "not hardcode owner=only viewer" (via Fork B); the literal word "nullable" in the gate is best read as "don't require a backfill migration to add account #2," which A1 already meets.

### FORK B — access model: centralize the ownership check (the real "don't hardcode owner = only viewer")
Today each query wrapper filters `WHERE userId = ctx.userId`. To make a future default-off sharing layer addable WITHOUT rework:
- Introduce a single **access chokepoint** — e.g. `assertCanAccess(ctx.userId, row)` / a `visibleTo(userId)` filter builder — that TODAY returns owner-only (`ownerUserId === userId`) but is the ONE place a future sharing-grant join is added. Refactor the query wrappers to call it instead of inlining the equality. No behavioral change now (still private/owner-only); the relationship is modeled once, not scattered. This is the core G3 "ownership as a first-class relationship" requirement.

### FORK C — remove vs disable the bypass
Scope says "remove the single-operator bypass."
- **C1 (recommended): DELETE `authBypass.ts` and its wiring** (trpc.ts + the 3 index.ts handlers); the `isAuthenticated` middleware always validates the session; no env can re-disable auth. Removes the standing risk entirely.
- **C2: leave it flagged-off.** Rejected — leaves a re-enable-able unauth path in a client-data app.

### FORK D — account provisioning for account #2 (NOT self-signup)
- **D1 (recommended): an operator-only provisioning path** — a small one-off script (like the G1 reset) OR an admin-gated `auth`/`admin` procedure to create an account (username + bcrypt password + owner key). No public signup (scope: "small set of trusted attorney accounts"). Also exposes a proper **password change/reset** (formalize the G1 stopgap: an authenticated `auth.changePassword` verifying current password; and an operator reset path) so the stopgap kelly credential is rotated here.
- Do-not-touch: no roles/permissions beyond "is a valid user"; no invite/email flows.

## Proposed implementation shape (pending fork decisions; two default-safe increments)

**Increment 1 — auth hardening + bypass removal (no schema change):**
- Delete `authBypass.ts` + unwire (trpc.ts, index.ts ×3); `isAuthenticated` always validates session.
- Add `auth.changePassword` (authenticated; verify current via bcrypt; uses existing `updateUserPassword`) + an operator account-provisioning path (script or admin-gated procedure) for account #2 and credential rotation.
- Session hardening review: confirm secure/httpOnly/sameSite (present); decide on session rotation on password change (regenerate session id); CSRF posture for tRPC mutations (sameSite=lax + same-origin; document residual); auth-event telemetry (login/logout/failed/changed) — full audit record deferred to FOLD-GOV-1.
- Tests: bypass-removal regression (middleware always 401 without session); changePassword; provisioning.

**Increment 2 — owner-key relationship (additive migration 0004):**
- Per Fork A/B: formalize `userId`-as-owner + the `assertCanAccess`/`visibleTo` chokepoint; refactor query wrappers to use it (no behavioral change — still owner-only/private).
- If A2 chosen: additive nullable `ownerUserId` (migration 0004, IF NOT EXISTS-style, backfill = userId) — no destructive change; apply to prod TiDB out-of-band (DEPLOY-MIGRATIONS-NOT-AUTOMATIC).
- Tests: access chokepoint (owner sees own, non-owner denied); 2-account fixture proves isolation.

## Do-not-touch
No org/RBAC/multi-tenant model; no SSO/IdP; no sharing/grant logic (model the relationship chokepoint only, default owner-only); no destructive migration; no change to the reviewer/calibration/MR-CAL feature behavior; no Railway/prod mutation without separate approval.

## Acceptance (gate G3)
- Auth replacement live-verified (bypass code gone; unauth → 401; login works; a 2nd test account sees only its own data).
- Owner key present + enforced on all core objects via the single access chokepoint.
- Default access private. Stopgap kelly credential rotated.

## Honest risks / notes
- Bypass removal could lock out workflows if any path silently relied on the synthetic bypass user — Increment 1 must audit all `getBypassUserId()` callers before deletion.
- The owner-key "nullable" wording is interpreted (Fork A); triad should confirm the interpretation.
- Live verification now requires real login (no bypass) — slightly less convenient but correct.
- Migration 0004 (if A2) needs the out-of-band prod-migrate step.
- Privilege/egress + audit-as-record are FOLD-GOV-1, not here; sharing is a later latent layer.

## §3.1 FIRE — next step
This plan HALTS for external triad review (independent GPT + Claude) before implementation. Ready-to-paste packet: `EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §12.2 (auth checkpoint). Manifest: this plan + WHEREAS_FOLD_master_plan.md + WHEREAS_PREFOLD_GATE_CHECKLIST.md + FOLD-REBASELINE-1-investigation.md + CLAUDE.md + MR_CAL_engagement_state.json + (the auth code: auth.ts, authBypass.ts, session.ts, users.ts, schema.ts excerpt). After triad disposition (or operator waiver) and operator approve accept:FOLD-AUTH-1-plan, implementation proceeds under the normal Phase A→B gates.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
