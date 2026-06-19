/**
 * featureFlags.ts — MR-CAL-5B
 *
 * Product feature flags read from the environment. Every flag DEFAULTS OFF:
 * absence (or any value other than the exact string "true") preserves the
 * established behavior exactly. (Env-gated accessor pattern; the former
 * middleware/authBypass.ts was removed in FOLD-AUTH-1 — auth is always enforced.)
 */

/**
 * Multi-reviewer + advisory-evaluator topology (MR-CAL-5B).
 *
 * DEFAULT OFF. When off, the review workflow is single-reviewer per cycle exactly
 * as before (the MR-0G behavior): reviewSession.create rejects more than one
 * selected reviewer with MULTI_REVIEWER_DISABLED, and the UI offers single-select.
 *
 * When MULTI_REVIEWER_ENABLED is exactly "true", the attorney may select multiple
 * reviewers in one cycle. This toggle controls EXPOSURE only; it does NOT by itself
 * complete the evaluator output contract — that is MR-CAL-5C, and until then the
 * evaluator dispatch stays inert (see reviewSession.ts EVALUATOR_OUTPUT_CONTRACT_READY).
 *
 * Extension point (design:MR-CAL-5B option 2 — per-matter granularity, later):
 * add the per-matter override HERE (e.g. accept an optional context and let a
 * per-matter setting override the global default) so call sites need not change.
 */
export function isMultiReviewerEnabled(): boolean {
  return process.env['MULTI_REVIEWER_ENABLED'] === 'true';
}

/**
 * Evaluator dispatch (MR-CAL-5C). DEFAULT OFF.
 *
 * The evaluator output contract — real prompt/schema, parsing the LLM output, and
 * persisting dispositions via insertFeedbackEvaluation — is MR-CAL-5C, not 5B.
 * 5B only enables multi-reviewer SELECTION. This flag keeps the (currently
 * incomplete, telemetry-only) evaluator dispatch disabled so that enabling
 * multi-reviewer never fires a placeholder evaluator LLM call. MR-CAL-5C will
 * complete the contract and flip the default.
 */
export function isEvaluatorEnabled(): boolean {
  return process.env['EVALUATOR_ENABLED'] === 'true';
}

/**
 * Async + progressive reviewer fan-out (REVIEWER-ASYNC-FANOUT-1 Inc 1). DEFAULT OFF.
 *
 * When OFF (the default), reviewSession.create runs reviewers INLINE and SEQUENTIALLY within the
 * tRPC request and only returns after every reviewer (and the evaluator) has finished — the
 * established behavior. With a slow big-doc reviewer (e.g. GPT-5) this can block the attorney for
 * many minutes.
 *
 * When exactly "true", create FIRES the reviewer jobs concurrently in the background
 * (fire-and-forget, still via executeCanonicalMutation per R4) and returns { sessionId }
 * immediately — the operator is NEVER blocked. The frontend's existing job.poll / reviewSession.get
 * polling surfaces each reviewer's feedback progressively as it lands. The advisory evaluator (which
 * must read ALL reviewer feedback) is SKIPPED in async-mode v1 (operator decision; it is advisory-
 * only and default-OFF) — evaluator fan-in is a fast-follow increment. The background-lane timeout
 * envelope raise (so deep GPT-5 reviews survive past 300s) is a separate increment.
 *
 * v1 LIMITATION (documented, not a defect): fire-and-forget is in-process — a server restart mid-
 * review loses the in-flight LLM call (the job is left non-terminal). Moving to the DB-backed
 * dispatcher for restart-robustness is a deferred fast-follow.
 */
export function isReviewerAsyncEnabled(): boolean {
  return process.env['REVIEWER_ASYNC_ENABLED'] === 'true';
}

/**
 * Durable job dispatcher (DISPATCHER-COMPLETE-1, Gate 0 Component A). DEFAULT OFF.
 *
 * When OFF (the default), every LLM job runs INLINE in the request via executeCanonicalMutation
 * exactly as today (byte-for-byte): no handler is registered, the in-process dispatcher stays a
 * no-op, and the async-reviewer path keeps its in-process fire-and-forget behavior.
 *
 * When exactly "true", the dispatcher registers a reviewer_feedback handler and the async-reviewer
 * path leaves its job 'queued' for the dispatcher to atomically claim and run to completion (with
 * bounded retry/re-queue), so async work survives as a real, recoverable DB row instead of an
 * in-process promise. Durable retry/recovery ACROSS a restart is Component B (JOB-RECOVERY-1).
 */
export function isJobDispatcherEnabled(): boolean {
  return process.env['JOB_DISPATCHER_ENABLED'] === 'true';
}

/**
 * Crash recovery for the job system (JOB-RECOVERY-1, Gate 0 Component B). DEFAULT OFF.
 *
 * When OFF (the default), behavior is byte-for-byte unchanged: no reaper sweep runs, the
 * stuck-active-session self-heal never fires, and Component A's in-memory retry counter is used.
 * (The H3 markJobFailed guards in canonicalMutation are always present but inert on the happy path.)
 *
 * When exactly "true", a periodic reaper terminalizes 'running' jobs orphaned by a crash/restart
 * (stale heartbeat), reviewSession.create self-heals a stuck-active session so it no longer wedges
 * the next create, and the dispatcher's bounded-retry attempt count is persisted durably in
 * jobs.input (surviving a restart). No migration; no new env var beyond this flag.
 */
export function isJobReaperEnabled(): boolean {
  return process.env['JOB_REAPER_ENABLED'] === 'true';
}

/**
 * Export-safety / outbound-readiness deterministic gate (FOLD-SEND-1). DEFAULT OFF.
 *
 * When OFF (the default), the gate runs in SHADOW MODE: every evaluation is still computed + logged
 * to sendability_evaluation per category, but NOTHING is enforced — the DOCX export proceeds exactly
 * as before. When exactly "true", the gate ENFORCES at the export boundary (v1 hard-stops only
 * wrong_matter_id; other categories warn) with the recorded attorney override path. The flip to
 * enforce is operator-gated on the shadow-mode false-positive data (FOLD-SEND-1 disposition).
 */
export function isSendabilityGateEnabled(): boolean {
  return process.env['SENDABILITY_GATE_ENABLED'] === 'true';
}

/**
 * Affirmative conflict-clearance enforcement gate (R2-PRE-CONFLICT-1 Inc 3b). DEFAULT OFF.
 *
 * When OFF (the default), every conflict-sensitive transition behaves EXACTLY as it did before Inc 3b:
 * advance-to-drafting uses the legacy `hasUndispositionedBlocker` boolean, `lockPlan` uses only the
 * all-hits-dispositioned gate, and export is not conflict-gated at all. The Inc 3b enforcement wiring
 * is therefore inert when shipped OFF — a behavior-preserving merge/deploy (merge != deploy; this lets
 * Inc 3c + Inc 5 land while the gate stays dormant).
 *
 * When exactly "true", all four dispositioned transitions ENFORCE the affirmative
 * `evaluateConflictClearance` predicate: the transition proceeds only on state CLEARED, never on
 * "not BLOCKED". The four sites are advance-to-drafting (document.create), lockPlan (which is also the
 * cleared-disposition ROOT — it writes conflictsClearedForPlanning), and export/send. Activation is a
 * SINGLE reversible flag flip, gated (R2-PRE-CONFLICT-1 disposition) on the confirm-UX (Inc 3c) and the
 * retroactive client-party migration (Inc 5) being live — otherwise every matter (none has a CONFIRMED
 * client party yet) would be hard-blocked. See docs/STATE.md for the activation constraint.
 *
 * INTENTIONAL ASYMMETRY (do NOT "fix" it): the conflict gate is FAIL-CLOSED — an ethics gate must
 * never be satisfied by absence of evidence, so a missing check or an evaluation error BLOCKS. This is
 * the deliberate opposite of the FOLD-SEND-1 sendability gate's fail-to-warn posture.
 */
export function isConflictGateEnabled(): boolean {
  return process.env['CONFLICT_GATE_ENABLED'] === 'true';
}

/**
 * Conflicts-posture FORCE-ON precedence (CONFLICT-TOGGLE-1, disposition item 6). DEFAULT OFF.
 *
 * An admin FLOOR: when exactly "true", the posture resolver forces ENFORCED for every matter regardless of
 * any persisted firm posture policy — a persisted relaxation (ADVISORY) can never drop below it. When OFF
 * (the default), the resolver honors the firm policy (still default-safe → ENFORCED on missing/malformed).
 * This flag NEVER makes the gate less strict; it can only raise the floor. It is independent of
 * CONFLICT_GATE_ENABLED (which governs whether the affirmative-clearance gate enforces at the four
 * transitions at all). DORMANT in Increment 1: the posture resolver exists but nothing consumes its result
 * to change a transition yet.
 */
export function isConflictGateForceOn(): boolean {
  return process.env['CONFLICT_GATE_FORCE_ON'] === 'true';
}

/**
 * Deed recordability gate (FOLD-DEED-1, Inc 1 foundation). DEFAULT OFF.
 *
 * When OFF (the default), the deed-gate surface is entirely dormant: the deedGate procedures refuse
 * (PRECONDITION_FAILED) except the ungated isEnabled probe, nothing reads/writes the deed_gate table, and no
 * gate evaluation runs — zero new behavior. When exactly "true", the three-gate evaluator + the affirmative-
 * attorney-act recording surface. INVARIANT: the gate is FAIL-CLOSED and KB-mandatory — with no locality KB
 * seeded (the blocked VA-primer increment), NO deed ever reaches "recordable", by design. The deed_gate table
 * (migration 0049) must be applied before flipping this. This flag gates ONLY the gate; it never enables RON/
 * e-recording (a separate, decision-gated increment).
 */
export function isDeedGateEnabled(): boolean {
  return process.env['DEED_GATE_ENABLED'] === 'true';
}

/**
 * Deadline / tickler engine (FOLD-PM-1, Phase-4 head). DEFAULT OFF.
 *
 * When OFF (the default), the deadline engine is entirely dormant: the data-core tables exist but
 * nothing computes a deadline, nothing materializes ticklers, and no deadline surface renders. Inc 1
 * (data core) ships with this OFF and is therefore a behavior-preserving merge/deploy.
 *
 * When exactly "true", the deadline panels surface and the on-load tickler materialization runs. The
 * flip to ON is operator-gated (Pattern-16) AND requires attorney verification of all seeded rule legal
 * content first (CI cannot judge deadline correctness). 1031 rules carry an ADDITIONAL structural block:
 * each 1031 deadline_rule.enabled stays 0 until attorney-approved 1031-0 fixtures pass (G-B) — flipping
 * this flag never activates a 1031 rule on its own.
 *
 * INVARIANT (load-bearing): the engine SURFACES and REMINDS, it never acts. No email, no push, no
 * external calendar, no filing — no egress contract exists in the engine by design. This flag never
 * gates any outbound action because there is none.
 */
export function isDeadlineEngineEnabled(): boolean {
  return process.env['DEADLINE_ENGINE_ENABLED'] === 'true';
}

/**
 * Blob-first master-prompt composition (INSTR-1A0 / INSTRUCTIONS-LEG-1). DEFAULT OFF.
 *
 * When OFF (the default), every prompt path is byte-for-byte the established behavior —
 * the hardcoded procedure prompts plus the chokepoint's matter-state and per-PA-profile
 * injections. Zero behavior change anywhere, and the composition resolver performs ZERO
 * extra DB reads.
 *
 * When exactly "true", ONE narrow path changes: a draft_generation job, dispatched to the
 * Anthropic PRIMARY_DRAFTER_MODEL, on a matter whose practice area exact-matches T&E /
 * estate-planning, sends the verbatim `master/claude/te` asset (hash-pinned, see
 * promptAssets.ts) as the ENTIRE system block. Everything else stays legacy. Both paths
 * are snapshotted per draft job (prompt_snapshots) so the experiment is fully measured.
 */
export function isPromptCompositionEnabled(): boolean {
  return process.env['PROMPT_COMPOSITION_ENABLED'] === 'true';
}

/**
 * Reviewer-lane request-side speed tuning (REVIEWER-LATENCY-1 Step 2a). DEFAULT OFF.
 *
 * When OFF (the default), every provider request is byte-for-byte identical to today — no
 * reasoning_effort, no service_tier, nothing added to any adapter request. This is the
 * "cannot confound the drafter A/B baseline" guarantee, guard-tested per adapter.
 *
 * When exactly "true", the OpenAI reviewer lane (reviewer_feedback jobs on openai:gpt-5) sends
 * the two latency knobs resolved by resolveReviewerLatencyTuning() (config.ts): reasoning_effort
 * (default "low") and service_tier (default "priority"). DRAFTER and every non-OpenAI / non-
 * reviewer lane are untouched — the resolver returns null for them, so their requests never change.
 */
export function isReviewerLatencyTuningEnabled(): boolean {
  return process.env['REVIEWER_LATENCY_TUNING_ENABLED'] === 'true';
}

/**
 * Reviewer output-contract diet — single structured card, no prose memo
 * (REVIEWER-LATENCY-1 Step 2b). DEFAULT OFF.
 *
 * When OFF (the default), the reviewer system prompt and the emitted contract are
 * byte-for-byte identical to today: a NARRATIVE_REVIEWER_MEMO plus the full 25-field
 * STRUCTURED_FEEDBACK_CARDS array inside each legacy wrapper body (guard-tested).
 *
 * When exactly "true", the reviewer is instructed to emit, inside each wrapper body,
 * ONLY a STRUCTURED_FEEDBACK_CARDS array holding a SINGLE lean feedback-card object
 * (no prose memo): a trimmed field set plus the new governing_law field, with the
 * runtime/evaluator-owned and inert fields dropped. The active wrapper parser
 * (parseFeedbackOutput) and the card-first display path are UNCHANGED — the lean card
 * is a strict subset the lenient FeedbackCardDisplaySchema already tolerates. This is a
 * token-weight reduction to keep the gpt-5 reviewer lane from truncating; activation is
 * operator-gated and live-tested before any flip.
 */
export function isReviewerLeanContractEnabled(): boolean {
  return process.env['REVIEWER_LEAN_CONTRACT_ENABLED'] === 'true';
}

/**
 * Serve the public landing page at the bare domain for anonymous visitors (LANDING-2).
 * DEFAULT OFF.
 *
 * When OFF (the default), GET / is byte-for-byte identical to today: it falls through
 * to express.static, which serves dist/index.html (the React SPA) for every visitor.
 *
 * When exactly "true", a GET / handler (registered before express.static) checks the
 * existing iron-session cookie (getSession/extractUserId): an authenticated visitor is
 * served the SPA exactly as today (no extra clicks); an anonymous visitor is served the
 * public landing page (dist/landing.html, shipped by LANDING-1). /landing.html and every
 * other route (the SPA deep-link catch-all) are unchanged.
 */
export function isLandingAtRootEnabled(): boolean {
  return process.env['LANDING_AT_ROOT_ENABLED'] === 'true';
}

/**
 * Conversation surface — the matter-scoped chat/thread UI (CHAT-UI-1). DEFAULT OFF.
 *
 * When OFF (the default), the entire CHAT-UI-1 surface is absent: the client renders no
 * conversation entry point, the matter-scoped /chat route redirects to the matter page,
 * and every existing surface (matters, documents, review, settings) is byte-for-byte
 * unchanged. The flag reaches the client read-only via chatUi.isEnabled.
 *
 * When exactly "true", the conversation surface and its entry point render. The W0
 * scaffold is display-only (a three-zone shell skeleton); the consequence-tier confirm
 * component + posture model (W1) and the reviewer/disposition surface (Gate-0-blocked,
 * W4) land behind this same flag in later increments. Activation is operator-gated.
 */
export function isChatUi1Enabled(): boolean {
  return process.env['CHAT_UI_1_ENABLED'] === 'true';
}

/**
 * Chat→model dispatch substrate — the `chat_turn` job path (CHAT-DISPATCH-1). DEFAULT OFF.
 *
 * When OFF (the default), the `chatDispatch.submitTurn` procedure refuses with
 * PRECONDITION_FAILED and no chat turn ever reaches a model — behavior is byte-for-byte
 * unchanged everywhere (the chat composer remains the inert placeholder).
 *
 * When exactly "true", `submitTurn` routes a single chat turn through the canonical LLM
 * chokepoint (executeCanonicalMutation) as a `chat_turn` job and returns the model text.
 * The substrate injects NO master prompt (legacy composition); master-into-chat injection
 * is INSTR Phase D, separately gated on the external triad review. Activation is operator-gated.
 */
export function isChatDispatchEnabled(): boolean {
  return process.env['CHAT_DISPATCH_ENABLED'] === 'true';
}

/**
 * Drafting-time master-prompt selection (INSTR-2B-core). DEFAULT OFF.
 *
 * When OFF (the default), prompt composition is byte-for-byte unchanged from today: the
 * INSTR-1A0 TE-blob path (gated by PROMPT_COMPOSITION_ENABLED, draft + Anthropic + exact T&E
 * only, master = the entire system block) and the legacy matter-state + per-PA-profile path
 * everywhere else. No `master/claude/lawfirm` is ever composed.
 *
 * When exactly "true", drafting (draft_generation + regeneration) on the Anthropic drafter
 * selects a master LAYERED on top of matter-state + subject-scope (D-4) and SUPPRESSES the
 * per-PA instruction-profile injection (D-5): exact-match T&E keys -> master/claude/te (now
 * layered), ANY OTHER paKey including unconfirmed/NULL (and, for now, title_settlement) ->
 * master/claude/lawfirm (the operator-ratified safe default). Title routing (master/claude/title,
 * the title_settlement key) is INSTR-2B-TITLE, deferred. Non-Anthropic provider -> legacy;
 * reviewers/evaluator/extraction/formatting -> none. Activation is operator-gated.
 */
export function isMasterLawfirmEnabled(): boolean {
  return process.env['MASTER_LAWFIRM_ENABLED'] === 'true';
}

/**
 * Master-into-CHAT injection (CHAT-INJ-1, INSTR Phase D). DEFAULT OFF, fail-closed.
 *
 * INDEPENDENT of MASTER_LAWFIRM_ENABLED (drafting) — flipping the drafting master on never
 * affects chat, and vice-versa. When OFF (the default), an interactive chat turn is byte-for-byte
 * the CHAT-DISPATCH-1 substrate: the neutral chat system prompt + matter-state, NO firm master,
 * and ZERO extra reads (the conflicts/identity gate is never consulted for composition).
 *
 * When exactly "true", a chat turn receives a representational master (master/claude/lawfirm or
 * master/claude/te) ONLY when ALL hold: the principal is the supervising attorney (R6); a valid,
 * owner-authorized matter exists (R1); the matter's engagement capacity is the representational
 * law_firm seat — NEVER the title/settlement seat (R3); there is no unresolved title signal in the
 * practice area (R2); and the existing conflicts/identity gate is CLEARED for the matter (R10).
 * Chat is STRICTER than drafting: it NEVER defaults to Law Firm and NEVER injects the Title master.
 * Activation is operator-gated; not client-facing until FOLD-L0-1 is live-verified.
 */
export function isMasterChatEnabled(): boolean {
  return process.env['MASTER_CHAT_ENABLED'] === 'true';
}

/**
 * Master injection into the OUTLINE role (INSTR-2C, Phase C). DEFAULT OFF, fail-closed.
 *
 * INDEPENDENT of MASTER_LAWFIRM_ENABLED (drafting) and MASTER_CHAT_ENABLED (chat). When OFF (the
 * default), outline_generation composes byte-for-byte the legacy outline assembly (the hardcoded
 * "expert legal document drafter" outline prompt + matter-state + confirmed-PA profile), with ZERO
 * extra reads — the conflict gate is never consulted for composition.
 *
 * When exactly "true", an outline turn receives a representational master (master/claude/lawfirm or
 * master/claude/te, NEVER title) ONLY when, under the INSTR-2C R1 allowlist, the matter is the
 * explicit representational law_firm seat (R3), carries no title signal (R4), and the existing
 * conflicts/identity gate is CLEARED (R5) — with the non-suppressible internal-planning-scaffold
 * addendum as a precedence floor (R6). Outline is the only judgment-bearing non-draft role enabled;
 * matter_analysis and matrix stay deferred/legacy. Activation is operator-gated; not client-facing
 * until FOLD-L0-1 is live-verified.
 */
export function isMasterOutlineEnabled(): boolean {
  return process.env['MASTER_OUTLINE_ENABLED'] === 'true';
}

/**
 * Chat copilot — persisted conversations, windowed multi-turn history, grounding/citations, guided
 * modes (CHAT-COPILOT-1). DEFAULT OFF, fail-closed. Layered ABOVE the existing chat flags
 * (CHAT_DISPATCH_ENABLED / CHAT_UI_1_ENABLED / MASTER_CHAT_ENABLED).
 *
 * When OFF (the default), the chat copilot surface is entirely dormant: no conversation/message/summary
 * row is read or written, the copilot procedures refuse (PRECONDITION_FAILED), and every existing chat
 * path is BYTE-FOR-BYTE the CHAT-DISPATCH-1 / CHAT-INJ-1 substrate with ZERO new reads. The three
 * additive tables (migration 0033) simply sit empty.
 *
 * When exactly "true", chat turns persist by-reference (never the compiled master body, raw assembled
 * context, source chunks, or NPI field values), windowed history is restored across reloads, and every
 * turn re-runs the FRESH per-turn posture gate from live matter state (persisted masterApplied/
 * masterSource are audit-only). Grounding + citations (Inc 3) and guided modes (Inc 5) land behind this
 * SAME flag in later, separately-gated increments. Activation is operator-gated; nothing is client-facing
 * until the FOLD-L0-1 live-verification bar (per the chat lineage). Not deployed by this build.
 */
export function isChatCopilotEnabled(): boolean {
  return process.env['CHAT_COPILOT_ENABLED'] === 'true';
}

/**
 * CHAT-COPILOT-2 Increment B — the on-demand MULTI-MODEL REVIEW PANEL. DEFAULT OFF, fail-closed, layered
 * ABOVE CHAT_COPILOT_ENABLED. When OFF (the default) the review-panel surface is entirely absent: the
 * panel procedures refuse (PRECONDITION_FAILED), no chat_review_* row is read or written, the panel UI is
 * not mounted, and the rest of the copilot is BYTE-FOR-BYTE the Increment-A behavior with ZERO extra reads.
 *
 * When exactly "true", the attorney can request a panel of OTHER models (GPT/Gemini/Grok) to review the
 * current chat work product; the primary (Claude) dispositions each suggestion ADOPT/REJECT/
 * MODIFY_AND_ADOPT; the attorney makes the final call. INTERNAL WORK PRODUCT ONLY — no send/finalize/
 * promote/draft path. Activation ALSO requires the operator adding the panel providers to
 * GROUNDED_CHAT_PROVIDERS (the fail-closed egress allowlist) — until then the panel is structurally dark
 * even with this flag on. Operator-gated; not deployed by this build.
 */
export function isChatReviewPanelEnabled(): boolean {
  return process.env['CHAT_REVIEW_PANEL_ENABLED'] === 'true';
}

/**
 * Pure predicate: is a selection of `count` reviewers permitted, given whether the
 * multi-reviewer flag is enabled? Selecting more than one reviewer is only allowed
 * when multi-reviewer is enabled. (The lower bound — at least one reviewer — is
 * enforced separately by the create input schema's .min(1).)
 */
export function isReviewerSelectionCountAllowed(
  count: number,
  multiReviewerEnabled: boolean,
): boolean {
  if (count > 1 && !multiReviewerEnabled) return false;
  return true;
}

/**
 * Matter-deliverable overview (FOLD-PM-4). DEFAULT OFF.
 *
 * A simple owner+matter-scoped "ongoing matters + to-do list": each row is one
 * deliverable on one matter. When OFF (default), the matterDeliverable router
 * refuses every op (MATTER_DELIVERABLE_DISABLED) except the ungated isEnabled
 * probe, and the /overview page redirects — zero new behavior. When exactly
 * "true", the overview surface and CRUD are live. Additive + reversible; the
 * matter_deliverable table (migration 0036) must be applied BEFORE flipping this.
 */
export function isMatterDeliverableEnabled(): boolean {
  return process.env['MATTER_DELIVERABLE_ENABLED'] === 'true';
}

/**
 * Read-only egress / supervision view (SUPERVISION-VIEW-1). DEFAULT OFF.
 *
 * A READ-ONLY owner-scoped dashboard over the chat_egress_events audit log (the A1
 * egress control plane) serving the GLBA vendor-oversight (recurring-review) duty:
 * each attorney reviews THEIR OWN copilot vendor sends (provider/kind/decision, with
 * NPI-withheld + attachment counts). When OFF (default), the supervision procedures
 * refuse with PRECONDITION_FAILED and the /supervision page redirects + its nav link
 * is hidden — zero new behavior. The underlying log is itself only populated when
 * CHAT_COPILOT_ENABLED is ON, so on prod (both OFF) the view is empty. Read-only: no
 * mutation of the append-only log, no new egress. No migration. Additive + reversible.
 */
export function isSupervisionViewEnabled(): boolean {
  return process.env['SUPERVISION_VIEW_ENABLED'] === 'true';
}

/**
 * Document-type structured extraction (FOLD-PM-2). DEFAULT OFF.
 *
 * The PURE, no-egress document-type parsers (title commitment / deed / survey /
 * settlement statement) over a material's already-extracted text, persisted to
 * material_extraction. When OFF (default), the materialExtraction procedures refuse
 * with PRECONDITION_FAILED and the extraction panel does not render — zero new
 * behavior. The extraction is deterministic + attorney-facing only (never an egress
 * contract); low-confidence fields are withheld at the data layer (honesty floor).
 * Additive + reversible; the material_extraction table (migration 0037) must be
 * applied BEFORE flipping this.
 */
export function isDocumentExtractionEnabled(): boolean {
  return process.env['DOCUMENT_EXTRACTION_ENABLED'] === 'true';
}

/**
 * Party / entity / contact data model (FOLD-PM-3). DEFAULT OFF.
 *
 * An ADDITIVE, owner+matter-scoped entity/contact model (matter_entity +
 * matter_entity_contact) that underpins conflicts + persistent reference and unblocks
 * FOLD-DEED-1. When OFF (default), the matterEntity procedures refuse with
 * PRECONDITION_FAILED (except the ungated isEnabled probe) — zero new behavior. It does
 * NOT alter matter_parties (the thin conflicts party); a matter_entity may OPTIONALLY
 * reference a party WITHIN THE SAME MATTER via partyRef. WITHIN-MATTER only: no
 * cross-matter identity resolution is implemented (externalIdentityKey is a forward-safe
 * grouping hook, never matched/joined now). Additive + reversible; the matter_entity /
 * matter_entity_contact tables (migration 0044) must be applied BEFORE flipping this.
 */
export function isPartyModelEnabled(): boolean {
  return process.env['PARTY_MODEL_ENABLED'] === 'true';
}

/**
 * In-app notification core — store + read + display (FOLD-NOTIFY-1). DEFAULT OFF.
 *
 * An ADDITIVE, owner-scoped in-app notification model (a dedicated `notifications`
 * table) plus the bell/unread-badge + per-matter "ready" badge in the app shell and a
 * lightweight poll. INFORMATIONAL ONLY — it NEVER auto-adopts, auto-sends, or makes any
 * decision. When OFF (default), the notification procedures refuse with
 * PRECONDITION_FAILED (except the ungated isEnabled probe), the bell/badge do NOT render,
 * and the client does NOT poll — zero new behavior. When exactly "true", the bell + unread
 * badge surface and the poll runs.
 *
 * This is the STORE + READ + DISPLAY tier ONLY. The OUTBOX-EMIT WIRING (producers that
 * create notifications) and the hold/ack notification types are DEFERRED to after EGRESS
 * Inc 3b — no producer is wired here, so the table may legitimately sit empty until
 * producers land. Additive + reversible; the notifications table (migration 0045) must be
 * applied BEFORE flipping the flag. No new env var beyond the flag.
 */
export function isNotificationsEnabled(): boolean {
  return process.env['NOTIFICATIONS_ENABLED'] === 'true';
}
