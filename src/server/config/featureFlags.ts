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
