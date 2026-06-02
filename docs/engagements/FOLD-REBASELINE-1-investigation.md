# FOLD-REBASELINE-1 — Re-Baseline Gap Map (Investigation)

Engagement: FOLD-REBASELINE-1
Type: Investigation only (Whereas fold Phase 0 / F.2). Checkpoint class: FIRE (§3.1).
Date: 2026-06-02 (America/New_York)
Repo state: main 7ca2f1c (MR-CAL complete; G1 closed — real auth required on prod).
Method: read-only audit of the actual MR-CAL-complete code (schema.ts, migrations 0000-0003, src/server/procedures, src/server/context, src/server/llm/prompts, src/client) via CodeGraph/Serena/Grep/Read. Evidence-class precision throughout.

## Caveat on source of truth
The original gap map (`LLN_FOLD_VS_SCRATCH_GAP_MAP_2026-05-30.md`) and six-layer synthesis (`LEXLAW_NEXT_FINAL_SYNTHESIS_post_review.md`) are NOT in this repo (they live in the Cowork analytical loop, per master plan F.2.3). This re-baseline therefore anchors the primitive taxonomy on the IN-REPO fold docs (`WHEREAS_FOLD_master_plan.md` Phases 1-5 + `WHEREAS_PREFOLD_GATE_CHECKLIST.md`) reconciled against the actual code. Where the original gap map would add finer primitives, that is flagged. Supplying the two source docs would let a follow-up tighten the reconciliation.

## Evidence base (what actually exists)
- Tables (21, from schema.ts + migrations 0000-0003): users, user_preferences, telemetry_events, matters, matter_materials, documents, versions, document_outlines, document_references, jobs, templates, template_versions, template_variable_schemas, information_requests, information_request_items, review_sessions, feedback, feedback_manual_selections, feedback_evaluations, locked_decisions, adopt_ledger.
- Routers (13): auth, job, matter, document(+document4a), version, materials, reference, settings, contextPipeline, template, informationRequest, outline, reviewSession.
- Client pages: LoginPage, MatterDashboard, MatterDetail, DocumentDetail, InformationRequestPage, TemplatesPage, SettingsPage, UploadFormatPage. Components: AppShell, AuthGuard, ContextPreviewPanel, MaterialsDrawer, ReviewPane.
- Ownership: every core table carries `userId char(36) NOT NULL` (FK users.id); reads filter by userId through the Zod Wall. Single seeded user (kelly). Auth is now real (G1): iron-session cookie, bcrypt, AuthGuard → /login.

## 1. Current-state map (layer / primitive → status, with evidence)

Legend: BUILT = present and functional against the fold target; PARTIAL = a usable piece exists but short of the fold target; NOT-BUILT = absent.

### Production-readiness foundation (Phase 1)
| Primitive | Status | Evidence / gap |
| :-- | :-- | :-- |
| Authentication (real login) | PARTIAL | BUILT: iron-session + bcrypt + AuthGuard; bypass off (G1). GAP: single account; no per-user multi-account model. |
| Owner/user key on core objects | PARTIAL | `userId NOT NULL` + userId-filtered reads exist on all tables. GAP vs FOLD-AUTH-1: key is NOT-NULL (not nullable/backfilled), ownership not modeled first-class, no private-by-default sharing layer; "add 2nd attorney without migration" not satisfied (NOT NULL + no sharing relationship). |
| Tier-name disambiguation | NOT-BUILT | COLLISION CONFIRMED: `context/pipeline.ts` uses "Tier 1/2/3" for context-window priority (pinned/sibling/recency); `reviewerPrompts.ts:48` uses `source_of_truth_tier` for authority. Same word, two senses. FOLD-TIER-1 rename not done. |
| Audit as first-class Matter Record | NOT-BUILT | Only `telemetry_events` (operational telemetry) exists — not a per-matter immutable record of what each model said / adopted / rejected / locked / sent / verified. |
| Privilege-egress posture + context preview | PARTIAL | `ContextPreviewPanel` + `contextPipeline` assemble/preview a context packet. GAP: no per-matter/per-provider egress category control; no provider retention/training posture; no pre-send preview gate before a newly toggled lane receives matter content. |
| 14-object persistence schema | PARTIAL | See §2 — ~9 of the spine objects exist; Source/Provision/Package/OpenItem/LibraryEntry/JurisdictionRule/SendabilityRule/AuditEvent NOT-BUILT. Retention/deletion/client-file-return + DR/backup posture undocumented. |

### Layer 1 — Matter-State Engine (Phase 2)
| Primitive | Status | Evidence / gap |
| :-- | :-- | :-- |
| Locked decisions | BUILT | `locked_decisions` (migration 0002); decline-&-lock + lock-on-adopt; injected into reviewer prompt. Live-verified (6C, CAL-7B F2). |
| Cumulative adopt ledger | BUILT | `adopt_ledger` (migration 0003); adopted text + survival status; "Previously Adopted" injection. Live-verified (7C, CAL-7B F3). |
| Advisory evaluator (cross-reviewer) | BUILT (advisory) | `feedback_evaluations`; dispositions; no auto-decision. Live-verified (5D, CAL-7B F4). |
| Source-of-truth tiers (authority) | NOT-BUILT | `source_of_truth_tier` named in a prompt but no Source object, no tiering act, no operative/current-draft/counterparty/superseded model. |
| Disposition history (unified) | PARTIAL | `feedback_manual_selections` records positive adopt selections per iteration; not a full disposition lifecycle (considered/declined/deferred) beyond locked_decisions. |
| Open-item registry | NOT-BUILT | No OpenItem object/registry; "unresolved" exists only implicitly via adopt_ledger status. |
| Matter-memory injection service | PARTIAL | Locked decisions + adopt ledger ARE injected into reviewer prompts; assembleContext injects materials/siblings. GAP: no single unified "current matter state" injected into EVERY model call (the no-cold-reviews precondition); evaluator/sendability/drafter not all fed one coherent state. |
| Shared-context conversation substrate | NOT-BUILT | No "everyone up to speed" assembled package per toggled-on lane. |
| Template registry + cross-matter gate | PARTIAL | `templates`/`template_versions`/`template_variable_schemas` exist (document templates). GAP: not the MM-8 reusable-template + cross-matter invocation gate with anti-contamination controls. |
| Five explicit acts | PARTIAL | (1) Lock = BUILT. (2) Tier a source = NOT-BUILT. (3) Disposition = PARTIAL (selection exists; not a first-class confirmable act). (4) Send = PARTIAL (advisory sendability only; not a deliberate send commitment/gate). (5) Matter identity anchor = PARTIAL (MatterDetail shows identity; not an always-visible anti-wrong-matter anchor). |
| Matter-state dashboard | NOT-BUILT | No inspectable dashboard (state summary / source-authority / decision log / open-items / sendability status / model-context-packet preview as one surface). ContextPreviewPanel is a partial piece. |

### Layer 0 + spec-novel (Phase 3)
| Primitive | Status | Evidence / gap |
| :-- | :-- | :-- |
| Layer 0 intake/analysis (non-document closure) | NOT-BUILT | No analysis-first front end; matters open into drafting. ("intake" hits are the matter-phase enum only.) |
| Conflicts-at-intake | NOT-BUILT | No parties/related/adverse/existing-matter lookup. Ethics-mandatory gap (G8). |
| Practice knowledge base | NOT-BUILT | No LibraryEntry/practice-memo repository, currency/privilege metadata, retrieval/surfacing. |
| Shared-context multi-model orchestration | PARTIAL | Multi-reviewer toggle (MR-CAL-5B) + advisory evaluator exist. GAP: per-matter model toggle, shared-context conversation, constrained convergent bulk-confirm, divergent per-item forcing. |
| Drafting/audience primitives (LDD, provenance, package, audience split/leak) | NOT-BUILT | Drafting + regeneration exist (documents4a); LDD diff, provision provenance, package bundle/closure, audience format/tone split, audience-leak filter NOT-BUILT. |
| Sendability hard gate (block/warn/pass) | PARTIAL | Advisory classifier BUILT (8C, read-only query). GAP: deterministic block/warn/pass gate (wrong-matter, stale baseline, missing signer, unverified citation) NOT-BUILT — by design (advisory only today). |

### Practice-management spine + integrations (Phases 4-5)
| Primitive | Status | Evidence |
| :-- | :-- | :-- |
| Deadline/tickler engine | NOT-BUILT | No deadline/tickler model (1031, contingencies, closing/recording, trust funding, filings). |
| PDF ingestion + extraction (OCR + parsers) | NOT-BUILT | Upload & Format exists for text; no PDF→OCR→document-type parsers. |
| Party/entity/contact model (cross-matter identity) | NOT-BUILT | No party/entity model (underpins conflicts + persistent reference). |
| Cross-matter portfolio/attention view | NOT-BUILT | MatterDashboard lists matters; no managing-attorney portfolio/attention view. |
| External integrations (Gmail/Box/Drive/DocuSign/calendar) | NOT-BUILT | None present. |

## 2. 14-object persistence reconciliation (FOLD-PERSIST-1)
Existing spine objects (BUILT): matters, documents, versions, matter_materials, review_sessions, feedback, feedback_manual_selections, feedback_evaluations, locked_decisions, adopt_ledger, templates(+versions/variable_schemas), information_requests(+items), document_outlines, document_references, jobs.
Fold-novel objects (NOT-BUILT): **Source** (tiered source-of-truth), **Provision** (provision provenance), **Package** (bundle/closure), **OpenItem** (open-item registry), **LibraryEntry** (KB), **JurisdictionRule**, **SendabilityRule** (deterministic gate rules), **AuditEvent** (audit-as-Matter-Record). Cross-cutting NOT-DOCUMENTED: retention/deletion/client-file-return policy; DR/backup posture for the matter-state spine.

## 3. Build cards — NOT-BUILT primitives (Phase 1-2 foundation, full cards)

Each card: input schema / stored state / trigger / deterministic-vs-model / output / UI affordance / audit log / override path.

### BC-1 Owner-key model (FOLD-AUTH-1)
- Input: existing userId on core tables; new-account creation input (username, displayName, password).
- Stored state: nullable `ownerUserId` on all core objects (backfilled to operator); per-user accounts; (latent) sharing-grant relation addable later.
- Trigger: any read/write — filter by current user; account-add event.
- Deterministic vs model: fully deterministic (no model).
- Output: per-user-scoped data; private-by-default access.
- UI: login (exists); account management minimal.
- Audit: account create / login / access-denied events → AuditEvent.
- Override: operator can grant access later (sharing layer); not "owner = only viewer".

### BC-2 Source object + source-of-truth tiers (FOLD-TIER-1 + FOLD-L1-1)
- Input: a document/material entering a matter + attorney-set authority tier.
- Stored state: `Source` rows with `source_authority_tier` (operative / current-draft / counterparty / superseded …), provenance, currency.
- Trigger: source ingress; the "tier a source" explicit act.
- Deterministic vs model: tier is attorney-set (deterministic); currency checks may be model-assisted (advisory).
- Output: queryable operative baseline; feeds sendability + injection.
- UI: tiering control at source entry; dashboard source-authority panel.
- Audit: tier-set / re-tier events → AuditEvent.
- Override: attorney re-tiers; supersede chain preserved.

### BC-3 Open-item registry (FOLD-L1-1)
- Input: an unresolved item (from review, intake, or attorney).
- Stored state: `OpenItem` (matterId, summary, status active/resolved, sourceRef, blocker?).
- Trigger: item raised / dispositioned / resolved.
- Deterministic vs model: status deterministic; surfacing may be model-suggested.
- Output: open-items/blockers list; feeds sendability + dashboard.
- UI: open-items panel on the dashboard.
- Audit: open/resolve transitions → AuditEvent.
- Override: attorney resolves/reopens.

### BC-4 Unified matter-memory injection (FOLD-L1-2)
- Input: matterId + the assembled matter state (identity, operative source, locked decisions, adopted, open items, source currency, sendability).
- Stored state: none new (assembles existing); a state-assembler service.
- Trigger: EVERY model call (reviewer/evaluator/drafter/sendability/intake).
- Deterministic vs model: deterministic assembly; consumed by models.
- Output: a current-matter-state packet injected into every dispatch (no cold reviews).
- UI: model-context-packet preview (extends ContextPreviewPanel).
- Audit: what state was injected per call → AuditEvent.
- Override: n/a (precondition, not a decision).

### BC-5 Five explicit acts + matter-state dashboard (FOLD-L1-5)
- Input: explicit attorney commitment for lock / tier / disposition / send / matter-identity.
- Stored state: reuse locked_decisions (lock), Source tier (tier), disposition history (disposition), send/AuditEvent (send), matter anchor (identity).
- Trigger: deliberate confirmable UI act (never inferred from conversation).
- Deterministic vs model: deterministic commitments.
- Output: visible state surfaces; the inspectable dashboard.
- UI: the five as explicit controls + dashboard (summary/source-authority/decision-log/open-items/sendability/context-packet).
- Audit: each act → AuditEvent.
- Override: each act is editable/reversible by the attorney with an audit trail.

### BC-6 Audit-as-Matter-Record + egress posture (FOLD-GOV-1)
- Input: every model interaction + decision + send + verification.
- Stored state: `AuditEvent` (immutable, per-matter); per-matter/provider egress category settings.
- Trigger: any model call, adopt/reject/lock/send/withhold, authority verification.
- Deterministic vs model: deterministic record; model-output governance enforcement (tier + confidence + verification before pass).
- Output: immutable matter record; egress control + pre-send context preview.
- UI: matter record view; egress settings; pre-send preview.
- Audit: is the audit log itself.
- Override: model-only unverified claims cannot clear the gate.

## 4. Build cards — Phase 3-5 NOT-BUILT primitives (abbreviated; full card at each engagement's Phase-A)
- **Layer 0 intake/analysis (FOLD-L0-1):** analysis-first closure on a locked plan; Claude single-lane default; plan-only closure exempt from outbound sendability.
- **Conflicts-at-intake (G8, in FOLD-L0-1):** parties/related/adverse/existing-matter lookup → warn → attorney disposition; RPC-mandatory.
- **Knowledge base (FOLD-KB-1):** LibraryEntry + practice memos; currency/privilege/abstraction/jurisdiction metadata; surface-not-auto-use; private-by-default.
- **Multi-model orchestration (FOLD-ORCH-1):** per-matter toggle; shared-context; synthesis proposed-not-applied; convergent scroll-acknowledge; divergent per-item.
- **Drafting/audience (FOLD-DRAFT-1):** LDD diff + key-term dictionaries; Provision provenance; Package bundle/closure; audience format/tone split; audience-leak filter.
- **Sendability hard gate (FOLD-SEND-1):** SendabilityRule-driven block/warn/pass; deterministic blocks; attorney override recorded.
- **PM spine (FOLD-PM-1..4):** deadline/tickler; PDF ingestion+OCR+parsers; party/entity model; portfolio view.
- **Integrations (FOLD-INTEG-1):** Gmail/Box/Drive/DocuSign/calendar — each a new external contract + egress surface.

## 5. Summary
- **BUILT (fold-relevant):** locked decisions, adopt ledger, advisory evaluator, multi-reviewer toggle, native-card display, advisory sendability, real auth (single-account), row-level userId scoping, document templates, materials, drafting/regeneration spine.
- **PARTIAL:** owner-key/multi-account model, matter-memory injection (only locks+ledger), disposition history, template/cross-matter gate, the five acts, egress/context-preview, multi-model orchestration, sendability (advisory not hard).
- **NOT-BUILT:** tier-name disambiguation, source-of-truth tiers/Source object, open-item registry, shared-context substrate, matter-state dashboard, audit-as-record, Layer 0 intake, conflicts, knowledge base, drafting/audience primitives, sendability hard gate, deadline/tickler, PDF ingestion, party/entity model, portfolio view, integrations; plus the 8 fold-novel persistence objects and retention/DR posture.
- **Confirmed reviewer/operator-relevant facts:** the tier-name collision is real (pipeline.ts vs reviewerPrompts.ts) — FOLD-TIER-1 is a genuine prerequisite to Layer-1 schema work; ownership is NOT-NULL userId (not the nullable owner-key the fold wants).

## 6. §3.1 FIRE — halt before Phase 1
FOLD-REBASELINE-1 is a FIRE engagement. This map is the design artifact; per the protocol it HALTS for external triad review (independent GPT + Claude) before any Phase-1 implementation (FOLD-AUTH-1 etc.). The investigation itself was read-only. Recommended manifest for that review: this map + WHEREAS_FOLD_master_plan.md + WHEREAS_PREFOLD_GATE_CHECKLIST.md + CLAUDE.md + (if available) the original gap map/synthesis.

## 7. Disposition
FOLD-REBASELINE-1 investigation complete; map verified against code. Recommend: (1) supply the original gap map/synthesis to tighten reconciliation (optional); (2) external triad review of this map; (3) then FOLD-AUTH-1 (Phase 1, gate G3) as the first implementation engagement. No code was changed.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
