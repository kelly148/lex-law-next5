# Consolidated Triad Disposition — HI-2 / ME-1 (SENDABILITY-EGRESS-LOGGING → EGRESS-CONTROL-PLANE)

**Date:** 2026-06-16. **Checkpoint:** §3.1 FIRE (HI-2 / SENDABILITY-EGRESS-LOGGING-1). **Reviewers:** GPT (Doc 3), independent Claude (Doc 2), synthesis/meta (Doc-S). **Operator:** Kelly. **Status:** **DISPOSITIONED — REJECT status-quo; FIX REQUIRED.**

## Disposition (one line)
Treat **ME-1 as the finding**, **HI-2 (sendability) as the pilot**. Build a unified external-model **egress control plane** — a durable, pre-dispatch, hold-aware allow/block decision for every external send of client/matter content — and route sendability through it first. **Chat-surface-only is not a defensible confidentiality boundary; documentation is not a cure.** Convergent across all three reviewers.

## Verification closed (Cowork, code-confirmed 2026-06-16 — the triad's #1 action item)
The document-side job/telemetry layer is **NOT** control-equivalent, so the fix does not shrink:
- `jobs` table records execution `status` + `errorClass`/`errorMessage`/`output` only — **no allow/block decision, no pre-dispatch gate, no hold** (`schema.ts` job table).
- `holdFlag`/`no_external` exists **only** on the conversation table (+ `chat_attachments`) — **conversation-scoped**; there is **no matter/document/global hold** to express (`schema.ts:2730, 2894`).
- The only egress decision record is `chat_egress_events`, written by `egressClient.send`, used **only** by chat surfaces.
- `checkSendability` uses a **raw `adapter.generate`**, bypassing even the job layer.

## The boundary principle (all three)
The control boundary is **external-egress-of-client-content vs. no-external-egress** — *not* chat vs. document. Surface (chat/document/job/matter) is a **field on the audit row**, not a gate on whether the row exists. Audit is **opt-out-with-reviewed-justification**, never opt-in; the document side is the *higher*-stakes surface (that's where privileged work product lives, and sends can be background/system-initiated).

## ADOPT / MODIFY / PASS

**ADOPT — from GPT (Doc 3):**
- The `egressSubject` discriminated-union subject model: `{ type: 'conversation'|'document'|'document_job'|'matter', subjectId, matterId, documentId?, documentVersionId?, jobId?, userId, orgId }`.
- Rename `chat_egress_events` → a surface-agnostic ledger (`egress_events` / `llm_egress_events`) with a `surface` column; unified query/reporting layer.
- **The architecture/CI guard**: ban raw `adapter.generate` for external providers outside the approved broker module (static/lint/code-search). *This is the single most-skipped, most-important criterion — behavioral tests can't catch the next bypass; only a structural guard prevents ME-1 from silently reopening.*
- New-feature backstop: a new LLM feature cannot merge without declaring an `egressSubject` type and passing broker enforcement.

**ADOPT — from independent Claude (Doc 2):**
- The legal grounding anchored to the regime Kelly is personally exposed under: **RPC 1.6 (confidentiality), RPC 1.1 (tech competence), supervision duties** — not just generic "GLBA-style."
- The edge-case/threat-model catalog for the ADR: high-frequency calls multiply egress surface; provider-subpoena reconstruction; multi-attorney supervision split.

**ADOPT — GLBA nuance (Doc-S, specific to this firm):** the firm's **title/settlement business makes it a GLBA "financial institution"** — settlement agents handle NPI and are squarely covered, and the **2021 FTC Safeguards amendments** (16 CFR Part 314) tightened service-provider/vendor-oversight duties that **flow down to tools** processing customer financial info. So the Safeguards Rule is *more* apt for title matters than for generic legal SaaS — an independent regulatory hook **on top of** the RPC duties. Fold **both** citations into the ADR.

**MODIFY — correct two soft spots in Doc 2 (adopt the stricter version, per Doc-S):**
- **Kill the "log-now, gate-later" phasing.** Stage *which call sites* you onboard — never *whether* onboarded sites are gateable. **Any path brought under the plane gets log AND hold from day one.** Never surface/promise a global `no_external` kill-switch while blocking coverage is partial — *a hold that lies is worse than no hold* (false assurance).
- **The decision row is synchronous and pre-dispatch.** A send cannot leave without a logged allow/block decision; only *secondary/outcome* logging may be async. (Resolves Doc 2's fire-and-forget-vs-fail-closed inconsistency.)

**Hold-scope model (Doc 3 + Doc 2 + Doc-S):** explicit scope `∈ {conversation, matter, global}` (via the `egressSubject` hierarchy); document sends check **matter + global**; a conversation hold must **not** block unrelated matters; a matter/global hold **must** reach document sends; documented precedence (global > matter > conversation). **No synthetic `conversationId`** — generalize the context, never spoof it. **Factor a shared egress-audit-and-hold primitive**; the existing chat broker becomes the chat adapter over it, a document-egress wrapper the document adapter.

**Retention/reconstruction contract (the gap none of the three specified — make it explicit):** the audit row stores a **content hash + secure reference to the versioned document, NOT the draft text** (the ledger must not become a second unprotected repository of privileged content). Make a deliberate decision on whether **any** prompt content is ever retained (e.g., for provider-dispute defense). **Default: NO.** Load-bearing for a privilege-bearing ledger.

**PASS / keep so the triad doesn't relitigate:** the **"about-to-be-sent-anyway" rebuttal fails** — send-to-client ≠ send-to-external-model; the egress concern is the third-party trust-boundary crossing. Keep this in the ADR.

## Unified acceptance criteria (deduped across all three + the corrections)
**Structural (highest priority):**
1. **CI guard** — no production document-side path calls `adapter.generate` directly for external providers; must route through a named chokepoint.
2. **New-feature backstop** — a new LLM feature can't merge without declaring an `egressSubject` type and passing broker enforcement.

**Fail-closed audit + hold:**
3. Exactly **one durable decision row written synchronously BEFORE dispatch** (provider, model, ts, matter/document/version scope, `surface`, allow/block+reason, content hash/reference, policy version, correlation id). **Audit-write failure prevents egress** (auditability over availability → `CLASSIFIER_UNAVAILABLE`, never an unlogged send).
4. **`no_external` (matter/global) blocks before dispatch** — adapter not invoked, BLOCKED row written, degrade-to-unavailable. Gate sits immediately-before-dispatch (a hold set after bundle assembly still blocks).
5. **Hold-scope correctness** — conversation hold does NOT block unrelated matters; matter/global hold DOES reach document sends; precedence tested.
6. **No synthetic conversation context** — assert (review + test) no placeholder `conversationId` for document sends.
7. **No content duplication** — row stores hash/reference, not full draft text.
8. **Failure still audits the decision** — provider timeout/parse-fail leaves the allow decision auditable; user sees `CLASSIFIER_UNAVAILABLE`.
9. **No client-visible regression** when sendability is available.

**Coverage:**
10. **Sendability = pilot/first adopter** (self-contained, advisory, degrade-tolerant → small blast radius); then reviewer/drafter/evaluator/intake/outline/IR onboarded **audit-by-default**, each log+hold from day one.
11. **Compliance query** — retrieve all blocked document egresses by org/matter/document/hold-reason/provider/date.

**Documentation gate (ADR):** define external-model egress; surfaces covered; the audit-of-record; what is logged and deliberately not; how `no_external` applies across conversation/matter/global; incident reconstruction; the retention contract; the RPC 1.6/1.1/supervision + GLBA-Safeguards grounding; any exception with justification.

## Second triad round — four refinements folded in (2026-06-16)
A second independent triad (GPT + two Claude reviewers) returned the **same** disposition and added four load-bearing refinements:

1. **CR-4 ↔ HI-2 share a seam — sequence and test them JOINTLY.** A `no_external` hold (or a broker block) landing **mid reviewer fan-out** must behave deterministically against in-flight reviewer jobs and must NOT orphan/wedge a session — the exact failure CR-4 addresses. The hold-enforcement point and CR-4's session-lifecycle fix touch the same dispatch path. *Joint acceptance:* a hold landing during dispatch blocks the not-yet-sent reviewers, leaves no stuck `active` session, and is itself audited as blocked.

2. **Fail-closed posture, refined (not blanket).** Fail-closed is **unconditional for the hold check** — if the system can't confirm there's no applicable hold, it does not send. But a **generic broker/audit outage** needs a **deliberately defined degraded mode**, because failing closed on every blip would DoS the whole drafting/review pipeline (the broker becomes the chokepoint for ALL model egress). Decide + test both: hold-check-uncertain ⇒ no send; generic-broker-down ⇒ defined degraded behavior (for the advisory sendability classifier specifically, that's `CLASSIFIER_UNAVAILABLE`).

3. **Phase by payload risk — the first slice is sendability + reviewer + drafter**, not sendability alone. Those three ship full/substantial client text; routing only sendability while reviewer/drafter keep bypassing is "security theater." Sendability is the safest place to *land* the new plane first (advisory, degrade-tolerant), but reviewer + drafter follow in the same slice.

4. **Matter-keying is the better audit key** (a per-matter egress trail) — confirms the polymorphic `egressSubject` (`conversationId` XOR `documentId`/`matterId`).

## Necessary, but NOT sufficient — the operator/compliance layer (do not conflate)
Every reviewer flagged this, and it's the most important thing for you personally: **routing through the broker controls and logs egress; it does NOT by itself create authority to send.** "Now it's routed" must not be mistaken for "now it's compliant." Two operator-layer prerequisites remain yours, independent of the code:
- A **no-train / zero-retention / confidentiality DPA** with each provider (`anthropic/openai/google/xai`) — the long-pending GLBA operator item.
- **Client disclosure / consent** appropriate to AI processing of their NPI (RPC 1.6 + your engagement terms).
The control plane makes egress *auditable and blockable*; you, the supervising attorney, still own the *authority and consent* to send.

## Engagement reframe
HI-2's original narrow scope ("route sendability") is **superseded**: this is now **ME-1, the systemwide egress control plane**, a **multi-increment** architecture build (shared primitive + ledger generalization + CI guard → sendability+reviewer+drafter first slice → onboard the remaining document sends), with sendability the first landing point. Rename/expand the queue entry accordingly (Rule 11 → CLI). **Sequence jointly with CR-4** (shared mid-fan-out seam, refinement 1).

**CR-4 still needs its own disposition** — but it should now be dispositioned and built **together with** this one, not separately.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
