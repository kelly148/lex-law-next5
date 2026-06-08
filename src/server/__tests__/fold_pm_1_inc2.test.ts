/**
 * FOLD-PM-1 Increment 2 — pure computeDeadline engine + the G-A mandated unit-fixture suite.
 *
 * Proves the frozen G-A contract (docs/engagements/FOLD-PM-1-GA-contract.md). Every fixture asserts the
 * full {dueDate, isProvisional, constraints} shape, including empty constraints on clean shapes. Fixtures
 * here test the ENGINE MECHANISM with synthetic dates; the attorney-approved 1031 fixtures that gate
 * ACTIVATION (G-B) are a separate Inc-6 artifact harvested from the 1031-0 interview.
 */

import { describe, it, expect } from 'vitest';
import {
  computeDeadline,
  type DeadlineRuleInput,
  type HolidayCalendar,
} from '../deadline/index.js';
import { addDays, addBusinessDays, rollToBusinessDay, isWeekend, fifteenthOfMonthAfter } from '../deadline/dateMath.js';

const makeCal = (holidays: string[], coverageEnd = '2030-12-31'): HolidayCalendar => ({
  jurisdictions: ['US'],
  holidays: new Set(holidays),
  coverageStart: '2026-01-01',
  coverageEnd,
});
const CAL = makeCal(['2026-07-03', '2026-12-25']); // Independence(observed Fri) + Christmas(Fri)

const base: DeadlineRuleInput = {
  anchorType: 'test', offsetDays: null, dayConvention: 'calendar_no_roll', rollRule: 'none',
  recurrence: null, constraintsSpec: null, jurisdiction: null, sourceTag: 'TEST',
};
const rule1031_45: DeadlineRuleInput = { ...base, anchorType: 'relinquished_transfer_date', offsetDays: 45, dayConvention: 'calendar_no_roll', rollRule: 'none', sourceTag: 'IRC 1031(a)(3)(A)' };
const CAP_SPEC = { type: 'return_due_date_cap', requires: ['entityType', 'fiscalYearEnd', 'taxYear', 'extensionFiled', 'filedDate'], description: 'earlier of 180 / return due / filed' };
const rule1031_180: DeadlineRuleInput = { ...base, anchorType: 'relinquished_transfer_date', offsetDays: 180, dayConvention: 'calendar_no_roll', rollRule: 'none', constraintsSpec: [CAP_SPEC], sourceTag: 'IRC 1031(a)(3)(B)' };
const ruleRollFwd: DeadlineRuleInput = { ...base, offsetDays: 10, dayConvention: 'calendar_roll_forward', rollRule: 'next_business_day' };
const ruleBizDays: DeadlineRuleInput = { ...base, offsetDays: 3, dayConvention: 'business_days', rollRule: 'next_business_day' };

describe('FOLD-PM-1 Inc2 — statutory calendar-no-roll (45/180)', () => {
  it('simple 45-day offset, clean shape (empty constraints, not provisional)', () => {
    const r = computeDeadline(rule1031_45, '2026-01-01', CAL);
    expect(r.dueDate).toBe('2026-02-15');
    expect(r.isProvisional).toBe(false);
    expect(r.constraints).toEqual([]);
    expect(r.basis.rollApplied).toBe(false);
  });

  it('45-day landing on a weekend does NOT roll (statutory)', () => {
    const r = computeDeadline(rule1031_45, '2026-06-03', CAL); // +45 = 2026-07-18 (Sat)
    expect(r.dueDate).toBe('2026-07-18');
    expect(isWeekend('2026-07-18')).toBe(true);
    expect(r.basis.rollApplied).toBe(false);
  });

  it('Feb 29 (leap) anchor + 45, no roll', () => {
    const r = computeDeadline(rule1031_45, '2028-02-29', CAL);
    expect(r.dueDate).toBe('2028-04-14');
  });

  it('DST is immune both directions (date unchanged across spring-forward and fall-back)', () => {
    expect(computeDeadline({ ...rule1031_45, offsetDays: 30 }, '2026-03-01', CAL).dueDate).toBe('2026-03-31'); // crosses 2026-03-08
    expect(computeDeadline({ ...rule1031_45, offsetDays: 30 }, '2026-10-25', CAL).dueDate).toBe('2026-11-24'); // crosses 2026-11-01
  });
});

describe('FOLD-PM-1 Inc2 — rolling conventions (NOT statutory)', () => {
  it('calendar_roll_forward: a holiday(Fri)+weekend lands forward to the next business day', () => {
    const r = computeDeadline(ruleRollFwd, '2026-12-15', CAL); // +10 = 2026-12-25 (Fri, Christmas holiday)
    expect(r.dueDate).toBe('2026-12-28'); // Sat,Sun skipped -> Mon
    expect(r.basis.rollApplied).toBe(true);
    expect(r.basis.rollFromDate).toBe('2026-12-25');
  });

  it('consecutive holidays are skipped', () => {
    const calX = makeCal(['2026-12-25', '2026-12-28']); // Christmas Fri + synthetic Mon holiday
    const r = computeDeadline(ruleRollFwd, '2026-12-15', calX); // naive 2026-12-25
    expect(r.dueDate).toBe('2026-12-29'); // Fri-hol, Sat, Sun, Mon-hol -> Tue
  });

  it('business_days counts business days, skipping weekends + holidays', () => {
    const r = computeDeadline(ruleBizDays, '2026-07-01', CAL); // +3 biz; 2026-07-03 is a holiday
    expect(r.dueDate).toBe('2026-07-07');
    expect(r.dueDate).toBe(addBusinessDays('2026-07-01', 3, CAL.holidays));
  });
});

describe('FOLD-PM-1 Inc2 — return_due_date_cap (three-leg earliest-of)', () => {
  it('UNRESOLVED with no cap inputs: naive 180 + provisional + unresolved constraint', () => {
    const r = computeDeadline(rule1031_180, '2026-05-08', CAL);
    expect(r.dueDate).toBe('2026-11-04'); // naive 180
    expect(r.isProvisional).toBe(true);
    expect(r.constraints).toHaveLength(1);
    expect(r.constraints[0]!.status).toBe('unresolved');
    expect(r.constraints[0]!.type).toBe('return_due_date_cap');
  });

  it('PARTIAL inputs stay unresolved (provisional)', () => {
    const r = computeDeadline(rule1031_180, '2026-05-08', CAL, {
      // missing taxYear + extensionFiled
      return_due_date_cap: { entityType: 'individual', fiscalYearEnd: '12-31' } as never,
    });
    expect(r.isProvisional).toBe(true);
    expect(r.constraints[0]!.status).toBe('unresolved');
  });

  it('entity-taxpayer cap (partnership ~March) controls a late-year transfer', () => {
    const r = computeDeadline(rule1031_180, '2026-11-01', CAL, {
      return_due_date_cap: { entityType: 'partnership', fiscalYearEnd: '12-31', taxYear: 2026, extensionFiled: false },
    });
    expect(r.dueDate).toBe('2027-03-15'); // earlier than naive 2027-04-30
    expect(r.isProvisional).toBe(false);
    expect(r.constraints[0]!.status).toBe('resolved');
    expect(r.constraints[0]!.resolvedValue).toBe('2027-03-15');
  });

  it('individual cap is ~April (4th month), NOT a hardcoded date', () => {
    const r = computeDeadline(rule1031_180, '2026-11-01', CAL, {
      return_due_date_cap: { entityType: 'individual', fiscalYearEnd: '12-31', taxYear: 2026, extensionFiled: false },
    });
    // naive 2027-04-30 vs return-due 2027-04-15 -> cap controls
    expect(r.dueDate).toBe('2027-04-15');
  });

  it('fiscal-year cap: a non-calendar FYE shifts the cap month', () => {
    const r = computeDeadline(rule1031_180, '2026-05-08', CAL, {
      return_due_date_cap: { entityType: 'partnership', fiscalYearEnd: '06-30', taxYear: 2026, extensionFiled: false },
    });
    expect(r.dueDate).toBe('2026-09-15'); // 15th of 3rd month after 06-30; earlier than naive 2026-11-04
  });

  it('extension pushes the return due date out (+6 months), so naive 180 may control', () => {
    const r = computeDeadline(rule1031_180, '2026-11-01', CAL, {
      return_due_date_cap: { entityType: 'partnership', fiscalYearEnd: '12-31', taxYear: 2026, extensionFiled: true },
    });
    // extended return due = 2027-09-15; naive 2027-04-30 is earlier -> statutory controls
    expect(r.dueDate).toBe('2027-04-30');
    expect(r.constraints[0]!.resolvedValue).toBe('2027-04-30');
  });

  it('cap-boundary TIE: naive 180 == return due date exactly', () => {
    const r = computeDeadline(rule1031_180, '2026-10-17', CAL, {
      return_due_date_cap: { entityType: 'individual', fiscalYearEnd: '12-31', taxYear: 2026, extensionFiled: false },
    });
    expect(r.dueDate).toBe('2027-04-15'); // both legs equal
    expect(r.isProvisional).toBe(false);
  });

  it('filed-early truncation: actual filing before completion controls', () => {
    const r = computeDeadline(rule1031_180, '2026-05-08', CAL, {
      return_due_date_cap: { entityType: 'individual', fiscalYearEnd: '12-31', taxYear: 2026, extensionFiled: false, filedDate: '2026-10-01' },
    });
    expect(r.dueDate).toBe('2026-10-01'); // earlier than naive 2026-11-04 and return-due 2027-04-15
  });

  it('cap date landing on a weekend ROLLS (filing deadline rolls; statutory days do not)', () => {
    const r = computeDeadline(rule1031_180, '2027-11-01', CAL, {
      return_due_date_cap: { entityType: 'individual', fiscalYearEnd: '12-31', taxYear: 2027, extensionFiled: false },
    });
    // return-due base 2028-04-15 (Sat) rolls forward to 2028-04-17 (Mon); naive 180 is later -> cap controls
    expect(r.dueDate).toBe('2028-04-17');
    expect(fifteenthOfMonthAfter(2027, 12, 4)).toBe('2028-04-15');
    expect(isWeekend('2028-04-15')).toBe(true);
    expect(r.constraints[0]!.resolvedValue).toBe('2028-04-17');
  });
});

describe('FOLD-PM-1 Inc2 — recurrence single-occurrence', () => {
  it('annual_fixed (e.g. MD SDAT April 15) for the anchor cycle, rolled per convention', () => {
    const rule: DeadlineRuleInput = { ...base, offsetDays: null, recurrence: { type: 'annual_fixed', month: 4, day: 15 }, dayConvention: 'calendar_roll_forward', rollRule: 'next_business_day' };
    const r = computeDeadline(rule, '2028-01-01', CAL); // cycle 2028; Apr 15 2028 is Sat -> rolls to Mon 17
    expect(r.dueDate).toBe('2028-04-17');
    expect(r.basis.recurrenceCycle).toBe('2028');
  });

  it('annual_anniversary_month_end (e.g. VA SCC) = last day of the anniversary month, no roll', () => {
    const rule: DeadlineRuleInput = { ...base, offsetDays: null, recurrence: { type: 'annual_anniversary_month_end' }, dayConvention: 'calendar_no_roll', rollRule: 'none' };
    const r = computeDeadline(rule, '2026-03-10', CAL); // formation in March -> 2026-03-31
    expect(r.dueDate).toBe('2026-03-31');
  });

  it('year-boundary recurrence is isolated from the cap (cycle year drives the date)', () => {
    const rule: DeadlineRuleInput = { ...base, offsetDays: null, recurrence: { type: 'annual_fixed', month: 1, day: 1 }, dayConvention: 'calendar_no_roll', rollRule: 'none' };
    expect(computeDeadline(rule, '2029-12-31', CAL).dueDate).toBe('2029-01-01'); // cycle = anchor year
  });
});

describe('FOLD-PM-1 Inc2 — coverage guard + determinism', () => {
  it('business-day roll past coverageEnd returns the un-rolled date + a holiday_coverage constraint', () => {
    const cal = makeCal([], '2026-12-31');
    const r = computeDeadline(ruleRollFwd, '2026-12-30', cal); // +10 = 2027-01-09, past coverage
    expect(r.dueDate).toBe('2027-01-09'); // un-rolled
    expect(r.isProvisional).toBe(true);
    expect(r.constraints.some((c) => c.type === 'holiday_coverage')).toBe(true);
  });

  it('is deterministic and throws on a malformed anchor', () => {
    const a = computeDeadline(rule1031_45, '2026-01-01', CAL);
    const b = computeDeadline(rule1031_45, '2026-01-01', CAL);
    expect(a).toEqual(b);
    expect(() => computeDeadline(rule1031_45, '2026-13-99', CAL)).toThrow();
  });

  it('sanity: helpers agree with the engine for a plain calendar add', () => {
    expect(addDays('2026-01-01', 45)).toBe('2026-02-15');
    expect(rollToBusinessDay('2026-12-25', CAL.holidays, 1)).toBe('2026-12-28');
  });
});
