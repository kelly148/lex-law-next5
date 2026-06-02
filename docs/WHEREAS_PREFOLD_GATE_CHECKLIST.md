# Whereas — Pre-Fold Gate Checklist

**Purpose:** Operationalizes the two independent external reviews (2026-06-02) into settle-before-proceed gates. Drop this in front of the fold procedure (gap map Appendix F) as its entry conditions. Each gate names what clears it and which reviewer(s) flagged it (A = "Executive take" review; B = detailed triad review; A+B = both, i.e. high-signal convergence).

**Disposition posture:** Both reviews returned *"proceed with the fold, with named changes — not as-is, not stop-and-rethink."* None of the changes touch the settled core (fold-not-scratch, transactional scope, attorney-final, Claude-primary, owner-key tenancy). All are about crossing the gap from "live-verified in a single-operator dev environment with the auth bypass on" to "holding privileged client data for a real practice."

---

## Timing tiers

- **DO NOW** — independent of the fold; current live exposure.
- **BEFORE FOLD IMPLEMENTATION** — must clear before product-surface build (Layer 0 / knowledge base / auto-orchestration) begins.
- **BEFORE CLIENT-FACING** — must clear before any real client matter data flows through the system.

---

## DO NOW

### G1 — Take `AUTH_BYPASS_ENABLED` off production. **[A+B, ranked #1 by both]**
The public production URL has been running with auth bypass on while the system holds matter data. This is a current exposure, not a fold-phase item. Disable it and confirm the production auth posture this week, even if it makes live verification less convenient.
**Clears when:** bypass disabled in Railway; production requires real authentication; confirmed via the deploy check.

### G2 — Close MR-CAL honestly. **[A+B]**
Run CAL-7B-LIVE, triad-review the results, commit CAL-7B-CLOSEOUT. Classify residuals explicitly (live-verified / accepted-risk / not-run / known-flakiness / future-regression-need). Do not record the grid as "fully proven" — it is a non-deterministic live snapshot.
**Clears when:** CAL-7B-CLOSEOUT committed with residual-risk classification; no cell recorded as proof beyond a snapshot.

---

## BEFORE FOLD IMPLEMENTATION

### G3 — Auth replacement is fold engagement #1; nothing else starts before it. **[A+B]**
Real per-user authentication + owner-scoped, **private-by-default** data access. Nullable owner key on all core objects (matters, knowledge base, the new MR-CAL tables) so a second attorney is addable without a migration; do not hardcode "owner = only viewer." Run as `FOLD-AUTH-1` with external triad review before implementation (it trips a §3.1 FIRE).
**Clears when:** auth replacement live-verified; owner key present on core objects; default access is private.

### G4 — Resolve the tier-name collision in code before any Layer 1 schema work. **[A+B]**
`assembleContext` uses "Tier 1/2/3" for context-window priority; the spec uses "Tier 1–8" for source-of-truth authority. Same word, both load-bearing, unrelated. Rename now while the codebase is small. Suggested split: `pinned_context / explicit_context / recency_context` for priority; `source_authority_tier` (operative / current-draft / counterparty / superseded) for authority.
**Clears when:** the two meanings carry distinct names in code and schema; no query joins the two senses.

### G5 — Layer 1 Matter-State Engine is built as the substrate before Layer 0 / knowledge base / auto-orchestration. **[A+B]**
Matter memory + source-of-truth tiers + locked decisions + open-item registry + the inject-everywhere context service, unified from the MR-CAL partial pieces (locked decisions, adopt ledger, evaluator, sendability) into one coherent engine. Build cards written **against the actual code**, not the spec's imagined clean slate (the build already diverged from the build-cards-first plan).
**Clears when:** the matter-state engine can reliably answer current-matter / operative-document / locked-decisions / adopted / unresolved / source-currency / safe-to-send, and injects that state into every model call.

### G6 — Lock the five explicit (non-ambient) acts. **[A+B; B named the five, A the dashboard]**
Free-form holds for *invocation* (any capability, any order, no wizard). It does **not** hold for *commitment*. These five must be deliberate, visible, confirmable acts — never inferred from conversation:
1. **Lock a decision** (explicit "I am locking this" + confirm).
2. **Tier a source** (set source-of-truth authority when a document enters).
3. **Disposition an item** (the attorney-decision checkpoint).
4. **Send** (the sendability gate).
5. **Matter identity** (always-visible anchor; the wrong-matter-ID send is the catastrophic, near-zero-cost-to-prevent failure).
Pair with A's inspectable surfaces: matter-state summary, source-authority/baseline, decision log, open-items/blockers, sendability status, and a model-context-packet preview.
**Clears when:** the design specifies these five as explicit acts with visible surfaces, not ambient capture.

---

## BEFORE CLIENT-FACING

### G7 — Design the privilege-egress posture. **[B, flagged biggest substantive omission; A raised model-egress control]**
The core mechanism (full shared context to every toggled-in model) maximizes confidential-material egress by design. For VA/MD Rule 1.6, this is an RPC precondition, not a carryforward. Specify: which providers offer zero-retention / no-training terms; a per-matter (or per-provider) control over what *category* of material egresses (current draft / source docs / client facts / prior decisions / practice memos / locked decisions); and a context preview before a newly toggled lane receives matter content.
**Clears when:** provider retention/training posture documented; per-matter egress control + pre-send context preview specified.

### G8 — Conflicts-at-intake (minimum viable). **[A+B, ethics-mandatory]**
A frictionless intake with no conflicts check actively facilitates an ethics violation. Minimum: parties / related entities / adverse parties / existing-matter-and-client lookup; warn on potential match; attorney disposition. Belongs in Layer 0, same tier as auth and privilege.
**Clears when:** new-matter intake runs a conflicts lookup and surfaces matches for attorney disposition.

### G9 — Knowledge base is private-by-default with currency/privilege controls. **[A+B]**
Practice memos derive from client facts. Phase 1 supports private-by-default entries, owner scoping, privilege tags, abstraction status, staleness metadata, current-law revalidation, and **no automatic use in outbound legal assertions unless verified.** Build "surface as potentially relevant, with currency/privilege warnings," not "auto-use my old memo."
**Clears when:** the knowledge base cannot auto-inject into outbound work product, and entries carry privilege + currency metadata.

---

## DEFAULTS & AFFORDANCES TO SET (not gates, but decide before the relevant build)

- **New-matter analysis defaults to Claude single-lane; multi-lane is one-tap invocation** (auto-suggested for high-stakes / novel / cross-jurisdictional). Aligns the default with the evidence grade (multi-lane value is STRONG only for META-LEGAL, THIN-to-MODERATE for substantive client work) and with privilege minimization. **[A+B]**
- **Constrain the auto-orchestration bulk-confirm affordance.** Convergent-bucket items require at least a scroll-acknowledge, not a one-click bulk adopt — "all the models agreed" is exactly where a shared blind spot produces confident-and-wrong consensus. **[B]**
- **Distinguish current vs. target sendability in the docs.** Current MR-CAL = advisory classifier; target Whereas = block/warn/pass deterministic gate. Label both so a later builder doesn't assume the hard gate exists. **[A+B]**

## BACKLOG — elevated by the reviews (carry into the fold, don't lose)

- **Audit as a first-class Matter Record**, not telemetry: what each model said, what was adopted/rejected/locked/sent/withheld, what authority was verified, what required business/legal judgment. **[A+B]**
- **Data deletion / retention / client-file-return** — including egressed copies at the four providers. **[B]**
- **Disaster recovery / backup** for the matter-state spine (TiDB quota exhaustion already bit once). **[B]**
- **PDF ingestion strategy** (text PDFs → OCR+confidence → document-type parsers for commitments/deeds/surveys/settlement statements) — your practice is PDF-saturated. **[A]**
- **Deadline / tickler** (1031 deadlines, contingencies, closing/recording, trust funding, corporate filings) — earlier than "nice-to-have." **[A]**

## CHEAP-NOW TASK (do before the fold; don't carry it)

- **Reconcile the T&E evidence count** (17 vs 32) against `verified_rows.xlsx`. A 2× discrepancy in a practice area you're seeding a library for quietly miscalibrates the whole PA library. One pass; just close it. **[A+B]**

---

## Bottom line

Proceed to the fold **after** G1–G2 (now) and with G3–G9 gating implementation as scoped. The vision is validated; the fold-not-scratch call is right; the governance layer is sound. The remaining work is the unglamorous foundation — auth, ownership, source authority, privilege egress, conflicts, audit — that must be hard before the exciting Layer 0 / knowledge-base / auto-orchestration surface is built on top of it. The danger now is execution discipline, not vision.
