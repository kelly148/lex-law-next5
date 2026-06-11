-- =============================================================================
-- CHAT-UI-1 W3 Migration — posture_provenance.subject (non-posture act target)
-- =============================================================================
-- Additive: adds one nullable JSON column to posture_provenance. No data change; no
-- existing column altered. posture_provenance is itself a CHAT-UI-1 (flag-gated) table
-- created in migration 0028 and not yet deployed, so 0028 + 0029 apply together at the
-- first deploy of this feature; nothing is written while CHAT_UI_1_ENABLED is off.
--
-- `subject` records the TARGET of a non-posture hard-stop act (W3): the bound matter for a
-- matter-identity confirm, the reversed entry for an undo, etc. Posture acts leave it NULL
-- (their target is the resolved triple already stored in the typed columns). It is part of
-- the hash-chain content, so it is tamper-evident like every other field.
-- -----------------------------------------------------------------------------
ALTER TABLE `posture_provenance`
  ADD COLUMN `subject` JSON NULL DEFAULT NULL AFTER `findings`;
