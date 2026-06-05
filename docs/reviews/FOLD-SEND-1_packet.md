# External Triad-Review Packet — FOLD-SEND-1 (sendability: advisory → deterministic block/warn/pass gate)

> **BANNER — this is a review packet, not an approval.** Per `EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §3.1, FOLD-SEND-1 is a **FIRE** (advisory→blocking sendability gate: client-send-safety + decision-authority — hard to reverse, not CI-caught). Claude Code has written **no implementation code**. Two independent reviewers (a fresh GPT-5 and a fresh independent Claude) pressure-test the plan below; the operator (Kelly, non-developer, sole decision-maker) reads both, decides, and directs. The labor is automated; the decision is not. This packet is **self-contained** — everything needed is inlined; no repo access required.

---

## PART 1 — Ready-to-paste reviewer prompt (paste into a fresh GPT-5 chat AND a fresh Claude chat)

> You are an independent senior reviewer. You did **not** write what follows and you are not on the team that did. You're reviewing **one design decision** in an attorney-supervised legal-AI build (product "Whereas," build repo `lex-law-next5`). I'm Kelly — the managing attorney and product owner. I am **not** a software developer. The primary builder is a separate Claude Code instance. Your job is to **pressure-test the attached plan before we write code** and tell me, concretely, what you would change and why. Do not rubber-stamp; do not pad.
>
> **Where we are:** Phase 3 of the fold; we just shipped the drafting primitives to production. The last Phase-3 engagement, FOLD-SEND-1, upgrades "sendability" from an advisory LLM classifier (which only surfaces possible problems and never blocks anything) to a **deterministic block / warn / pass gate** that can actually stop an outbound document on objective conditions, with a recorded attorney override. This is the moment we decide how send-safety is enforced.
>
> **The decision under review:** Replace/augment the advisory LLM sendability classifier with a *deterministic* engine that BLOCKS export on machine-checkable conditions (wrong matter id, stale baseline, missing required signer/open execution item, unverified statute citation), WARNS on soft signals (tone, package completeness, low-confidence matches), and PASSES otherwise — attaching the block to the DOCX export endpoint, recording any attorney override, behind a default-OFF feature flag. New additive tables `sendability_rule` / `jurisdiction_rule` / `sendability_override`. Full plan and the current code are attached.
>
> **Attached documents:** (1) the FOLD-SEND-1 Phase-A plan — the thing to critique; (2) the current sendability code excerpts — what exists today; (3) the master plan — where this sits + what's downstream; (4) the engagement-state JSON — current status + accepted risks; (5) CLAUDE.md governance constraints; (6) MR-CAL-8A sendability investigation + the reviewer-prompt-spec / reference-taxonomies docs (the source-of-truth tiers + the P8-T7 governing-law blocker class feed sendability). *(All inlined below.)*
>
> **Please return, in this order:**
> 1. **Top risks or flaws** in this plan, ranked.
> 2. **Specific changes** you would make, each with its rationale.
> 3. **Omissions** — what a production legal-AI system needs here that the plan doesn't address.
> 4. **Keep list** — what you would explicitly NOT change, so I don't over-correct.
> 5. **Bottom line** — one of: *proceed as-is* / *proceed with the named changes* / *stop and rethink*.
>
> **Constraints to respect (flag any violation):** additive only, no destructive migrations; the attorney is always the final decision-maker; no title/settlement scope; single-operator now with a nullable owner key so a second attorney can be added later without a migration; feature flags default OFF; reviewers surface options and never make business decisions.
>
> **I'd especially value your read on the six open decisions in §5 of the plan** — particularly (a) whether gating DOCX export is the right surface when there is no real "send," and (b) whether the `unverified_statute_citation` block can be made deterministic without unacceptable false positives/negatives, or should be deferred.

---

## PART 2 — Document manifest (all inlined below — no repo access needed)

**Base set:** FOLD-SEND-1 Phase-A plan (Part 3) · master-plan F.5 sendability spec (Part 4) · engagement-state summary (Part 5) · CLAUDE.md governance constraints (Part 6).
**Sendability adds:** current sendability code excerpts (Part 7); the MR-CAL-8A category list + severity vocabulary (inlined in Part 7). *Operator: if the reviewers want the full `LLN_Reviewer_Prompt_Specifications.docx` / `Reference_Taxonomies_v1_3_Proposal.docx` / `MR-CAL-8A-investigation.md`, attach those on a second pass — they detail the source-of-truth tiers and the P8-T7 governing-law blocker class that feed sendability.*

---

## PART 3 — The artifact under review (FOLD-SEND-1 Phase-A plan, inlined verbatim)

### Target (master plan F.5 / acceptance)
Upgrade sendability from the advisory classifier to a **block/warn/pass** deterministic gate. **Blocks:** wrong matter ID, stale baseline, missing required signer/open execution item, unverified statute citation in an outbound legal assertion. **Warnings:** tone, optional package completeness, low-confidence library match. **Acceptance:** defined deterministic categories block; non-blockers warn; **attorney override recorded.**

### Proposed design
- **Pure deterministic engine** `evaluateSendability(ctx) → { verdict:'block'|'warn'|'pass', blocks[], warnings[] }` (no LLM, no I/O). Each block from a machine-checkable source:
  - **wrong_matter_id** — version's `matterId` vs the matter being exported under. Deterministic.
  - **stale_baseline** — open *substantive* `open_items`, or regeneration after the last `adopt_ledger` entry, or version drift. Deterministic.
  - **missing_required_signer / open_execution_item** — open execution-class `open_item`, or a required signer/notary block absent for the document type. Deterministic from `open_items` + matter state + `jurisdiction_rule`.
  - **unverified_statute_citation** — *the hard one (see open decisions)* — extract citation-shaped tokens; block if an outbound assertion cites a statute not marked verified (vs `source_authority` tier-1 / an attorney "verified" flag).
  - **Warnings (non-blocking):** tone (reuse the existing LLM classifier as the *warn* layer), package completeness (reuse FOLD-DRAFT-1 `closurePackage.getClosureCheck`), low-confidence KB/library match.
- **Data model (additive, nullable owner key):** `sendability_rule` (which checks are enabled + block-vs-warn, firm-default, attorney-tunable per matter/doc-type without a migration); `jurisdiction_rule` (per-jurisdiction execution formalities, e.g. VA vs MD witness/notary, feeding missing_required_signer); `sendability_override` (append-only record of an attorney overriding a block: who/when/which-blocks/reason; audited).
- **Attachment point:** gate `GET /api/documents/:id/export` — on `block`, refuse export unless a matching `sendability_override` exists for that version+block set; `warn`/`pass` export freely.
- **Keep the LLM classifier** as the advisory *warn* layer (separated from deterministic blocks; degrade-to-unavailable preserved — a flaky model can never block).
- **Safety/rollout:** feature flag `SENDABILITY_GATE_ENABLED` **default OFF**; additive migrations only; engine unit-tested across block/warn/pass; live-verify before enabling; attorney override always available + recorded.

### Open decisions for the triad (ranked)
1. **What "block" should block** — DOCX export is the only egress (no real "send"). Gate export, or attach to a future send/share and leave self-export ungated? (Self-use only now.)
2. **`unverified_statute_citation`** — deterministic without unacceptable false +/-? Options: (a) extract + attorney "verified" mark; (b) cross-check `source_authority` tier-1; (c) **defer this one category**, ship the other three first.
3. **Override model** — block-overridable-with-recorded-reason vs hard-block-for-some-categories.
4. **Rule data model** — attorney-configurable vs hardcoded for v1; per-matter vs firm-level; safe seeding of VA/MD formalities.
5. **Keep vs retire the LLM advisory classifier** (proposed: keep as warn layer).
6. **Interaction with GOV-1b egress + the deferred FOLD-DRAFT-1 audience-leak filter** (which "ride FOLD-SEND-1"): leak filter as a block category here, or separate?

### Increment plan (after disposition; each reversible build-and-PR onto the phase branch)
1. data core (`sendability_rule` + `jurisdiction_rule` + `sendability_override` + seeds; no behavior change).
2. pure `evaluateSendability` engine + the three tractable blocks + warnings, unit-tested; read-only API; not wired to export.
3. wire to export behind `SENDABILITY_GATE_ENABLED` (OFF) + override record/flow + audit.
4. UI: block/warn/pass surface + recorded override action + render test.
5. (statute-citation block: separate increment or deferred per decision 2.)

---

## PART 4 — Master plan F.5 (sendability), inlined

> **FOLD-SEND-1** · Implementation · **FIRE.** Upgrade sendability from the current **advisory classifier** to the target **block/warn/pass** deterministic gate. Blocks: wrong matter ID, stale baseline, missing required signer/open execution item, unverified statute citation in outbound legal assertion. Warnings: tone, optional package completeness, low-confidence library match. Document current-vs-target explicitly so no builder assumes the hard gate exists prematurely. *Acceptance: defined deterministic categories block; non-blockers warn; attorney override recorded.*
>
> Deferral map: **JurisdictionRule, SendabilityRule → FOLD-SEND** (these tables are created by this engagement). The deferred FOLD-DRAFT-1 audience format/tone split + audience-leak filter "ride FOLD-SEND-1 + FOLD-GOV-1 egress decisions."

---

## PART 5 — Engagement state (summary, inlined)

- **Done + on prod (`main` = `0d704c9`):** FOLD-AUTH-1, TIER-1, GOV-1a, PERSIST-1, L1-1..L1-5, L0-1, KB-1, ORCH-1, **DRAFT-1** (provenance + LDD + closing-package; live-verified). Migrations `0007`–`0017` applied. Auth real (bypass off). MODE B deploy (no auto-rollback yet).
- **Queue head: FOLD-SEND-1** (this packet). Then Phase 4 (FOLD-PM-1..4), Phase 5 (FOLD-INTEG-1 FIRE, SEED-1, MIGRATE-1 FIRE, VERIFY-1).
- **Accepted risks / carryforwards:** reviewer reliability (Gemini invalid JSON; intermittent empties); `LLN-PROD-CLEANUP-1` synthetic prod data (operator-gated cleanup only); attorney retention sign-off pending; MODE-A smoke automation deferred. Not client-facing yet (self-use).

---

## PART 6 — CLAUDE.md governance constraints the reviewers must respect

- **Attorney is always the final decision-maker.** Reviewers/automation surface options and issues; they never make business decisions and never treat a business choice as a defect. Any "block" must be overridable by the attorney, and the override must be recorded.
- **Additive only; no destructive/non-additive migration** of existing tables without a separate operator-gated, manual step. Feature flags **default OFF**.
- **Single operator now, nullable owner key** (so a second attorney can be added later without a migration). Owner-scoping goes through `ownerScope()` (never inline `eq(table.userId, …)`).
- **Scope fence:** transactional document-assembly only — no title/settlement, litigation/M&A/advisory, or new external integration/egress contract beyond what's named.
- **CI cannot judge send-safety correctness** — it type-checks + runs unit/render tests; it cannot tell whether the gate blocks the *right* things. That gap is exactly why this triad review exists.
- **Deploy topology:** Railway auto-deploy is OFF; merge ≠ deploy; deploy is operator-gated and MODE B (no auto-rollback yet). DOCX export is the only egress today.

---

## PART 7 — Current sendability code (excerpts, inlined — "what exists today")

**7.1 The advisory classifier** (`src/server/procedures/reviewSession.ts`) — an LLM query, read-only, NOT wired to finalize/export, degrades to unavailable:

```ts
// MR-CAL-8B — sendability check (ADVISORY classifier; read-only)
// Runs an LLM classifier over the current draft (+ latest reviewer feedback) and returns an
// advisory verdict. It is a QUERY: no persistence, no job row, and it is NOT wired into
// finalize/export — so it can never block or affect the send transaction (advisory-only).
// DEGRADE-TO-UNAVAILABLE: any classifier/parse failure returns { available:false } rather than
// throwing. The only audit trace is the 'sendability_checked' telemetry event.
checkSendability: protectedProcedure
  .input(z.object({ documentId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    // ... loads current version + latest-iteration feedback as classifier signal ...
    const adapter = resolveAdapter(EVALUATOR_MODEL);              // anthropic:claude-opus-4-5
    const llmResult = await adapter.generate({ systemPrompt, userPrompt, temperature: 0.2,
      maxTokens: 4096, structuredOutputSchema: SendabilityVerdictSchema, signal: AbortSignal.timeout(300_000) });
    const verdict = parseSendabilityOutput(llmResult.content);
    return { available: true, verdict };                          // { sendable, blockers[], notes? }
    // catch -> { available:false, reason:'CLASSIFIER_UNAVAILABLE' }
  }),
```

**7.2 The current (LLM, subjective) verdict contract** (`src/shared/schemas/phase4b.ts`):

```ts
// "The sendability classifier ... returns an ADVISORY verdict ... It NEVER blocks finalize/export."
export const SENDABILITY_BLOCKER_CATEGORY_VALUES = [
  'jurisdiction_mismatch', 'missing_material_terms', 'unresolved_blanks',
  'missing_party_or_capacity', 'conflicting_provisions', 'business_decision_needed',
  'execution_signature_defect', 'counterparty_over_disclosure', 'other',
] as const;
export const SENDABILITY_BLOCKER_SEVERITY_VALUES = ['BLOCKER','SUBSTANTIVE','STRUCTURAL','PRECISION','POLISH'] as const;
export const SendabilityVerdictSchema = z.object({
  sendable: z.boolean(),
  blockers: z.array(z.object({ category: z.enum(SENDABILITY_BLOCKER_CATEGORY_VALUES),
    severity: z.enum(SENDABILITY_BLOCKER_SEVERITY_VALUES), summary: z.string() })),
  notes: z.string().optional(),
});
```

**7.3 The egress surface** (`src/server/index.ts`) — the only way a document leaves the system; currently **ungated**:

```
GET /api/documents/:documentId/export   // Phase 6 synchronous DOCX export; emits 'document_exported'.
```

**7.4 Reusable deterministic inputs already in the codebase** (the gate would read, not rebuild): `open_items` (persistent blockers/execution items, with category + requiresAttorneyConfirmation); `adopt_ledger` (what's been adopted); `versions` (baseline/version drift); `source_authority` (source-of-truth tiers — feeds statute verification); `auditEvents` (where the override is recorded); FOLD-DRAFT-1 `closurePackage.getClosureCheck` (package completeness → a warning). Scaffolded-but-unused boolean columns `outboundEligible` / `sendabilityRequired` exist.

---

**End of packet. Reviewer disposition returns to the operator, who directs adopt/reject/blend. No code until then.**

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
