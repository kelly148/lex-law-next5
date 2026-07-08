# FRESH-EYES-AUDIT-1 — Comprehensive project audit (2026-07-07)

**Method:** Five independent, context-free audit agents (architecture/code quality, test engineering, security/confidentiality, governance/paper-trail, release/ops) ran in parallel against the repo with deliberately minimal briefing — no project narrative, no settled-decisions list, adversarial framing. Read-only throughout. This document synthesizes their findings; Cowork lane, non-binding, nothing here is an operator decision.

**Scope caveat (material):** the local clone's tracked files are a ~2026-06-15 vintage checkout (`lex-next/config-validation-hardening-1`, 216 commits behind `origin/main` = `0de0f71`, prod = `b92591e`). Code-level findings reflect that vintage; the governance agent verified paper-trail findings against `origin/main` directly. Line references may drift; each finding should be re-verified against current `main` before an engagement is cut. Where a 07-06 STATE.md carryforward corroborates a finding (e.g., SUPERVISION-UNIFY-1 corroborates the egress gap), that is noted.

---

## 1. Headline verdict

The codebase is in **notably good shape for its stage** — unusually strong discipline signals (~42% of LOC is tests, zero TODO/FIXME debt, fail-fast config validation, real DI seams, auth bypass genuinely removed, no raw SQL, no secrets in code). The real risks are not rot. They cluster in four places:

1. **Confidentiality architecture:** the egress broker with its fail-closed allowlist, NPI minimization, and audit trail governs only the chat surfaces. The **primary drafting/extraction/reviewer pipeline sends raw privileged document text to four external providers outside the broker** — no minimization, no fail-closed gate, no egress audit rows. (Corroborated by the standing SUPERVISION-UNIFY-1 carryforward.)
2. **Overnight operations:** no alerting, no dead-man switch, liveness-only healthcheck, post-deploy smoke not automatic, rollback untested. For unattended overnight batches this is the dominant operational risk.
3. **Test-suite shape:** headline size (~2,786 cases) is inflated by static source-grep "tests"; the two highest-stakes surfaces — **cross-user ownership denial** and **document/deed export structural integrity** — are exactly where behavioral coverage thins out.
4. **Paper-trail drift:** both CLAUDE.md "Current state" blocks (working tree AND origin/main) are stale; `MR_CAL_engagement_state.json` is internally contradictory; and the **operator-adopted July roadmap + COWORK_MAP.md exist only as untracked files in this stale clone** — the documents defining "what next" are not in version control.

---

## 2. Consolidated findings, ranked

### CRITICAL / HIGH

**F1 — Egress-broker coverage gap (security).** `documents4a.ts` concatenates raw material text into prompts for extraction/draft/regeneration and dispatches via `executeCanonicalMutation` → direct provider fetch, bypassing `egressClient.send()` entirely. `GROUNDED_CHAT_PROVIDERS` fail-closed allowlist and `NPI_DEFAULT_WITHHELD_CATEGORIES` (wire instructions, SSN/TIN, trust-account data) do not apply; no `chat_egress_events` row is written. A scanned settlement statement with wire routing numbers goes verbatim to whichever providers have keys set. Compensating control today is procedural only (operator DPA/ZDR discipline per provider). **Exposure: today LOW–MODERATE (single user, attorney-in-loop); Stage 2 HIGH.**

**F2 — No overnight failure visibility (ops).** All failure signal is `console.*` → Railway logs. Telemetry write failures are swallowed. Handler-level reviewer failures only set a DB row. No email/webhook/pager anywhere. Railway healthcheck points at `/api/health` (unconditional 200) while the real DB-checking `/api/ready` is built but unwired. Post-deploy smoke fires only on manual dispatch or an optional webhook. Auto-rollback requires repo secrets that are absent, and its GraphQL path is commented "UNTESTED." **A failed overnight deploy or wedged reviewer pipeline is discovered by scrolling logs the next morning.**

**F3 — Ownership enforcement is grep-guarded, not behavior-tested (test + security).** `mr_fold_auth_2.test.ts` is a static ratchet counting inline `userId` predicates; its own docstring admits it cannot catch a query that omits the owner predicate entirely. **No test logs in as user B and asserts user A's data is denied.** Harmless at single-user; the exact class of bug that becomes a cross-attorney breach at Stage 2, and NC-PT-11 already requires a Stage-2 design answer.

**F4 — The adopted roadmap and orientation map are not in version control (governance).** `docs/WHEREAS_BUILD_ROADMAP_2026-07.md` and `COWORK_MAP.md` are untracked files in a stale scratch clone. Loss of this working tree loses the operator's build order. Same for the July dispatches until the CLI commits them.

**F5 — CLAUDE.md "Current state" is stale at both levels (governance).** Working-tree copy says "as of 2026-06-02, main at 9a0ebc3, queue head FOLD-AUTH-1, pnpm/tsc/vitest NOT installed" — all false. Even origin/main's copy says "as of 2026-06-24, main at e412864" — ~12 days and two prod deploys stale. The most-read bootstrap file misleads every fresh session; only STATE.md (top of origin/main copy or Desktop mirror) is current.

**F6 — engagement_state.json is internally contradictory (governance).** Stale prod pin (`4e07e51` vs real `b92591e`); `in_progress_engagement` = CHAT-COPILOT-1 (long finished); queue = the obsolete FOLD list, not the adopted roadmap; and it claims **FOLD-L0-1 LIVE-VERIFIED (STRONG PASS)** while every 07-06 STATE.md entry still carries "not client-facing until FOLD-L0-1 live-verified" — one of these is wrong and it gates client-facing use.

**F7 — Migration allowlist is a hand-maintained parallel list that already caused a prod outage (ops).** The `0019`/`0020` silent-skip broke every `SELECT * FROM matters`; the `0051`–`0055` skip broke all prod document generation (UAT RED-1) until MIGRATION-ALLOWLIST-1. A registration guard test now exists, but the runner still doesn't self-verify against the migrations directory, and the "additive" check is a keyword denylist that would pass a destructive `MODIFY`. Flag/migration coupling adds booby-traps: `CHAT_UI_1_ENABLED` flipped on prod today would hit deliberately-unapplied migrations `0028`/`0029`.

### MEDIUM

**F8 — Deed generation has no tests; DOCX export tests are substring-only and depend on the external `unzip` binary (test).** A structural export regression (reordering, duplication, dropped sections) that preserves substrings passes. The deed *drafting* path — the highest-stakes instrument — is untested (extraction is covered). Export tests have been re-baselined v1→v4, so they track the implementation rather than a frozen contract.

**F9 — Two parallel review stacks + three chat surfaces (architecture).** Document review (`reviewSession.ts`, 1,596 lines) and chat review (`chatReviewPanelEngine.ts`) duplicate prompt-builders, parsers, and disposition state machines. Four chat routers behind four flags (`chatUi`, `chatDispatch`, `chatCopilot`, `chatReviewPanel`). C.6c already plans ChatSurface retirement — the audit independently confirms that consolidation is the right call and should extend to the older scaffolds.

**F10 — God files (architecture).** `ReviewPane.tsx` 2,083 lines / 32 hooks; `schema.ts` 3,140 lines / 62 tables; `documents4a.ts` 1,298 lines (split by build-phase, not domain); `index.ts` inlines two multipart handlers + an HTML converter + the export gate ladder. Mechanical, low-risk splits.

**F11 — Web-security basics absent (security).** No helmet/CSP/HSTS, no CORS policy, no rate limiting, no login lockout (bcrypt cost 12 is the only friction). Session cookie `Secure` flag depends on `NODE_ENV === 'production'` being set on Railway (unverified); 14-day stateless sessions with no server-side revocation. Fine-ish single-user; not Stage-2-ready.

**F12 — Prompt injection from uploaded/OCR'd documents is undelimited (security).** Material text is interpolated raw into prompts. Bounded today by attorney-in-the-loop + export gates, but the surface grows with every auto-extraction feature.

**F13 — Source-grep tests create false confidence (test).** ~90 test files read source via fs; many assert `.toContain('identifier')` on code rather than executing it — including the reviewer dispatch wiring. They survive real logic regressions and break on renames. No enforced coverage floor (coverage step is continue-on-error by policy).

**F14 — Drizzle pinned ~14 minors back is an active TiDB migration hazard (architecture).** Old drizzle-kit emits SQL TiDB rejects; every migration is hand-patched. Tracked as DD-001/DD-003, but the jump grows monthly.

**F15 — Reviewer model slugs are boot-validated but provider-unverified (ops).** `gpt-5.5`, `gemini-3.1-pro-preview`, `grok-4.3` are registered locally, but a wrong slug fails only at review time (prior incident: `gpt-5.4-mini` 404'd every GPT-Lite review, 2026-06-15) — and with F2, silently.

### LOW / HYGIENE

**F16 — Silent carryforward attrition (governance).** Items that appear in STATE.md then vanish without closure: E8 live Layer-2 run; RPR-6/7 flag adoption; title-exam standing operator items (PB-1 FATIC written basis, PB-2 DC posture, xAI ZDR, malpractice-carrier confirmation); DISANTO trustee isolation; LIVE-5 prod OCR provisioning; `0052` provenance backfill. Also an unresolved contradiction: 06-26 entries say `DEED_DRAFT_AGENT_ENABLED` is ON in prod; 07-04 says OFF. Needs a live-config check.

**F17 — Stale bootstrap docs (governance).** HANDOFF.md presents the project as "v1 final"; BUILD_LOG.md frozen at 2026-04-24; README.md names "The Satterwhite Law Firm PLLC" while deed output treats that branding as a removed bug (firm-of-record = The Mason Law Firm / Universal Title). ~60 markdown files at repo root bury the real docs.

**F18 — Flag sprawl without a graduation path (ops).** 22+ flags, all default-OFF, uniformly disciplined — but none ever retire, several gate incomplete surfaces (`EVALUATOR_ENABLED` gates an admittedly-unfinished contract), and interaction chains (5 chat flags + egress allowlist; 3 job flags; 3 prompt flags) are easy to misconfigure. `REVIEWER_ASYNC_ENABLED` on + `JOB_REAPER_ENABLED` off (the default combo) orphans in-flight reviews on restart.

---

## 3. Positive findings worth recording

Auth core solid (constant-time compare, no enumeration, bypass fully removed with a test proving it inert). No SQL injection surface (no raw/string-built SQL). No SSRF/path-traversal (no user-supplied URL fetched; UUID storage keys; sanitized export filenames; 50 MB upload cap). Secrets clean (env-only, gitignored, never logged; migration runner never prints DATABASE_URL). Fail-fast boot validation (SESSION_SECRET length, model whitelist, prompt/OCR assets test -f in Docker build). Flag discipline uniform (`=== 'true'`, server-authoritative, no client twin to drift). The prompt-composition flag family has genuine byte-for-byte flag-off equivalence tests with zero-read counters — the gold standard the other flags should copy. Reviewer parse/normalize/adapter layer is genuinely behavioral across all four adapters. Pre-deploy migration runner fails the deploy on error (no half-migrated state).

---

## 4. Candidate engagements (feed for the monster overnight batch)

Reversible build-and-PR lane unless noted. Mapping ≠ prioritization; order is evidence-weighted suggestion, operator decides.

| ID (proposed) | Closes | Lane |
|---|---|---|
| OWNERSHIP-BEHAVIORAL-1 — real cross-user denial suite (user B vs user A across matters/documents/reviews/versions/exports) | F3 | Reversible; pure tests |
| OPS-DEADMAN-1 — wire healthcheck to `/api/ready`; auto-fire post-deploy smoke; nightly failed/orphaned-job summary pushed out-of-band; JOB_REAPER default-on when async on | F2, F15 | Mostly reversible; healthcheck/Railway bits operator-gated |
| MIGRATION-SELFVERIFY-1 — runner asserts allowlist == directory minus explicit EXCLUDE set; strengthen additivity check to a DDL-verb allowlist; per-flag migration-precondition assertions | F7 | Reversible |
| DEED-EXPORT-TESTS-1 — behavioral deed-generation tests + structural DOCX assertions (jszip in-process, drop the `unzip` binary dependency) | F8 | Reversible; pure tests |
| DOCS-TRUTH-1 — commit roadmap + COWORK_MAP + July dispatches; refresh CLAUDE.md Current-state header (diff-gated); repair/retire engagement_state.json contradictions (Rule 11 gate); archive HANDOFF/BUILD_LOG; fix README firm name; sweep root .md files into docs/ | F4, F5, F6, F17 | Reversible but multiple gates (CLAUDE.md append, state.json membership) |
| EGRESS-UNIFY-1 — extend broker allowlist + minimization + per-send audit to the canonical drafting/reviewer pipeline | F1 | **Run §3.1 triage — likely FIRE** (client-send-safety/confidentiality prong; could block existing drafting if flipped fail-closed). Design first. |
| SEC-WEB-BASICS-1 — helmet, login rate-limit/lockout, boot-time NODE_ENV assertion, CORS policy | F11 | Reversible |
| PROMPT-DELIM-1 — delimit/isolate untrusted document text in prompts | F12 | Reversible; touches every prompt builder — needs byte-for-byte flag-off proof |
| TEST-DEBT-1 — replace source-grep assertions on dispatch wiring with behavioral tests; add flag-off equivalence proofs to path-changing flags (lean-contract, latency-tuning, sendability shadow) | F13 | Reversible; pure tests |
| CLONE-REPAIR-1 — fetch + fast-forward this local clone, normalize line endings (.gitattributes), so Cowork reads current reality | F4 caveat | Operator-present; touches git state — NOT for an overnight batch |
| CARRYFORWARD-SWEEP-1 — one-page disposition of every vanished carryforward in §F16 + resolve the two live contradictions (FOLD-L0-1 verified?; DEED_DRAFT_AGENT_ENABLED on/off?) | F16 | Cowork lane can draft; operator dispositions |

Deliberately NOT proposed for overnight: anything touching prod config, Railway settings, flag flips, or the Drizzle upgrade (F14 — needs an attended spike given the TiDB history).

---

## 5. Open questions for the operator

1. FOLD-L0-1: live-verified or not? (JSON says yes/STRONG PASS; STATE.md says still gating client-facing use.)
2. `DEED_DRAFT_AGENT_ENABLED` on prod: ON (06-26 entries) or OFF (07-04 entry)?
3. Is `NODE_ENV=production` actually set on Railway? (Determines Secure cookies.)
4. F1 posture: accept-in-writing for Stage 1, or schedule EGRESS-UNIFY-1 design before more extraction features land?
5. Migrations `0028`/`0029`: keep deliberately-unapplied (document it louder) or apply and close the booby-trap?

*Read-only audit; no repo state was mutated. Line references are June-15-vintage and must be re-verified against current main before implementation.*
