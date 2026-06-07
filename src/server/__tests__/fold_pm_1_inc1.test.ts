/**
 * FOLD-PM-1 Increment 1 — deadline/tickler engine data core (Zod Wall) + seed/gate guards.
 *
 * Tests the additive Zod-Wall schemas (the testable core), the feature-flag default, and STRUCTURAL
 * guards over the migration seed content that CI can enforce even though it cannot judge whether the
 * legal content is correct (that is the attorney-verification-before-flag-ON gate). The owner-scoped
 * queries land in later increments; Inc 1 has NO behavior.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DeadlineRuleRowSchema,
  DeadlineRuleRevisionRowSchema,
  MatterDeadlineRowSchema,
  TicklerRowSchema,
  HolidayCalendarRowSchema,
  RecurrenceSchema,
  DeadlineConstraintSchema,
  DEADLINE_FAMILY_VALUES,
  DEADLINE_STATUS_VALUES,
} from '../../shared/schemas/deadline.js';
import { isDeadlineEngineEnabled } from '../config/featureFlags.js';

const now = new Date('2026-06-07T00:00:00Z');
const UUID = '11111111-1111-1111-1111-111111111111';
const UUID2 = '22222222-2222-2222-2222-222222222222';

const MIGRATION_SQL = readFileSync(
  fileURLToPath(new URL('../db/migrations/0021_fold_pm_1_deadline_engine.sql', import.meta.url)),
  'utf8',
);

describe('FOLD-PM-1 Inc1 — Zod Wall schemas', () => {
  it('DeadlineRuleRowSchema: parses a firm-default rule (null userId); rejects a bad family', () => {
    const row = { id: UUID, userId: null, family: 'exchange_1031', ruleKey: '1031_45_day_identification', label: '1031 45-day', enabled: false, currentRevisionId: UUID2, createdAt: now, updatedAt: now };
    expect(DeadlineRuleRowSchema.safeParse(row).success).toBe(true);
    expect(DeadlineRuleRowSchema.safeParse({ ...row, userId: UUID2 }).success).toBe(true);
    expect(DeadlineRuleRowSchema.safeParse({ ...row, family: 'made_up' }).success).toBe(false);
    expect(DeadlineRuleRowSchema.safeParse({ ...row, ruleKey: '' }).success).toBe(false);
  });

  it('DeadlineRuleRevisionRowSchema: parses a 1031 revision with an earlier-of constraintsSpec; rejects a bad convention', () => {
    const row = {
      id: UUID, ruleId: UUID2, jurisdiction: null, anchorType: 'relinquished_transfer_date',
      offsetDays: 180, dayConvention: 'calendar_no_roll', rollRule: 'none', recurrence: null,
      leadTimeDefaults: [60, 45, 30, 14, 7, 1],
      constraintsSpec: [{ type: 'return_due_date_cap', requires: ['taxYear', 'extensionFiled'], description: 'earlier of' }],
      sourceTag: 'IRC 1031(a)(3)(B)', notes: null, createdAt: now,
    };
    expect(DeadlineRuleRevisionRowSchema.safeParse(row).success).toBe(true);
    expect(DeadlineRuleRevisionRowSchema.safeParse({ ...row, offsetDays: null }).success).toBe(true); // recurrence-driven
    expect(DeadlineRuleRevisionRowSchema.safeParse({ ...row, dayConvention: 'lunar' }).success).toBe(false);
    expect(DeadlineRuleRevisionRowSchema.safeParse({ ...row, rollRule: 'sideways' }).success).toBe(false);
    expect(DeadlineRuleRevisionRowSchema.safeParse({ ...row, sourceTag: '' }).success).toBe(false);
  });

  it('MatterDeadlineRowSchema: parses a pending_confirm instance; rejects a bad status and a bad date', () => {
    const row = {
      id: UUID, userId: UUID2, matterId: UUID, ruleRevisionId: UUID2, family: 'contract_contingency',
      description: 'Financing contingency', anchorType: 'contract_ratification', anchorDate: '2026-06-01',
      anchorSource: 'attorney_entered', anchorBasis: null, anchorDocumentId: null, computedDueDate: '2026-06-22',
      constraints: [], attorneyOverrideDate: null, overrideReason: null, status: 'pending_confirm',
      confirmedByUserId: null, confirmedAt: null, ruleSnapshot: null, dispositionBasis: null, createdAt: now, updatedAt: now,
    };
    expect(MatterDeadlineRowSchema.safeParse(row).success).toBe(true);
    expect(MatterDeadlineRowSchema.safeParse({ ...row, ruleRevisionId: null }).success).toBe(true); // manual/ad-hoc
    expect(MatterDeadlineRowSchema.safeParse({ ...row, status: 'snoozed' }).success).toBe(false);
    expect(MatterDeadlineRowSchema.safeParse({ ...row, anchorDate: '06/01/2026' }).success).toBe(false);
    expect(MatterDeadlineRowSchema.safeParse({ ...row, description: '' }).success).toBe(false);
  });

  it('TicklerRowSchema + HolidayCalendarRowSchema: parse valid rows; reject bad shapes', () => {
    const t = { id: UUID, userId: UUID2, matterDeadlineId: UUID, leadDays: 30, fireAt: '2026-05-02', acknowledgedByUserId: null, acknowledgedAt: null, snoozedUntil: null, snoozeReason: null, createdAt: now, updatedAt: now };
    expect(TicklerRowSchema.safeParse(t).success).toBe(true);
    expect(TicklerRowSchema.safeParse({ ...t, leadDays: -1 }).success).toBe(false);
    const h = { id: UUID, jurisdiction: 'US', date: '2026-07-03', label: 'Independence Day', createdAt: now };
    expect(HolidayCalendarRowSchema.safeParse(h).success).toBe(true);
    expect(HolidayCalendarRowSchema.safeParse({ ...h, date: '2026-7-3' }).success).toBe(false);
  });

  it('RecurrenceSchema parses both seeded shapes; DeadlineConstraint carries a status', () => {
    expect(RecurrenceSchema.safeParse({ type: 'annual_fixed', month: 4, day: 15 }).success).toBe(true);
    expect(RecurrenceSchema.safeParse({ type: 'annual_anniversary_month_end' }).success).toBe(true);
    expect(RecurrenceSchema.safeParse({ type: 'weekly' }).success).toBe(false);
    expect(DeadlineConstraintSchema.safeParse({ type: 'return_due_date_cap', requires: ['taxYear'], status: 'unresolved' }).success).toBe(true);
    expect(DeadlineConstraintSchema.safeParse({ type: 'x', requires: [], status: 'maybe' }).success).toBe(false);
  });

  it('the v1 families + lifecycle statuses are present in the vocabularies', () => {
    for (const f of ['exchange_1031', 'contract_contingency', 'corporate_filing', 'closing_recording', 'trust_funding']) {
      expect(DEADLINE_FAMILY_VALUES).toContain(f);
    }
    for (const s of ['pending_confirm', 'active', 'satisfied', 'waived', 'expired_unresolved']) {
      expect(DEADLINE_STATUS_VALUES).toContain(s);
    }
  });
});

describe('FOLD-PM-1 Inc1 — feature flag default', () => {
  const prev = process.env['DEADLINE_ENGINE_ENABLED'];
  afterEach(() => {
    if (prev === undefined) delete process.env['DEADLINE_ENGINE_ENABLED'];
    else process.env['DEADLINE_ENGINE_ENABLED'] = prev;
  });

  it('defaults OFF; only the exact string "true" enables it', () => {
    delete process.env['DEADLINE_ENGINE_ENABLED'];
    expect(isDeadlineEngineEnabled()).toBe(false);
    process.env['DEADLINE_ENGINE_ENABLED'] = 'TRUE';
    expect(isDeadlineEngineEnabled()).toBe(false);
    process.env['DEADLINE_ENGINE_ENABLED'] = '1';
    expect(isDeadlineEngineEnabled()).toBe(false);
    process.env['DEADLINE_ENGINE_ENABLED'] = 'true';
    expect(isDeadlineEngineEnabled()).toBe(true);
  });
});

describe('FOLD-PM-1 Inc1 — migration seed structural guards (CI-enforceable)', () => {
  it('migration is additive only (no destructive DDL)', () => {
    expect(/CREATE TABLE IF NOT EXISTS/.test(MIGRATION_SQL)).toBe(true);
    expect(/\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i.test(MIGRATION_SQL)).toBe(false);
    expect(/\bTRUNCATE\b/i.test(MIGRATION_SQL)).toBe(false);
    // No bare DELETE of seed data (DELETE FROM); seeds are idempotent upserts.
    expect(/\bDELETE\s+FROM\b/i.test(MIGRATION_SQL)).toBe(false);
  });

  it('G-B: both 1031 rules are seeded DISABLED (enabled=0); no 1031 rule is seeded enabled=1', () => {
    // The 1031 rule rows are the two with ruleKey 1031_* in the deadline_rule INSERT. They must carry
    // enabled=0. We assert the two 1031 VALUES lines end with ", 0, '<revisionUuid>')".
    const ruleLines = MIGRATION_SQL.split('\n').filter((l) => l.includes("'1031_"));
    expect(ruleLines.length).toBe(2);
    for (const l of ruleLines) {
      expect(/,\s*0,\s*'d1054c00-/.test(l)).toBe(true); // enabled = 0
      expect(/,\s*1,\s*'d1054c00-/.test(l)).toBe(false); // never enabled = 1
    }
  });

  it('G-A: the 180-day 1031 revision declares the return_due_date_cap constraint', () => {
    expect(MIGRATION_SQL.includes('return_due_date_cap')).toBe(true);
    expect(MIGRATION_SQL.includes('"requires":["taxYear","extensionFiled"]')).toBe(true);
  });

  it('1031 rules use calendar_no_roll (statutory: calendar days, no roll)', () => {
    // Each relinquished_transfer_date revision line must specify calendar_no_roll + none.
    const r1031 = MIGRATION_SQL.split('\n').filter((l) => l.includes('relinquished_transfer_date'));
    expect(r1031.length).toBe(2);
    for (const l of r1031) {
      expect(l.includes('calendar_no_roll')).toBe(true);
      expect(l.includes("'none'")).toBe(true);
    }
  });
});
