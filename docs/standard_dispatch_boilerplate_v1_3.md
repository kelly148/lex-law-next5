# Standard Dispatch Boilerplate v1.3

**Document version:** v1.3
**Date issued:** May 2, 2026
**Supersedes:** Standard Dispatch Boilerplate v1.2 (issued April 30, 2026)
**Status:** AUTHORITATIVE for all dispatches drafted post-Operating Plan v1.9 issuance.
**References:** Operating Plan v1.9 (in force); Failure-Mode Patterns Inventory v1.3.

---

## §0 — What's New in v1.3

This boilerplate supersedes v1.2 with the following material updates:

1. **Pattern 9 generalized redaction discipline embedded inline** in §6.5 (sandbox credential precondition) rather than referenced as external precedent. Both input-position and output-position redaction are documented with examples.

2. **§8 scan-and-confirm grep step** documented as standard Phase B addendum requirement in §10. Three required grep checks (GitHub PAT regex, DB password placeholder, Railway token placeholder).

3. **Module B v2.2 sub-check references** embedded in Phase A close-out (§9) and Phase B addendum (§10) requirements:
   - B.1 single-boundary verification
   - B.2 credential-pattern body scan
   - B.3 epistemic-discipline conformance
   - B.4 evidence-label accuracy spot-check
   - B.5 mid-investigation narration / process-leak check

4. **Three new evidence classes** added to Rule 3 taxonomy:
   - `(Railway GraphQL query)` — output from Railway GraphQL API calls
   - `(GitHub Actions REST API)` — output from GitHub Actions REST API for CI run data
   - `(GitHub REST API — commits endpoint)` — output from GitHub REST API commits queries

5. **Rule 8 push verification structure** clarified as five-command (with `git fetch --all --tags --prune` first) rather than four-command, per S12 Phase B corrected addendum precedent.

6. **Live verification disclaimer template** for Phase B addendum §10.1(g) standardized with three-outcome framing per Operating Plan v1.9 §1.7 (Pattern 16 formalization).

7. **Action-based AHC framing** for "scope expansion would be needed" halt conditions, per S12 dispatch v2 final precedent. Replaces subjective "temptation" language.

---

## §1 — Header Block

Every dispatch begins with a header block containing:

```
**Engagement ID:** <name and ID>
**Engagement type:** <Code (two-phase) | Investigation (single-phase) | Hybrid>
**Baseline SHA:** <full 40-char SHA> (operator pre-send Rule 13 check required)
**Branch:** <feature branch name, e.g., lex-next/<engagement-id>>
**Operating Plan:** v1.9
**Standard Dispatch Boilerplate:** v1.3
**Failure-Mode Patterns Inventory:** v1.3
**Reviewer B Context Brief:** v2.2 consolidated
**Predecessor (architectural):** <prior engagement and SHA>
**Predecessor (diagnostic):** <if applicable, prior investigation finding>
```

If predecessor merge risk exists between drafting and send, header includes operator pre-send Rule 13 check callout per Operating Plan v1.9 §1.5.

---

## §2 — Required Sections (varies by engagement type)

Standard structure for code engagements (two-phase):

- §0 What this engagement is
- §1 Engagement identity (background, decision, scope at a glance, build agent)
- §2 Baseline and preconditions (required baseline, test count baseline, halt-on-precondition triggers, inputs Manus must read)
- §3 Scope (file allowlist, substantive change, contract preservation, pre-implementation investigation, tests, verification, commit)
- §4 Per-concern implementation principles (hard constraints)
- §5 Architectural halt conditions
- §6 Engagement structure (two-phase, sandbox credential precondition, authorship requirement, boundary statement format)
- §7 Out-of-scope
- §8 Testing requirements
- §9 Phase A close-out requirements
- §10 Phase B addendum requirements
- §11 Governance rules in force
- §12 Lane review (pre-send; stripped before dispatch to Manus) — when lane review is run
- §13 Operator dispatch header (pre-send instructions)

Investigation-only engagements compress sections; halt close-outs use §13 modifications.

---

## §3 — Scope Section Standards

### §3.1 — File allowlist

Strict allowlist with explicit pre-investigation determination if file location is uncertain (per S11 v2 final / S12 v1 precedent: "implementation file is not presumed; pre-implementation investigation locates the source").

Hard guardrails listed explicitly. Modifying any guardrail file triggers halt.

### §3.2 — Substantive change

Pseudocode showing the change (illustrative; actual location may shift per §3.4 investigation).

If target value or behavior depends on pre-implementation findings, include a confirm-or-correct flow table (per S11 v2 final / S12 precedent) covering all reasonable findings.

### §3.4 — Pre-implementation investigation

Required outputs as numbered list. Each output produces verbatim evidence (grep, code excerpt, etc.). Must include:

- Verbatim grep across `src/` for relevant identifiers
- Verbatim excerpt of the change locus showing current state
- Confirmation or correction of any assumed values
- Verification of guardrail file integrity (e.g., S8 guards intact verbatim if applicable)
- Test fixture analysis with explicit narrow-vs-broad classification
- Contract preservation analysis

### §3.5 — Tests

New tests with explicit T-IDs. Identify the load-bearing test (the one that asserts the engagement's central claim).

Existing-test-fixture updates: narrow scope only. Updates outside narrow scope halt.

Optional integration test conditional on existing harness support; if harness insufficient, soft-fail (defer integration test, proceed with unit tests). Hard halt only if no test can verify the load-bearing claim.

### §3.7 — Commit

Commit message format: `fix(<area>): <ENGAGEMENT-ID> — <one-line summary>`

Authored as `Kelly Satterwhite <kelly@thesatterwhitelawfirm.com>` per Rule 9.

**Use explicit per-file `git add` for in-scope files only.** Broad staging commands (`git add -A`, `git add .`) prohibited per AHC-8.

---

## §4 — Hard Constraints (§4 boilerplate language)

Standard hard constraints to include:

- Single-axis change discipline
- Rule 14 boundary on options/recommendations (for follow-on engagements after investigation)
- No absorption of out-of-scope carryforwards (action-based: "If implementation determines that achieving the dispatch deliverable as scoped requires additionally modifying X, halt")
- Pattern 9 generalized redaction discipline (input + output positions)
- Staging discipline (per-file `git add` only)

---

## §5 — Architectural Halt Conditions (action-based framing per v1.3)

Standard AHC list:

- AHC-1: File outside allowlist would need modification
- AHC-2: Hard-guardrail file would need modification
- AHC-3: Implementation requires more than the single dispatched change
- AHC-4: Existing tests require updates beyond narrow scope; OR baseline-passing test outside narrow scope now fails
- AHC-5: Test count delta cannot be reconciled to specific in-scope tests via mapping table (mappability is the rule, numeric range is a guideline)
- AHC-6: New failure mode discovered requiring scope expansion
- AHC-7: Sandbox credential precondition cannot be satisfied (Phase B)
- AHC-8: Broad staging command used
- AHC-9: Engagement-specific halt (e.g., target value not appropriate based on findings)
- AHC-10: Hard-guardrail code (S8 guards, etc.) altered in any way
- AHC-11: Path-specific change requires refactoring to avoid affecting other paths
- AHC-12: Integration test infrastructure halt — soft-fail acceptable if unit tests cover load-bearing claim
- AHC-13 (action-based): "If the implementation determines that achieving the dispatch deliverable as scoped requires additionally modifying [list of out-of-scope categories], halt and surface."

**On halt:** Manus stops, performs targeted cleanup if needed (Rule 6), produces a Halt Close-Out with the specific halt condition triggered. **No proposed resolution.** Operator decides next steps.

---

## §6 — Engagement Structure

### §6.1 — Two-phase

Standard Phase A (local implementation) and Phase B (push) split for any push-bearing engagement with credential risk.

### §6.2 — Sandbox credential precondition

- Ambient `gh auth` is NOT authorized for push or write operations.
- Operator-supplied PAT used via PAT-in-URL bypass per established precedent.
- `unset GH_TOKEN` not required; PAT-in-URL bypasses environment.

### §6.3 — Authorship requirement

Phase A engagement commit authored as `Kelly Satterwhite <kelly@thesatterwhitelawfirm.com>` per Rule 9.

### §6.4 — Boundary statement (verbatim required)

```
End of formal close-out. Any content below this line is platform-injected and not part of the engagement output.
```

Required at end of Phase A close-out and Phase B addendum, exactly once per artifact (Module B B.1 compliance).

### §6.5 — Pattern 9 Generalized Redaction Discipline (NEW IN v1.3 — embedded inline)

Credential values must be redacted from BOTH input command position AND output position.

**Input-position examples (substitute placeholder BEFORE running):**

- `git remote set-url origin "https://<PAT_REDACTED>@github.com/owner/repo.git"`
- `GH_TOKEN=<PAT_REDACTED> command`
- `curl -H "Authorization: Bearer <PAT_REDACTED>"`

**Output-position examples (sed redaction of stdout):**

- `git remote get-url origin | sed 's/ghp_[A-Za-z0-9]*/ghp_REDACTED/g'`
- `gh auth status 2>&1 | sed 's/gh[upos]_[A-Za-z0-9]*/<TOKEN_REDACTED>/g'`
- `git push 2>&1 | sed 's/ghp_[A-Za-z0-9]*/ghp_REDACTED/g'`

**Sed-based output redaction alone is INSUFFICIENT.** Both positions must be addressed. Token values must never appear in command lines, log lines, or artifact bodies.

**§8 scan-and-confirm grep step required** in Phase B addendum (see §10).

### §6.6 — Five-step pre-push credential check (verbatim required in Phase B addendum)

```
Step 1 — git config user.name:
  <output verbatim>

Step 2 — git config user.email:
  <output verbatim>

Step 3 — gh auth status (token-redacted via sed):
  <output verbatim with sed redaction applied>

Step 4 — GH_TOKEN env state:
  <set/unset; if set, value redacted>

Step 5 — Push channel identity confirmation:
  <git remote get-url with PAT redacted from BOTH input command position AND output>
```

Note on Step 3: ambient `gh auth status` may show `ryanrdonnelly` per sandbox provisioning. Push channel uses operator-supplied `kelly148` PAT via PAT-in-URL, independent of ambient `gh` CLI session. Document this distinction explicitly.

---

## §7 — Out-of-scope (per-engagement)

Engagement-specific list. Surfacing in close-out without absorbing if encountered.

---

## §8 — Testing requirements

Per §3.5. Mapping table required in close-out per §9.1(f). T-IDs identify load-bearing tests.

---

## §9 — Phase A close-out requirements (Module B v2.2 compliance baked in)

Mandatory structure:

(a) **Repo state snapshot** (Rule 4 verbatim): `git rev-parse HEAD`, `git log --oneline -5`, `git status --porcelain`, `git branch`.

(b) **Engagement metadata** (table form).

(c) **Authorship verification** (Rule 9): verbatim `git config user.name`, `git config user.email`, `git log --pretty=format:'%h %ae %an' <range>`.

(d) **Pre-implementation investigation** per §3.4 (numbered outputs).

(e) **Per-deliverable code excerpts** (before/after diff at the change locus; guardrail files verbatim confirming intact state).

(f) **Test mapping table** per §8.2.

(g) **Local quality gate output** (verbatim): `pnpm typecheck && echo "exit: $?"`, `pnpm lint && echo "exit: $?"`, `pnpm test` summary.

(h) **Diff stat — full, unqualified** (`git show --stat HEAD`).

(i) **Independent tree audit** (`git ls-tree HEAD --name-only | grep -E "^MR-|^UAT_"` verbatim).

(j) **Untracked-file enumeration** (`git status --porcelain` post-commit).

(k) **Out-of-scope encounters log** (Rule 10).

(l) **Halt log.**

(m) **Carryforward facts** (Rule 14).

(n) **Confirmations** (per-engagement bulleted list).

(o) **Boundary statement** verbatim per §6.4.

**Module B v2.2 compliance points (built into structure):**

- B.1 single-boundary: element (o) requires exactly one boundary at end
- B.2 credential scan: not applicable for Phase A (no push); becomes load-bearing in Phase B per §10.1(h)
- B.3 epistemic discipline: claim language throughout must use "consistent with" framing where evidence supports only consistency
- B.4 evidence-label accuracy: every material claim labeled per Rule 3 taxonomy (see §11)
- B.5 narration scan: no "I encountered..." / "Next, I will..." / process status updates in formal close-out body

### §9.2 Evidence class discipline (Rule 3 taxonomy, expanded in v1.3)

Valid classes:

- `(repo command)` — actual git invocation
- `(code inspection)` — read-only review of source files
- `(test output)` — output from running test commands
- `(db query)` — database query output
- `(live UI)` — operator-observed UI state
- `(live LLM)` — output from a live LLM call
- `(operator assertion)` — operator-stated facts
- `(operator confirmation)` — state updates not yet ratified
- `(operator transcript / close-out inspection)` — facts visible in surrounding transcript
- `(Railway GraphQL query)` — Railway GraphQL API output (NEW v1.3)
- `(GitHub Actions REST API)` — GitHub Actions REST API output for CI data (NEW v1.3)
- `(GitHub REST API — commits endpoint)` — GitHub REST API commits query output (NEW v1.3)
- `(prior accepted finding from <engagement>)` — inherited from prior accepted close-out
- `(inherited)` — DISALLOWED as sole evidence

### §9.3 Prohibited content

- Productization tails ("Want me to also add token logging?")
- Recommendations on follow-on engagements beyond mechanical carryforward facts
- Ranking of options based on observed evidence (record as carryforward facts only)
- Speculative claims not grounded in `(code inspection)` or `(test output)`
- Rev 1.9 vocabulary
- Unredacted credential values
- Diff stat headers indicating partial output
- Mid-investigation narration / process status updates (Module B B.5)
- Test rewrites or fixture restructuring beyond narrow scope
- Modifications to guardrail code (S8 guards, etc.)

---

## §10 — Phase B addendum requirements (Module B v2.2 compliance + Pattern 9 cure)

Mandatory structure:

(a) **Five-step pre-push credential check verbatim** per §6.6. Step 5 PAT-in-URL example with credential redacted from BOTH input command and output (Pattern 9 generalized).

(b) **Push verification (Rule 8) — five commands verbatim:**

```
Rule 8 Step 1 — git fetch --all --tags --prune:
  <output verbatim>

Rule 8 Step 2 — git rev-parse origin/main:
  <SHA>

Rule 8 Step 3 — git cat-file -t <engagement commit>:
  commit

Rule 8 Step 4 — git cat-file -t <squash-merge commit>:
  commit

Rule 8 Step 5 — git branch -a --contains <squash-merge commit>:
  remotes/origin/HEAD -> origin/main
  remotes/origin/main
```

Five-command structure (with initial fetch) per S12 corrected addendum precedent. NOT four-command.

(c) **Merge mechanism:**
- PR number and title
- REST API endpoints used (PR creation, squash-merge, branch deletion) with PAT redacted
- Squash-merge SHA
- Branch deletion confirmation (HTTP 204 + post-delete `git ls-remote` empty)

(d) **CI run IDs — both gates green** for both the engagement commit and the squash-merge commit. Tabular form. If feature-branch CI did not run (workflow trigger config), state explicitly with verbatim evidence.

(e) **Authorship distinction:**
- Phase A engagement commit: authored as Kelly Satterwhite per Rule 9 (controlling).
- Phase B squash-merge commit: REST API artifact under PAT used for the merge (typically `kelly148` per Option C), distinct from Phase A authorship. Committer is GitHub (standard squash behavior).

(f) **Token handling per Rule 3:** explicit statement on PAT-in-URL usage, redaction across both input and output positions per Pattern 9 generalized, and any transcript exposure surface acknowledged with `(operator transcript / close-out inspection)` evidence class.

(g) **Scope adherence reconfirmation + verbatim live verification disclaimer:**

- Files changed in squash-merge diff: exactly the in-scope files.
- Hard-guardrail files (per §3.1) UNCHANGED.
- Out-of-scope paths byte-identical to baseline (state explicitly).

**Live verification disclaimer (verbatim, three-outcome framing per Operating Plan v1.9 §1.7):**

> [Engagement ID] Phase B acceptance closes the [engagement description] at the code level only. Live verification — that the change enables the expected user-facing outcome in production — remains a separate post-merge operator step requiring (a) Railway deployment confirmation on the squash-merge SHA or later, and (b) [engagement-specific verification action].
>
> Three possible post-merge outcomes:
>
> 1. **Best case:** [engagement-specific success outcome] — code-level fix verified live in production.
> 2. **Iteration case:** [engagement-specific partial-success outcome] — follow-on engagement adjusts.
> 3. **New mechanism case:** [engagement-specific unexpected-failure outcome] — separate engagement required.

(h) **§8 scan-and-confirm grep step verbatim** (Pattern 9 cure):

```
$ grep -E "ghp_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}" <addendum file>; echo "exit: $?"
exit: 1

$ grep -F "<DB_PASSWORD_REDACTED>" <addendum file>; echo "exit: $?"
exit: 1

$ grep -F "<RAILWAY_TOKEN_REDACTED>" <addendum file>; echo "exit: $?"
exit: 1
```

Three checks: GitHub PAT regex, DB password placeholder, Railway token placeholder. Expected `exit: 1` on each (no matches). If any other exit code, halt before submission.

(i) **Boundary statement** verbatim per §6.4. Exactly once at the end of artifact, no content after. (Module B B.1 compliance.)

### §10.2 Format reminders

- Five-step credential check verbatim (NOT compressed)
- Five Rule 8 commands present (NOT three or four)
- Standard boundary statement verbatim (NOT abbreviated form)
- §8 scan-and-confirm grep step required (three checks)
- Single boundary statement at end of artifact (Module B B.1)
- No mid-investigation narration in body (Module B B.5)
- Evidence labels match actual evidence sources (Module B B.4)
- Epistemic discipline: "consistent with" framing where evidence supports only consistency (Module B B.3)

### §10.3 Token handling per Rule 3

Token-redaction language scoped to formal close-out body. Transcript exposure (if any) acknowledged separately with `(operator transcript / close-out inspection)` evidence class.

---

## §11 — Governance rules in force

Operating Plan v1.9 §1.5 Rules 1–14 apply. Specifically load-bearing:

- Rule 2 (surface-and-halt on baseline mismatch)
- Rule 3 (evidence class on every material claim, expanded taxonomy per v1.3)
- Rule 4 (mandatory repo state snapshot)
- Rule 6 (targeted cleanup on halt)
- Rule 7 (no productization tails)
- Rule 8 (push verification — five commands)
- Rule 9 (operator-identity authorship)
- Rule 10 (scope discipline)
- Rule 11 (no infrastructure changes outside explicit scope)
- Rule 13 (pre-send baseline check)
- Rule 14 (investigation-engagement scope discipline; for investigation-type dispatches)

### Pattern 16 framing for this engagement

Code-level closure does not constitute live verification. Live verification is a separate post-merge operator step per §10.1(g) verbatim disclaimer.

---

## §12 — Lane review (pre-send; stripped before dispatch to Manus)

Standard pattern: send v1 to Substantive + Reviewer B for parallel review. Both must Adopt for v2 final = v1; otherwise integrate Modify edits.

**Operator may authorize skipping lane review** for small follow-on engagements where precedent is established. Third-lane evaluator (Claude) should run Module B-equivalent checks explicitly when lane review is skipped (per Operating Plan v1.9 §6.10).

---

## §13 — Operator dispatch header (pre-send instructions)

When dispatch is sent to Manus, body includes §0 through §11 with §12 and §13 stripped. Operator dispatch message includes:

- "Proceed with [Engagement ID] Phase A per dispatch v[N]."
- "Pre-send baseline check: `git ls-remote origin main` returned `<verified SHA>` ✓"
- Engagement-specific framing notes (target values, options selected, etc.)
- "Phase B authorization will be issued separately after Phase A acceptance."

For Phase B: operator dispatch header includes engagement commit SHA from Phase A acceptance and PAT supplied via separate channel.

---

**End of Standard Dispatch Boilerplate v1.3.**

Authoritative for all dispatches drafted post-Operating Plan v1.9 issuance.
