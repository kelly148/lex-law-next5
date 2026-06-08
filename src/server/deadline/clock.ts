/**
 * clock.ts — FOLD-PM-1 Increment 3: the injectable, server-authoritative clock seam.
 *
 * Everything that needs "today" (expiry sweeps, the rolling-12-month tickler horizon, the
 * within-N-days integrity check) takes a DeadlineClock instead of calling `new Date()` directly, so:
 *   - expiry/horizon behavior is DETERMINISTIC and fixture-testable (inject a fixed date);
 *   - "today" is computed in a FIXED timezone (America/New_York), date-only — a deadline does not
 *     silently flip to overdue at UTC midnight while it is still today in the office.
 *
 * The engine's date math (computeDeadline) is clock-free and pure; only these lifecycle reads need a
 * clock, and it is always passed in (never ambient) so production and tests share one code path.
 */

import type { DateOnly } from './dateMath.js';

export interface DeadlineClock {
  /** Today's date-only ('YYYY-MM-DD') in America/New_York. */
  today(): DateOnly;
}

// en-CA formats as YYYY-MM-DD; the timeZone option pins the civil date to America/New_York.
const NY_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The real server clock: today's civil date in America/New_York. */
export const systemClock: DeadlineClock = {
  today(): DateOnly {
    return NY_DATE_FMT.format(new Date());
  },
};

/** A fixed clock for deterministic tests / replays. */
export function fixedClock(date: DateOnly): DeadlineClock {
  return { today: () => date };
}
