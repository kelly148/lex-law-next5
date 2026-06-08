-- =============================================================================
-- FOLD-PM-1 Migration 0022 — deadline engine audit event types (Increment 3)
-- =============================================================================
-- ADDITIVE ONLY. Appends two values to the audit_events.eventType ENUM so the deadline engine can audit
-- the system FIRING (system surfaced a deadline/tickler) and the attorney ACKNOWLEDGMENT distinctly from
-- an attorney 'disposition' (FOLD-PM-1 disposition: audit the firing distinct from acknowledgment).
--
-- ENUM value ADDITION is additive: MODIFY re-declares the column with the SAME existing values IN ORDER
-- plus the two new trailing values — no value is removed or reordered, existing rows stay valid, and a
-- re-run to the identical definition is a no-op (idempotent). The pre-deploy additive guard permits
-- ALTER ... MODIFY (it is not DROP/TRUNCATE/DELETE/RENAME/UPDATE).
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
    'deadline_acknowledged'
  ) NOT NULL;
