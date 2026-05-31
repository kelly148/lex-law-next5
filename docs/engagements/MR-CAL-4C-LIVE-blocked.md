# MR-CAL-4C-LIVE - Blocked (Railway deploy pipeline)

Engagement: MR-CAL-4C-LIVE (Phase 3, item 3.3) - Native feedback-card live verification
Status: BLOCKED (not failed) - external infrastructure
Date: 2026-05-31 (America/New_York)
Repo state at block: main @ b579ee9.

## Summary

The native-card live render could not be verified because the deployed
production app is not serving the merged native-card code. This is a Railway
deployment-pipeline problem, not a code, test, or Dockerfile problem. The
engagement is recorded as blocked, with a recommended follow-up
(OPS-DEPLOY-PIPELINE-1).

## What is confirmed good

- MR-CAL-4B native-card code is merged (a748028), CI-green (type-check + 13
  tests), and code-correct.
- The native-card data is present at runtime: live reviewer feedback bodies
  contain the embedded STRUCTURED_FEEDBACK_CARDS block (confirmed in-browser).
- The Dockerfile is correct: stage 2 does COPY . . then `pnpm exec vite build`,
  so any source change invalidates the build layer and would produce a new
  content-hashed frontend bundle.

## The block (root cause isolated)

The served frontend bundle stayed `index-DXdOnjQl.js` across every deploy and
redeploy attempted in this session, before and after the native-card merges
(a748028, b579ee9) and after explicit redeploys. Because Vite content-hashes the
bundle, a real rebuild of the changed source WOULD change that filename. It never
changed.

Conclusion: Railway is not building/serving the latest `main` commit. The running
container is an older build; the recent commits are not being deployed, despite
the dashboard showing an "active / successful" deployment. This is in Railway's
deploy orchestration, not in the application code or the Dockerfile.

Reliable evidence (logged-in, in-browser, decompressed fetch of the loaded
bundle): `index-DXdOnjQl.js` contains neither `nativeCards` nor the string
"Attorney decision required"; the reviewer feedback body DOES contain
`STRUCTURED_FEEDBACK_CARDS`. (Earlier curl-based bundle checks were unreliable due
to a single-bundle / encoding mismatch and were superseded by the in-browser
check.)

## Incidental blockers cleared along the way

- TiDB Cloud serverless usage quota was exhausted, restricting cluster access
  (login and SQL editor both returned the quota error). Resolved by the operator
  raising the spending limit / upgrading the plan. Heavy live-testing this session
  plus MR-CAL-2G raw-output telemetry writes contributed to quota consumption.
- App login credentials are not held by the operator and there is no
  password-reset flow; access is via the env-gated auth bypass
  (AUTH_BYPASS_ENABLED). Bypass left enabled by operator decision for now (note:
  this disables authentication on the public production URL while on).

## Recommended follow-up: OPS-DEPLOY-PIPELINE-1

Investigate why Railway is not deploying the latest `main`:
- Inspect the Railway build logs for the most recent deployment: did a build for
  b579ee9 actually run, did `vite build` execute, and did it fail or get skipped?
- Confirm the GitHub auto-deploy trigger for `main` is active and firing on merge.
- Confirm the deployment that shows "active" corresponds to the latest commit, not
  a stale one.
Requires Railway dashboard / build-log access (operator).

## Disposition

- MR-CAL-4C-LIVE: BLOCKED on OPS-DEPLOY-PIPELINE-1.
- MR-CAL-4B on-screen render: remains DEFERRED under the same root cause (code is
  merged and correct; only the deploy is not serving it).
- No code change is warranted by this block; the application work is sound.

---
End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
