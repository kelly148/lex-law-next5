# FLAG_FLIP_RUNBOOK.md — production feature-flag flip runbook

**GOV-MECH-1 Part B (FLAG-FLIP-RUNBOOK-1), closes disposition A2.** A prod flag flip is a behavior change with no PR, no CI, and no review — config drift already caused the D3-enforce incident, and `CHAT_UI_1_ENABLED` flipped on prod would hit deliberately-unapplied migrations. This runbook makes every flip a checklisted, evidence-backed, revertible step.

> **HONESTY LINE (read this).** The test suite for this runbook is **coverage-maintaining, not correctness-maintaining**. It proves every flag in `src/server/config/featureFlags.ts` has a complete row here — it does **NOT** prove any row's *content* is right. **Row content is operator-verified at each flip** (especially the migration IDs and partner flags). Treat the table as the checklist scaffold, not an oracle.

---

## Per-flip checklist (run for EVERY prod flag flip)

1. **Migration precondition verified against the PROD schema.** For a flag whose row lists required migrations, confirm those migrations are actually applied in prod BEFORE flipping. **Record the evidence** (red-team item 6): *what* you queried (the exact command/source — e.g. `SHOW TABLES LIKE '…'` / `SELECT … FROM information_schema`), *when*, and the *expected* migration IDs vs. the *actual* observed schema. **RULE: do not flip on a mismatch** — a flag flipped ahead of its migration fails the write (best case) or corrupts behavior (worst case).
2. **Partner-flag check.** Confirm every partner flag in the row is in the required state (some flags are inert or unsafe unless a companion flag / allowlist is also set — e.g. `REVIEWER_ASYNC_ENABLED` wants `JOB_REAPER_ENABLED`; `CHAT_REVIEW_PANEL_ENABLED` needs `CHAT_COPILOT_ENABLED` **and** `GROUNDED_CHAT_PROVIDERS` populated).
3. **Post-flip smoke step named + run.** Name the concrete check from the row and run it immediately after the flip.
4. **Revert step named.** The flip is a single env change; the revert is setting it back (`unset` or `=false`, or the prior `D3_SIGNOFF_MODE` value). Confirm the revert is a pure config change with no data cleanup required (if a flip WRITES rows, note whether a revert leaves them — usually harmless/dormant).
5. **STATE.md line recorded.** One dated line: which flag, old→new value, migration evidence, smoke result.

**Prod-schema verification evidence is mandatory (step 1).** No flip proceeds without the recorded command/timestamp/expected-vs-actual. On any mismatch: **STOP, do not flip.**

---

## HARD BLOCKS (do not flip until separately resolved)

<!-- HARD-BLOCK-START -->
- **`CHAT_UI_1_ENABLED` — HARD BLOCK.** Do **NOT** flip on prod until migrations **0028** (`chat_ui_1_posture_provenance`) and **0029** (`chat_ui_1_provenance_subject`) are separately resolved/applied to prod (red-team item 6). Flipping it before those land hits deliberately-unapplied migrations.
<!-- HARD-BLOCK-END -->

---

## Per-flag precondition table

Every flag in `featureFlags.ts` has exactly one row. `none` is a valid, meaningful cell. Migration IDs are best-known from the flag's own doc comment + the migration filenames; **verify against prod at flip time** (honesty line). Rows are enclosed by the markers the coverage test parses.

<!-- FLAG-TABLE-START -->
| Flag | Required migrations (verify vs prod) | Partner flags / allowlist | Booby-traps | Post-flip smoke | Revert |
| --- | --- | --- | --- | --- | --- |
| `MULTI_REVIEWER_ENABLED` | none | `EVALUATOR_ENABLED` (evaluator dispatch, MR-CAL-5C — keep OFF until contract complete) | enabling multi-select must not fire a placeholder evaluator LLM call | create a review session selecting 2 reviewers; both lanes run | set false → single-reviewer |
| `EVALUATOR_ENABLED` | none | `MULTI_REVIEWER_ENABLED` | evaluator output contract (5C) is incomplete; enabling fires an inert/placeholder path | confirm evaluator disposition persists (only after 5C) | set false |
| `REVIEWER_ASYNC_ENABLED` | none (0030 reviewer_lanes already applied) | `JOB_REAPER_ENABLED` (recover in-flight on restart), `JOB_DISPATCHER_ENABLED` (durable lane) | in-process fire-and-forget loses in-flight LLM on restart w/o reaper | create review; session returns immediately, feedback lands via poll | set false → inline sequential |
| `JOB_DISPATCHER_ENABLED` | none | `JOB_REAPER_ENABLED` (Component B) | registering the handler changes async-review claim semantics | run a reviewer job; confirm it is claimed+run to completion as a DB row | set false → inline |
| `JOB_REAPER_ENABLED` | none | `JOB_DISPATCHER_ENABLED` / `REVIEWER_ASYNC_ENABLED` | reaper terminalizes stale 'running' jobs — confirm heartbeat window | orphan a job (or wait); confirm reaper terminalizes it | set false |
| `SENDABILITY_GATE_ENABLED` | 0018 fold_send_1_export_safety | none | flip is operator-gated on shadow-mode false-positive data (prod-DB analysis) | export a wrong-matter draft; confirm block + override path | set false → shadow-only |
| `D3_SIGNOFF_MODE` | 0053 d3_signoff | `DEED_RECORDABILITY_ENABLED` (when OFF, D3 export is suppressed via resolveDeedExportD3Mode) | THREE-STATE (off/observe/enforce); `enforce` 409s deed export until sign-off; recordability OFF hides it | export a deed; observe logs / enforce 409s per mode | set back to prior value (`off`/`observe`) |
| `CONFLICT_GATE_ENABLED` | 0020 party_confirmation, 0025 gate_override | Inc 3c confirm-UX + Inc 5 client-party migration LIVE first | FAIL-CLOSED ethics gate; flipping before any matter has a CONFIRMED client party hard-blocks every matter | advance a cleared matter to drafting; confirm proceeds only on CLEARED | set false |
| `CONFLICT_GATE_FORCE_ON` | 0047 posture_policy, 0048 matter_posture | independent of `CONFLICT_GATE_ENABLED` | admin FLOOR — only raises strictness, never lowers; DORMANT in Inc 1 (nothing consumes the resolver yet) | confirm resolver forces ENFORCED regardless of firm policy | set false |
| `DEED_GATE_ENABLED` | 0049 deed_1_deed_gate | none | FAIL-CLOSED + KB-mandatory; with no locality KB seeded, NO deed reaches recordable (by design) | open a deed; confirm three-gate evaluator surfaces | set false → dormant |
| `DEED_DRAFT_AGENT_ENABLED` | 0052 deed_provenance (supports LIVE-9 export sanction) | `DEED_RECORDABILITY_ENABLED` (recordability surface), `CONFLICT_GATE_*` (intake gate) | THIS is the deed-express-intake lever (/deed page + nav + quickDeed procedures); not client-facing until FOLD-L0-1 live-verified | open /deed; generate a gift deed; export .docx | set false → dormant |
| `DEED_RECORDABILITY_ENABLED` | none (no schema/migration) | `DEED_GATE_ENABLED`, `D3_SIGNOFF_MODE` (each panel self-gates when ON) | OFF suppresses the recordability surface AND the D3 export block; LIVE-9 DEED_EXPORT_BLOCKED stays on regardless | ON: deed page shows recording strip + D3 export gate applies | set false → Stage-1 document-first |
| `KB_BACKBONE_ENABLED` | 0050 kb_backbone_p2_inc1_memo_scope_metadata (0038/0039 authority_source foundation) | none | Inc 1 is CAPTURE+SCHEMA only; never retrieves/injects KB into an LLM call | exercise kbBackbone capture; confirm authority_source link persists | set false → dormant |
| `DEADLINE_ENGINE_ENABLED` | 0021 deadline_engine, 0022 deadline_audit_events | none | requires attorney verification of ALL seeded rule legal content; each 1031 rule stays disabled until G-B fixtures pass | load a matter; confirm ticklers materialize; NO 1031 rule fires | set false → dormant |
| `PROMPT_COMPOSITION_ENABLED` | 0026 instr_1a0_prompt_snapshots | none | only changes T&E + Anthropic draft path; both paths snapshotted | draft a T&E matter on Anthropic; confirm master/claude/te used + snapshot | set false → legacy prompts |
| `REVIEWER_LATENCY_TUNING_ENABLED` | 0027 reviewer_latency_0_tokens_reasoning | inert vs `GPT5_REASONING_CAP_ENABLED` (both set reasoning_effort) | only the OpenAI gpt-5 reviewer lane changes; drafter/other lanes untouched | run a gpt-5 review; confirm reasoning_effort/service_tier sent | set false → no knobs |
| `REVIEWER_LEAN_CONTRACT_ENABLED` | none | none | reviewer emits a single lean card, no prose memo; parser unchanged (lenient superset) | run a review; confirm lean card parses + displays | set false → full contract |
| `LANDING_AT_ROOT_ENABLED` | none | none | GET / handler runs before express.static; authed users still get the SPA | anonymous GET / → landing.html; authed GET / → SPA | set false → SPA at / |
| `CHAT_UI_1_ENABLED` | **0028 + 0029 — HARD BLOCK (see above)** | `CHAT_DISPATCH_ENABLED`, `MASTER_CHAT_ENABLED` (later increments) | **DO NOT FLIP until 0028/0029 resolved** (red-team item 6); Gate-0-blocked reviewer surface | (blocked) once unblocked: conversation entry point renders | set false → surface absent |
| `CHAT_DISPATCH_ENABLED` | none | `CHAT_UI_1_ENABLED` (surface) | routes chat turn through the LLM chokepoint; injects NO master (that is CHAT-INJ-1) | submitTurn returns model text | set false → PRECONDITION_FAILED |
| `MASTER_LAWFIRM_ENABLED` | 0031 engagement_capacity, 0032 capacity_election_marker | independent of chat/outline masters | drafting master layering + suppresses per-PA profile; Anthropic drafter only | draft on Anthropic non-T&E; confirm master/claude/lawfirm | set false → legacy |
| `MASTER_CHAT_ENABLED` | 0031, 0032 | independent of `MASTER_LAWFIRM_ENABLED` | STRICTER than drafting; never defaults Law Firm, never injects Title; not client-facing until FOLD-L0-1 | chat on a cleared law_firm matter; confirm representational master | set false → neutral chat prompt |
| `MASTER_OUTLINE_ENABLED` | 0031, 0032 | independent of the other two masters | outline role only; NEVER title; conflict gate must be CLEARED | outline on a cleared law_firm matter; confirm master applied | set false → legacy outline |
| `CHAT_COPILOT_ENABLED` | 0033 conversations (0034 egress, 0035 attachments) | `GROUNDED_CHAT_PROVIDERS` populated for grounding | layered above chat flags; nothing client-facing until FOLD-L0-1 | persist a conversation; confirm windowed history restores | set false → dormant |
| `CHAT_REVIEW_PANEL_ENABLED` | 0040 chat_copilot_2_incb_review_panel | `CHAT_COPILOT_ENABLED` **and** `GROUNDED_CHAT_PROVIDERS` populated | structurally dark w/o providers; internal work product only, no send | request a panel; confirm ADOPT/REJECT dispositions | set false → PRECONDITION_FAILED |
| `AUTO_REVIEW_LOOP_ENABLED` | none (0051 tables gated separately by durable-records flag) | `EXPRESS_DURABLE_RECORDS_ENABLED` (durable ledger) | E8 ship-gate: enabling for recordable instruments needs zero-false-negative + operator approval | run the Express review loop; confirm locus-gate auto-adopt discipline | set false → dormant |
| `EXPRESS_DURABLE_RECORDS_ENABLED` | 0051 express_durable_records_e4b_e7b | `AUTO_REVIEW_LOOP_ENABLED` (inert without it) | flipping before 0051 lands fails the write (fail-visible, never silent drop) | complete a loop run; confirm ledger + attestation persist | set false → in-response-only |
| `REVIEWER_NATIVE_STRUCTURED_OUTPUT_ENABLED` | none | none | only after live-compliance validation; fail-open (RPR-1..5 nets remain) | run a review on a capable model; confirm native schema request | set false → json_object |
| `MATTER_DELIVERABLE_ENABLED` | 0036 fold_pm_4_matter_deliverable | none | /overview redirects when OFF | open /overview; CRUD a deliverable | set false → redirect |
| `SUPERVISION_VIEW_ENABLED` | none | log populated only when `CHAT_COPILOT_ENABLED` ON | read-only; view is empty on prod (copilot OFF) | open /supervision; confirm read-only egress log renders | set false → redirect |
| `DOCUMENT_EXTRACTION_ENABLED` | 0037 fold_pm_2_material_extraction | none | deterministic + attorney-facing only; low-confidence fields withheld | run extraction on a material; confirm panel + withholding | set false → PRECONDITION_FAILED |
| `PARTY_MODEL_ENABLED` | 0044 fold_pm_3_party_model | none | within-matter only; no cross-matter identity resolution | CRUD a matter_entity; confirm partyRef within matter | set false → PRECONDITION_FAILED |
| `NOTIFICATIONS_ENABLED` | 0045 fold_notify_1_notifications | `NOTIFY_SOUND_ENABLED` (sound rides this) | STORE+READ+DISPLAY only; no producer wired (table may sit empty) | flip; confirm bell/badge render + poll runs | set false → no bell/poll |
| `NOTIFY_SOUND_ENABLED` | none | `NOTIFICATIONS_ENABLED` (moot without it) | client-only best-effort audio; per-user pref gates it | trigger a ready-notification; confirm gavel ×3 (if pref ON) | set false → no sound path |
| `ASYNC_DRAFT_DISPATCH_ENABLED` | none | `DRAFT_STREAMING_ENABLED` (streaming overlay) | in-process fire-and-forget (restart loses in-flight); bus is per-replica (single-replica prod only) | generate a draft; jobId returns immediately, draft lands via poll | set false → synchronous |
| `GPT5_REASONING_CAP_ENABLED` | none | inert vs `REVIEWER_LATENCY_TUNING_ENABLED` | truncation-insurance fallback; active full GPT reviewer only | run a gpt-5 review; confirm bounded reasoning_effort | set false |
| `REVIEWER_HEALTH_VIEW_ENABLED` | none | none | read-only aggregate; /diagnostics redirects when OFF | open /diagnostics; confirm job/session counts render | set false → redirect |
| `DRAFT_STREAMING_ENABLED` | none | `ASYNC_DRAFT_DISPATCH_ENABLED` (needed for tokens to reach the client) | delivery overlay only; durable draft unchanged; Anthropic drafter in Inc 1 | with async also ON, generate an Anthropic draft; tokens render incrementally | set false → blocking generate |
| `TITLE_EXAM_ENABLED` | 0054 title_exam_data_model + 0055 client_delivery_approval (out-of-band, NOT on the apply-prod-migrations allowlist) | none | Phase A is mocks/fixtures only — NO live provider call; escalate-only reconciler | flip; run a mocked exam; confirm memo + no send path | set false → PRECONDITION_FAILED |
<!-- FLAG-TABLE-END -->

---

*GOV-MECH-1 Part B. The coverage test (`src/server/config/__tests__/flagFlipRunbook.coverage.test.ts`) enforces: 100% flag coverage, no blank/placeholder cells, and no orphan rows (a row naming a nonexistent flag). It does not judge row correctness — see the honesty line.*
