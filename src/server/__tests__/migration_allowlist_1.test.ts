/**
 * MIGRATION-ALLOWLIST-1 registration guard (2026-07-05).
 *
 * Operator directive (2026-07-05): register 0051-0055 in the apply-prod-migrations.mjs additive allowlist.
 * These five migrations existed on `main` but were never allowlisted or applied — the root cause of the live
 * prod deed-generation failure (prod writes documents.provenance without 0052's column -> "Unknown column
 * 'provenance'"), the same silent-skip class the runner's own comments document (0019/0020). This locks the
 * registration so a future edit can't silently drop them. Each file's additive-DDL safety is asserted by its
 * own engagement's migration test; the ENUM re-run invariant by migration_enum_rerun_safety.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const runner = readFileSync(
  fileURLToPath(new URL('../../../scripts/apply-prod-migrations.mjs', import.meta.url)),
  'utf8',
);
// Only the MIGRATIONS array body (not comment mentions), to assert true registration.
const arrStart = runner.indexOf('const MIGRATIONS = [');
const arrBody = runner.slice(arrStart, runner.indexOf('];', arrStart));

describe('apply-prod-migrations allowlist — MIGRATION-ALLOWLIST-1 (0051-0055 registered, no silent skip)', () => {
  it.each([
    '0051_express_durable_records_e4b_e7b.sql',
    '0052_deed_provenance.sql',
    '0053_d3_signoff.sql',
    '0054_title_exam_1_data_model.sql',
    '0055_title_exam_6_client_delivery_approval.sql',
  ])('registers %s in the MIGRATIONS allowlist', (file) => {
    expect(arrBody).toContain(`'${file}'`);
  });

  it.each([
    'express_loop_run',
    'express_ledger_entry',
    'express_approval_attestation',
    'deed_signoff',
    'title_exam_matter_attribute',
    'title_exam_session',
    'title_exam_finding',
    'title_exam_client_delivery_approval',
  ])('expects the new table %s present after apply (EXPECTED_TABLES_EXTRA)', (table) => {
    expect(runner).toContain(`'${table}'`);
  });

  it('keeps 0050-0055 in ascending order in the allowlist array', () => {
    const order = ['0050', '0051', '0052', '0053', '0054', '0055'].map((n) => arrBody.indexOf(`'${n}_`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b)); // strictly ascending positions
  });

  it('0052 is a column add (documents.provenance), not a table — additive ADD COLUMN IF NOT EXISTS', () => {
    const mig = readFileSync(
      fileURLToPath(new URL('../db/migrations/0052_deed_provenance.sql', import.meta.url)),
      'utf8',
    );
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS\s+`provenance`/i);
    // the UPDATE backfill is comment-only (a separate operator data decision) — never an executed statement
    const stripped = mig.replace(/--[^\n]*/g, '');
    expect(/(^|;)\s*UPDATE\s+/im.test(stripped)).toBe(false);
  });
});
