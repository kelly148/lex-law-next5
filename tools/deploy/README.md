# Post-deploy live-verification + rollback (FOLD-DEPLOY-VERIFY-1)

Automated smoke verification for the **gated** deploy. Since Railway auto-deploy is
OFF (merge != deploy; deploy is `operator approve deploy:`), this runs **after** a
deploy and tells you GREEN (live-verified) or RED (roll back).

## What it checks

`tools/deploy/smoke.mjs` runs, in order:

1. **health** — `GET /api/health` returns `200 {status:'ok'}`.
2. **ready** — `GET /api/ready` returns `200 {status:'ready'}` (DB reachable).
3. **version-match** — `GET /api/version` commit starts with `SMOKE_EXPECTED_COMMIT` (only *required* when that var is set — the Pattern-16 "the right build actually deployed" check).
4. **protected-401-unauth** — `GET /trpc/auth.me` with no cookie returns **401** (auth is enforced).
5. **login** — `auth.login` with the smoke credentials succeeds and the resulting session authenticates `auth.me` (round-trip).
6. **changePassword-enforces** — `auth.changePassword` rejects a wrong current password (401) and a too-short new password (validation) — proves the endpoint is deployed and enforcing **without mutating** the credential.
7. **changePassword-rotates** *(opt-in; off by default)* — full rotate-and-restore. See the warning below.
8. **engagement-specific Pattern-16 checks** — pass extra checks via `config.extraChecks` (see `buildChecks` in `smokeCore.mjs`).

The suite **exits non-zero on any required-check failure**.

## Run it

```
SMOKE_USERNAME=<smoke-account> SMOKE_PASSWORD=<pw> npm run smoke:prod
# optional: SMOKE_EXPECTED_COMMIT=<git-sha-of-the-deploy>  SMOKE_ENGAGEMENT_ID=<id>
```

Secrets come from the environment — **never hardcoded, never logged**.

## Wired to run after each deploy

`.github/workflows/post-deploy-smoke.yml`:

- **`workflow_dispatch`** — run it by hand right after you trigger a deploy (Actions tab → "Post-Deploy Smoke" → Run; optional `engagement_id` / `expected_commit` inputs).
- **`repository_dispatch` (type `deploy-succeeded`)** — for *fully automatic* runs, point a Railway "deployment succeeded" webhook at the GitHub `repository_dispatch` API. Then every deploy triggers the smoke job with no manual step.

Set these **repo secrets** (Settings → Secrets and variables → Actions): `SMOKE_USERNAME`, `SMOKE_PASSWORD`, optionally `SMOKE_BASE_URL`, and for auto-rollback `RAILWAY_TOKEN` + `RAILWAY_SERVICE_ID` + `RAILWAY_ENVIRONMENT_ID`.

## On RED / On GREEN

- **GREEN** → prints `deploy verified for <id>` and recommends `operator approve live-verified:<id>`. (Pattern-16 sign-off stays the operator's — the suite recommends, it does not self-declare.)
- **RED** → the job fails (GitHub emails you = the alert) and prints the **exact rollback steps**. If a `RAILWAY_TOKEN` is configured it also **attempts a true auto-rollback** to the previous successful deployment; otherwise it runs **alert-only** (no token).

## Rollback mode — currently ALERT-ONLY (no Railway token)

There is **no `RAILWAY_TOKEN`** in this environment, so true auto-rollback is **not active**. On RED the suite prints the manual rollback steps (dashboard / CLI / API). **To enable true auto-rollback, provide `RAILWAY_TOKEN` (+ `RAILWAY_SERVICE_ID`, `RAILWAY_ENVIRONMENT_ID`) as repo secrets.** The Railway GraphQL rollback path in `smokeCore.mjs#performRollback` is implemented but **UNTESTED without a live token** — verify it on first real use.

## Things you'll want to set up

- **A dedicated smoke account** (not your only login) if you want the opt-in `changePassword-rotates` check — rotation mutates the credential, restored in a `finally`, but a mid-run failure could leave it on the temp value, so never point it at your sole account.
- **`RAILWAY_TOKEN`** for true auto-rollback (above).
- **The Railway deploy webhook** if you want the smoke to run with zero manual steps.
