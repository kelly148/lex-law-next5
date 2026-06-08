-- =============================================================================
-- FOLD-PM-1 Migration 0021 — deadline / tickler engine data core (Increment 1)
-- =============================================================================
-- ADDITIVE ONLY. Five new tables + idempotent firm-default seeds. Data core for the deadline/tickler
-- engine (triad-reviewed + operator-APPROVED: FOLD-PM-1_consolidated_disposition_2026-06-07.md).
-- NO behavior change in this migration: nothing computes a deadline, nothing is surfaced, no egress.
-- Flag DEADLINE_ENGINE_ENABLED default OFF. Auto-applies via the pre-deploy runner (additive allowlist).
-- Seeds use fixed UUIDs + INSERT ... ON DUPLICATE KEY UPDATE so re-runs are a safe no-op (idempotent).
--
-- HARD GATES enforced structurally here:
--   G-B  1031 rules are seeded with `enabled` = 0 (SEEDED-BUT-DISABLED). Activation is hard-blocked on
--        attorney-approved 1031-0 fixtures (a later increment). The disabled state is unmistakable in
--        the data: deadline_rule.enabled = 0.
--   G-C  status vocabulary includes pending_confirm + expired_unresolved (no silent states); the
--        instance/tickler tables exist but are EMPTY in Inc 1 (no behavior).
--   G-A  constraintsSpec stores the rule-declared compound caps (e.g. the 1031 return_due_date_cap);
--        the runtime computeDeadline() contract is frozen at the G-A review (before Inc 2).
--
-- LEGAL-CONTENT NOTICE: every seeded rule's legal content (offsets, conventions, recurrence, statutory
-- dates) and every holiday date is ATTORNEY-VERIFIED BEFORE FLAG-ON (Inc 5) — the builder never asserts
-- a legal deadline rule as fact. While DEADLINE_ENGINE_ENABLED is OFF these seeds are inert.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `deadline_rule` (
  `id`                CHAR(36)     NOT NULL,
  `userId`            CHAR(36)     NULL DEFAULT NULL, -- NULL = firm default
  `family`            ENUM('exchange_1031','contract_contingency','closing_recording','trust_funding','corporate_filing') NOT NULL,
  `ruleKey`           VARCHAR(128) NOT NULL, -- stable identifier for idempotent seeding + lookup
  `label`             VARCHAR(256) NOT NULL,
  `enabled`           TINYINT(1)   NOT NULL DEFAULT 0, -- 1031 seeds land disabled (G-B)
  `currentRevisionId` CHAR(36)     NULL DEFAULT NULL, -- pointer to the operative immutable revision
  `createdAt`         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_deadline_rule_key` (`ruleKey`),
  INDEX `idx_deadline_rule_family` (`family`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `deadline_rule_revision` (
  `id`               CHAR(36)     NOT NULL,
  `ruleId`           CHAR(36)     NOT NULL,
  `jurisdiction`     VARCHAR(16)  NULL DEFAULT NULL, -- NULL = federal/any
  `anchorType`       VARCHAR(64)  NOT NULL,
  `offsetDays`       INT          NULL DEFAULT NULL, -- NULL = recurrence/fixed-date driven
  `dayConvention`    ENUM('calendar_no_roll','calendar_roll_forward','business_days') NOT NULL,
  `rollRule`         ENUM('none','next_business_day','previous_business_day') NOT NULL,
  `recurrence`       JSON         NULL DEFAULT NULL,
  `leadTimeDefaults` JSON         NOT NULL,
  `constraintsSpec`  JSON         NULL DEFAULT NULL, -- rule-declared compound caps (e.g. 1031 cap)
  `sourceTag`        VARCHAR(256) NOT NULL, -- attorney-verified legal authority citation
  `notes`            TEXT         NULL DEFAULT NULL,
  `createdAt`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- IMMUTABLE (no updatedAt)
  PRIMARY KEY (`id`),
  INDEX `idx_deadline_rev_rule` (`ruleId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `matter_deadline` (
  `id`                   CHAR(36)     NOT NULL,
  `userId`               CHAR(36)     NOT NULL,
  `matterId`             CHAR(36)     NOT NULL,
  `ruleRevisionId`       CHAR(36)     NULL DEFAULT NULL, -- NULL = manual/ad-hoc (first-class)
  `family`               ENUM('exchange_1031','contract_contingency','closing_recording','trust_funding','corporate_filing') NOT NULL,
  `description`          VARCHAR(512) NOT NULL,
  `anchorType`           VARCHAR(64)  NOT NULL,
  `anchorDate`           DATE         NOT NULL, -- date-only, America/New_York; visibly attorney-asserted
  `anchorSource`         ENUM('attorney_entered','document_linked') NOT NULL,
  `anchorBasis`          TEXT         NULL DEFAULT NULL,
  `anchorDocumentId`     CHAR(36)     NULL DEFAULT NULL, -- deadline<->source-document linkage
  `computedDueDate`      DATE         NULL DEFAULT NULL,
  `constraints`          JSON         NOT NULL, -- resolved DeadlineConstraint[] snapshot (may be [])
  `attorneyOverrideDate` DATE         NULL DEFAULT NULL,
  `overrideReason`       TEXT         NULL DEFAULT NULL, -- required when override set (app layer)
  `status`               ENUM('pending_confirm','active','satisfied','waived','expired_unresolved') NOT NULL DEFAULT 'pending_confirm',
  `confirmedByUserId`    CHAR(36)     NULL DEFAULT NULL,
  `confirmedAt`          TIMESTAMP    NULL DEFAULT NULL,
  `ruleSnapshot`         JSON         NULL DEFAULT NULL, -- operative rule fields at confirmation
  `dispositionBasis`     TEXT         NULL DEFAULT NULL, -- basis on satisfy/waive (satisfy records a basis too)
  `createdAt`            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_matter_deadline_matter` (`userId`, `matterId`),
  INDEX `idx_matter_deadline_status` (`userId`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tickler` (
  `id`                   CHAR(36)  NOT NULL,
  `userId`               CHAR(36)  NOT NULL,
  `matterDeadlineId`     CHAR(36)  NOT NULL,
  `leadDays`             INT       NOT NULL, -- logical lead-time; ack/snooze keys to this
  `fireAt`               DATE      NOT NULL,
  `acknowledgedByUserId` CHAR(36)  NULL DEFAULT NULL,
  `acknowledgedAt`       TIMESTAMP NULL DEFAULT NULL,
  `snoozedUntil`         DATE      NULL DEFAULT NULL,
  `snoozeReason`         TEXT      NULL DEFAULT NULL,
  `createdAt`            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_tickler_deadline` (`matterDeadlineId`),
  INDEX `idx_tickler_user_fire` (`userId`, `fireAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `holiday_calendar` (
  `id`           CHAR(36)     NOT NULL,
  `jurisdiction` VARCHAR(16)  NOT NULL, -- 'US' (federal) | 'VA' | 'MD'
  `date`         DATE         NOT NULL,
  `label`        VARCHAR(256) NOT NULL,
  `createdAt`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_holiday_jurisdiction_date` (`jurisdiction`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Idempotent firm-default RULE seeds (userId NULL). PROPOSED legal content — attorney-verified before
-- FLAG-ON (Inc 5). Inert while DEADLINE_ENGINE_ENABLED is OFF. Fixed UUIDs -> ON DUPLICATE KEY = no-op.
-- ============================================================================

-- deadline_rule rows. Mutable fields (label/enabled/currentRevisionId) refresh on re-run.
INSERT INTO `deadline_rule` (`id`,`userId`,`family`,`ruleKey`,`label`,`enabled`,`currentRevisionId`) VALUES
  ('d1054b00-0000-4000-8000-000000000001', NULL, 'contract_contingency', 'contingency_financing',        'Financing contingency',          1, 'd1054c00-0000-4000-8000-000000000001'),
  ('d1054b00-0000-4000-8000-000000000002', NULL, 'contract_contingency', 'contingency_appraisal',        'Appraisal contingency',          1, 'd1054c00-0000-4000-8000-000000000002'),
  ('d1054b00-0000-4000-8000-000000000003', NULL, 'contract_contingency', 'contingency_inspection',       'Inspection / due-diligence',     1, 'd1054c00-0000-4000-8000-000000000003'),
  ('d1054b00-0000-4000-8000-000000000004', NULL, 'contract_contingency', 'contingency_title_objection',  'Title-objection window',         1, 'd1054c00-0000-4000-8000-000000000004'),
  ('d1054b00-0000-4000-8000-000000000005', NULL, 'corporate_filing',     'va_scc_annual_registration',   'VA SCC annual registration',     1, 'd1054c00-0000-4000-8000-000000000005'),
  ('d1054b00-0000-4000-8000-000000000006', NULL, 'corporate_filing',     'md_sdat_annual_report',        'MD SDAT annual report',          1, 'd1054c00-0000-4000-8000-000000000006'),
  ('d1054b00-0000-4000-8000-000000000007', NULL, 'exchange_1031',        '1031_45_day_identification',   '1031 45-day identification',     0, 'd1054c00-0000-4000-8000-000000000007'),
  ('d1054b00-0000-4000-8000-000000000008', NULL, 'exchange_1031',        '1031_180_day_exchange',        '1031 180-day exchange period',   0, 'd1054c00-0000-4000-8000-000000000008')
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`), `enabled` = VALUES(`enabled`), `currentRevisionId` = VALUES(`currentRevisionId`);

-- deadline_rule_revision rows (IMMUTABLE -> ON DUPLICATE KEY UPDATE id=id keeps existing rows untouched).
-- Contingencies: attorney-entered per matter (offsetDays NULL -> attorney supplies the window/anchor per
-- contract); lead T-7/3/1; roll forward to next business day if the window ends on a non-business day.
INSERT INTO `deadline_rule_revision`
  (`id`,`ruleId`,`jurisdiction`,`anchorType`,`offsetDays`,`dayConvention`,`rollRule`,`recurrence`,`leadTimeDefaults`,`constraintsSpec`,`sourceTag`,`notes`) VALUES
  ('d1054c00-0000-4000-8000-000000000001','d1054b00-0000-4000-8000-000000000001', NULL, 'contract_ratification', NULL, 'calendar_roll_forward','next_business_day', NULL, '[7,3,1]', NULL, 'Per executed contract terms (attorney-entered per matter)', 'Window/anchor supplied per contract; not statutory.'),
  ('d1054c00-0000-4000-8000-000000000002','d1054b00-0000-4000-8000-000000000002', NULL, 'contract_ratification', NULL, 'calendar_roll_forward','next_business_day', NULL, '[7,3,1]', NULL, 'Per executed contract terms (attorney-entered per matter)', 'Window/anchor supplied per contract; not statutory.'),
  ('d1054c00-0000-4000-8000-000000000003','d1054b00-0000-4000-8000-000000000003', NULL, 'contract_ratification', NULL, 'calendar_roll_forward','next_business_day', NULL, '[7,3,1]', NULL, 'Per executed contract terms (attorney-entered per matter)', 'Window/anchor supplied per contract; not statutory.'),
  ('d1054c00-0000-4000-8000-000000000004','d1054b00-0000-4000-8000-000000000004', NULL, 'contract_ratification', NULL, 'calendar_roll_forward','next_business_day', NULL, '[7,3,1]', NULL, 'Per executed contract terms (attorney-entered per matter)', 'Window/anchor supplied per contract; not statutory.'),
  -- Corporate: VA SCC annual registration — due last day of the formation-anniversary month (recurring annual).
  ('d1054c00-0000-4000-8000-000000000005','d1054b00-0000-4000-8000-000000000005', 'VA', 'formation_anniversary', NULL, 'calendar_no_roll','none', '{"type":"annual_anniversary_month_end"}', '[90,60,30,14,7]', NULL, 'Va. Code Ann. tit. 13.1 (annual registration fee) — VERIFY entity-type specifics before flag-ON', 'PROPOSED — attorney-verify (corp vs LLC differ; corporations also file an annual report).'),
  -- Corporate: MD SDAT annual report (+ personal property return) — due April 15 annually.
  ('d1054c00-0000-4000-8000-000000000006','d1054b00-0000-4000-8000-000000000006', 'MD', 'fixed_annual_date', NULL, 'calendar_roll_forward','next_business_day', '{"type":"annual_fixed","month":4,"day":15}', '[90,60,30,14,7]', NULL, 'Md. Code Ann., Tax-Prop. / Corps. & Ass''ns (annual report, due April 15) — VERIFY before flag-ON', 'PROPOSED — attorney-verify due date + roll behavior + entity scope.'),
  -- 1031: calendar days, NO ROLL (statutory). SEEDED-DISABLED (G-B). 180-day carries the earlier-of cap.
  ('d1054c00-0000-4000-8000-000000000007','d1054b00-0000-4000-8000-000000000007', NULL, 'relinquished_transfer_date', 45, 'calendar_no_roll','none', NULL, '[30,14,7,1]', NULL, 'IRC 1031(a)(3)(A); Treas. Reg. 1.1031(k)-1(b)(2)(i)', 'PROPOSED — DISABLED pending attorney-approved 1031-0 fixtures (G-B). Calendar days, no roll.'),
  ('d1054c00-0000-4000-8000-000000000008','d1054b00-0000-4000-8000-000000000008', NULL, 'relinquished_transfer_date', 180, 'calendar_no_roll','none', NULL, '[60,45,30,14,7,1]', '[{"type":"return_due_date_cap","requires":["taxYear","extensionFiled"],"description":"180-day period is capped at the due date (including extensions) of the transferor return for the tax year of the transfer; the EARLIER of +180 days and the return due date controls."}]', 'IRC 1031(a)(3)(B); Treas. Reg. 1.1031(k)-1(b)(2)(ii)', 'PROPOSED — DISABLED pending attorney-approved 1031-0 fixtures (G-B). Calendar days, no roll; earlier-of cap is the G-A constraints[] case.')
ON DUPLICATE KEY UPDATE `id` = `id`;

-- ============================================================================
-- Idempotent holiday_calendar seeds. US federal (observed) + MD state addition (American Indian
-- Heritage Day, day after Thanksgiving), 2026–2030. Dates computed deterministically (Node) to avoid
-- hand-math errors; attorney-verified before flag-ON. VA state-specific closures beyond federal (if any)
-- are a verification item — VA matters union US+VA, which is the federal set until VA rows are added.
-- The computation core returns a COVERAGE constraint past 2030 (never assumes) + a "coverage ends"
-- tickler (Inc 2/3); refresh this seed (or the maintenance path) before extending past the range.
-- ============================================================================
INSERT INTO `holiday_calendar` (`id`,`jurisdiction`,`date`,`label`) VALUES
  ('d1054a00-0000-4000-8000-000000000001', 'US', '2026-01-01', 'New Years Day'),
  ('d1054a00-0000-4000-8000-000000000002', 'US', '2026-01-19', 'Birthday of Martin Luther King, Jr.'),
  ('d1054a00-0000-4000-8000-000000000003', 'US', '2026-02-16', 'Washingtons Birthday'),
  ('d1054a00-0000-4000-8000-000000000004', 'US', '2026-05-25', 'Memorial Day'),
  ('d1054a00-0000-4000-8000-000000000005', 'US', '2026-06-19', 'Juneteenth National Independence Day'),
  ('d1054a00-0000-4000-8000-000000000006', 'US', '2026-07-03', 'Independence Day'),
  ('d1054a00-0000-4000-8000-000000000007', 'US', '2026-09-07', 'Labor Day'),
  ('d1054a00-0000-4000-8000-000000000008', 'US', '2026-10-12', 'Columbus Day'),
  ('d1054a00-0000-4000-8000-000000000009', 'US', '2026-11-11', 'Veterans Day'),
  ('d1054a00-0000-4000-8000-000000000010', 'US', '2026-11-26', 'Thanksgiving Day'),
  ('d1054a00-0000-4000-8000-000000000011', 'US', '2026-12-25', 'Christmas Day'),
  ('d1054a00-0000-4000-8000-000000000012', 'US', '2027-01-01', 'New Years Day'),
  ('d1054a00-0000-4000-8000-000000000013', 'US', '2027-01-18', 'Birthday of Martin Luther King, Jr.'),
  ('d1054a00-0000-4000-8000-000000000014', 'US', '2027-02-15', 'Washingtons Birthday'),
  ('d1054a00-0000-4000-8000-000000000015', 'US', '2027-05-31', 'Memorial Day'),
  ('d1054a00-0000-4000-8000-000000000016', 'US', '2027-06-18', 'Juneteenth National Independence Day'),
  ('d1054a00-0000-4000-8000-000000000017', 'US', '2027-07-05', 'Independence Day'),
  ('d1054a00-0000-4000-8000-000000000018', 'US', '2027-09-06', 'Labor Day'),
  ('d1054a00-0000-4000-8000-000000000019', 'US', '2027-10-11', 'Columbus Day'),
  ('d1054a00-0000-4000-8000-000000000020', 'US', '2027-11-11', 'Veterans Day'),
  ('d1054a00-0000-4000-8000-000000000021', 'US', '2027-11-25', 'Thanksgiving Day'),
  ('d1054a00-0000-4000-8000-000000000022', 'US', '2027-12-24', 'Christmas Day'),
  ('d1054a00-0000-4000-8000-000000000023', 'US', '2027-12-31', 'New Years Day'),
  ('d1054a00-0000-4000-8000-000000000024', 'US', '2028-01-17', 'Birthday of Martin Luther King, Jr.'),
  ('d1054a00-0000-4000-8000-000000000025', 'US', '2028-02-21', 'Washingtons Birthday'),
  ('d1054a00-0000-4000-8000-000000000026', 'US', '2028-05-29', 'Memorial Day'),
  ('d1054a00-0000-4000-8000-000000000027', 'US', '2028-06-19', 'Juneteenth National Independence Day'),
  ('d1054a00-0000-4000-8000-000000000028', 'US', '2028-07-04', 'Independence Day'),
  ('d1054a00-0000-4000-8000-000000000029', 'US', '2028-09-04', 'Labor Day'),
  ('d1054a00-0000-4000-8000-000000000030', 'US', '2028-10-09', 'Columbus Day'),
  ('d1054a00-0000-4000-8000-000000000031', 'US', '2028-11-10', 'Veterans Day'),
  ('d1054a00-0000-4000-8000-000000000032', 'US', '2028-11-23', 'Thanksgiving Day'),
  ('d1054a00-0000-4000-8000-000000000033', 'US', '2028-12-25', 'Christmas Day'),
  ('d1054a00-0000-4000-8000-000000000034', 'US', '2029-01-01', 'New Years Day'),
  ('d1054a00-0000-4000-8000-000000000035', 'US', '2029-01-15', 'Birthday of Martin Luther King, Jr.'),
  ('d1054a00-0000-4000-8000-000000000036', 'US', '2029-02-19', 'Washingtons Birthday'),
  ('d1054a00-0000-4000-8000-000000000037', 'US', '2029-05-28', 'Memorial Day'),
  ('d1054a00-0000-4000-8000-000000000038', 'US', '2029-06-19', 'Juneteenth National Independence Day'),
  ('d1054a00-0000-4000-8000-000000000039', 'US', '2029-07-04', 'Independence Day'),
  ('d1054a00-0000-4000-8000-000000000040', 'US', '2029-09-03', 'Labor Day'),
  ('d1054a00-0000-4000-8000-000000000041', 'US', '2029-10-08', 'Columbus Day'),
  ('d1054a00-0000-4000-8000-000000000042', 'US', '2029-11-12', 'Veterans Day'),
  ('d1054a00-0000-4000-8000-000000000043', 'US', '2029-11-22', 'Thanksgiving Day'),
  ('d1054a00-0000-4000-8000-000000000044', 'US', '2029-12-25', 'Christmas Day'),
  ('d1054a00-0000-4000-8000-000000000045', 'US', '2030-01-01', 'New Years Day'),
  ('d1054a00-0000-4000-8000-000000000046', 'US', '2030-01-21', 'Birthday of Martin Luther King, Jr.'),
  ('d1054a00-0000-4000-8000-000000000047', 'US', '2030-02-18', 'Washingtons Birthday'),
  ('d1054a00-0000-4000-8000-000000000048', 'US', '2030-05-27', 'Memorial Day'),
  ('d1054a00-0000-4000-8000-000000000049', 'US', '2030-06-19', 'Juneteenth National Independence Day'),
  ('d1054a00-0000-4000-8000-000000000050', 'US', '2030-07-04', 'Independence Day'),
  ('d1054a00-0000-4000-8000-000000000051', 'US', '2030-09-02', 'Labor Day'),
  ('d1054a00-0000-4000-8000-000000000052', 'US', '2030-10-14', 'Columbus Day'),
  ('d1054a00-0000-4000-8000-000000000053', 'US', '2030-11-11', 'Veterans Day'),
  ('d1054a00-0000-4000-8000-000000000054', 'US', '2030-11-28', 'Thanksgiving Day'),
  ('d1054a00-0000-4000-8000-000000000055', 'US', '2030-12-25', 'Christmas Day'),
  ('d1054a00-0000-4000-8000-000000000056', 'MD', '2026-11-27', 'American Indian Heritage Day'),
  ('d1054a00-0000-4000-8000-000000000057', 'MD', '2027-11-26', 'American Indian Heritage Day'),
  ('d1054a00-0000-4000-8000-000000000058', 'MD', '2028-11-24', 'American Indian Heritage Day'),
  ('d1054a00-0000-4000-8000-000000000059', 'MD', '2029-11-23', 'American Indian Heritage Day'),
  ('d1054a00-0000-4000-8000-000000000060', 'MD', '2030-11-29', 'American Indian Heritage Day')
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);
