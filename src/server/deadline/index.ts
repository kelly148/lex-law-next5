/**
 * FOLD-PM-1 deadline engine — Increment 2 importable server module (the consumable contract).
 *
 * Stable signatures consumed by FOLD-ADV-1031-1 and FOLD-PM-4 (recorded dependency). Pure; no I/O.
 * The instance lifecycle + tRPC read API land in Increment 3 (where deadline instances exist to read).
 */
export {
  computeDeadline,
  type DeadlineRuleInput,
  type DeadlineComputation,
  type DeadlineBasis,
  type HolidayCalendar,
  type ConstraintInputs,
  type ReturnDueDateCapInputs,
  type DayConvention,
  type RollRule,
} from './computeDeadline.js';
export * from './dateMath.js';
