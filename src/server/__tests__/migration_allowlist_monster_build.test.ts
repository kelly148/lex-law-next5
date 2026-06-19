/**
 * Migration allowlist registration guard — the monster-build (2026-06-19) migrations.
 *
 * Operator directive (2026-06-19): register 0046-0049 in the apply-prod-migrations.mjs additive allowlist so
 * the pre-deploy runner auto-applies them (the operator still triggers the deploy; merge != deploy). This
 * locks that registration so a future edit can't silently drop them — the exact silent-skip class that broke
 * prod once before (the 0019/0020 incident the runner's own comments document). It asserts EXACTLY these four
 * (some migrations — e.g. 0028/0029 — are DELIBERATELY excluded as operator-gated, so "every file registered"
 * would be wrong); the additive-DDL safety of each file is asserted by that engagement's own migration test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const runner = readFileSync(
  fileURLToPath(new URL('../../../scripts/apply-prod-migrations.mjs', import.meta.url)),
  'utf8',
);

describe('apply-prod-migrations allowlist — monster-build migrations registered (no silent skip)', () => {
  it.each([
    '0046_notify_suite_1_deadline_alerts.sql',
    '0047_conflict_toggle_1_posture_policy.sql',
    '0048_conflict_toggle_1_matter_posture.sql',
    '0049_deed_1_deed_gate.sql',
  ])('registers %s in the MIGRATIONS allowlist', (file) => {
    expect(runner).toContain(`'${file}'`);
  });

  it.each(['firm_conflict_policy', 'matter_conflict_posture', 'deed_gate'])(
    'expects the new table %s present after apply (EXPECTED_TABLES_EXTRA)',
    (table) => {
      expect(runner).toContain(`'${table}'`);
    },
  );

  it('keeps the four registered in ascending order after 0045', () => {
    const order = ['0045', '0046', '0047', '0048', '0049'].map((n) => runner.indexOf(`'${n}_`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b)); // strictly ascending positions
  });
});
