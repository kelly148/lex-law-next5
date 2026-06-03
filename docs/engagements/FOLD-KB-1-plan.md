# FOLD-KB-1 — Phase-A Design Plan: Practice Knowledge Base

Engagement: FOLD-KB-1 (Whereas fold Phase 3 / Appendix D). Type: Implementation (design artifact — pre-implementation). Checkpoint: **§3.1 FIRE** (gate G9 — establishes a knowledge-store privilege/currency model and the "KB cannot auto-inject into outbound legal assertions" contract: hard to reverse once data accrues, not CI-caught, privilege-confidentiality + client-send-safety risk). Status: **plan drafted; auto-assembled into `docs/reviews/FOLD-KB-1_packet.md` + phase2 mirror; HALTED for external triad review before any implementation.**
Date: 2026-06-03. Repo: `fold/phase-3` (HEAD `725438b`; FOLD-L0-1 complete).

> This is a **design proposal for review**, not a built artifact. No code is written until the triad disposition returns and the operator directs adopt/reject/blend. The attorney is the final decision-maker; **filing a memo, promoting it to reuse, and pulling it into a matter are explicit attorney acts, never inferred.**

---

## 1. Objective

Build the **Practice Knowledge Base**: the firm's accumulating, owner-private store of (1) **per-practice-area master prompts** the attorney has already tuned (RE / general / T&E), versioned and auto-loaded by a matter's practice area, and (2) **internal practice memos** — the file memos the attorney writes at the end of a research episode (e.g., 1031 related-party transfers) — each carrying **currency** and **privilege/abstraction** metadata, retrievable and **proactively surfaced** next time the matter is in the same territory.

The governing instinct (operator's own words): *"build it, but never let it be the sole source of truth; the models must still check current statutes."* The master-plan acceptance criteria encode that as hard constraints:

- **KB cannot auto-inject into outbound work product.**
- **Entries carry privilege + currency metadata.**
- **Owner-scoped, private by default.**

Per the master plan, FOLD-KB-1 is the knowledge-base layer. The deterministic block/warn/pass sendability gate is FOLD-SEND-1; the full cross-matter party/entity identity model is FOLD-PM-3; multi-model orchestration is FOLD-ORCH-1; library/PA seeding rides this engagement's review (FOLD-SEED-1).

## 2. Current substrate (code map, 2026-06-03)

- **Prompts:** code-module assets in `src/server/llm/prompts/*.ts`; versions are env-driven and **single per role** (`promptVersions.ts` — `PROMPT_VERSION` + `JOB_TYPE_TO_PROMPT_ROLE`); **no per-practice-area dimension** today. `jobs.promptVersion` captures the active version at job creation and is **immutable (R11)**.
- **Practice area:** `matters.practiceArea` is a **freeform `varchar(128)`, nullable** — **no controlled enum** (curation deferred to v2, Ch 5.4).
- **Context injection chokepoint:** every LLM call flows through `executeCanonicalMutation`; it auto-prepends the **matter-state block** (L1-2) and the **assembleContext** materials (pinned > sibling docs > recency). These are the ONLY things auto-injected. KB is not wired in anywhere yet.
- **Outbound boundary:** the sendability fields live on artifacts (`artifactKind` / `outboundEligible` / `sendabilityRequired` / `sendabilityStatus`); the sendability classifier (MR-CAL-8C) is **advisory only** (FOLD-SEND-1 will make it a hard gate). "Outbound work product" = a document/version that can be exported/sent; a `matter_analysis` is categorically non-sendable.
- **Reusable-artifact registry (FOLD-L1-4):** `reusable_artifacts` (kind `template|clause|memo|snippet`; `reusableScope matter_only|cross_matter`) + a **PURE cross-matter gate** (`evaluateCrossMatterInvocation`: default-DENY across matters; firm-level/same-matter allowed; cross-matter requires explicit scope **and** opt-in; fail-visible audit). Static snapshots created by attorney action — NOT a metadata-rich, currency-aware, retrieval-surfaced knowledge store.
- **Owner-scoping:** `ownerScope(table.userId, userId)` is the sole chokepoint (future sharing layer lands here); a CI **ratchet** (`mr_fold_auth_2.test.ts`) fails any new `src/server/**` query that inlines `eq(table.userId, …)` instead of `ownerScope`.
- **Audit:** `audit_events` (append-only matter record) is the home for explicit attorney decisions (`disposition` events with target/action/rationale/scope).
- **Migrations:** hand-written additive SQL; latest `0007`; pre-deploy auto-apply allowlist (`scripts/apply-prod-migrations.mjs`) with a destructive-DDL guard. KB would add `0008` (additive).

## 3. Proposed design (additive, owner-scoped, default-private, surface-not-inject)

### 3.1 Two new stores (Fork D — new tables, reuse FOLD-L1-4 gate pattern)
Additive migration `0008`. New owner-scoped tables; every read through the Zod Wall.

- **`pa_instruction_profiles`** (the per-PA master-prompt layer): `id, userId, paKey (owner-defined label, e.g. 'real_estate'), title, body (mediumtext — the tuned master prompt), version (string), active (bool), supersededById?, timestamps`. A matter's freeform `practiceArea` maps to a `paKey` by **explicit attorney selection/confirmation** (never silent string-guessing).
- **`practice_memos`** (internal practice memos): `id, userId, originMatterId? (nullable = firm-level/abstracted), sourceAnalysisId? / sourceDocumentId?, title, body (mediumtext), practiceArea, jurisdiction, lawReliedOn (JSON/text — the authorities the memo relied on), topicTags (JSON — for surfacing), writtenOn (date), lastVerifiedAt (date, nullable), privilegeTag ('client_confidential'|'abstracted'|'public'), abstractionStatus ('raw'|'abstracted'), reuseScope ('matter_only'|'firm_wide' — default 'matter_only'), supersededById?, timestamps`.

The relationship to `reusable_artifacts` is stated, not duplicated: KB **reuses** the FOLD-L1-4 cross-matter gate semantics (default-deny + explicit opt-in + fail-visible audit) but is a **distinct store** because it needs currency/privilege/abstraction/jurisdiction metadata, a memo lifecycle, and proactive retrieval that the static clause/template registry does not model.

### 3.2 The no-auto-inject contract (Fork A — the load-bearing ethics/send-safety decision)
**Practice memos are NEVER added to an LLM context automatically.** They are not wired into the `executeCanonicalMutation` injection chokepoint. The KB **surfaces candidates in the matter UI** ("you wrote this before; here it is; here's its currency/privilege posture"); pulling a memo into a matter's working context is an **explicit attorney act** (recorded in `audit_events`), and even when adopted, the content is tagged **KB-derived / currency-not-verified** so it cannot silently become an outbound legal assertion. A conclusion sourced from a memo cannot clear into outbound work product without current verification — the hook FOLD-SEND-1 will enforce. *Distinction:* the **per-PA master prompt** (§3.1) is the attorney's OWN tuned instruction layer, not client work product — it MAY auto-load into analysis/drafting by the matter's confirmed `paKey` (that is its purpose), with its version captured per R11.

### 3.3 Privilege + abstraction gate (Fork B)
A memo captured from a client matter defaults to the **most-private** posture: `privilegeTag='client_confidential'`, `abstractionStatus='raw'`, `reuseScope='matter_only'`. **Promotion to firm-wide reuse is a separate, explicit, gated attorney act** that requires the memo to be **abstracted** (`abstractionStatus='abstracted'` — client specifics stripped, legal analysis kept) — enforced by reusing the FOLD-L1-4 cross-matter gate (a `matter_only`/`raw` memo cannot be invoked into an unrelated matter; default-deny; fail-visible audit). This encodes D.4's rule: *the abstracted legal analysis is reusable; the client's particular facts do not ride along.*

### 3.4 Currency / staleness model (Fork C)
Every memo carries `writtenOn`, `lawReliedOn`, `jurisdiction`, `lastVerifiedAt`. **Retrieval/surfacing always renders age + dependency + a staleness warning** — never hands a memo back as current. MVP: the metadata + the warning display + a manual **"mark re-verified"** attorney act (writes `lastVerifiedAt` + an audit row). The **automated** currency re-validation (Grok currency check / stale-source detection against `lawReliedOn`) is **deferred** (D.6 places it at MVP-1B/2) and noted as the FOLD-KB-2 follow-on.

### 3.5 Memo capture from a Layer-0 analysis (Fork G)
A one-step **"file this as a practice memo"** action from a FOLD-L0-1 matter analysis (or a document/research episode). Capture pre-fills `sourceAnalysisId`, `practiceArea`, `jurisdiction`, and defaults to the most-private posture (§3.3). Because the source carries that matter's confidential facts, capture is **matter_only/raw/client_confidential** until the attorney explicitly abstracts and promotes.

### 3.6 Retrieval + proactive surfacing (Fork F)
MVP surfacing is **deterministic and owner-scoped**: candidate memos are matched to the open matter by `practiceArea` + `jurisdiction` + `topicTags` overlap and shown in the matter UI as "potentially relevant" with currency/privilege warnings — **not** a search box the attorney must remember, and **not** auto-injected. Semantic/embedding retrieval is deferred.

### 3.7 Per-PA master-prompt migration + wiring (Fork E)
Migrating the attorney's existing tuned RE/general/T&E prompts is the concrete day-one asset. They land as `pa_instruction_profiles` rows (versioned). A matter's confirmed `paKey` auto-loads the active profile into the analysis/drafting system prompt via the existing chokepoint; the loaded version is captured at job creation (R11). Open: how the freeform `practiceArea` maps to a `paKey` (attorney-confirmed mapping vs an owner-curated PA list) — see Fork E.

### 3.8 Scope, migrations, safety
- **Additive only.** Migration `0008` (the two new tables; no destructive/altering migration of existing data). Qualifies for the pre-deploy additive-only allowlist.
- **Owner-scoped, private by default** via `ownerScope`/`assertOwned`; new query files use `ownerScope` (ratchet-clean). Firm-wide reuse is an explicit opt-in through the FOLD-L1-4 gate, never a default.
- **Surface-not-inject** is the architectural boundary: KB memos are deliberately absent from the auto-injection chokepoint; only the attorney's own per-PA instruction layer auto-loads.
- **Attorney-final / default-safe**: file, promote-to-reuse, pull-into-matter, and mark-re-verified are explicit attorney acts (audit_events `disposition`). The KB proposes; the attorney decides.
- **Egress minimization** (ties to parked FOLD-GOV-1b): a surfaced memo is UI-only (no egress); only an explicitly-adopted memo's content reaches a model — confirm this is the intended egress posture.

## 4. Acceptance (from the master plan)
KB **cannot auto-inject into outbound work product**; entries **carry privilege + currency metadata**; the store is **owner-scoped, private by default**. Plus the D.6 build cards in MVP scope: per-PA instruction store (auto-load by PA); practice-memo object with the full metadata; one-step memo capture; manual re-verification + staleness display; deterministic proactive surfacing; the privilege/abstraction gate before firm-wide reuse.

## 5. Forks for the triad (the load-bearing decisions to pressure-test)
- **FORK A — the no-auto-inject enforcement point (ETHICS / client-send-safety):** is "surface-in-UI-only; explicit attorney adopt; tag KB-derived/unverified; a memo conclusion cannot clear into outbound without current verification" the right and *sufficient* boundary? Is keeping memos entirely out of the auto-injection chokepoint correct, or too strict to be useful? Where exactly must the no-auto-inject be enforced relative to FOLD-SEND-1?
- **FORK B — privilege + abstraction model:** is `privilegeTag` × `abstractionStatus` × the FOLD-L1-4 cross-matter gate the right control so client-confidential facts never ride into an unrelated matter, while abstracted analysis stays reusable? Is "abstraction" an attorney act, an LLM-assisted step, or both — and who attests it?
- **FORK C — currency model + what's deferred:** are `writtenOn`/`lawReliedOn`/`jurisdiction`/`lastVerifiedAt` + a mandatory staleness display + manual re-verify sufficient for MVP, with automated Grok/SSD re-validation deferred? Is manual re-verification an acceptable interim, or does shipping memos without automated currency invite stale-law reuse?
- **FORK D — new store vs extend FOLD-L1-4 `reusable_artifacts`:** build `practice_memos`/`pa_instruction_profiles` as new tables (richer metadata, retrieval, lifecycle) reusing the cross-matter gate, or extend the existing registry? Where's the right seam so the two don't drift or duplicate the gate?
- **FORK E — per-PA master prompts:** storage/versioning and how a matter's **freeform** `practiceArea` maps to a `paKey` (attorney-confirmed mapping vs an owner-curated PA enum); the R11 immutability interaction; and confirming the per-PA instruction layer SHOULD auto-load (unlike memos) because it is the attorney's own instruction, not client work product.
- **FORK F — proactive surfacing:** is deterministic PA+jurisdiction+tag matching an acceptable MVP for "you wrote this before," with semantic retrieval deferred? What's the false-surfacing / privilege-leak risk if a surfaced candidate reveals another matter's existence?
- **FORK G — memo capture provenance:** does defaulting capture to matter_only/raw/client_confidential, requiring explicit abstraction + promotion before reuse, correctly prevent confidential-fact leakage at the capture moment?
- **Privilege/egress:** surfaced-but-not-adopted = no egress; adopted memo = egress to a model — acceptable at single-operator scale, and how does it interact with the parked FOLD-GOV-1b egress posture?

## 6. Explicitly NOT in FOLD-KB-1 (deferred)
Automated currency re-validation engine (Grok currency check + stale-source detection) → FOLD-KB-2/MVP-1B; semantic/embedding retrieval; authoritative **external** source ingestion (underwriting manuals, statutes — and PDF/OCR, a separate HIGH gap); the deterministic block/warn/pass sendability **hard gate** (FOLD-SEND-1 — KB only provides the hook); full cross-matter party/entity identity (FOLD-PM-3); any RBAC/firm-multi-user sharing beyond the nullable owner key.

## 7. Constraints honored
Additive-only migration (`0008`); owner-scoped chokepoint + private-by-default; **KB cannot auto-inject into outbound** (surface-not-inject; explicit adopt; KB-derived/unverified tagging); entries carry privilege + currency metadata; firm-wide reuse is explicit opt-in through the existing default-deny cross-matter gate; attorney always final (file / promote / adopt / re-verify are explicit acts); single-operator, nullable owner key, no RBAC; egress-minimizing (surface = no egress); transactional-document-assembly scope — KB is the firm-knowledge substrate behind analysis/drafting, **no new external integration/egress contract** (those are FOLD-INTEG-1).

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
