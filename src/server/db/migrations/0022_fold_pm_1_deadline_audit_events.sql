-- =============================================================================
-- FOLD-PM-1 Migration 0022 — deadline engine audit event types (Increment 3)
-- =============================================================================
-- ADDITIVE ONLY. Appends two values to the audit_events.eventType ENUM so the deadline engine can audit
-- the system FIRING (system surfaced a deadline/tickler) and the attorney ACKNOWLEDGMENT distinctly from
-- an attorney 'disposition' (FOLD-PM-1 disposition: audit the firing distinct from acknowledgment).
--
-- ENUM value ADDITION is additive: MODIFY re-declares the column with the existing values IN ORDER plus
-- trailing values — no value is removed or reordered, existing rows stay valid. The pre-deploy additive
-- guard permits ALTER ... MODIFY (it is not DROP/TRUNCATE/DELETE/RENAME/UPDATE).
--
-- RE-RUN-SAFETY INVARIANT (the pre-deploy runner re-runs EVERY allowlisted migration, in order, on EVERY
-- deploy): a MODIFY is a no-op on re-run ONLY when its list is the column's FINAL union of values. This
-- MODIFY therefore carries 'review_session_transition' too — even though 0043 is what FIRST adds it —
-- because re-running 0022 against the 0043-widened (13-value) column must NOT narrow it back to 12 and
-- truncate audit rows using the later value. 0043 holds the canonical ordered list; 0022 mirrors it
-- EXACTLY (same values, same order). Append-only: never remove or reorder a value.
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
