# Lex Law Next — Pattern 16 Live Verification Framing

**Generated from project materials:** Failure-Mode Patterns Inventory v1.3 and Operating Plan v1.9.

**Purpose:** Standalone quick-reference document for the rule that code-level closure does not equal live functional verification.

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

## Operating Plan v1.9 Cross-Reference

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
