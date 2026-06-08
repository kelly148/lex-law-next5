/**
 * computeDeadline.ts — FOLD-PM-1 Increment 2: the pure deadline computation core.
 *
 * Implements the G-A FROZEN CONTRACT (docs/engagements/FOLD-PM-1-GA-contract.md). PURE: no I/O, no LLM,
 * no DB, no ambient clock. Same inputs -> same output (fully fixture-tested). Consumed downstream by
 * FOLD-ADV-1031-1 and FOLD-PM-4 — they call this; they never grow a private timeline engine.
 *
 * The whole safety property lives in `constraints[]` + `isProvisional`: when a compound deadline depends
 * on inputs the system does not have (the 1031 return_due_date_cap), the engine returns the NAIVE date +
 * a visible unresolved constraint + isProvisional:true — it never emits a confidently-wrong compound date.
 * When the typed `constraintInputs` ARE supplied, the SAME pure call resolves the cap deterministically.
 *
 * NO autonomous/egress action of any kind. This computes; it never acts, sends, or files.
 */

import type { Recurrence, DeadlineConstraintSpec, DeadlineConstraint } from '../../shared/schemas/deadline.js';
import {
  type DateOnly,
  addDays,
  addBusinessDays,
  addMonths,
  rollToBusinessDay,
  isValidDateOnly,
  fifteenthOfMonthAfter,
  monthOfMmDd,
  earliestOf,
  lastDayOfMonth,
} from './dateMath.js';

export type DayConvention = 'calendar_no_roll' | 'calendar_roll_forward' | 'business_days';
export type RollRule = 'none' | 'next_business_day' | 'previous_business_day';

export interface DeadlineRuleInput {
  anchorType: string;
  offsetDays: number | null;
  dayConvention: DayConvention;
  rollRule: RollRule;
  recurrence: Recurrence | null;
  constraintsSpec: DeadlineConstraintSpec[] | null;
  jurisdiction: string | null;
  sourceTag: string;
}

/** CHANGE 1 + 2 (1031-0 disposition §4): typed per constraint type. Partial inputs stay provisional. */
export interface ReturnDueDateCapInputs {
  entityType: 'partnership' | 's_corp' | 'individual' | 'c_corp';
  fiscalYearEnd: string; // 'MM-DD'; NEVER a hardcoded April date
  taxYear: number;
  extensionFiled: boolean;
  filedDate?: DateOnly | null;
}
export interface ConstraintInputs {
  return_due_date_cap?: ReturnDueDateCapInputs;
}

export interface DeadlineBasis {
  anchorDate: DateOnly;
  anchorType: string;
  offsetDays: number | null;
  dayConvention: DayConvention;
  rollRule: RollRule;
  rollApplied: boolean;
  rollFromDate: DateOnly | null;
  recurrenceCycle: string | null;
  sourceTag: string;
  explanation: string;
}

export interface DeadlineComputation {
  dueDate: DateOnly | null;
  isProvisional: boolean;
  basis: DeadlineBasis;
  constraints: DeadlineConstraint[];
}

export interface HolidayCalendar {
  jurisdictions: string[];
  holidays: ReadonlySet<DateOnly>;
  coverageStart: DateOnly;
  coverageEnd: DateOnly;
}

const RETURN_DUE_MONTHS_AFTER: Record<ReturnDueDateCapInputs['entityType'], number> = {
  partnership: 3, // ~March 15 for a calendar year (15th of the 3rd month after FYE)
  s_corp: 3,
  individual: 4, // ~April 15 for a calendar year (15th of the 4th month after FYE)
  c_corp: 4,
};

/**
 * Resolve the return-due-date cap (leg b) to a final, rolled filing date. RULE-SHAPE, not pinned
 * authority: the month offsets / +6mo extension encode the doctrine shape the 1031-0 panel named;
 * pinned citations + attorney-approved fixtures gate 1031 ACTIVATION (Inc 6). The cap is a FILING
 * deadline and DOES roll off weekends/holidays (CHANGE 3 asymmetry) — unlike the statutory 45/180 days.
 */
function resolveReturnDueDate(inputs: ReturnDueDateCapInputs, holidays: ReadonlySet<DateOnly>): DateOnly {
  const monthsAfter = RETURN_DUE_MONTHS_AFTER[inputs.entityType];
  const fyeMonth = monthOfMmDd(inputs.fiscalYearEnd);
  let base = fifteenthOfMonthAfter(inputs.taxYear, fyeMonth, monthsAfter);
  if (inputs.extensionFiled) base = addMonths(base, 6);
  return rollToBusinessDay(base, holidays, 1); // filing deadline rolls forward
}

function hasAllCapFields(i: ReturnDueDateCapInputs | undefined): i is ReturnDueDateCapInputs {
  if (!i) return false;
  // Required: entityType, fiscalYearEnd, taxYear, extensionFiled. filedDate optional.
  if (i.entityType == null || i.fiscalYearEnd == null || i.taxYear == null || i.extensionFiled == null) return false;
  if (i.filedDate != null && !isValidDateOnly(i.filedDate)) return false;
  return true;
}

/** Compute one occurrence's due date. See the frozen G-A contract for full semantics. */
export function computeDeadline(
  rule: DeadlineRuleInput,
  anchorDate: DateOnly,
  calendar: HolidayCalendar,
  constraintInputs?: ConstraintInputs,
): DeadlineComputation {
  if (!isValidDateOnly(anchorDate)) throw new Error(`computeDeadline: invalid anchorDate ${JSON.stringify(anchorDate)}`);

  const constraints: DeadlineConstraint[] = [];
  let rollApplied = false;
  let rollFromDate: DateOnly | null = null;
  let recurrenceCycle: string | null = null;
  let dueDate: DateOnly | null = null;
  let explanation = '';

  const needsHolidays = rule.dayConvention !== 'calendar_no_roll';
  const rollDir: 1 | -1 = rule.rollRule === 'previous_business_day' ? -1 : 1;

  // ── Branch A: offset-driven (the 1031 45/180 + contingency shape) ──
  if (rule.offsetDays != null) {
    if (rule.dayConvention === 'calendar_no_roll') {
      dueDate = addDays(anchorDate, rule.offsetDays);
      explanation = `${anchorDate} + ${rule.offsetDays} calendar days = ${dueDate} (no weekend/holiday roll — statutory).`;
    } else if (rule.dayConvention === 'business_days') {
      const naive = addDays(anchorDate, rule.offsetDays);
      if (naive > calendar.coverageEnd) {
        dueDate = naive;
        pushCoverage(constraints, calendar.coverageEnd, naive);
        explanation = `${anchorDate} + ${rule.offsetDays} business days needs holiday data past ${calendar.coverageEnd}; returning the un-rolled calendar date pending calendar coverage.`;
      } else {
        dueDate = addBusinessDays(anchorDate, rule.offsetDays, calendar.holidays);
        explanation = `${anchorDate} + ${rule.offsetDays} business days = ${dueDate}.`;
      }
    } else {
      // calendar_roll_forward (or previous_business_day): naive calendar offset, then roll off non-business days.
      const naive = addDays(anchorDate, rule.offsetDays);
      if (naive > calendar.coverageEnd) {
        dueDate = naive;
        pushCoverage(constraints, calendar.coverageEnd, naive);
        explanation = `${anchorDate} + ${rule.offsetDays} calendar days = ${naive}, which is past calendar coverage (${calendar.coverageEnd}); returning the un-rolled date pending coverage.`;
      } else {
        const rolled = rollToBusinessDay(naive, calendar.holidays, rollDir);
        rollApplied = rolled !== naive;
        rollFromDate = rollApplied ? naive : null;
        dueDate = rolled;
        explanation = rollApplied
          ? `${anchorDate} + ${rule.offsetDays} calendar days = ${naive}, rolled ${rollDir === 1 ? 'forward' : 'back'} to the ${rollDir === 1 ? 'next' : 'previous'} business day ${rolled}.`
          : `${anchorDate} + ${rule.offsetDays} calendar days = ${dueDate} (a business day; no roll needed).`;
      }
    }
  } else if (rule.recurrence != null) {
    // ── Branch B: recurrence single-occurrence (enumeration is the Inc-3 lifecycle wrapper) ──
    const occ = recurrenceOccurrence(rule.recurrence, anchorDate);
    recurrenceCycle = occ.cycle;
    if (needsHolidays && occ.date <= calendar.coverageEnd) {
      const rolled = rollToBusinessDay(occ.date, calendar.holidays, rollDir);
      rollApplied = rolled !== occ.date;
      rollFromDate = rollApplied ? occ.date : null;
      dueDate = rolled;
    } else if (needsHolidays && occ.date > calendar.coverageEnd) {
      dueDate = occ.date;
      pushCoverage(constraints, calendar.coverageEnd, occ.date);
    } else {
      dueDate = occ.date;
    }
    explanation = `${occ.label} for cycle ${occ.cycle} = ${occ.date}${rollApplied ? ` (rolled to ${dueDate})` : ''}.`;
  } else {
    // No offset and no recurrence -> not computable from this rule alone (e.g. attorney must supply).
    explanation = 'rule has neither an offset nor a recurrence; due date is not computable without attorney input.';
  }

  // ── return_due_date_cap (1031 180-day): three-leg earliest-of (CHANGE 2) ──
  const capSpec = (rule.constraintsSpec ?? []).find((c) => c.type === 'return_due_date_cap');
  if (capSpec) {
    const capIn = constraintInputs?.return_due_date_cap;
    if (hasAllCapFields(capIn) && dueDate != null) {
      const returnDue = resolveReturnDueDate(capIn, calendar.holidays); // leg (b), rolled
      const naive180 = dueDate; // leg (a), the statutory no-roll date computed above
      const filed = capIn.filedDate ?? null; // leg (c)
      const controlling = earliestOf([naive180, returnDue, filed])!;
      const which =
        controlling === filed ? 'actual return filing date (early filing truncates)' :
        controlling === returnDue ? 'return due date' : 'statutory 180-day date';
      constraints.push({
        ...capSpec,
        status: 'resolved',
        resolvedValue: controlling,
      });
      dueDate = controlling;
      explanation += ` Cap resolved: earliest of statutory ${naive180}, return due ${returnDue}${filed ? `, filed ${filed}` : ''} -> ${controlling} (${which}).`;
    } else {
      constraints.push({ ...capSpec, status: 'unresolved' });
      explanation += ` Cap UNRESOLVED: the controlling date may be earlier (return due date / actual filing). Provide ${capSpec.requires.join(', ')} to resolve.`;
    }
  }

  const isProvisional = constraints.some((c) => c.status === 'unresolved');

  return {
    dueDate,
    isProvisional,
    basis: {
      anchorDate,
      anchorType: rule.anchorType,
      offsetDays: rule.offsetDays,
      dayConvention: rule.dayConvention,
      rollRule: rule.rollRule,
      rollApplied,
      rollFromDate,
      recurrenceCycle,
      sourceTag: rule.sourceTag,
      explanation,
    },
    constraints,
  };
}

function pushCoverage(constraints: DeadlineConstraint[], coverageEnd: DateOnly, needed: DateOnly): void {
  constraints.push({
    type: 'holiday_coverage',
    requires: ['holiday_calendar_through_' + needed],
    status: 'unresolved',
    description: `Business-day math needs holiday data through ${needed}, but the seeded calendar ends ${coverageEnd}. The date is returned un-rolled pending calendar coverage.`,
  });
}

interface Occurrence { date: DateOnly; cycle: string; label: string }
function recurrenceOccurrence(rec: Recurrence, anchorDate: DateOnly): Occurrence {
  const year = Number(anchorDate.slice(0, 4));
  if (rec.type === 'annual_fixed') {
    const date = `${String(year).padStart(4, '0')}-${String(rec.month).padStart(2, '0')}-${String(Math.min(rec.day, lastDayOfMonth(year, rec.month))).padStart(2, '0')}`;
    return { date, cycle: String(year), label: `annual fixed date ${String(rec.month).padStart(2, '0')}-${String(rec.day).padStart(2, '0')}` };
  }
  // annual_anniversary_month_end: last day of the anchor's (anniversary) month, in the cycle year.
  const month = Number(anchorDate.slice(5, 7));
  const day = lastDayOfMonth(year, month);
  const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { date, cycle: String(year), label: 'anniversary month-end' };
}
