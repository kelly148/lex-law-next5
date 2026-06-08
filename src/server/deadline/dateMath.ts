/**
 * dateMath.ts — FOLD-PM-1 Increment 2: pure, date-only calendar arithmetic for the deadline engine.
 *
 * PURE + DETERMINISTIC: no I/O, no ambient clock, no Date.now(). Dates are 'YYYY-MM-DD' strings.
 * All arithmetic goes through UTC midnight, which makes it DST-IMMUNE by construction: adding N calendar
 * days to a date never shifts the calendar date across a spring-forward/fall-back boundary (UTC has no
 * DST). America/New_York is the engine's SEMANTIC timezone, but date-only counting needs no wall clock —
 * only the clock SEAM that decides "today" (Inc 3) is timezone-sensitive, and it is injected there.
 */

export type DateOnly = string; // 'YYYY-MM-DD'

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateOnly(s: string): boolean {
  if (!YMD_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  // Reject normalized-away values like 2026-02-30 -> Mar 2.
  return toDateOnly(new Date(t)) === s;
}

/** Parse a 'YYYY-MM-DD' into a UTC-midnight Date. Throws on malformed input (fail-loud). */
export function parseDateOnly(s: DateOnly): Date {
  if (!isValidDateOnly(s)) throw new Error(`invalid DateOnly: ${JSON.stringify(s)}`);
  return new Date(Date.parse(`${s}T00:00:00Z`));
}

/** Format a UTC Date back to 'YYYY-MM-DD'. */
export function toDateOnly(d: Date): DateOnly {
  return d.toISOString().slice(0, 10);
}

/** Add N calendar days (N may be negative). DST-immune (UTC arithmetic). */
export function addDays(s: DateOnly, n: number): DateOnly {
  const d = parseDateOnly(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateOnly(d);
}

/** Day of week: 0=Sunday .. 6=Saturday (UTC). */
export function dayOfWeek(s: DateOnly): number {
  return parseDateOnly(s).getUTCDay();
}

export function isWeekend(s: DateOnly): boolean {
  const w = dayOfWeek(s);
  return w === 0 || w === 6;
}

export function isHoliday(s: DateOnly, holidays: ReadonlySet<DateOnly>): boolean {
  return holidays.has(s);
}

export function isBusinessDay(s: DateOnly, holidays: ReadonlySet<DateOnly>): boolean {
  return !isWeekend(s) && !isHoliday(s, holidays);
}

/**
 * Roll a date to the next/previous BUSINESS day if it lands on a weekend or holiday (skipping any number
 * of consecutive non-business days). A business day is returned unchanged. `dir` = +1 forward, -1 back.
 * Guard caps the walk so a malformed/over-wide holiday set can never loop forever.
 */
export function rollToBusinessDay(
  s: DateOnly,
  holidays: ReadonlySet<DateOnly>,
  dir: 1 | -1,
): DateOnly {
  let cur = s;
  for (let i = 0; i < 366; i++) {
    if (isBusinessDay(cur, holidays)) return cur;
    cur = addDays(cur, dir);
  }
  throw new Error('rollToBusinessDay: no business day within 366 days (holiday set malformed?)');
}

/**
 * Add N business days forward from `s` (N >= 0), skipping weekends + holidays. addBusinessDays(s, 0)
 * returns the next business day on/after s. Guarded against runaway holiday sets.
 */
export function addBusinessDays(s: DateOnly, n: number, holidays: ReadonlySet<DateOnly>): DateOnly {
  if (n < 0) throw new Error('addBusinessDays: N must be >= 0');
  let cur = rollToBusinessDay(s, holidays, 1); // land on a business day first (the 0th)
  let added = 0;
  let guard = 0;
  while (added < n) {
    cur = addDays(cur, 1);
    if (isBusinessDay(cur, holidays)) added++;
    if (++guard > 100000) throw new Error('addBusinessDays: runaway (holiday set malformed?)');
  }
  return cur;
}

/** Last day of a month (1-based month). */
export function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * The 15th day of the month that is `monthsAfter` months after a fiscal-year-end (month1/year), used by
 * the return-due-date cap. Pure month arithmetic with year carry; day is clamped to the month length
 * (always 15, so no clamp needed, but lastDayOfMonth keeps it safe for future day values).
 */
export function fifteenthOfMonthAfter(year: number, fyeMonth1: number, monthsAfter: number, day = 15): DateOnly {
  const zero = fyeMonth1 - 1 + monthsAfter; // 0-based month index from year start
  const y = year + Math.floor(zero / 12);
  const m1 = (zero % 12) + 1;
  const d = Math.min(day, lastDayOfMonth(y, m1));
  return `${String(y).padStart(4, '0')}-${String(m1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Add whole months to a date (day clamped to target month length). Used for the +6mo extension. */
export function addMonths(s: DateOnly, months: number): DateOnly {
  const d = parseDateOnly(s);
  const zero = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const y = Math.floor(zero / 12);
  const m1 = (zero % 12) + 1;
  const day = Math.min(d.getUTCDate(), lastDayOfMonth(y, m1));
  return `${String(y).padStart(4, '0')}-${String(m1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Earliest of a list of dates (ignores null/undefined). Returns null if none. */
export function earliestOf(dates: Array<DateOnly | null | undefined>): DateOnly | null {
  let best: DateOnly | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (best === null || d < best) best = d; // ISO 'YYYY-MM-DD' sorts lexicographically = chronologically
  }
  return best;
}

/** Month (1-based) of a 'MM-DD' fiscal-year-end string. Throws on malformed input. */
export function monthOfMmDd(mmdd: string): number {
  if (!/^\d{2}-\d{2}$/.test(mmdd)) throw new Error(`invalid MM-DD: ${JSON.stringify(mmdd)}`);
  const m = Number(mmdd.slice(0, 2));
  if (m < 1 || m > 12) throw new Error(`invalid month in MM-DD: ${JSON.stringify(mmdd)}`);
  return m;
}
