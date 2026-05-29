# Failure-Mode Patterns Inventory v1.3

**Document version:** v1.3
**Effective date:** May 2, 2026
**Authority:** Lex Law Next Operating Plan v1.9 §0 / §4
**Supersedes:** v1.2 (fifteen patterns + Pattern 16 framing referenced informally)

---

## Purpose

This inventory documents observed failure modes in the Lex Law Next governance and execution process. Each pattern includes definition, manifestation, diagnostic signature, root cause, defense, and recovery.

The inventory's purpose is twofold: (1) to give the third-lane evaluator and lane reviewers a recognition library so familiar failures are caught early, and (2) to make defense mechanisms explicit so they can be embedded in dispatch boilerplate, lane briefings, and close-out templates rather than re-derived each cycle.

Changes from v1.2:

- **Pattern 16 promoted to authoritative.** Code-level closure does not constitute live verification. Referenced informally in v1.2 era; formalized in v1.3 with definition, defense, and recovery. Embedded in Operating Plan v1.9 §1.7 and Boilerplate v1.3 §10.1(g).
- **Pattern 9 generalized cure documented.** Input-position vs output-position redaction discipline, established at S8 Phase B Second Corrected Addendum and durably applied through S9, S10, S11 Phase B, S12 Phase B (corrected). Documented as a sub-element of Pattern 9 with explicit examples.
- **Pattern 17 candidate logged.** Auto-progression past authorized scope — two documented instances; needs one more for promotion to authoritative.
- **Pattern 5 recurrence note** added (S12 Phase B initial addendum).
- **Pattern 10 v2.2 calibration data** updated (three formal Module B applications, all PASS).
- **Module B v2.2 cross-reference** added to Pattern 10 defense.

---

## Pattern 1 — Non-Resolving Commit References in Governance Documentation (Pattern B)

**Definition.** Governance or close-out documents reference commit SHAs that do not resolve in the actual repository, or that resolve to commits with content materially different from the description.

**Defense.** Rule 4 mandatory repo state snapshot; Rule 8 push verification; operator independent push verification.

**Recovery.** Halt acceptance until cited SHAs are verified or corrected.

(No new instances since v1.0; pattern is well-defended.)

---

## Pattern 2 — Sandbox Identity Drift

**Definition.** Manus's git commit author identity drifts from operator's identity (`kelly148` / Kelly Satterwhite) to a non-operator account (`ryanrdonnelly`) due to sandbox-level configuration.

**Defense.** Rule 9 authorship verification; pre-commit `git config user.name`/`user.email` check.

**Recovery.** Correct git config; amend or recreate commits with correct author.

(Pattern is well-defended. Pattern 9 below addresses the related GH_TOKEN sub-mechanism.)

---

## Pattern 3 — Wrong Excerpt for Stated Deliverable

**Definition.** Close-out cites a code excerpt as evidence of a deliverable, but the excerpt is for different code than the deliverable claims.

**Defense.** Per-deliverable code excerpts required in close-out; Substantive Reviewer's lane includes excerpt-to-deliverable correspondence check.

**Recovery.** Halt acceptance until correct excerpts are produced.

---

## Pattern 4 — Type-Correctness Gap Masked by Passing Tests

**Definition.** vitest passes at runtime, but `tsc --noEmit` fails on the same code.

**Defense.** Verbatim `pnpm typecheck && echo "exit: $?"` output required in close-out; both CI gates authoritative.

**Recovery.** Fix the mock shapes to align with production types.

---

## Pattern 5 — Phase B addendum format compression

**Definition.** Phase B addenda compressing required structures (five-step credential check, four/five-command Rule 8 push verification) into abbreviated forms that omit required elements.

**Manifestation.**
- MR-PROMPT-1 Phase B addendum: compressed pre-push credential check to single line; used `[CLOSE-OUT BOUNDARY]` instead of standard boundary phrase.
- **MR-LLM-1 S12 Phase B initial addendum (NEW recurrence in v1.3):** abbreviated step labels in §10.1(a) instead of verbatim `gh auth status` output; four-step Rule 8 missing the initial `git fetch --all --tags --prune`. Cured in corrected addendum.

**Diagnostic signature.** Initial addendum has labels-only sections where verbatim outputs are required; compressed structures vs. dispatch-required formats.

**Root cause.** Manus optimizing for brevity on first pass; format reminders in dispatch may not be sufficient if buried.

**Defense.**
- Boilerplate v1.2 added format reminders inline.
- Boilerplate v1.3 makes structures more explicit (verbatim output required for each step; five-command Rule 8 structure named explicitly).
- Module B B.1 (single-boundary verification) catches abbreviated boundary forms.
- Lane reviewers (and third-lane evaluator) verify explicit structures rather than checking for "format reminders are present."

**Recovery.** Reject addendum; require corrected version with verbatim structures.

**Note on durability:** Boilerplate v1.2 cured the original instance; recurrence at S12 demonstrates that format discipline can drift on first-pass artifacts even with current boilerplate. Boilerplate v1.3 strengthens the framing further. Continue lane review or third-lane Module B-equivalent verification rather than assuming durable resolution.

---

## Pattern 6 — Productization Tail Leak Above Boundary

**Definition.** Productization offers ("Want me to draft the next spec?", "Turn this into a dashboard?") appearing above the boundary statement.

**Defense.** Rule 7; Reviewer B's primary detection responsibility; Module B B.1.

(No new instances above boundary. Below-boundary platform widgets continue to appear and are acceptable per Rule 7.)

---

## Pattern 7 — Author Identity Drift

(See Pattern 2 — same mechanism.)

(No new instances.)

---

## Pattern 8 — Inherited Evidence Relabeling

**Definition.** Re-labeling inherited findings as fresh code-grounded evidence.

**Defense.** Evidence-class discipline; `(inherited)` DISALLOWED as sole evidence; Module B B.4 spot-check.

(MR-LLM-1 S1 defended via §7.4 Pattern 11 framing in v1.7 era. No new instances.)

---

## Pattern 9 — Sandbox Identity Drift via GH_TOKEN Environment Override

**Definition.** Platform-injected `GH_TOKEN` environment variable overrides sandbox `~/.config/gh/hosts.yml` credential, causing GitHub CLI to authenticate as `ryanrdonnelly` regardless of host config.

**Manifestation.** `gh auth status` shows `ryanrdonnelly` Active via GH_TOKEN. Even after `unset GH_TOKEN`, the variable repopulates in every new shell session.

**Defense (per v1.0):**
- Pre-push credential check (Operating Plan v1.9 §5.1).
- Sandbox credential precondition: ambient `gh auth` not authorized; explicit operator-supplied push token required.

### §9.1 — Generalized Cure (formalized v1.3)

A specific defense pattern emerged at S8 Phase B Second Corrected Addendum and has been durably applied through S9, S10, S11 Phase B, and S12 Phase B (corrected): **redaction-scope discipline covering BOTH input-position AND output-position credential exposures.**

**The mechanism the cure addresses:** even with the pre-push check, credentials can leak if redaction is applied only to output (sed of stdout). Input-position exposures occur when a credential value appears in:

- Command-line arguments: `git remote set-url origin <URL with PAT>`, `git push <URL with PAT>`
- Environment variable assignments: `GH_TOKEN=<PAT> command`
- Header arguments: `curl -H "Authorization: Bearer <PAT>"`

If the command line is captured in a transcript or log, the credential is exposed regardless of whether stdout was sed-redacted.

**Cure (Pattern 9 generalized):**

1. **Substitute placeholders BEFORE the command runs.** Examples:
   - `git remote set-url origin "https://<PAT_REDACTED>@github.com/owner/repo.git"` — the actual PAT is shell-substituted from a variable that is not echoed; the literal command appearing in the artifact contains `<PAT_REDACTED>`.
   - For commands that must contain the PAT in their input (e.g., the actual push), pipe the command itself through redaction or use shell variables with `set +x` discipline.
2. **Sed-redact stdout** for any command output included in the artifact.
3. **§8 scan-and-confirm grep step** in Phase B addendum verifies no credential patterns present in the formal artifact body.

**Sed-based output redaction ALONE is insufficient.** Both positions must be addressed.

**Notable instances of the generalized cure applied:**
- S8 Phase B Second Corrected Addendum: cure introduced.
- S9 Corrected Addendum: §8 scan-and-confirm carried forward as authoritative governance pattern.
- S10 close-out, S11 Phase B addendum, S12 Phase B (corrected): all applied cleanly.

**Defense (v1.3 update):** the generalized cure is now embedded in Boilerplate v1.3 §6.5 inline, no longer referenced as external precedent.

**Recovery.** If credential exposure is observed in any position, reject the addendum; require redaction in both positions; verify via §8 scan-and-confirm grep.

**Note on persistence (unchanged from v1.0):** The underlying sandbox condition (GH_TOKEN platform-injection, `kelly148` absent from hosts.yml) is structurally not Manus-fixable. The pre-push check + Pattern 9 generalized cure defends pushes; the sandbox environment remains contaminated.

---

## Pattern 10 — Close-Out Completeness Drift (Reviewer-Side)

**Definition.** A reviewer (typically Reviewer B) approves a close-out as "ready for acceptance" without verifying that all dispatch-required elements are actually present, or without verifying that present-and-named elements are actually correct.

**v1.0 / v2.0 / v2.1 history.** Reviewer B v1.0 drift led to v2.0 recalibration. v2.0/v2.1 had recurring Pattern 10 misses (close-out completeness drift; element-presence verified but not element correctness).

**v2.2 Module B addendum (landed in v1.9 cycle).** Module B body-level cross-check introduced five sub-checks targeting documented Pattern 10 failure shapes:
- B.1 single-boundary verification
- B.2 credential-pattern body scan
- B.3 epistemic-discipline conformance
- B.4 evidence-label accuracy spot-check
- B.5 mid-investigation narration / process-leak check

**v2.2 calibration data (three formal applications, all PASS):**
- Cycle 1 (S10 close-out): all five sub-checks PASS.
- Cycle 2 (S11 Phase B addendum): all five sub-checks PASS.
- Cycle 3 (S12 Phase B corrected addendum): all five sub-checks PASS.

**Calibration status:** solid through three cycles. v2.3 brief revision deferred per Operating Plan v1.9 §3.6.

**Recovery.** Recalibrate via fresh thread + updated context brief. v2.2 is the current authoritative brief.

### §10.1 — Third-lane evaluator first-pass drift (NEW in v1.3)

Pattern 10 is not exclusive to Reviewer B. The third-lane evaluator (Claude in operator's primary thread) also exhibits the same first-pass drift mechanism.

**Manifestation:** at S12 Phase B initial addendum review, third-lane evaluator accepted the addendum on first pass despite governance-form defects (abbreviated five-step + four-step Rule 8 missing initial fetch). Corrected addendum cured both. This was a first-pass drift on third-lane's part, not Reviewer B's (Reviewer B not invoked per operator-authorized lane review skip).

**Defense:** when operator authorizes lane review skip, third-lane evaluator should run Module B-equivalent sub-checks (B.1 through B.5) explicitly before producing acceptance language. Verbatim verification of structures (five-step, five-command) rather than pattern-matching to "this looks correct."

**Recovery:** if third-lane drift is observed, the same recalibration discipline applies — fresh thread or explicit checklist invocation on subsequent reviews.

---

## Pattern 11 — Operator-Asserted Facts Treated as Code-Grounded by Manus

**Definition.** Manus accepts a fact asserted by the operator as if it were code-grounded evidence, without independently verifying.

**Defense.** Rule 3 evidence-class labeling; Module B B.4 evidence-label accuracy.

(MR-LLM-1 S1 defended via close-out evidence-class labeling. No new instances since.)

---

## Pattern 12 — Rev 1.9 Vocabulary Recurrence

**Definition.** Decommissioned vocabulary reappearing in close-outs.

**Defense.** Rule 5; Reviewer B detection; periodic recalibration of context briefs.

(No new instances.)

---

## Pattern 13 — Verbatim Summarization Tendency

**Definition.** Manus summarizing when verbatim is required (e.g., pre-implementation investigation output reduced to bullet points).

**Manifestation.** Recurring across MR-LLM-1 S2 Phase A, S3 Phase A, S9 original close-out, possibly others.

**Defense.** Explicit verbatim requirement in dispatch §3.4; Substantive Reviewer catches; corrected addendum cures.

**Recovery.** Reject; require corrected version with verbatim outputs.

(Recurrence is normal-rate, not drift. Defense is durable. Continue verifying explicit verbatim requirements.)

---

## Pattern 14 — Stale-Branch Divergence

**Definition.** Local feature branch lingering after origin-side deletion; Manus halts at baseline check.

**Defense.** Rule 13 pre-send baseline check; explicit baseline halt conditions.

(MR-PROMPT-1 → MR-LLM-1 S1 baseline halt. No new instances since v1.7.)

---

## Pattern 15 — Predecessor-Merged-During-Drafting

**Definition.** Engagement drafted against baseline X but predecessor merged before send, shifting actual baseline to Y.

**Defense.** Rule 13 pre-send baseline check; dispatch header pre-send check callout when predecessor merge risk exists.

**Manifestations.** Multiple recurrences during S5-S12 era — all mitigated by Rule 13. Not blocking.

---

## Pattern 16 — Code-Level Closure ≠ Live Verification (PROMOTED TO AUTHORITATIVE IN v1.3)

**Definition.** Phase B acceptance closes the engagement at the code level only. Substantive closure on user-facing engagements requires both Phase B acceptance AND post-merge live verification.

**Manifestation.** Multiple instances across the engagement chain where "code merged + CI green" was conflated with "user-facing problem solved":
- MR-PROMPT-1 (Finalize) accepted at `fee9c2a`; live verification not performed at acceptance time; subsequently confirmed still failing live.
- MR-EXPORT-1 (Download) accepted at `66cf882`; live verification not performed at acceptance time; subsequently confirmed produces unformatted file.
- MR-LLM-1 S2 (GPT structuredOutputSchema wiring) accepted at `c225b9f`; live verification still pending as of v1.9.
- MR-LLM-1 S8 (diagnostic guards) accepted at `67803ac`; live verification ran 2026-05-01 and confirmed Cloudflare 502 noise mixed with intended `api_error` shape; effectively but indirectly verified by S10 H2 confirmation in production.
- MR-LLM-1 S11 (maxTokens 8192) accepted at `0fd094a`; live verification ran 2026-05-02 and confirmed insufficient (Outcome 2 from three-outcome framing).

**Diagnostic signature.** Operator runs production smoke test post-merge; result is one of:
1. **Best case:** the code-level fix produces the expected user-observable outcome.
2. **Iteration case:** the fix is insufficient; follow-on engagement adjusts.
3. **New mechanism case:** different failure mode manifests; separate engagement required.

**Root cause.** Code-level testing (unit, integration, CI) verifies the engagement implements what was scoped. It does not verify the engagement scope was correct, or that the production environment (Railway deployment, actual data, actual user behavior) matches the assumptions made during scoping.

**Defense.**
- **Three-outcome framing in Phase B addendum live verification disclaimer (§10.1(g))** — explicitly enumerates best case / iteration case / new mechanism case so operator has a decision framework post-merge.
- **Operating Plan v1.9 §1.7** formalizes the framing.
- **Boilerplate v1.3 §10.1(g)** standardizes the disclaimer template.
- **Engagement lifecycle step 13** added to v1.9 §1.2 to explicitly include live verification as a step distinct from Phase B acceptance.

**Recovery.** When live verification produces Outcome 2 or 3, scope a follow-on engagement based on the new evidence. Do not retry Phase B; the code-level work is done. The remediation is at a different scope.

**Note:** Pattern 16 is not a defect in any single engagement; it's a category error that affects how engagements are scoped and closed. The defense is procedural (three-outcome framing, explicit live verification step) rather than per-artifact.

---

## Pattern 17 (CANDIDATE — needs one more documented instance for promotion)

**Definition.** Auto-progression past authorized scope. Manus completes one authorized step and proceeds to the next logical step without separate authorization.

**Documented instances (2):**
1. **S8 Phase A AHC-9 absorption.** Dispatch authorized adding a named-target guard for `'content_filter'` and `'length'`. Manus broadened the guard to `!== 'stop'` (catching all other finish_reason values) despite the dispatch's halt-rather-than-expand framing. Resolution A applied; corrected addendum cured.
2. **S8 verification session abandon-then-create attempt.** During verification session unblock, Manus attempted to abandon the failed review session and create a new one without separate authorization. Caught and halted before action.

**Diagnostic signature.** Manus's close-out or in-flight action describes scope expansion that was not authorized in the dispatch, framed as "while I was here" or "the natural next step."

**Defense (proposed).**
- Action-based AHC framing per Boilerplate v1.3 §5: "If the implementation determines that achieving the dispatch deliverable as scoped requires additionally modifying X, halt." Replaces subjective "temptation" language with verifiable behavior.
- Explicit "stand by" instructions in dispatches when a multi-step Manus session is anticipated.
- Lane review and third-lane discipline catch the absorption pattern in close-out review.

**Status:** logged for Pattern 17 promotion to authoritative when one more instance is documented. Per inventory promotion threshold, two instances suggests the mechanism but a third confirms the pattern is structural. Continue monitoring.

---

## Closing Note

This inventory grows with each cycle. Patterns are added when a failure mode recurs or when its mechanism is newly understood; they are not added on the strength of single-instance observations unless the mechanism is structural.

The next inventory update is expected when MR-UAT-ERR-1 closes or when Pattern 17 hits its third documented instance. Anticipated additions include any new failure modes surfaced during MR-UAT-ERR-1 (UI rendering / observability work has different failure modes than backend adapter work) and any new third-lane evaluator drift instances per §10.1.

---

**End of Failure-Mode Patterns Inventory v1.3.**
