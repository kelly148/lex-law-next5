# CHAT-COPILOT-1 — Triad Disposition + Revised Build Spec (v2)

**Disposition:** §3.1 external triad — **3/3 APPROVE-WITH-CHANGES.** Build approved with conditions, **gated by increment**, with HALT lines. Promote-to-draft (old Inc 6) **removed** from this engagement → its own future checkpoint. Reviewers: GPT (most rigorous / most legally grounded), independent Claude (laundering-channel + citation-validation specifics), Claude "Doc 3" (permissive outlier — discounted on two load-bearing confidentiality errors). Reconciliation merged to the condition set in Part B.

**Lane:** Cowork drafted this; the **CLI builds** to it, increment by increment; **operator gates** each HALT, the state.json registration, every merge, and deploy. This supersedes `CHAT-COPILOT-1_triad_packet_2026-06-13.md` as the build contract.

**Legal anchors cited by the triad (for the record):** ABA Formal Opinion 512 (lawyer must evaluate GAI confidentiality risk before inputting client-representation info; self-learning tools may require informed consent; lawyer stays fully responsible). Virginia Rule 1.6 (reasonable efforts to prevent unauthorized disclosure; sensitivity/likelihood/competence/cost factors). Maryland Rule 19-301.6 (no disclosure absent informed consent/exception) + 19-305.3 (supervisory controls over non-lawyer assistants).

---

## Part A — What's locked (3/3 convergence — decided, no further debate)

1. Retention / deletion / legal-hold / export path **defined and implemented before** any production persistence (Inc 1/2).
2. Third-party provider posture (no-train / no-cross-customer-learning, DPA, breach terms) **required before** grounding (Inc 3).
3. Master composition + all posture gates **re-evaluated fresh every turn** from current matter state; persisted `masterApplied`/`masterSource` flags are **audit-only**, never short-circuit re-evaluation.
4. **Promote-to-draft removed** from this engagement → its own dedicated checkpoint (server-side mutation, gates re-run at promote-time, born `internal_working_draft / client_sendable=false`, R4 carried forward).
5. Phasing reordered: policy+schema → persistence (after delete/hold exist) → grounding+citations (bundled) → guided modes → [promote deferred].

## Part A.2 — Adjudicated divergences (where reviewers split; resolution adopted)

- **HALT posture adopted** (over Doc 3's "proceed and backfill"). For persisted privileged work-product + widened NPI exposure, guardrails are **preconditions, not follow-ups.**
- **Categorical exclusion from persistence adopted** (Doc 3 wrong). See Inc 1 store-by-reference list.
- **Redaction synthesis** (resolves the only 3-way split): the control is **deterministic, category-level "don't send by default,"** NOT probabilistic NLP redaction (which breeds false confidence). Title/settlement + T&E sensitive categories are withheld from grounding unless the attorney **affirmatively selects** that material for that turn. Probabilistic field-redaction is a fast-follow, not a blocker.
- **Master-laundering across memory** (Doc 3 missed the history-replay channel): adopt **freeze-on-capacity-divergence** (primary) + **window-scrub** of master-applied prior turns when current posture wouldn't permit the master (defense-in-depth) + **posture-aware summaries**.
- **Grounding + citations ship as ONE unit** (no grounded answers without a verification path).
- **Citation-hallucination validation:** the parser **rejects** any cited `sourceId` not present in the assembled context (hallucination signal).
- **Cross-matter isolation depth** (GPT's bar): immutable `matterId`, DB-level FKs where possible, **capacity-bound** summaries, and server tests proving a `conversationId` can't be reused across matter / owner / capacity.
- **Kept from Doc 3 (its two good catches):** retention as a **defensibility asset** (design the export-to-matter-file path well, not as a chore); a per-turn / per-conversation **"do-not-persist / exclude-from-future-grounding"** attorney mark.

---

## Part B — Revised build spec, by increment (HALT-gated)

Flag: new `CHAT_COPILOT_ENABLED` (default OFF), layered above the existing `CHAT_DISPATCH/CHAT_UI_1/MASTER_CHAT`. All increments additive + reversible. CI green per PR; operator-gated merge.

### Inc 1 — Data model + lifecycle metadata. **HALT until policy + isolation + store-by-reference are settled.**
- Tables (additive, `CREATE TABLE IF NOT EXISTS`, allowlisted): `chat_conversations`, `chat_messages`, `chat_summaries`.
- **Store-by-reference (categorical exclusion — do NOT persist into `chat_messages`):** the compiled master body, raw assembled context, full source chunks copied from matter files, wire instructions, payoff/account/routing numbers, full SSNs/TINs, ID images. **Persist instead:** turn text + response, `sourceId` + citation locators, `masterApplied`, `masterSource`, `capacitySnapshot` (`engagementCapacity` + `electionMarker` + `titleSignal`), `draftingGateDecisionId`, model/provider metadata, hashes.
- Lifecycle/metadata columns from the start: retention class, deletion/legal-hold flags, `doNotPersist` / `excludeFromGrounding` per turn + per conversation.
- **Isolation invariants (not just scoped queries):** immutable `matterId` on conversations; immutable (or explicitly versioned) `documentId`; DB-level FKs where the engine allows; summaries are matter-bound **and** capacity-bound.
- **HALT preconditions:** (i) retention/deletion/legal-hold/export **path implemented** (not just documented); (ii) **server tests** proving a `conversationId` cannot be reused across matter / document / owner / capacity / title-vs-law-firm mode; (iii) store-by-reference exclusions enforced + tested; (iv) per-turn do-not-persist mark wired.

### Inc 2 — Persistence + windowed multi-turn history. **HALT until the laundering mitigations + fresh per-turn gate are specified and tested.**
- Windowed last-N history (+ optional rolling summary) restored across reloads.
- **Master-laundering mitigations (blocking):** (a) **freeze-on-capacity-divergence** — if current capacity/election ≠ the conversation's, freeze the thread and require a new conversation; (b) **window-scrub** — exclude or down-render master-applied prior turns when the current turn's posture wouldn't permit the master; (c) **posture-aware summaries** — never compress across a master/non-master boundary; summaries carry structured posture metadata, not just prose; (d) **fresh per-turn gate** — recompute principal + capacity + election + title-signal + `resolveDraftingGate` (fail-closed) **every turn from live matter state**, never cached on the conversation; re-assert the non-suppressible R4 addendum on every master-applied turn.
- Summaries are **additive** — raw turns remain retrievable; the summary is a windowing convenience, expandable on demand (a lossy summary that drops a controlling fact is a malpractice vector).

### Inc 3 + Inc 4 — Grounding **and** citations, shipped as ONE unit. **HALT until the provider posture + NPI minimization are locked.**
- Grounding via `assembleContext('chat_turn')`; **full operative-document priority** when a `documentId` is bound (prioritize that doc's current version even if it crowds siblings); **truncation signal in the UI** ("context truncated — N materials omitted" — no silent truncation); guaranteed budget for operative doc + pinned materials + latest version + locked/adopted decisions; dynamic budget by mode, not a single fixed cap.
- **Citation fidelity (blocking):** model receives `sourceId`s it cannot invent; the parser **rejects** any citation whose `sourceId` was not in the assembled context (hallucination signal); citations resolve to document/version/page/paragraph or material locator; UI visually distinguishes source-grounded statements from uncited model claims.
- **HALT preconditions:** (i) documented **no-train / zero-retention** posture for **every** routable model (enterprise/ZDR terms, in writing) — a provider that can't confirm no-train + no-human-review + bounded retention is **not selectable** for grounded chat; (ii) a **grounded-chat provider allowlist** distinct from general chat; (iii) **default category-level NPI minimization** — for title/settlement + T&E, do **not** send wire instructions, payoff/account data, scanned IDs, TINs, trust-account data, or estate asset schedules with account numbers unless the attorney **affirmatively selects** that material for that turn; (iv) attorney-facing **sensitivity control** to downgrade grounding (fall back to matter-state only) on unusually sensitive matters.

### Inc 5 — Guided modes + one-click refine. *(Fine as scoped — ship after grounding is reliable.)*
- Modes **collect missing inputs**, not just swap the system prompt: Draft/Review/Analyze/Outline ask for audience, jurisdiction, document/version, posture, deliverable, and whether client-sendable language is being requested. Review mode auto-pulls the operative document + prior versions; T&E Analyze pulls the instrument set. Refine actions (expand/shorten/cite/rephrase) issue follow-up turns.

### Inc 6 — Promote-to-draft. **REMOVED from this engagement.**
- Future engagement (e.g. `CHAT-COPILOT-PROMOTE-1`) with its own §3.1 checkpoint + adversarial tests. Required invariants when built: a **separate server-side mutation** (not a chat continuation); explicit attorney click + confirmation modal + selected target document/matter; server **re-runs** conflict/identity + capacity/posture + sendability **at promote-time**; promoted version born `internal_working_draft / client_sendable=false`; finalize/send re-runs sendability (promotion never satisfies final sendability); audit links `chat_message_id → document_version_id`; UI says "Create internal draft for attorney review," never "send/finalize/client-ready"; R4 addendum carried forward.

---

## Part C — Operator inputs required (your calls, Kelly — they gate the increments)

1. **Retention policy values** (gates Inc 1/2): retention period per matter type, matter-close handling (auto-export to matter file then delete, or retain X years), legal-hold trigger. Proposed default to react to: *active matter + 5 yrs post-closure, configurable per matter type; on close, export full thread+citations to the matter file; attorney delete at turn/conversation level any time.* Adjust to your VA/MD file-retention practice.
2. **Provider no-train/DPA confirmation** (gates Inc 3/4): which of your routable providers (Anthropic / OpenAI / Google / xAI) have **written** enterprise/ZDR **no-train + no-human-review + bounded-retention** terms. Only those go on the grounded-chat allowlist. This is a factual confirmation only you can make.
3. **NPI minimization list ratification** (gates Inc 3/4): confirm/extend the default-withheld categories (wire instructions, payoff/account/routing, SSN/TIN, ID images, trust-account data, estate asset schedules w/ account numbers, full borrower/seller NPI).

## Part D — Governance / next steps

- **§3.1 checkpoint = dispositioned** (3/3 APPROVE-WITH-CHANGES). Build may proceed to **this v2 design**, increment by increment, each HALT-gated; each PR still hits CI + your accept gate.
- **state.json registration** of CHAT-COPILOT-1 (status, §3.1 disposition, the merged condition set) is a Rule-11 list-membership change → **CLI/operator-gated**; I flagged it, did not make it.
- **Promote-to-draft** is a separate future engagement + checkpoint — not in this build.
- **Advisory-title packet** still pending your materials (the `ADVISORY_DEPTH_DECOMPOSITION` doc + a sample commitment) — unchanged.

*Assembled by Cowork (propose-never-commit). Canonical homes on commit: `docs/reviews/CHAT-COPILOT-1_triad_disposition.md` (this disposition) + the v2 spec under `docs/engagements/`. Cowork did not self-run or self-approve the review; the operator returned the disposition.*
