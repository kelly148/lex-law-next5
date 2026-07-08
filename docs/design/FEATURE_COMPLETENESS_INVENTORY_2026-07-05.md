# Feature-completeness inventory — what exists but doesn't work, what's dark, what's not built

**Cowork, 2026-07-05 evening. Evidence classes marked: [LIVE] = observed on prod tonight (build ea740d5); [CODE] = confirmed by code inspection of origin/main; [RECORD] = from STATE.md / close-outs, not independently re-verified. Companion docs: `UI_COMPREHENSIVE_REVIEW_2026-07-05.md`, `OVERNIGHT_BATCH_2026-07-06_dispatch.md`, `docs/UAT_FIX_LIST_2026-07-05.md`.**

## Tier 1 — visible in the UI but CANNOT currently succeed (the "dead buttons")

| Surface / control | What happens | Why | Fix queue |
|---|---|---|---|
| Templates → **Activate** | Silent failure (HTTP 412, nothing rendered) [LIVE] | Activation requires a confirmed variable schema; the schema author/confirm step has **no UI anywhere** [CODE] | FL-17a → overnight item 4 |
| Template-mode document → **Extract Variables**, **Variables tab**, populate/render/detach | Extract fails silently (412) [LIVE]; Variables tab permanently empty; the whole extract→populate→render UI is unreachable | `document.create` hardcodes `templateVersionId: null`; no template picker, no bind procedure [CODE] | FL-17b → overnight item 4 |
| New Document → **"Template-based" radio** | Creates a document that can never draft (see above) [LIVE] | Same binding gap | FL-17b; until fixed, badge "not yet wired" |
| Diagnostics → **"8 possibly-stuck session(s)"** | Looks like a link; not clickable; no way to clear a stuck session from the UI [LIVE] | Reaper not active (`JOB_REAPER_ENABLED` off [RECORD]); no manual abandon surface. Stuck `active` sessions block the next review create — known reviewer-reliability carryforward | FL-12 + G7; reaper flip is an operator decision |
| Settings → **Conflict clearance enforcement** section | Invisible — you cannot find the on/off you asked for [LIVE] | Deliberately self-dark while `CONFLICT_GATE_ENABLED` is off (anti-silent-off design) [CODE] | FL-19/S13: quiet the conflicts UI + optionally show the section in its off state |
| Overview → **Add** button | Appears dead until a title is typed (40% opacity, no hint); failures are silent [LIVE] | Disabled-until-input + unrendered mutation error [CODE] | FL-16/S15 + G9 |
| Review cards → **"BLOCKER"** tier label | Says blocker; blocks nothing (advisory posture) [LIVE, prior UAT] | QA-5: warn-only except wrong_matter_id | FL-5 → overnight item 5 (label gloss; semantics untouched) |
| Matter page → **party management** | No visible way to add a second client [LIVE] | Party model exists server-side (`PARTY_MODEL_ENABLED`, DOC-CLIENT-TARGET-1 bindings) [CODE]; no management UI | S16 interim Add-client button; full parties card in C.4–C.6 |

## Tier 2 — fully built, deliberately dark or partial (activation = a named operator step)

| Feature | State | Activation path |
|---|---|---|
| **Title exam module** (T1–T10: lanes, reconciler, memo, hat gate, Express ports, tRPC surface) | Built + live-wired, flag-dark [CODE/RECORD]; migrations 0054/0055 already on prod; no nav entry tonight [LIVE] | Flip `TITLE_EXAM_ENABLED` → first operator-driven live exam on a synthetic matter (Pattern-16). Out-of-band items: xAI ZDR (Grok consults), malpractice-carrier confirmation |
| **Async reviewer trio** (`JOB_DISPATCHER` / `REVIEWER_ASYNC` / `JOB_REAPER`) | Built; preflight GO-WITH-WATCH [RECORD]; today's review ran async-style display and behaved | Formal flag flips + watch items — parked operator decision |
| **Sendability gate enforcement** (`SENDABILITY_GATE_ENABLED`) | Advisory pre-flight visible [LIVE]; enforcement in shadow mode, cleared by false-positive check (0 wrong_matter_id hits) [RECORD] | Enforce decision — operator |
| **D3 deed sign-off enforce** (`D3_SIGNOFF_MODE`) | `observe` on prod [RECORD] | Your A.6 runbook: flip to `enforce` + 5 real deeds → unlocks C.4–C.6 |
| **Document-type extraction panel** (FOLD-PM-2: title-commitment/deed/survey/settlement parsers) | Built, default OFF [RECORD]; migration 0037 applied. Materials "extracted" tag tonight is the base text pipeline, not this panel | Flip `DOCUMENT_EXTRACTION_ENABLED` — cheap win worth testing |
| **Conflicts gate machinery** (posture-aware gate + Settings control + override attestations) | Built end-to-end; OFF on prod [LIVE-verified tonight] | Stage-2/client-facing decision; stays off for Stage-1 per 7/5 ruling |
| **Copilot Increment A extras** | Copilot surface live [LIVE]; grounded chat operating (egress events show chat_primary/chat_panel) | Multipart file-upload endpoint + attachment chips were flagged "light follow-ups, not blocking" [RECORD] — not built; drag-drop-into-chat ruling (7/5) makes this the natural vehicle |
| **Reviewer tuning flags** (`REVIEWER_LEAN_CONTRACT_ENABLED`=false per your report tonight, `REVIEWER_LATENCY_TUNING`, `GPT5_REASONING_CAP`, `DRAFT_STREAMING`, `ASYNC_DRAFT_DISPATCH`, `MASTER_*`, `PROMPT_COMPOSITION`, `KB_BACKBONE`, `LANDING_AT_ROOT`) | Config-class flags; state lives in the Railway env [RECORD only — not re-verified] | No action needed; listed for completeness. Gemini lane separately dormant by policy (Settings toggle contradiction = S18) |

## Tier 3 — named in governance but NOT built (the true missing queue)

1. **C.4–C.6 conversational matter page** — design triad-adopted (C1-CONV-DESIGN v1.1), mockup + requirements trace + operator rulings ready; **gated on A.6** (D3 enforce + 5 real deeds). The biggest item, and the gate is on your side.
2. **Promote-to-draft from conversation** — deliberately excluded; its own future §3.1 FIRE.
3. **Copilot Increment B review panel** — `CHAT_REVIEW_PANEL_ENABLED` flag reserved, feature unbuilt.
4. **Native feedback-card runtime** — only additive *display* shipped (MR-CAL-4C); legacy JSON contract still the runtime.
5. **ChatSurface → CopilotPage consolidation / one composer substrate** (NC-C1-2, NC-C1-4) — two chat surfaces + two dispatch paths still coexist; must collapse before/with C.4.
6. **Title-exam Phase B** — NC-6 Phase-2 surfaces → tests → August retrospective; unapproved.
7. **Primary-source research lane** (LIS/eCFR from conversation) — new egress scope surfaced by the Ricky-thread trace; needs its own engagement + triad review.
8. **Client-level standing configuration layer** (per-client master instructions inside Whereas) — surfaced by the master-instructions-thread trace; no design yet.
9. **Config/client-scope decision locks** — locks are document-scoped only [CODE]; the "don't re-raise what we decided on purpose" mechanic doesn't yet cover config decisions.
10. **Info-request DOCX export** — matrix + plain-text export built; the docx pipeline was explicitly deferred ("Phase 6") [CODE comment].
11. **True offline calibration regression suite** + per-matter granularity (Option 2) — long-standing deferred items [RECORD].

## Reading of the whole board

Core functionality (matter → materials → iterative draft → multi-lane review → disposition → export) is real and works — tonight's walk plus today's UAT confirm it. The dead-button problem is concentrated in ONE feature (the template pipeline, FL-17) plus a handful of affordance gaps; the dark-feature inventory is mostly deliberate staging with named activation steps, of which four are cheap and waiting on you: async trio flips, `DOCUMENT_EXTRACTION_ENABLED`, D3 enforce (which also unlocks the conversational build), and title-exam first-run. The genuinely unbuilt queue is Tier 3, and items 1–5 all converge on the same destination: the conversational matter page with one composer, one review path, and promote-to-draft as the final gated piece.
