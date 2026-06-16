-- =====================================================================================
-- EGRESS-CONTROL-PLANE-1 (Increment 1) Migration — egress_hold (scoped no_external hold)
-- =====================================================================================
-- ADDITIVE ONLY: one CREATE TABLE IF NOT EXISTS. conversation.holdFlag (chat, conversation-scoped) is
-- UNTOUCHED — this table adds the MATTER and GLOBAL hold scopes the conversation-only flag could not
-- express. A document/external send checks matter + global here; precedence global > matter > conversation
-- (a conversation hold must NOT block unrelated matters; a matter/global hold MUST reach document sends).
--
-- subjectId = conversationId | matterId (NULL for scope='global'). matterId is set for conversation/matter
-- scope so the hold purges WITH the matter (matterPurge byMatter); NULL for a firm-level global hold, which
-- is therefore RETAINED across a matter purge (firm-level, like authority_source). Release is
-- AUDIT-PRESERVING: active=FALSE + releasedAt (no in-operation row delete). Owner-scoped (ownerScope() on
-- every read).
--
-- Idempotent. On the additive pre-deploy allowlist (scripts/apply-prod-migrations.mjs). TiDB-compatible
-- MySQL. NO DB FK (app-layer isolation, codebase convention).
-- =====================================================================================

CREATE TABLE IF NOT EXISTS `egress_hold` (
  `id`               CHAR(36)     NOT NULL,
  `userId`           CHAR(36)     NOT NULL,
  `scope`            ENUM('conversation','matter','global') NOT NULL,
  `subjectId`        CHAR(36)     NULL DEFAULT NULL,
  `matterId`         CHAR(36)     NULL DEFAULT NULL,
  `holdFlag`         ENUM('none','no_panel','no_external') NOT NULL DEFAULT 'no_external',
  `reason`           TEXT         NULL DEFAULT NULL,
  `active`           BOOLEAN      NOT NULL DEFAULT TRUE,
  `createdByUserId`  CHAR(36)     NOT NULL,
  `createdAt`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `releasedAt`       TIMESTAMP    NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  -- One active hold per (owner, scope, subject); MySQL permits multiple NULL subjectId rows (global) — the
  -- evaluator treats any active global no_external hold as binding, so multiplicity is harmless.
  UNIQUE INDEX `uniq_egress_hold_scope_subject` (`userId`, `scope`, `subjectId`),
  INDEX `idx_egress_hold_matter` (`matterId`, `userId`),
  INDEX `idx_egress_hold_active` (`userId`, `active`, `scope`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
