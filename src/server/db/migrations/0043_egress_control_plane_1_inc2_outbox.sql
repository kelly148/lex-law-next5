-- =============================================================================
-- EGRESS-CONTROL-PLANE-1 (Increment 2) — durable outbox + CR-4 / STUCK-SESSION-RECOVERY
-- =============================================================================
-- ADDITIVE ONLY. No existing column is dropped or retyped destructively; every
-- pre-existing row stays valid. TiDB-compatible MySQL syntax (IF NOT EXISTS on
-- ADD COLUMN/INDEX; ENUM value ADDITION via MODIFY appends trailing values only).
-- Applied additively by scripts/apply-prod-migrations.mjs (Railway pre-deploy).
--
-- WHY a COMPANION column instead of extending review_sessions.state:
--   review_sessions.state is referenced by the STORED generated column
--   `activeSessionKey` (the single-active-session guard, R10). TiDB does NOT permit
--   MODIFY COLUMN on a column a generated column depends on, so the new lifecycle
--   sub-states are stored in a NEW companion column (lifecyclePhase). `state` is
--   UNCHANGED — so the activeSessionKey guard keeps enforcing one active review per
--   (documentId, iterationNumber) across EVERY live phase, and assertSessionActive
--   (state='active') is untouched. (Operator-approved 2026-06-16.)
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- review_sessions: the CR-4 lifecycle sub-state machine (companion to `state`) +
-- the session-level partial-fan-out reason (Inc 3's send gate reads partialReason
-- to require an attorney acknowledgment for hold-blocked partials).
--   lifecyclePhase NULL = idle/active-normal (created, reviewers running, or the
--     attorney reviewing/selecting). 'dispatching' = the brief post-commit transmit
--     handoff window (recovery-refusal marker). 'completed' = all expected lanes
--     terminal. 'held' / 'blocked_by_hold' / 'partial_blocked_by_hold' are DEFINED
--     here and SET by the egress gate in Increment 3 (recovery already refuses them).
--   partialReason: 'non_response' (some reviewers failed/timed-out — informational)
--     vs 'blocked_by_hold' (a no_external hold blocked reviewers — Inc 3 requires the
--     recorded one-click attorney acknowledgment). NULL = clean / not partial.
-- Both nullable + additive; the Zod Wall reads them .nullable().optional().
-- -----------------------------------------------------------------------------
ALTER TABLE `review_sessions`
  ADD COLUMN IF NOT EXISTS `lifecyclePhase` VARCHAR(32) NULL DEFAULT NULL;

ALTER TABLE `review_sessions`
  ADD COLUMN IF NOT EXISTS `partialReason` VARCHAR(32) NULL DEFAULT NULL;

-- -----------------------------------------------------------------------------
-- reviewer_lanes: define the `blocked_by_hold` terminal lane status (additive ENUM
-- value addition via MODIFY — appended trailing; existing rows untouched; idempotent).
-- reviewer_lanes has NO generated column, so MODIFY is safe. Set by Inc 3's per-
-- reviewer egress gate; classified now so a session can be distinguished as
-- partial-by-HOLD vs partial-by-non-response (the Inc-2 data foundation). It is a
-- TERMINAL status but NOT a FAILURE class (a hold-block is a deliberate withhold).
-- -----------------------------------------------------------------------------
ALTER TABLE `reviewer_lanes`
  MODIFY COLUMN `status` ENUM(
    'pending',
    'dispatched',
    'running',
    'completed_with_feedback',
    'completed_without_feedback',
    'failed',
    'timed_out',
    'dispatch_failed',
    'orphaned_reaped',
    'canceled',
    'blocked_by_hold'
  ) NOT NULL DEFAULT 'pending';

-- -----------------------------------------------------------------------------
-- jobs: durable-outbox idempotency key per (session, lane) on reviewer dispatch.
-- Value = `${reviewSessionId}:${reviewerRole}` for reviewer_feedback jobs; NULL for
-- every other job type (MySQL/TiDB unique indexes permit multiple NULLs, so non-
-- reviewer jobs never collide). Writing it here lets a resume / recovered re-dispatch
-- be deduped; the per-reviewer egress dedup is enforced fully in Increment 3.
-- Additive ADD COLUMN + ADD UNIQUE INDEX (both IF NOT EXISTS); jobs has no generated
-- column, so this is safe.
-- -----------------------------------------------------------------------------
ALTER TABLE `jobs`
  ADD COLUMN IF NOT EXISTS `idempotencyKey` VARCHAR(128) NULL DEFAULT NULL;

ALTER TABLE `jobs`
  ADD UNIQUE INDEX IF NOT EXISTS `uniq_jobs_idempotency_key` (`idempotencyKey`);

-- -----------------------------------------------------------------------------
-- audit_events: durable session-transition audit event type (additive ENUM value
-- addition via MODIFY — appended trailing; existing rows untouched; idempotent).
-- Every CR-4 state transition (auto-recovery / attorney-initiated / hold-frozen)
-- writes one append-only audit row with the reason in the payload, so a silent
-- abandon can never occur (spoliation / e-discovery posture under 7-10yr retention).
-- audit_events has NO generated column, so MODIFY is safe (matches 0005 / 0022).
-- -----------------------------------------------------------------------------
ALTER TABLE `audit_events`
  MODIFY COLUMN `eventType` ENUM(
    'model_output',
    'adopted',
    'rejected',
    'locked',
    'unlocked',
    'sent',
    'withheld',
    'authority_verified',
    'judgment_required',
    'disposition',
    'deadline_fired',
    'deadline_acknowledged',
    'review_session_transition'
  ) NOT NULL;
