/**
 * FOLD-PM-1 Increment 3 — lifecycle: pure-function units + source-guard invariants.
 *
 * The owner-scoped DB lifecycle runs live (no test DB), following the repo pattern (ownerScope() +
 * parse-on-read + transactional audit). What CI CAN prove without a DB: the pure tickler/coverage math,
 * and SOURCE GUARDS over deadlines.ts/procedures pinning the disposition's no-silent-states invariants —
 * pending_confirm fires ticklers, the firing is audited distinctly, expiry projects a one-directional
 * open_item that satisfy/waive clears, ack/snooze key to logical lead-time, and the whole surface is
 * flag-gated.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { targetTicklers, effectiveDueDate, coverageStateFromCounts } from '../db/queries/deadlines.js';

const QSRC = readFileSync(fileURLToPath(new URL('../db/queries/deadlines.js', import.meta.url)).replace(/\.js$/, '.ts'), 'utf8');
const PSRC = readFileSync(fileURLToPath(new URL('../procedures/deadlines.js', import.meta.url)).replace(/\.js$/, '.ts'), 'utf8');

describe('FOLD-PM-1 Inc3 — pure tickler horizon math', () => {
  it('materializes a lead within the rolling 12-month horizon, incl. past-due (fired)', () => {
    const t = targetTicklers('2026-07-01', [60, 30, 7], '2026-06-01');
    expect(t.map((x) => x.leadDays)).toEqual([60, 30, 7]);
    expect(t.find((x) => x.leadDays === 30)!.fireAt).toBe('2026-06-01'); // due - 30
    // a past-due lead (fireAt < today) is still materialized (so a fired tickler is never dropped)
    expect(targetTicklers('2026-06-05', [10], '2026-06-01')[0]!.fireAt).toBe('2026-05-26');
  });

  it('defers leads whose fireAt is beyond the 12-month horizon (rolling)', () => {
    // deadline ~2 years out: due - 30 is still > today+365, so nothing materializes yet
    expect(targetTicklers('2028-06-01', [30, 7], '2026-06-01')).toEqual([]);
    expect(targetTicklers(null, [30], '2026-06-01')).toEqual([]);
  });

  it('effectiveDueDate prefers the attorney override over the computed date', () => {
    expect(effectiveDueDate({ attorneyOverrideDate: '2026-09-09', computedDueDate: '2026-08-01' })).toBe('2026-09-09');
    expect(effectiveDueDate({ attorneyOverrideDate: null, computedDueDate: '2026-08-01' })).toBe('2026-08-01');
    expect(effectiveDueDate({ attorneyOverrideDate: null, computedDueDate: null })).toBe(null);
  });

  it('coverage precedence: absence NEVER reads as all-clear (overdue > unconfirmed > active > none)', () => {
    expect(coverageStateFromCounts({ overdueUnresolved: 1, pendingConfirm: 5, active: 5 })).toBe('overdue_unresolved');
    expect(coverageStateFromCounts({ overdueUnresolved: 0, pendingConfirm: 2, active: 5 })).toBe('unconfirmed');
    expect(coverageStateFromCounts({ overdueUnresolved: 0, pendingConfirm: 0, active: 3 })).toBe('active');
    expect(coverageStateFromCounts({ overdueUnresolved: 0, pendingConfirm: 0, active: 0 })).toBe('none');
  });
});

describe('FOLD-PM-1 Inc3 — source-guard invariants (no silent states)', () => {
  it('pending_confirm DOES materialize ticklers on create (G-C: visibility before confirmation)', () => {
    // createMatterDeadline inserts status pending_confirm AND reconciles ticklers in the same tx.
    expect(QSRC).toMatch(/status: 'pending_confirm'/);
    expect(QSRC).toMatch(/reconcileTicklers\(tx[\s\S]*?\)/);
  });

  it('the FIRING is audited distinctly (deadline_fired, actor system) from attorney disposition', () => {
    expect(QSRC).toContain("eventType: 'deadline_fired'");
    expect(QSRC).toMatch(/eventType: 'deadline_fired',\s*actor: 'system'/);
    expect(QSRC).toContain("eventType: 'deadline_acknowledged'"); // ack distinct from firing
  });

  it('expiry projects a one-directional blocker open_item; satisfy/waive clears it', () => {
    expect(QSRC).toContain("status: 'expired_unresolved'");
    expect(QSRC).toMatch(/autoRegisterOpenItem\([\s\S]*?severity: 'blocker'/);
    expect(QSRC).toContain('EXPIRED_OPEN_ITEM_CATEGORY');
    expect(QSRC).toMatch(/clearExpiredProjection/);
    expect(QSRC).toMatch(/resolveOpenItem\(/);
  });

  it('override/waive/satisfy require a reason/basis (no unexplained disposition)', () => {
    expect(QSRC).toMatch(/a reason is required/);
    expect(QSRC).toMatch(/a basis\/reason is required/);
  });

  it('recompute is propose-and-confirm (a read-only proposal + a separate confirm)', () => {
    expect(QSRC).toMatch(/export async function proposeRecompute/);
    expect(QSRC).toMatch(/export async function confirmRecompute/);
    expect(PSRC).toMatch(/proposeRecompute: protectedProcedure[\s\S]*?\.query\(/); // proposal is read-only
  });

  it('every procedure except isEnabled is flag-gated; the surface never acts (no egress)', () => {
    expect(PSRC).toMatch(/function assertEnabled\(\)/);
    expect(PSRC).toContain('DEADLINE_ENGINE_DISABLED');
    // no outbound/egress primitives wired into the deadline surface
    expect(PSRC).not.toMatch(/sendEmail|fetch\(|calendar|webhook|nodemailer/i);
  });
});
