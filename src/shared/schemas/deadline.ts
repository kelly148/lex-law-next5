/**
 * Zod schemas for the FOLD-PM-1 deadline / tickler engine data core (Increment 1).
 *
 * Ch 35.1 Zod Wall: every read of these tables parses through these schemas.
 *
 * FOLD-PM-1 is the Phase-4 head — the first feature that computes legally consequential dates.
 * Design triad-reviewed + operator-APPROVED (FOLD-PM-1_consolidated_disposition_2026-06-07.md).
 * INCREMENT 1 IS THE DATA CORE ONLY — tables + schemas + idempotent seeds. NO behavior:
 * nothing computes a deadline, nothing is surfaced, flag DEADLINE_ENGINE_ENABLED default OFF, and
 * NO autonomous/egress action exists anywhere in the engine by design.
 *
 * Tables (all additive, nullable owner key, ownerScope() discipline, camelCase FKs):
 *  - deadline_rule            — a rule's identity + `enabled` switch + pointer to its current
 *                               (immutable) revision. owner-null = firm default; no config UI v1.
 *  - deadline_rule_revision   — IMMUTABLE snapshot of a rule's legal content (anchor, offset,
 *                               day-convention, roll, recurrence, lead times, constraintsSpec,
 *                               sourceTag citation). Editing a rule writes a NEW revision; existing
 *                               revisions never mutate, so a matter_deadline that snapshotted one
 *                               keeps its historical basis.
 *  - matter_deadline          — per-matter instance (computed from a rule revision, or manual).
 *                               status pending_confirm -> active -> satisfied | waived |
 *                               expired_unresolved. anchorDate is visibly attorney-asserted.
 *  - tickler                  — per-deadline lead-time reminder rows; ack/snooze keyed to the
 *                               LOGICAL lead-time (leadDays) so state survives recompute.
 *  - holiday_calendar         — jurisdiction + date + label; business-day math reads it; a coverage
 *                               guard returns a constraint past the seeded range (never assumes).
 *
 * HARD GATES reflected here:
 *  - G-A: constraints[] is a FIRST-CLASS unresolved-input return — the engine may emit a naive date
 *    PLUS a visible unresolved constraint, never a confidently wrong compound ("earlier/later of")
 *    date. The full computeDeadline() contract is frozen at the G-A review (before Inc 2); this
 *    module defines only the STORAGE shape of a constraint (rule-declared spec + per-instance
 *    resolved snapshot).
 *  - G-B: 1031 rules land enabled=false (seeded-but-disabled); activation is hard-blocked on
 *    attorney-approved 1031-0 fixtures.
 *  - G-C: pending_confirm is a first-class visible status (it fires ticklers under an "unconfirmed"
 *    treatment); expired_unresolved is a permanent terminal-until-disposed status.
 */

import { z } from 'zod';

// ── Closed vocabularies (mirror the schema.ts mysqlEnum values exactly) ──

// The five named deadline families. The ENGINE supports all five from Inc 1; v1 SEEDS + ENABLES only
// 1031 (disabled pending fixtures) + contingencies + corporate filings. closing/recording + trust
// funding are later DATA rows (no migration), so they are in the vocabulary now.
export const DEADLINE_FAMILY_VALUES = [
  'exchange_1031',
  'contract_contingency',
  'closing_recording',
  'trust_funding',
  'corporate_filing',
] as const;
export type DeadlineFamily = (typeof DEADLINE_FAMILY_VALUES)[number];

// Day-count convention. 1031 is calendar_no_roll by statute (the loud special case). roll_forward and
// business_days roll off weekends/holidays per the rollRule.
export const DAY_CONVENTION_VALUES = [
  'calendar_no_roll',
  'calendar_roll_forward',
  'business_days',
] as const;
export type DayConvention = (typeof DAY_CONVENTION_VALUES)[number];

// How a computed date that lands on a non-business day is rolled. 'none' pairs with calendar_no_roll.
export const ROLL_RULE_VALUES = ['none', 'next_business_day', 'previous_business_day'] as const;
export type RollRule = (typeof ROLL_RULE_VALUES)[number];

// matter_deadline lifecycle (disposition §2.2/§2.5). pending_confirm FIRES ticklers (G-C);
// expired_unresolved is permanent until a reasoned satisfy/waive.
export const DEADLINE_STATUS_VALUES = [
  'pending_confirm',
  'active',
  'satisfied',
  'waived',
  'expired_unresolved',
] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUS_VALUES)[number];

// How the anchor date was asserted (anchor provenance — always an attorney assertion in v1).
export const ANCHOR_SOURCE_VALUES = ['attorney_entered', 'document_linked'] as const;
export type AnchorSource = (typeof ANCHOR_SOURCE_VALUES)[number];

// ── Reusable field schemas ──

const UuidSchema = z.string().uuid();
// Date-only (America/New_York semantics; stored as DATE, read as 'YYYY-MM-DD'). No time, no TZ.
export const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const LeadTimeDefaultsSchema = z.array(z.number().int().nonnegative());

// Recurrence (nullable). Two shapes needed in v1: a fixed annual date (e.g. MD SDAT Apr 15) and an
// annual anniversary-month-end (e.g. VA SCC, due the last day of the formation-anniversary month).
export const RecurrenceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('annual_fixed'), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) }),
  z.object({ type: z.literal('annual_anniversary_month_end') }),
]);
export type Recurrence = z.infer<typeof RecurrenceSchema>;

// Constraint STORAGE shapes (the computeDeadline() runtime contract is frozen at the G-A review).
//  - constraintsSpec (on a rule revision): the rule DECLARES which compound caps apply + what inputs
//    they require. No status — it is a template.
//  - constraints (on a matter_deadline): the RESOLVED snapshot at computation; carries a status so an
//    unresolved cap (e.g. 1031 return_due_date_cap) is visibly unresolved, never silently dropped.
export const DeadlineConstraintSpecSchema = z.object({
  type: z.string().min(1),
  requires: z.array(z.string().min(1)),
  description: z.string().optional(),
});
export type DeadlineConstraintSpec = z.infer<typeof DeadlineConstraintSpecSchema>;

export const DEADLINE_CONSTRAINT_STATUS_VALUES = ['unresolved', 'resolved', 'not_applicable'] as const;
export const DeadlineConstraintSchema = DeadlineConstraintSpecSchema.extend({
  status: z.enum(DEADLINE_CONSTRAINT_STATUS_VALUES),
  resolvedValue: z.string().nullable().optional(),
});
export type DeadlineConstraint = z.infer<typeof DeadlineConstraintSchema>;

// ── Row schemas (parse-on-read) ──

export const DeadlineRuleRowSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema.nullable(), // NULL = firm default
  family: z.enum(DEADLINE_FAMILY_VALUES),
  ruleKey: z.string().min(1), // stable identifier for idempotent seeding + lookup
  label: z.string().min(1),
  enabled: z.boolean(),
  currentRevisionId: UuidSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type DeadlineRuleRow = z.infer<typeof DeadlineRuleRowSchema>;

export const DeadlineRuleRevisionRowSchema = z.object({
  id: UuidSchema,
  ruleId: UuidSchema,
  jurisdiction: z.string().nullable(), // NULL = federal/any
  anchorType: z.string().min(1),
  offsetDays: z.number().int().nullable(), // NULL = recurrence/fixed-date driven (no simple offset)
  dayConvention: z.enum(DAY_CONVENTION_VALUES),
  rollRule: z.enum(ROLL_RULE_VALUES),
  recurrence: RecurrenceSchema.nullable(),
  leadTimeDefaults: LeadTimeDefaultsSchema,
  constraintsSpec: z.array(DeadlineConstraintSpecSchema).nullable(),
  sourceTag: z.string().min(1), // attorney-verified legal authority citation
  notes: z.string().nullable(),
  createdAt: z.date(),
});
export type DeadlineRuleRevisionRow = z.infer<typeof DeadlineRuleRevisionRowSchema>;

export const MatterDeadlineRowSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  matterId: UuidSchema,
  ruleRevisionId: UuidSchema.nullable(), // NULL = manual/ad-hoc deadline (first-class)
  family: z.enum(DEADLINE_FAMILY_VALUES),
  description: z.string().min(1), // required (especially for manual deadlines)
  anchorType: z.string().min(1),
  anchorDate: DateOnlySchema, // visibly attorney-asserted
  anchorSource: z.enum(ANCHOR_SOURCE_VALUES),
  anchorBasis: z.string().nullable(),
  anchorDocumentId: UuidSchema.nullable(), // deadline<->source-document linkage where one exists
  computedDueDate: DateOnlySchema.nullable(),
  constraints: z.array(DeadlineConstraintSchema), // resolved snapshot (may be empty)
  attorneyOverrideDate: DateOnlySchema.nullable(),
  overrideReason: z.string().nullable(), // required when attorneyOverrideDate is set (app layer)
  status: z.enum(DEADLINE_STATUS_VALUES),
  confirmedByUserId: UuidSchema.nullable(),
  confirmedAt: z.date().nullable(),
  ruleSnapshot: z.unknown().nullable(), // snapshot of the operative rule fields at confirmation
  dispositionBasis: z.string().nullable(), // basis recorded on satisfy/waive (satisfy records a basis too)
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MatterDeadlineRow = z.infer<typeof MatterDeadlineRowSchema>;

export const TicklerRowSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  matterDeadlineId: UuidSchema,
  leadDays: z.number().int().nonnegative(), // LOGICAL lead-time — ack/snooze state keys to this
  fireAt: DateOnlySchema,
  acknowledgedByUserId: UuidSchema.nullable(),
  acknowledgedAt: z.date().nullable(),
  snoozedUntil: DateOnlySchema.nullable(),
  snoozeReason: z.string().nullable(),
  // NOTIFY-SUITE-1 N2: the per-tickler "alerted-at" cursor (NULL = not yet alerted). The N2 producer sets it
  // so each lead-time reminder fires at most once. Additive + .nullable().optional() (the established Inc-2
  // additive-column pattern) so a pre-migration row / existing TicklerRow literal parses without it.
  notifiedAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type TicklerRow = z.infer<typeof TicklerRowSchema>;

export const HolidayCalendarRowSchema = z.object({
  id: UuidSchema,
  jurisdiction: z.string().min(1), // 'US' (federal) | 'VA' | 'MD' — business-day math unions US + state
  date: DateOnlySchema,
  label: z.string().min(1),
  createdAt: z.date(),
});
export type HolidayCalendarRow = z.infer<typeof HolidayCalendarRowSchema>;
