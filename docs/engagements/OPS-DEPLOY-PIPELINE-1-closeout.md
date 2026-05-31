# OPS-DEPLOY-PIPELINE-1 - Close-out

Disposition: COMPLETE. Deploy pipeline fixed and verified live. Unblocked and closed MR-CAL-4C-LIVE; closed the MR-CAL-4B deferred render.

Date: 2026-05-31 (America/New_York). Author/account: kelly148 (gh OAuth). Driven by Claude Code.

## Objective

Diagnose and fix why Railway production kept serving a stale frontend bundle (index-DXdOnjQl.js) that lacked recently merged code (notably the MR-CAL-4B native feedback cards), across every deploy, which blocked MR-CAL-4C-LIVE.

## Starting state

main at 6ad049a (PR #61, a prior cache-bust attempt). Production served index-DXdOnjQl.js with index.html Last-Modified frozen at 2026-05-30 20:52 UTC. Local Node/npx present (v24); pnpm and the Railway CLI absent.

## Root cause (confirmed)

Railway's Dockerfile build-LAYER cache was reusing a stale `vite build`. The active deployment's build log showed `COPY --from=builder /app/dist ./dist` as `cached`, and successive builds produced byte-identical images (same containerimage.digest, same size). The repo config was correct throughout (railway.json Dockerfile builder, no watchPatterns; Dockerfile COPY . . then vite build; CI green; Source = kelly148/lex-law-next5 @ main, auto-deploy ON). The displayed `afe64058` in the Railway header was an internal deployment id, not a git commit.

Service-variable workarounds were INEFFECTIVE:
- Static `ARG CACHEBUST` (#61) did not invalidate the cache.
- `NO_CACHE=1` applies to Railway's own (Railpack) builder, not Dockerfile builds; it produced a new image but the vite/dist layer stayed cached.

## Fix (PR #62, squash-merged d37ba10)

1. Pinned the base image on all stages: node:22-alpine -> node:22-alpine3.21. Changing the layer-chain foundation forces a full rebuild including `vite build`, which a cache cannot satisfy.
2. Replaced the static CACHEBUST with RAILWAY_GIT_COMMIT_SHA, consumed in a RUN before the build, so the build cache key changes on every commit automatically (no manual bumping). Prevents recurrence.
3. Added GET /api/version, reporting the commit and build time baked into dist/version.json by the runner stage. This makes a deployed build matchable to a commit in one request. /api/health left byte-identical (test T-S4-7 stays green).

Result: the deploy landed cleanly in roughly 45 seconds; /api/version confirmed d37ba10 (and later 5ad3be7) live.

## Measurement-artifact correction

The "stale frontend" signal was largely a measurement artifact. The client code-splits by route, so the native-card code lives in the lazily-loaded DocumentDetail-*.js chunk, not in the entry index-*.js bundle that was being grepped (both in-browser and via curl). The deployed chunk contained the markers. Lesson: verify route-split features against the route chunk (or the rendered DOM / API response), not the entry bundle hash.

## MR-CAL-4B render defect found and fixed (PR #63, squash-merged 5ad3be7)

Live tRPC inspection (reviewSession.get) showed the render path fully wired (nativeCards attached, render code deployed) yet extractEmbeddedFeedbackCards returned 0 cards. Cause: reviewers (observed: Gemini) emit audience_affected as a string, while the lenient FeedbackCardDisplaySchema typed it as z.array(z.string()); safeParse failed on that one field and the whole card was dropped, silently falling back to the legacy raw body.

Fix: in the display-only projection, audience_affected accepts either an array or a bare string (coerced to a one-element array); the strict canonical FeedbackCardSchema array contract is unchanged. A regression test using the exact production card shape was added. CI green.

## Live verification (Pattern 16) - PASS

On production 5ad3be7, Claude driving Chrome as kelly on the synthetic "POA iteration test" document: the same previously-failing Gemini iteration-7 session now parses (all three suggestions nativeCardsLen:1; audience_affected coerced string -> array) and renders the native card: severity-subtype chip (SUBSTANTIVE - BUSINESS), critique_type chip (structural), "Attorney decision required" amber badge, audience line, and "Suggested revision:" formatted content. No data mutation was needed.

This closes MR-CAL-4C-LIVE and the MR-CAL-4B deferred on-screen render.

## Files changed

- Dockerfile (base-image pin, per-commit cache-bust)
- src/server/index.ts (/api/version)
- src/shared/schemas/feedbackCards.ts (audience_affected tolerance)
- src/server/__tests__/mr_cal_4b.test.ts (regression test)

## Scope confirmation

No production database mutation, no schema migration, no Railway configuration changes performed by Claude. Railway dashboard actions (variable adds, redeploys) were performed by the operator. No credentials were printed, stored, or committed.

## Carryforwards

- AUTH_BYPASS_ENABLED is still ON in Railway production (left on for the live verification). Operator to disable.
- Synthetic test data persists on production (LLN-PROD-CLEANUP-1; operator-approved cleanup only).
- Minor: align reviewer prompts to emit audience_affected as an array (display schema now tolerant; canonical schema still requires an array).
- telemetry_events size/retention follow-up (MR-CAL-2G writes full raw reviewer output on every review).

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
