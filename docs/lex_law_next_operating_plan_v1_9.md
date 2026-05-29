# Lex Law Next — Operating Plan v1.9

**Document version:** v1.9
**Date issued:** May 2, 2026
**Supersedes:** Operating Plan v1.8 (issued April 30, 2026; superseded by this document).
**Status:** AUTHORITATIVE. All future engagements operate under this plan unless explicitly superseded.
**Operator:** Kelly Satterwhite, Esq. (VA/MD attorney; The Satterwhite Law Firm PLLC; Universal Title Company; The Mason Law Firm PLC).
**Build agent:** Manus AI.
**Codebase:** `kelly148/lex-law-next5`.

---

## §0 — What's New in v1.9

This document supersedes v1.8 with the following material updates:

**Engagement chain captured (eight engagements since v1.8):**
- MR-LLM-1 S5 acceptance at `960bf38` (adapter contract normalization; validated rawText return for OpenAI and Google structured-output paths).
- MR-DB-CLEAN-1 acceptance (production poison-row cleanup; 2 Gemini rows cleaned, ZERO GPT poison rows ever existed; backup CSV preserved).
- MR-LLM-1 S7 corrected addendum (Layer 2 OpenAI parse failure identified; H1/H2 hypotheses framed; Options C/D/E/F surfaced for operator scoping).
- MR-LLM-1 S8 acceptance at `67803ac` (diagnostic guards: `finish_reason` named-target for `'content_filter'` and `'length'` plus empty-string guard; verified end-to-end in production).
- MR-LLM-1 S9 corrected addendum (Railway log investigation; CF-1 logging gap — pre-S8 OpenAI adapter is structurally silent; H1/H2 unresolvable from logs).
- MR-LLM-1 S10 acceptance (single-phase investigation, no commits) — H2 confirmed in production at job `7ed7005a-...` on document `6639b148-...`; first directly observed CF-3 UI rendering gap.
- MR-LLM-1 S11 acceptance at `0fd094a` (maxTokens raised 4096 → 8192; live-verified insufficient on a Last Will Testament document).
- MR-LLM-1 S12 acceptance at `fd23a80d36b6` (maxTokens raised 8192 → 16384, GPT-5 standard variant model ceiling floor; one corrected addendum cycle).

**Process patterns added or formalized:**
- **Pattern 16 promoted to authoritative** — code-level closure does not constitute live verification. Referenced in S8/S11/S12 dispatches; formalized in §1.6 Halt Conditions Framework and §1.7 Live Verification Framing.
- **Pattern 9 generalized cure documented** — input-position vs output-position redaction discipline established at S8 Phase B Second Corrected Addendum, durably applied through S9, S10, S11 Phase B, and S12 Phase B. §1.4 expanded with explicit redaction-scope discipline.
- **Pattern 17 candidate logged** — auto-progression past authorized scope. Two documented instances (S8 Phase A AHC-9 absorption; S8 verification session abandon-then-create attempt). Not yet promoted to inventory; needs one more instance per Pattern promotion threshold.

**New evidence-class additions formalized in Rule 3:**
- `(Railway GraphQL query)` — established at S9; used at S11/S12 live verification.
- `(GitHub Actions REST API)` — established at S11/S12 Phase B addenda for CI run results.
- `(GitHub REST API — commits endpoint)` — established at S12 Phase B addendum for authorship distinction queries.

**Failure-Mode Patterns Inventory updated to v1.3** (parallel artifact). Promotes Pattern 16 to authoritative; documents Pattern 9 generalized cure; logs Pattern 17 candidate; adjusts Pattern 5 recurrence note.

**Standard Dispatch Boilerplate updated to v1.3** (parallel artifact). Embeds Pattern 9 generalized redaction discipline (both input and output positions) inline; embeds §8 scan-and-confirm grep step as standard Phase B addendum requirement; embeds Module B v2.2 sub-check references in Phase A close-out and Phase B addendum templates; adds three new evidence classes to standard taxonomy.

**Reviewer B Context Brief v2.2** consolidated brief landed as separate artifact (`reviewer_b_v2_2_consolidated_brief_2026_05_02.md`); Module B body-level cross-check operating cleanly through three formal applications.

**Authoritative SHA chain (oldest to newest, recent):**

| SHA | Engagement | Status |
|---|---|---|
| `9345c4b` | MR-DEPLOY-1 S2/S3/S4 | Accepted (v1.6 era) |
| `bf7415e` | MR-CONFIG-EXTRACT | Accepted (v1.6 era) |
| `d6ef9d6` | MR-UX-1 | Accepted (v1.7 era) |
| `c250ab3` | UAT 409 fix | Accepted (v1.7 era; process exception) |
| `fee9c2a` | MR-PROMPT-1 | Accepted (v1.7 era) |
| `c225b9f` | MR-LLM-1 S2 | Accepted (v1.7 era) |
| `ca5892627` | MR-LLM-1 S3 | Accepted (v1.8 era) |
| `960bf38` | MR-LLM-1 S5 | **Accepted (v1.9 era)** |
| `66cf882` | MR-EXPORT-1 | **Accepted (v1.9 era)** |
| `e059d34` | MR-PROMPT-1.1 | **Accepted (v1.9 era)** |
| `67803ac` | MR-LLM-1 S8 | **Accepted (v1.9 era)** |
| `0fd094a` | MR-LLM-1 S11 | **Accepted (v1.9 era)** |
| `fd23a80d36b6` | **MR-LLM-1 S12 (current HEAD)** | **Accepted (v1.9 era)** |

Note: `66cf882` (MR-EXPORT-1) and `e059d34` (MR-PROMPT-1.1) appear in the git log between v1.8 and S5; they're product engagements run in operator's separate threads, accepted as background updates, with their live verification still pending (see §3.3).

**Current `origin/main` HEAD:** `fd23a80d36b6bab6f0084fb2782f1473fdf02a42`
**Test baseline at current HEAD:** 488 passing / 16 skipped / 504 total.

---

## §1 — Governance Framework

### §1.1 — Roles

**Operator (Kelly):** Decides scope, authorizes engagements, makes architectural decisions. Holds the only authority to authorize Phase B pushes and to override governance constraints.

**Build agent (Manus AI):** Implements engagements per dispatch. Does NOT propose architectural-conflict resolutions on halt. Does NOT absorb scope expansions. Does NOT modify governance documents.

**Third-lane evaluator (Claude in operator's primary thread):** Drafts dispatches; synthesizes lane reviews; produces v2 final dispatches; reviews close-outs; protects scope discipline against drift.

**Lane reviewers:**
- **Substantive Reviewer** — substantive function; technical correctness; constraint coherence; adapter contract preservation
- **Reviewer B v2.2** — governance form; element-presence + Module B body-level cross-check (B.1 single-boundary, B.2 credential scan, B.3 epistemic discipline, B.4 evidence-label accuracy, B.5 narration scan)

Lane reviewers operate in separate threads with their own context briefs.

### §1.2 — Engagement Lifecycle

1. **Scope identified** — operator or third-lane evaluator surfaces the engagement.
2. **v1 draft** — third-lane evaluator produces a draft dispatch.
3. **Lane review (pre-dispatch)** — Substantive + Reviewer B independently review the draft. Both must Adopt; one or both may recommend Modify. **Operator may authorize skipping lane review** for small follow-on engagements where precedent is established (S12 followed this pattern after S11).
4. **v2 final** — third-lane evaluator integrates Modify edits. If both lanes Adopt v1, v1 = v2 final; otherwise revise.
5. **Operator dispatch** — operator sends v2 final to Manus.
6. **Phase A** — Manus performs local implementation, verification, commit, and Phase A close-out.
7. **Phase A lane review** — Substantive + Reviewer B independently review the close-out. (Operator may authorize skipping for small follow-on engagements.)
8. **Phase A acceptance** — operator accepts Phase A based on synthesis of lane reviews.
9. **Phase B authorization** — operator separately authorizes push, providing PAT via separate channel.
10. **Phase B** — Manus pushes, creates PR, squash-merges, runs CI, produces Phase B addendum.
11. **Phase B lane review** — Substantive + Reviewer B independently review the addendum. (Operator may authorize skipping.)
12. **Phase B acceptance** — operator accepts Phase B; engagement closed.
13. **Live verification (operator-side, post-merge)** — operator-side smoke test on production deployment confirming the code-level fix actually solves the user-facing problem. Per Pattern 16, this is a separate step from Phase B acceptance and is required for substantive closure on user-facing engagements.

Investigation-only engagements (e.g., MR-LLM-1 S1, S9, S10) compress this to a single phase — no Phase A/B split — but otherwise follow the same review cycle.

Phase B addenda may require correction cycles; a corrected addendum is not a process failure, it is a normal governance outcome when defects are caught (per S8 Phase B and S12 Phase B precedents — both had corrected addendum cycles that ended cleanly).

### §1.3 — Two-Phase Structure

**Phase A:** Local implementation only. No push, no PR, no GitHub write API call. No push token provided at dispatch.

**Phase B:** Push + PR + squash merge into `main`, separately authorized by operator. PAT-in-URL bypass acceptable per established precedent.

**Halt-as-acceptance pattern:** When Manus halts on a §5 architectural condition, that's the engagement deliverable. Operator decides what to do next. Manus does NOT propose resolutions.

### §1.4 — Sandbox Credential Precondition

When Phase B is authorized:

- Ambient `gh auth` is NOT authorized for push or write operations.
- Operator-supplied push token used via explicit authenticated path.
- PAT-in-URL bypass acceptable per established precedent (MR-DEPLOY-1 / MR-CONFIG-EXTRACT / MR-UX-1 / MR-PROMPT-1 / MR-LLM-1 S2 / S3 / S5 / S8 / S11 / S12).
- **Pattern 9 generalized redaction discipline** (formalized at S8 Phase B Second Corrected Addendum; durably applied through S9/S10/S11/S12): credential values must be redacted from BOTH input command position AND output position.
  - Input-position examples: `git remote set-url <URL with PAT>`, `GH_TOKEN=<PAT> command`, `curl -H "Authorization: Bearer <PAT>"` — credential values in these positions must be substituted with `<PAT_REDACTED>` or equivalent placeholders BEFORE the command runs.
  - Output-position examples: `gh auth status`, `git remote get-url origin`, `git push` output — credential values in stdout must be redacted via sed or equivalent before being included in any artifact.
  - Sed-based output redaction alone is INSUFFICIENT. Both positions must be addressed.
- §8 scan-and-confirm grep step required in every Phase B addendum:
  ```
  $ grep -E "ghp_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}" <addendum file>; echo "exit: $?"
  ```
  Expected `exit: 1`. Other relevant patterns (DB password placeholder, Railway token placeholder) checked with `grep -F` for their literal redaction markers.
- Token values MUST NEVER appear in close-out, logs, intermediate output, or any formal artifact body.

**Operator credential channel reality (unchanged from v1.8):** Operator possesses PATs from two GitHub accounts: `kelly148` (the repo owner) and `ryanrdonnelly`. Per Option C established in v1.7, `kelly148` is the canonical Phase B credential. S11 Phase B and S12 Phase B both used `kelly148` PAT successfully. Sandbox `gh auth status` continues to show `ryanrdonnelly` as ambient (sandbox provisioning, not Manus-fixable); PAT-in-URL bypass works around this.

**Token exposure handling (per v1.8 §1.4 refinement, durably applied):** Token-redaction language in close-outs is scoped to the formal close-out body. Transcript exposure (operator paste-in to build agent surface) is a separate fact requiring explicit acknowledgment when relevant; evidence class `(operator transcript / close-out inspection)`. Per operator standing instruction (no credential rotation prompts), known transcript exposures are flagged once for record but not pressed.

**Railway access (per v1.8 §6 retained, refined):** Project-scoped Railway tokens work via the GraphQL API directly at `https://backboard.railway.app/graphql/v2` with `Authorization: Bearer <token>`, but are rejected by `railway whoami` (CLI, account-level command). When delegating Railway work to Manus, instruct use of GraphQL API directly; skip `railway` CLI entirely. This was established at S9 and confirmed at S11/S12 live verification.

### §1.5 — Rules

**Rule 1 — No fictional language.** Engagements describe real code states, real evidence, real outputs. No speculative or hypothetical claims presented as fact.

**Rule 2 — Surface-and-halt on baseline mismatch.** If baseline preconditions cannot be verified, halt immediately and surface the mismatch. Do NOT absorb or attempt to recover without operator decision.

**Rule 3 — Evidence class on every material claim.** Valid classes (expanded in v1.9):

- `(repo command)` — actual git invocation
- `(code inspection)` — read-only review of source files
- `(test output)` — output from running test commands
- `(db query)` — output from a database query
- `(live UI)` — operator-observed UI state
- `(live LLM)` — output from a live LLM call
- `(operator assertion)` — operator-stated facts not independently verified
- `(operator confirmation)` — state updates not yet ratified into governance documents
- `(operator transcript / close-out inspection)` — facts visible in surrounding conversational transcript
- **`(Railway GraphQL query)`** — output from Railway GraphQL API calls (NEW in v1.9; established at S9)
- **`(GitHub Actions REST API)`** — output from GitHub Actions REST API for CI run data (NEW in v1.9; established at S11/S12 Phase B)
- **`(GitHub REST API — commits endpoint)`** — output from GitHub REST API commits queries (NEW in v1.9; established at S12 Phase B for authorship distinction)
- `(prior accepted finding from <engagement>)` — facts inherited from a prior accepted close-out
- `(inherited)` — DISALLOWED as sole evidence for fresh findings

**Rule 4 — Mandatory repo state snapshot.** Every Phase A close-out begins with verbatim `git rev-parse HEAD`, `git log --oneline -5`, `git status --porcelain`.

**Rule 5 — No Rev 1.9 vocabulary.** (Decommissioned terms not relevant to current work; carried forward from prior plans.)

**Rule 6 — Targeted cleanup on halt.** If working tree is dirty after halt, perform `git checkout <file>` per file. Do NOT use broad `git clean -fd` — pre-existing untracked close-out / documentation artifacts must be preserved.

**Rule 7 — No productization tails.** Build agent's response platform appends suggestions like "Turn this into a website" after engagement output. These appear AFTER the formal boundary statement and are platform-injected, NOT engagement output. The formal close-out ends at the boundary statement.

**Rule 8 — Push verification.** Phase B addenda must include verbatim outputs for:
- `git fetch --all --tags --prune`
- `git rev-parse origin/main`
- `git cat-file -t <commit>` for both engagement commit and squash-merge commit
- `git branch -a --contains <commit>`

(Established as five-command structure in S12 Phase B corrected addendum precedent — initial S12 Phase B addendum had four-command structure missing the initial fetch; corrected version cured.)

**Rule 9 — Operator-identity authorship.** Phase A engagement commits must be authored as `Kelly Satterwhite / kelly@thesatterwhitelawfirm.com`. Verbatim `git config user.name`, `git config user.email`, and `git log --pretty=format:'%h %ae %an' <range>` over engagement commit range required in close-outs. Phase B squash-merge commit attribution under the kelly148 PAT (REST API artifact) is expected and distinct — it is NOT characterized as "Kelly Satterwhite" in a blanket statement.

**Rule 10 — Scope discipline.** Build agent must not absorb scope expansions; must surface in close-out instead. Out-of-scope encounters log required in every close-out.

**Rule 11 — No infrastructure changes.** Engagements do not modify Railway env vars, deployment configs, build configs, or governance documents unless explicitly authorized in the dispatch.

**Rule 12 — Carryforward items.** Each close-out should note any items deferred to future engagements. Items not captured in close-out cannot be relied upon to surface later.

**Rule 13 — Pre-send baseline check.** Before sending a v2 final dispatch to Manus, operator runs `git ls-remote origin main` (or equivalent) to confirm current `origin/main` HEAD matches the dispatch baseline. If not, operator updates the baseline SHA in the dispatch via find-and-replace before sending. Mitigates Pattern 15 (predecessor-merged-during-drafting).

**Rule 14 — Investigation-engagement scope discipline.** Investigation engagements (e.g., MR-DEPLOY-1 S1, MR-LLM-1 S1/S7/S9/S10) explicitly prohibit recommending or ranking specific code fixes. Build agent may identify mechanically available implementation options, clearly labeled as "Options surfaced for operator scoping," but must not rank, choose, or begin implementing any option. Operator scopes follow-up implementation engagements based on investigation findings.

### §1.6 — Halt Conditions Framework

Each dispatch defines specific architectural halt conditions in its §5. Common patterns:

- Baseline preconditions cannot be verified.
- Any file outside the §3.1 allowlist would need to be modified.
- Hard-guardrail files cannot be modified.
- Test count delta cannot be reconciled to specific in-scope tests via a mapping table (mappability is the rule, numeric range is a guideline; refined v1.8 framing retained).
- Any baseline-passing test now fails.
- The proposed mechanism cannot satisfy the dispatch's premise without expanding scope.
- Sandbox credential precondition cannot be satisfied (Phase B).
- **Action-based scope determination triggers** (refined from v1.7 AHC-13 wording in S12): "If the implementation determines that achieving the dispatch deliverable as scoped requires additionally modifying [X, Y, Z]," halt. Replaces subjective "temptation" language with verifiable behavior.

**On halt:** Build agent stops, performs targeted cleanup if needed (Rule 6), produces a Halt Close-Out with the specific halt condition triggered. **No proposed resolution.** Operator decides next steps.

### §1.7 — Live Verification Framing (Pattern 16, formalized in v1.9)

**Code-level closure does not constitute live verification.** Phase B acceptance closes the engagement at the code level only. Live verification is a separate post-merge operator-side step requiring:

(a) Confirmation that production deployment (typically Railway) is running the squash-merge SHA or later.
(b) A fresh smoke test on a production-pattern artifact (document, transaction, etc.) that exercises the changed code path.

For user-facing engagements (those that change user-observable behavior), substantive closure requires both Phase B acceptance AND live verification. For internal-only engagements (test-only changes, internal refactors), Phase B acceptance is sufficient closure.

**Three-outcome framing** (established in S11/S12 dispatches; recommended for all user-facing engagement Phase B addenda):

1. **Best case:** the code-level fix produces the expected user-observable outcome in production.
2. **Iteration case:** the fix is insufficient; a follow-on engagement adjusts.
3. **New mechanism case:** a different failure mode manifests; separate engagement required.

The three-outcome framing protects against confusing "code merged" with "problem solved."

---

## §2 — Project Identity

### §2.1 — Codebase

**Repo:** `kelly148/lex-law-next5` on GitHub.

**Stack:**
- Frontend: React 19 + Vite + Tailwind.
- Backend: Node + Express + tRPC 11 + Drizzle.
- Database: TiDB Cloud.
- Deployment: Railway (auto-deploy via GitHub OAuth).

**CI gates (both authoritative):**
- "CI / Lint" — pnpm lint with one expected pre-existing warning (`@typescript-eslint/no-explicit-any` at `mr1.addendum_behavioral.test.ts:130`).
- "CI / Type Check + Tests" — pnpm typecheck + pnpm test.

Both must be green for merge.

### §2.2 — LLM Architecture

**10 LLM call sites across 4 files** (per MR-LLM-1 S1 investigation; unchanged from v1.7/v1.8):

| File | Line | Job Type | Model String |
|---|---|---|---|
| `documents4a.ts` | 218 | `data_extraction` | `PRIMARY_DRAFTER_MODEL` |
| `documents4a.ts` | 533 | `draft_generation` | `PRIMARY_DRAFTER_MODEL` |
| `documents4a.ts` | 668 | `regeneration` | `PRIMARY_DRAFTER_MODEL` |
| `documents4a.ts` | 1110 | `formatting` | `'anthropic:claude-opus-4-7'` (hardcoded; MR-PROMPT-1) |
| `informationRequest.ts` | 72 | `information_request_generation` | `PRIMARY_DRAFTER_MODEL` |
| `outline.ts` | 77 | `outline_generation` | `PRIMARY_DRAFTER_MODEL` |
| `outline.ts` | 181 | `outline_generation` | `PRIMARY_DRAFTER_MODEL` |
| `reviewSession.ts` | 169 | `reviewer_feedback` | `REVIEWER_MODELS[reviewerRole]` (multi-vendor) |
| `reviewSession.ts` | 237 | `evaluator` | `EVALUATOR_MODEL` |
| `reviewSession.ts` | 739 | `regeneration` | `PRIMARY_DRAFTER_MODEL` |

Note: line numbers may have shifted slightly due to S5/S8/S11/S12 changes; the architecture is unchanged.

**`maxTokens` configuration for GPT-5 reviewer-feedback path (S11/S12 lineage):**
- `reviewSession.ts:182` (or near; verify via grep): `maxTokens: 16384` per S12.
- `reviewSession.ts:255`: evaluator path, `maxTokens: 4096` (out of scope for S11/S12).
- `reviewSession.ts:753`: separate path, `maxTokens: 8192` (out of scope for S11/S12).
- `openai.ts:76` (or near): adapter default, `maxTokens: 4096` (out of scope for S11/S12).

**Adapter hardening status (post-S12):**
- **OpenAI**: S5 contract normalization + S8 diagnostic guards (`finish_reason` named-target for `'content_filter'` and `'length'`; empty-string guard) + S11/S12 maxTokens raised to model ceiling for reviewer-feedback path. JSON-object mode active for reviewer feedback per S2.
- **Google Gemini**: two-level guards live (S3); empty/missing candidates and missing text both throw `LlmProviderError('api_error')`.
- **xAI / Anthropic**: no S2/S3-equivalent hardening applied; no observed defects.

**`WHITELISTED_MODELS` array contents:** `'anthropic:claude-opus-4-5'`, `'anthropic:claude-sonnet-4-5'`, `'openai:gpt-5'`, `'google:gemini-2.5-pro'`, `'xai:grok-4'`. `'anthropic:claude-opus-4-7'` bypasses the whitelist via direct hardcoded literal at the formatting call site.

**`REVIEWER_MODELS` (role-keyed, multi-vendor BY DESIGN):** `claude` → Opus 4.5; `gpt` → GPT-5; `gemini` → Gemini 2.5 Pro; `grok` → Grok 4.

### §2.3 — Railway Environment Variables (verified state, unchanged from v1.7/v1.8)

**Set:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `DATABASE_URL`, `NODE_ENV`, `PORT`, `SEED_PASSWORD_HASH`, `SEED_USERNAME`, `SESSION_SECRET`.

**NOT set (intentionally; code falls back to defaults):** `PRIMARY_DRAFTER_MODEL`, `EVALUATOR_MODEL`.

### §2.4 — Live URLs

**Production:** `https://lex-law-next-app-production.up.railway.app`
**Repo:** `https://github.com/kelly148/lex-law-next5`

---

## §3 — Carryforward Queue

### §3.1 — Completed in v1.9 cycle

- MR-LLM-1 S5 dispatch + Phase A + Phase B (accepted at `960bf38`).
- MR-DB-CLEAN-1 dispatch + close-out (accepted; production poison-row cleanup; backup CSV preserved).
- MR-LLM-1 S7 corrected addendum + acceptance (Layer 2 OpenAI parse failure identified).
- MR-LLM-1 S8 dispatch + Phase A + Phase B with two corrected addendum cycles (accepted at `67803ac`; verified end-to-end in production).
- MR-LLM-1 S9 corrected addendum + acceptance (Railway log investigation; CF-1 logging gap).
- MR-LLM-1 S10 single-phase investigation + acceptance (H2 confirmed; first directly observed CF-3 UI rendering gap).
- MR-LLM-1 S11 dispatch + Phase A + Phase B + live verification (accepted at `0fd094a`; live-verified insufficient).
- MR-LLM-1 S12 dispatch + Phase A + Phase B with one corrected addendum cycle (accepted at `fd23a80d36b6`; pending live verification).
- Reviewer B v2.2 brief addendum (Module B body-level cross-check) drafted and applied through three formal review cycles.
- Standard Dispatch Boilerplate v1.3 (parallel artifact landing with v1.9).
- Failure-Mode Patterns Inventory v1.3 (parallel artifact landing with v1.9).
- Three new evidence classes formalized in Rule 3 (`Railway GraphQL query`, `GitHub Actions REST API`, `GitHub REST API — commits endpoint`).

### §3.2 — In flight

None at v1.9 issuance. S12 awaiting operator-side live verification (separate post-merge step).

### §3.3 — Pending live verification (operator-side)

- **MR-LLM-1 S12 live verification (HIGH PRIORITY).** Wait for Railway auto-deploy to land `fd23a80d36b6...`; re-run GPT smoke test on document `6639b148-0cd5-451f-9783-74bedfaefa35`. Three possible outcomes per dispatch §10.1(g):
  - **Best case:** GPT review completes successfully → S12 closes; GPT reviewer chain resolved.
  - **Iteration case:** Still fails with `finish_reason='length'` at 16384 (model ceiling) → architectural answer is document chunking; separate engagement.
  - **New mechanism case:** Different `finish_reason` or error class → separate engagement required.
- **MR-PROMPT-1 Finalize verification** (carried forward from v1.7/v1.8). Operator confirmed 2026-05-02 still failing live (zero observable response). Persists since `fee9c2a` accepted.
- **MR-EXPORT-1 / Download verification** (carried forward from v1.7/v1.8). Operator confirmed 2026-05-02 button works but file is unformatted. Persists since `66cf882` accepted.
- **MR-LLM-1 S2 GPT reviewer verification** (carried forward; superseded operationally by S5+S8+S11+S12 chain).
- **MR-LLM-1 S3 Gemini reviewer verification.** ✅ Confirmed live (v1.8 era).

### §3.4 — Queued / pre-staged

- **MR-UAT-ERR-1 v1 dispatch.** Next major engagement after S12 live verification. Evidence package matured to scopeable: three directly-observed CF-3 instances (S10 smoke test, 11:21 EDT smoke test, 18:31 UTC post-S11 smoke test) plus persistent Finalize and Download failures. See §3.5 for evidence summary.
- **MR-PROMPT-1.1** — pre-staged contingency for model-not-found from Anthropic for `claude-opus-4-7`. `e059d34` accepted as the temperature-removal version; further fallback to `claude-opus-4-6` available if needed.
- **Document chunking architecture** — only if S12 live verification produces Iteration case (still fails at 16384). Separate larger engagement; not pre-staged.
- **Token-count logging on failure path** — small follow-on engagement to address CF-2/CF-4 (tokensCompletion NULL on length path). Useful for future investigations; not blocking.

### §3.5 — MR-UAT-ERR-1 evidence package status

The UI silent-failure observability gap has accumulated rich, specific evidence:

**Three directly-observed CF-3 instances** (DB has diagnostic `errorMessage`; UI renders blank detail line below the structured failure card):

1. S10 smoke test job `7ed7005a-...` on document `6639b148-...` (2026-05-02 15:18:30 UTC) — DB: `"OpenAI returned finish_reason 'length' (token truncation)"`; UI: blank detail line.
2. 11:21 EDT 2026-05-02 smoke test (same document, same shape).
3. 18:31 UTC 2026-05-02 post-S11 smoke test (job `cf72453f-...`, same document, same shape).

**Persistent live failures** (operator-confirmed 2026-05-02):
- **Finalize button:** zero observable response. No error toast, no UI change, no file produced. Persists since `fee9c2a` accepted.
- **Download button:** produces file but doesn't format markdown to DOCX. Persists since `66cf882` accepted.

**Plus** the yesterday session-state cluster (multiple silent UI failures during S8 verification window).

**Pattern across all observations:** backend errors aren't surfacing to users; users see silent failures or blank error states. UAT-ERR-1 should scope this as a class, not as individual diagnostics.

**Suggested UAT-ERR-1 scope framing** (not yet ratified):
- Phase 1 (investigation, single-phase): identify the layer in tRPC error response → React error boundary → structured failure card component where `errorMessage` is being dropped or rendered into a non-visible position.
- Phase 2 (implementation, two-phase): fix the rendering gap; verify via component-level test with mocked tRPC error response.
- Out of scope for UAT-ERR-1 (separate engagements if needed): Finalize button silent failure; Download button formatting failure. UAT-ERR-1 may absorb these as in-scope test cases if the root cause is shared, but should not absorb them as additional fixes if root causes diverge.

### §3.6 — Deferred

- **Reviewer B Context Brief v2.3.** Currently using v2.2 (consolidated brief landed in v1.9 cycle). Module B holding cleanly through three formal applications. v2.3 deferred until either (a) three consecutive Module B catches confirm calibration, or (b) Module B itself misses a Pattern 10 instance (calibration trigger).
- **Token-hygiene audit.** Per operator standing instruction, NOT brought up proactively. Operator decides timing.
- **Branch archival of `lex-next/migration-tidb-compat`.** Operator-side housekeeping post-MR-CONFIG-EXTRACT.
- **Operating Plan v2.0.** Will batch UAT-ERR-1 closure + Reviewer B v2.3 brief revision (if formalized) + S12 live verification outcomes. Not before MR-UAT-ERR-1 closes; possibly later if more engagements accumulate first.

### §3.7 — Issuance cadence (v1.8 §3.6 lesson applied)

v1.9 lands one acceptance cycle after S12, not waiting for MR-UAT-ERR-1 closure. This honors the v1.8 §3.6 issuance cadence note ("refresh the Operating Plan within ~3 acceptance cycles of new HEAD rather than batching indefinitely"). The v1.9 cycle has captured eight engagements since v1.8; the next refresh (v2.0 or v1.10) should land within 3 acceptance cycles of post-S12 work.

---

## §4 — Failure-Mode Patterns Inventory v1.3 (in force; landing as parallel artifact)

| Pattern | Name | Manifested in (notable) |
|---|---|---|
| 1 | Quiet scope expansion | (multiple early engagements) |
| 2 | Test-count delta drift | (caught in v1.5 cycle) |
| 3 | Halt-as-failure framing | (v1.5 era) |
| 4 | Adapter contract drift | (v1.6 era; preserved by guardrails) |
| 5 | Phase B addendum format compression | MR-PROMPT-1 (resolved Boilerplate v1.2); **S12 Phase B initial addendum recurrence** (abbreviated five-step + four-step Rule 8; cured in corrected addendum) |
| 6 | Productization tail leak above boundary | (none observed; Rule 7 enforcement working) |
| 7 | Author identity drift | (none observed; Rule 9 enforcement working) |
| 8 | Inherited evidence relabeling | MR-LLM-1 S1 (defended) |
| 9 | Halt-with-resolution-proposal | (caught in v1.5 era; Option A discipline) |
| 10 | Defense variant: silent absorption / close-out completeness drift | MR-CONFIG-MERGE; halt-as-acceptance pattern. Reviewer B v2.0/v2.1 cycles. **v2.2 Module B closing this** (three formal applications, all PASS). |
| 11 | Operator-asserted facts as code-inspection | MR-LLM-1 S1 (defended) |
| 12 | Rev 1.9 vocabulary recurrence | (none observed) |
| 13 | Verbatim summarization tendency | MR-LLM-1 S2 Phase A; **MR-LLM-1 S3 Phase A**; **MR-LLM-1 S9 original close-out**. Defense durable; recurrence is normal-rate, not drift. |
| 14 | Stale-branch divergence | MR-PROMPT-1 → MR-LLM-1 S1 baseline halt |
| 15 | Predecessor-merged-during-drafting | MR-PROMPT-1 ← UAT 409; MR-LLM-1 S2 ← post-MR-PROMPT-1; MR-LLM-1 S3 ← post-S2; MR-EXPORT-1 dispatch ← post-MR-LLM-1 S3; **multiple S5-S12 era recurrences mitigated by Rule 13**. |
| **16** | **Code-level closure ≠ live verification (formalized v1.9)** | **All user-facing engagements; explicitly framed in S8/S11/S12 dispatch §10.1(g) and §1.7 above.** |

**Pattern 17 candidate (logged for v1.4 inventory):** Auto-progression past authorized scope.
- Two documented instances:
  - S8 Phase A AHC-9 absorption: Manus broadened the named-target guard to `!== 'stop'` despite halt-rather-than-expand instruction.
  - S8 verification session: abandon-then-create attempt without separate authorization.
- Not yet promoted to authoritative pattern; needs one more documented instance per inventory promotion threshold.
- Defense: explicit "stand by" instructions in dispatches; action-based AHC framing per Pattern 16-related refinement.

**Pattern 9 generalized cure (formalized v1.9 §1.4):** input-position vs output-position redaction discipline. Established at S8 Phase B Second Corrected Addendum; durably applied through S9, S10, S11 Phase B, S12 Phase B (corrected). Documented inline in §1.4 and embedded in Boilerplate v1.3.

**Pattern 10 v2.2 calibration data (3 cycles; calibration confirmed):**
- Cycle 1 (S10 close-out): all five Module B sub-checks PASS.
- Cycle 2 (S11 Phase B addendum): all five sub-checks PASS.
- Cycle 3 (S12 Phase B corrected addendum): all five sub-checks PASS.

One Module B miss observed at v1.9 cycle (S12 Phase B initial addendum had abbreviated five-step credential check and four-step Rule 8 missing initial fetch; third-lane evaluator's first-pass acceptance missed both defects; corrected addendum cured). This is technically a third-lane evaluator (Claude) first-pass calibration drift, not a Reviewer B miss — Reviewer B v2.2 was not invoked on the initial addendum review per operator-authorized lane review skip. Worth documenting honestly in §6 Process Exceptions.

---

## §5 — Standard Dispatch Boilerplate v1.3 (in force; landing as parallel artifact)

(Full content in `standard_dispatch_boilerplate_v1_3.md`.)

Key changes from v1.2:

- **Pattern 9 generalized redaction discipline** embedded inline in §6.5 (sandbox credential precondition) rather than referenced as external precedent.
- **§8 scan-and-confirm grep step** documented as standard Phase B addendum requirement in §10 boilerplate.
- **Module B v2.2 sub-check references** (B.1 single-boundary, B.2 credential scan, B.3 epistemic discipline, B.4 evidence-label accuracy, B.5 narration scan) embedded in Phase A close-out (§9) and Phase B addendum (§10) requirements.
- **Three new evidence classes** added to Rule 3 taxonomy: `(Railway GraphQL query)`, `(GitHub Actions REST API)`, `(GitHub REST API — commits endpoint)`.
- **Rule 8 push verification structure** clarified as five-command (with `git fetch --all --tags --prune` first) rather than four-command, per S12 Phase B corrected addendum precedent.
- **Live verification disclaimer template** for §10.1(g) Phase B addenda standardized with three-outcome framing per §1.7.

---

## §6 — Process Exceptions and Known Operational Realities

### §6.1 — Operator credential channel reality (unchanged from v1.8)

Per §1.4. `kelly148` PAT for Phase B pushes (Option C). Sandbox `gh auth status` shows ambient `ryanrdonnelly`; PAT-in-URL bypass works around. Per operator standing instruction, no credential rotation prompts.

### §6.2 — Manus close-out format drift (Pattern 5 recurrence note)

Resolved at Boilerplate v1.2; durable through S9, S10, S11. **Recurred at S12 Phase B initial addendum** (abbreviated step labels in §10.1(a); four-step Rule 8 missing initial `git fetch --all --tags --prune`). Cured in corrected addendum. Boilerplate v1.3 makes the five-step and five-command structures more explicit to defend against future recurrence.

**Lesson:** even durable cures can drift on first-pass artifacts. Lane reviewers (and third-lane evaluator) must continue verifying explicit structures rather than checking for "format reminders are present."

### §6.3 — Manus verbatim summarization tendency (Pattern 13)

Continues to manifest occasionally; cured per artifact via corrected versions. Worth flagging in close-out reviews; not blocking.

### §6.4 — UAT 409 fix process exception (historical, v1.7 era)

Documented in v1.7/v1.8. Future urgency should follow fast-track engagement, not bypass.

### §6.5 — MR-LLM-1 S1 baseline mismatch (historical, v1.7 era)

Resolved; Pattern 14 captured.

### §6.6 — MR-LLM-1 S3 Phase B governance-form drift (historical, v1.8 era)

Documented in v1.8 §6.6.

### §6.7 — Productization tails (Rule 7 enforcement)

Working as designed. Tails consistently appear after the boundary statement and are platform-injected. Don't flag as defects unless they appear above the boundary.

### §6.8 — Operator-confirmation evidence class (v1.8 retained)

Per v1.8 §6.8.

### §6.9 — Operator standing instructions for Claude-thread behavior (retained, refined)

- **No credential rotation prompts** until operator explicitly lifts. Acknowledged exposures may be flagged once for record but not pressed.
- No unsolicited productization tails / "turn this into a website" / etc.
- No token-hygiene reminders unless directly relevant to the immediate task.
- Direct, efficient communication preferred over caveats.
- **Maximize Manus delegation** where reasonable (added in v1.9; applied throughout S5-S12 chain).
- **"Small forward steps over big revisions"** — preference for tight specs, evidence-based close-outs, explicit decisions at each stage.

### §6.10 — Third-lane evaluator first-pass drift (NEW in v1.9)

Documented honestly: at S12 Phase B initial addendum review, the third-lane evaluator (Claude in operator's primary thread) accepted the addendum on first pass despite governance-form defects (abbreviated five-step credential check; four-step Rule 8 missing initial fetch). The corrected addendum cured both defects on second review.

This is a Pattern 10 first-pass calibration drift on Claude's part, not Reviewer B's (Reviewer B was not invoked per operator-authorized lane review skip). The same discipline that drove Module B's creation for Reviewer B applies to the third-lane evaluator: explicit element-presence verification, not pattern-matching to "this looks correct."

**Mitigation:** when operator authorizes lane review skip on Phase B addenda, third-lane evaluator should run the equivalent of Module B sub-checks (B.1 through B.5) explicitly before producing acceptance language. Verbatim verification of structures (five-step, five-command) rather than "looks complete."

---

## §7 — Lane Review System

### §7.1 — Substantive Reviewer

**Stance:** Substantive function — engagement premise viability, constraint conflicts, mechanism-vs-outcome correctness.

**Output format:** Direct recommendation (Adopt / Modify / Reject) with prescriptive edits.

**Cycles where Substantive caught issues other lanes missed:** 8, 9, 11, 17, MR-LLM-1 S3 Phase B addendum cycle, **S11 v1 dispatch (caught the implementation file is not presumed to be `openai.ts` architecture-aware correction)**, **S10 11:21 EDT smoke test response (correctly framed evidence routing)**.

**Context brief:** `/mnt/user-data/outputs/substantive_reviewer_brief_2026_05_02_post_s12.md` — refreshed in v1.9 cycle. Captures patterns observed through S12.

### §7.2 — Reviewer B v2.2 (with §3 extension and Module B addendum)

**Stance:** Governance form — element-presence + body-level cross-check.

**Output format:** Six-section structured response.

**Calibration history:**
- v1.0 drifted into Rev 1.9 vocabulary; recalibrated to v2.0.
- v2.0/v2.1 had recurring Pattern 10 misses (close-out completeness drift).
- v2.2 Module B addendum landed in v1.9 cycle to address Pattern 10.
- **Three formal Module B applications** (S10, S11 Phase B, S12 Phase B corrected addendum) — all five sub-checks PASS each time.

**Context brief:** `/mnt/user-data/outputs/reviewer_b_v2_2_consolidated_brief_2026_05_02.md` — consolidated brief landing in v1.9 cycle. Includes v2.0 base, v2.1 §3 extension, v2.2 Module B in single document.

**Status: calibration solid through three Module B cycles.** v2.3 brief revision deferred per §3.6.

### §7.3 — Synthesis (third-lane evaluator)

Third-lane evaluator (Claude in operator's primary thread) synthesizes both lane reviews. Lane reviewers do NOT coordinate; independence is the value.

**Honest note (per §6.10):** third-lane evaluator is also subject to Pattern 10 first-pass drift. Module B-equivalent discipline should be applied by third-lane when operator authorizes lane review skip.

---

## §8 — How to Resume This Plan

When operator returns to this work after a break, or when a fresh Claude instance picks up the engagement chain:

1. **Read this Operating Plan v1.9.**
2. **Verify current `origin/main` HEAD** matches §0's stated SHA (`fd23a80d36b6bab6f0084fb2782f1473fdf02a42`). If different, the chain has advanced; check S12 live verification outcome and any subsequent engagements.
3. **Check S12 live verification status** (§3.3 highest priority). If not yet done, suggest doing that before scoping new engagements. If done, interpret per dispatch §10.1(g) three-outcome framing.
4. **Check §3.4 for next major engagement.** As of v1.9 issuance: MR-UAT-ERR-1 v1 dispatch is the next major engagement after S12 live verification settles.
5. **Check §3.5 for MR-UAT-ERR-1 evidence package.** Three directly-observed CF-3 instances + persistent Finalize/Download failures + session-state cluster. Evidence is mature.
6. **Check §3.6 for deferred items.** Reviewer B v2.3 brief revision deferred; v2.0 or v1.10 plan refresh deferred.
7. **Check §6.9 for operator standing instructions** that govern Claude-thread behavior independent of engagement governance.
8. **Honor §6.10 third-lane evaluator first-pass discipline** — explicit element-presence verification, not pattern-matching, especially when lane review is skipped.

---

## §9 — Authoritative References

- This document (Operating Plan v1.9) supersedes v1.8 entirely.
- Standard Dispatch Boilerplate v1.3 (parallel artifact) supersedes v1.2.
- Failure-Mode Patterns Inventory v1.3 (parallel artifact) supersedes v1.2.
- Reviewer B Context Brief v2.2 consolidated (`reviewer_b_v2_2_consolidated_brief_2026_05_02.md`) supersedes prior split v2.0 + v2.1 + Module B addendum.
- Substantive Reviewer Context Brief refreshed (`substantive_reviewer_brief_2026_05_02_post_s12.md`).
- Operator Handoff Brief refreshed (`operator_handoff_brief_2026_05_02_post_s12.md`).

All dispatches drafted post-v1.9 must reference Operating Plan v1.9, Standard Dispatch Boilerplate v1.3, and Failure-Mode Patterns Inventory v1.3 in their headers.

---

**End of Operating Plan v1.9.**

Authoritative. Supersedes v1.8. In force as of May 2, 2026.
