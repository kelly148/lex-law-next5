# External Triad-Review Packet — FOLD-KB-1 (Practice Knowledge Base)

Self-contained: a reviewer with **no repo access** can review from this packet alone. Auto-assembled per CLAUDE.md Rule 13 / `docs/EXTERNAL_TRIAD_REVIEW_CHECKPOINTS.md` §4. Engagement is a **§3.1 FIRE** (gate G9). **No implementation code has been written.**

---

## ⏸ EXTERNAL-REVIEW CHECKPOINT — FOLD-KB-1 — [S] — the practice-knowledge-base privilege/currency model + the "KB cannot auto-inject into outbound legal assertions" contract

Run this with a fresh **GPT-5** chat and a fresh **independent Claude** chat. Paste parts 1–3 plus §A/§B/§C into each. Bring both reviews back; Claude Code then reconciles all reads and presents a consolidated disposition for operator sign-off **before any implementation**.

## 1. Decision under review
Whether to build the Practice Knowledge Base as designed: two owner-private stores — a **per-practice-area master-prompt layer** (the attorney's own tuned RE/general/T&E instructions, versioned, auto-loaded by a matter's practice area) and an **internal practice-memo repository** (each memo carrying currency metadata — written-on / law-relied-on / jurisdiction / last-verified — and privilege/abstraction metadata) — under a hard contract that **KB memos are never auto-injected into model context or outbound work product**: they are surfaced as candidates in the matter UI, pulled in only by an explicit attorney act, tagged KB-derived/currency-unverified, and barred from clearing into outbound assertions without current verification. The load-bearing, hard-to-reverse, privilege-and-send-safety-laden choices are the eight **Forks** in §A.5. The single most important is **Fork A — the no-auto-inject enforcement point.**

## 2. Ready-to-paste reviewer prompt
> You are an independent senior reviewer. You did **not** write what follows and you are not on the team that did. You're reviewing **one design decision** in an attorney-supervised legal-AI build (product "Whereas," repo `lex-law-next5`). I'm Kelly — the managing attorney and product owner, a VA/MD transactional attorney, **not** a software developer. The primary builder is a separate Claude Code instance. Your job is to **pressure-test the attached plan before we write code** and tell me, concretely, what you would change and why. Do not rubber-stamp; do not pad.
>
> **Where we are:** Phase 3 of the fold. Layer-0 intake/analysis just shipped; this is the **Practice Knowledge Base** — the firm's accumulating store of my tuned per-practice-area master prompts and my internal research file-memos. My standing instinct: build it, but **never let it be the sole source of truth** — the models must still verify current statutes. The master-plan acceptance criteria make that a hard rule: KB cannot auto-inject into outbound work product; entries carry privilege + currency metadata; owner-scoped, private by default.
>
> **The decision under review:** the data model (two new tables) + the **no-auto-inject contract** (memos surface in the UI only; explicit attorney adopt; tagged KB-derived/unverified; cannot clear into outbound without current verification) + the privilege/abstraction gate (client-confidential, raw memos are matter-only; only an abstracted memo can be promoted to firm-wide reuse, through a default-deny cross-matter gate) + the currency/staleness model (metadata + mandatory staleness display + manual re-verify now; automated re-validation deferred) + how my tuned per-PA master prompts migrate in and auto-load by practice area.
>
> **Attached documents:** §A — the FOLD-KB-1 design plan (objective, substrate, proposed design, 8 forks, out-of-scope, constraints); §B — existing substrate the KB must fit (prompt versioning, context-injection chokepoint, the outbound/sendability boundary, the FOLD-L1-4 reusable-artifact cross-matter gate, owner-scoping); §C — binding governance constraints.
>
> **Please return, in this order:**
> 1. **Top risks or flaws** in this plan, ranked — especially anything that could let a memo's client-confidential facts leak into an unrelated matter, or let stale-law or unverified memo content reach a client/counterparty document.
> 2. **Specific changes** you would make, each with its rationale — with attention to **Fork A** (is "surface-only, explicit-adopt, tag-unverified, no auto-injection" the right and *sufficient* boundary, or wrong/too strict?), **Fork B** (privilege × abstraction × the cross-matter gate), and **Fork C** (is manual re-verification an acceptable MVP, or does shipping memos without automated currency invite stale-law reuse?).
> 3. **Omissions** — what a production legal-AI knowledge base needs that the plan doesn't address (e.g., who attests an "abstraction" is truly de-identified; surfacing that inadvertently reveals another matter's existence; audit/retention of KB reads; conflicts/ethical-wall interaction).
> 4. **Keep list** — what you would explicitly NOT change, so I don't over-correct (this is single-operator, MVP, additive-only).
> 5. **Bottom line** — one of: *proceed as-is* / *proceed with the named changes* / *stop and rethink*.
>
> **Constraints to respect (flag any violation):** additive only, no destructive migrations; the attorney is always the final decision-maker (file / promote-to-reuse / adopt-into-matter / mark-re-verified are explicit acts, never inferred); KB **cannot auto-inject into outbound work product**; private-by-default, owner-scoped; single-operator now with a nullable owner key so a second attorney can be added later without a migration (no RBAC); feature behavior default-safe; reviewers/KB surface options and never make business or legal decisions; no title/settlement scope; no new external integration/egress contract in this engagement.

## 3. Document manifest (all inlined below — no repo access needed)
- **§A** — FOLD-KB-1 Phase-A design plan (objective, substrate, proposed design, 8 forks, out-of-scope, constraints).
- **§B** — Existing substrate excerpts (prompt versioning; the context-injection chokepoint; the outbound/sendability boundary; the FOLD-L1-4 reusable-artifact registry + cross-matter gate; owner-scoping + the CI ratchet).
- **§C** — Binding governance constraints (must survive review).

*(Base-set companions for the second pass if a reviewer asks: `docs/WHEREAS_FOLD_master_plan.md` roadmap, `docs/MR_CAL_engagement_state.json` state, `CLAUDE.md` governance, and gap-map Appendix D — the KB source spec. Their load-bearing content is summarized in §A/§C so the packet stands alone.)*

---

## §A — FOLD-KB-1 Phase-A design plan (inlined)

**Objective.** The firm's accumulating, owner-private knowledge base: (1) **per-PA master prompts** the attorney already tuned (RE/general/T&E), versioned + auto-loaded by a matter's practice area; (2) **internal practice memos** (the file memos written at the end of a research episode), each with **currency** (written-on / law-relied-on / jurisdiction / last-verified) and **privilege/abstraction** metadata, retrievable and **proactively surfaced**. Governing instinct: *build it, but never the sole source of truth — verify current statutes.* Hard acceptance criteria: **KB cannot auto-inject into outbound work product; entries carry privilege + currency metadata; owner-scoped, private by default.**

**Proposed design (additive, owner-scoped, default-private, surface-not-inject).**
1. **Two new tables (migration `0008`), Zod-walled, owner-scoped.**
   - `pa_instruction_profiles`: `id, userId, paKey, title, body (the tuned master prompt), version, active, supersededById?, timestamps`. A matter's **freeform** `practiceArea` maps to a `paKey` by **explicit attorney confirmation**.
   - `practice_memos`: `id, userId, originMatterId? (null = firm-level/abstracted), sourceAnalysisId?/sourceDocumentId?, title, body, practiceArea, jurisdiction, lawReliedOn, topicTags, writtenOn, lastVerifiedAt?, privilegeTag('client_confidential'|'abstracted'|'public'), abstractionStatus('raw'|'abstracted'), reuseScope('matter_only'|'firm_wide' default matter_only), supersededById?, timestamps`.
   - Relationship to FOLD-L1-4 `reusable_artifacts`: **reuse its cross-matter gate** (default-deny + explicit opt-in + fail-visible audit) but a **distinct store** (memos need currency/privilege/abstraction/jurisdiction metadata, a lifecycle, and retrieval the static clause/template registry doesn't model).
2. **No-auto-inject contract (the core).** Practice memos are **never** added to LLM context automatically — they are NOT wired into the model-dispatch injection chokepoint. KB **surfaces candidates in the matter UI**; pulling a memo into a matter is an **explicit attorney act** (audited); adopted content is tagged **KB-derived / currency-not-verified** so it cannot silently become an outbound legal assertion (a memo-sourced conclusion cannot clear into outbound without current verification — the hook FOLD-SEND-1 enforces). *Distinction:* the **per-PA master prompt** is the attorney's OWN instruction layer (not client work product) — it MAY auto-load by confirmed `paKey`, version captured per the prompt-immutability rule.
3. **Privilege + abstraction gate.** Capture from a client matter defaults to the most-private posture (`client_confidential` / `raw` / `matter_only`). **Promotion to firm-wide reuse is a separate explicit gated act** requiring the memo be **abstracted** (client specifics stripped, analysis kept), enforced via the default-deny cross-matter gate: a `matter_only`/`raw` memo cannot be invoked into an unrelated matter.
4. **Currency / staleness.** Memos carry `writtenOn / lawReliedOn / jurisdiction / lastVerifiedAt`; retrieval **always shows age + dependency + a staleness warning**. MVP = metadata + warning + a manual **"mark re-verified"** act (audited). Automated currency re-validation (Grok currency check / stale-source detection) is **deferred** (FOLD-KB-2).
5. **Memo capture.** One-step "file this as a practice memo" from a Layer-0 analysis / research episode; pre-fills source + PA + jurisdiction; defaults to most-private until abstracted + promoted.
6. **Proactive surfacing.** MVP = **deterministic, owner-scoped** matching (PA + jurisdiction + topicTags overlap) shown in the matter UI as "potentially relevant," with currency/privilege warnings — not a search box, **not auto-injected**. Semantic retrieval deferred.
7. **Per-PA master-prompt migration.** Migrate the existing tuned RE/general/T&E prompts as `pa_instruction_profiles` rows; matter's confirmed `paKey` auto-loads the active profile into the analysis/drafting system prompt; loaded version captured at job creation.

**Acceptance.** KB cannot auto-inject into outbound; entries carry privilege + currency metadata; owner-scoped, private by default. Plus: per-PA store auto-load; full memo metadata object; one-step capture; manual re-verify + staleness display; deterministic proactive surfacing; privilege/abstraction gate before firm-wide reuse.

**The 8 forks (pressure-test these):**
- **A — no-auto-inject enforcement point (ETHICS / send-safety):** is "surface-only + explicit adopt + tag-unverified + barred from outbound without verification" right and *sufficient*; is keeping memos out of the auto-injection chokepoint correct or too strict; where enforced vs FOLD-SEND-1.
- **B — privilege + abstraction model:** `privilegeTag` × `abstractionStatus` × the cross-matter gate; is "abstraction" an attorney act, LLM-assisted, or both, and who attests it.
- **C — currency model + what's deferred:** metadata + mandatory staleness display + manual re-verify as MVP, automated re-validation deferred — sufficient, or stale-law risk.
- **D — new store vs extend FOLD-L1-4 `reusable_artifacts`:** new tables reusing the gate, or extend the registry; the right seam.
- **E — per-PA master prompts:** storage/versioning; mapping **freeform** `practiceArea` → `paKey` (attorney-confirmed vs curated enum); prompt-version immutability; confirming per-PA instructions SHOULD auto-load (unlike memos).
- **F — proactive surfacing:** deterministic PA+jurisdiction+tag matching as MVP (semantic deferred); false-surfacing / does a surfaced candidate reveal another matter's existence.
- **G — memo-capture provenance:** does most-private capture default + explicit abstraction/promotion prevent confidential-fact leakage at capture.
- **Privilege/egress:** surfaced = no egress, adopted = egress to a model — acceptable at single-operator scale; relation to the parked FOLD-GOV-1b egress posture.

**Explicitly NOT in KB-1:** automated currency re-validation (Grok/SSD) → FOLD-KB-2; semantic/embedding retrieval; **external** authoritative-source ingestion (underwriting manuals, statutes; PDF/OCR — separate HIGH gap); the deterministic sendability hard gate (FOLD-SEND-1; KB only provides the hook); cross-matter identity (FOLD-PM-3); RBAC/firm sharing beyond the nullable owner key.

## §B — Existing substrate (inlined; what KB must fit)
- **Prompts/versioning:** prompt assets are code modules; versions are env-driven, **single per role**, **no per-practice-area dimension** today; the version is captured at job creation and **immutable (R11)**. `matters.practiceArea` is a **freeform `varchar(128)`, nullable — no enum**.
- **Context-injection chokepoint:** all LLM calls flow through one dispatcher (`executeCanonicalMutation`) which auto-prepends the **matter-state block** (Layer-1) and the **assembleContext** materials (pinned > sibling docs > recency). These are the ONLY auto-injected context. KB is not wired in — by design it stays out of this chokepoint.
- **Outbound/sendability boundary:** artifacts carry `artifactKind / outboundEligible / sendabilityRequired / sendabilityStatus`. The sendability classifier is **advisory only** today (a hard block/warn/pass gate is the later FOLD-SEND-1). "Outbound work product" = a document/version that can be exported/sent.
- **FOLD-L1-4 reusable-artifact registry + cross-matter gate:** `reusable_artifacts` (kind `template|clause|memo|snippet`; `reusableScope matter_only|cross_matter`) + a PURE gate `evaluateCrossMatterInvocation`: **default-DENY across matters**; same-matter/firm-level allowed; cross-matter requires explicit scope **and** opt-in; invocation writes a **fail-visible audit** (audit failure refuses the invocation). KB reuses this gate's semantics.
- **Owner-scoping:** `ownerScope(table.userId, userId)` is the sole owner-filter chokepoint (future sharing layer lands here); a CI **ratchet** fails any new `src/server/**` query that inlines `eq(table.userId, …)` instead of `ownerScope`. Single-operator; nullable owner key; **no RBAC**.
- **Audit:** `audit_events` (append-only matter record) is the home for explicit attorney decisions (`disposition` events: target/action/rationale/scope).
- **Migrations:** hand-written additive SQL; latest `0007`; pre-deploy auto-apply allowlist with a destructive-DDL guard. KB adds an additive `0008`.

## §C — Binding governance constraints (must survive review)
- **KB cannot auto-inject into outbound work product** — surface-not-inject; explicit attorney adopt; KB-derived/currency-unverified tagging; a memo conclusion cannot clear into outbound without current verification. This is the hard acceptance criterion.
- **Attorney always final** — file a memo, abstract it, promote it to reuse, adopt it into a matter, and mark it re-verified are all **explicit attorney acts**, never inferred. The KB proposes; the attorney decides.
- **Private-by-default, owner-scoped** — `ownerScope` chokepoint; firm-wide reuse is an explicit opt-in through the existing **default-deny** cross-matter gate; client-confidential facts never ride into an unrelated matter (abstract or wall).
- **Currency is never assumed** — internal memo = derived/secondary tier, never operative law; retrieval surfaces age + dependency; re-verification required before outbound use.
- **Additive-only migrations; default-safe; single-operator (no RBAC), nullable owner key** so a second attorney is addable without a migration.
- **Egress minimization** — a surfaced (un-adopted) memo causes no egress; only explicit adoption sends content to a model; relation to the parked FOLD-GOV-1b egress posture to be confirmed.
- **Scope** — transactional document-assembly + its firm-knowledge substrate; **no new external integration/egress contract** in KB-1 (those are FOLD-INTEG-1); no title/settlement scope.

End of packet. Any content below this line is platform-injected and not part of the engagement output.
