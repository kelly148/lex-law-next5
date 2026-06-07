# FOLD-PM-1 — G-A FROZEN CONTRACT: `computeDeadline`

**Status:** FROZEN 2026-06-08 (operator approve contract:FOLD-PM-1, with named pre-freeze changes from
`INTERVIEW-1031-0_consolidated_disposition_2026-06-08.md` §4, binding). Does not change without a new
disposition. Consumed downstream by **FOLD-ADV-1031-1** and **FOLD-PM-4** — they call this engine, never
grow a private timeline engine.

This is the pre-freeze G-A review record (CLAUDE.md Rule 12 architecture artifact). Increment 2
implements exactly this.

---

## Signature

```ts
function computeDeadline(
  rule: DeadlineRuleInput,
  anchorDate: DateOnly,                  // 'YYYY-MM-DD', America/New_York semantics, attorney-asserted
  calendar: HolidayCalendar,
  constraintInputs?: ConstraintInputs,   // CHANGE 1: optional typed resolution seam (pure, deterministic)
): DeadlineComputation;
```

Pure: no I/O, no LLM, no DB, no ambient clock. Same inputs → same output (fully fixture-testable). Date
arithmetic is date-only via UTC (DST-immune): adding N calendar days never shifts the calendar date
across a DST boundary.

## Types

```ts
type DeadlineOnly = string;            // 'YYYY-MM-DD'

interface DeadlineRuleInput {
  anchorType: string;
  offsetDays: number | null;           // null = recurrence/fixed-date driven
  dayConvention: 'calendar_no_roll' | 'calendar_roll_forward' | 'business_days';
  rollRule: 'none' | 'next_business_day' | 'previous_business_day';
  recurrence: Recurrence | null;
  constraintsSpec: DeadlineConstraintSpec[] | null;
  jurisdiction: string | null;
  sourceTag: string;
}

// CHANGE 1 + 2: typed per constraint type. Partial inputs stay provisional.
interface ConstraintInputs {
  return_due_date_cap?: ReturnDueDateCapInputs;
}
interface ReturnDueDateCapInputs {
  entityType: 'partnership' | 's_corp' | 'individual' | 'c_corp'; // → return-type due-date base month
  fiscalYearEnd: string;        // 'MM-DD' (e.g. '12-31'); cap is NEVER a hardcoded April date
  taxYear: number;              // tax year of the transfer
  extensionFiled: boolean;      // extension pushes the return due date out (+6 months, rule-shape)
  filedDate?: DeadlineOnly | null; // CHANGE 2 leg (c): actual filing before completion truncates
}

interface DeadlineComputation {
  dueDate: DeadlineOnly | null;        // null only when genuinely uncomputable (e.g. no anchor)
  isProvisional: boolean;              // true iff any constraint.status === 'unresolved'
  basis: {
    anchorDate: DeadlineOnly;
    anchorType: string;
    offsetDays: number | null;
    dayConvention: string;
    rollRule: string;
    rollApplied: boolean;
    rollFromDate: DeadlineOnly | null;
    recurrenceCycle: string | null;
    sourceTag: string;
    explanation: string;               // plain-English derivation (audit + "why this date" UI)
  };
  constraints: DeadlineConstraint[];   // [] when none apply
}
```

## Semantics (ratified decisions 1–4 + the 1031-0 named changes)

1. **Statutory components never roll.** `calendar_no_roll` (the 1031 45/180 case) skips all roll logic —
   a date landing on a weekend/holiday stays put (statutory). `calendar_roll_forward` / `business_days`
   roll per `rollRule`.

2. **`return_due_date_cap` — THREE-LEG earliest-of (CHANGE 2).** The controlling date is the **earliest**
   of:
   - (a) **naive anchor + 180** — statutory, **no roll**;
   - (b) the **return due date** = the 15th day of the *N*th month after `fiscalYearEnd`, where *N* = 3
     for `partnership`/`s_corp` (≈ March for a calendar year) and *N* = 4 for `individual`/`c_corp`
     (≈ April for a calendar year); **+6 months if `extensionFiled`**; driven by `fiscalYearEnd`/`taxYear`,
     **never a hardcoded date**. This leg **DOES roll** off weekends/holidays (it is a filing deadline) —
     **CHANGE 3 roll asymmetry**;
   - (c) the **actual `filedDate`** if supplied and earlier (early filing truncates the exchange period).

   The earlier-of comparison uses leg (b)'s **final rolled** date. The engine never applies roll to legs
   (a) or (c).

3. **Resolution seam (CHANGE 1).** Without `constraintInputs.return_due_date_cap`, or with required fields
   missing, the cap constraint is **`unresolved`**: `dueDate` = naive anchor+180, `isProvisional: true`.
   With all required fields present (`entityType`, `fiscalYearEnd`, `taxYear`, `extensionFiled`; `filedDate`
   optional), the same pure call **resolves** the cap: `dueDate` = the three-leg earliest, constraint
   `resolved`, `isProvisional: false`. Partial inputs stay provisional. Resolution lives in the PURE core
   (deterministic, fixture-testable) — never as untyped lifecycle math.

4. **Holiday-coverage gap.** If a roll would need holiday data past `calendar.coverageEnd`, the engine
   returns the **un-rolled** date + an `unresolved` `holiday_coverage` constraint + `isProvisional: true` —
   never assumes a non-holiday.

5. **`basis` is a structured record** (not a string) — audit log, "why this date" UI, and future export
   all read one derivation.

6. **Recurrence enumeration is a thin lifecycle-layer wrapper** (Inc 3) that calls `computeDeadline` once
   per cycle. `computeDeadline` itself is single-occurrence. `previous_business_day` is retained in the
   type (future-proof; no v1 seed uses it).

## Mandatory unit fixtures (Inc 2)

Listed G-A fixtures: Feb 29 anchor + offset; DST both directions (date unchanged); holiday-on-weekend per
roll rule; consecutive holidays; 1031 earlier-of via `constraints[]`; year-boundary recurrence; 1031
calendar-no-roll on weekend. **Plus the 1031-0 panel additions (binding):** cap-boundary **tie**
(naive 180 == due date exactly); **entity-taxpayer cap** (partnership/S-corp ≈ March); **fiscal-year cap**
(non-calendar FYE); **filed-early truncation**; **cap-date-on-weekend roll**. Every fixture asserts the
full `{dueDate, isProvisional, basis, constraints}` shape, including empty constraints on clean shapes.

> RULE-SHAPE, NOT PINNED AUTHORITY: the return-due-date month offsets / extension months encode the
> doctrine *shape* the panel named; pinned citations + attorney-approved fixtures gate 1031 ACTIVATION
> (Inc 6, G-B). The engine mechanism is built + unit-tested now; 1031 rules stay seeded-DISABLED until
> those fixtures pass.
