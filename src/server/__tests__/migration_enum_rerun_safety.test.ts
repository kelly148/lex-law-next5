// @vitest-environment node
/**
 * MIGRATION-ENUM-RERUN-SAFETY — re-run-safety invariant for ENUM columns.
 *
 * The pre-deploy runner (scripts/apply-prod-migrations.mjs) re-runs EVERY allowlisted migration, IN ORDER,
 * on EVERY deploy. So any `MODIFY COLUMN <col> ENUM(...)` MUST carry the FINAL UNION of that column's values
 * across ALL migrations that touch it. If an earlier file's MODIFY lists fewer values than a later one,
 * re-running the earlier file NARROWS the live column and TiDB truncates any row using the later value.
 *
 * This is the regression guard for the audit_events.eventType deploy failure: 0005 (10 values) and 0022 (12)
 * tried to narrow the 0043-widened (13-value) column on re-deploy → "Data truncated for column 'eventType',
 * value is 'review_session_transition'". The fix made every eventType MODIFY carry the identical 13-value set.
 *
 * The invariant enforced here, structurally: for every ENUM column MODIFY'd by the allowlist, ALL of its
 * MODIFY statements must declare the IDENTICAL ordered value list (widening-only — no narrowing, no reorder).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

// Parse the allowlist filenames from the runner — array entries only (not comment mentions).
const runner = read('../../../scripts/apply-prod-migrations.mjs');
const arrStart = runner.indexOf('const MIGRATIONS = [');
const arrBody = runner.slice(arrStart, runner.indexOf('];', arrStart));
const ALLOWLIST = [...arrBody.matchAll(/'(\d{4}_[a-z0-9_]+\.sql)'/g)].map((m) => m[1]!);

interface EnumModify {
  file: string;
  column: string;
  values: string[];
}
function parseEnumModifies(): EnumModify[] {
  const out: EnumModify[] = [];
  for (const file of ALLOWLIST) {
    const ddl = stripSqlComments(read(`../db/migrations/${file}`));
    const re = /MODIFY\s+COLUMN\s+`?(\w+)`?\s+ENUM\s*\(([\s\S]*?)\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ddl)) !== null) {
      const column = m[1]!;
      const values = [...m[2]!.matchAll(/'([^']*)'/g)].map((v) => v[1]!);
      out.push({ file, column, values });
    }
  }
  return out;
}
const MODIFIES = parseEnumModifies();

const byColumn = new Map<string, EnumModify[]>();
for (const m of MODIFIES) {
  const arr = byColumn.get(m.column) ?? [];
  arr.push(m);
  byColumn.set(m.column, arr);
}

describe('migration ENUM re-run safety (no MODIFY narrows a column a later migration widened)', () => {
  it('parses the allowlist and finds the known ENUM MODIFY columns', () => {
    expect(ALLOWLIST.length).toBeGreaterThan(40);
    expect(ALLOWLIST).toContain('0005_fold_l1_1_matter_state_engine.sql');
    expect(ALLOWLIST).toContain('0049_deed_1_deed_gate.sql');
    // eventType is MODIFY'd by more than one migration (the narrow-on-rerun risk); confirm we see them all.
    expect(MODIFIES.filter((m) => m.column === 'eventType').length).toBeGreaterThanOrEqual(3);
  });

  // Core invariant: every MODIFY of a given column must declare the identical ordered final value list.
  for (const [column, mods] of byColumn) {
    it(`every allowlisted MODIFY of \`${column}\` declares the identical final value list (widening-only)`, () => {
      const canonical = mods.reduce((a, b) => (b.values.length > a.values.length ? b : a)).values;
      for (const mod of mods) {
        // Same SET — no union value is missing from any MODIFY (a missing value => re-run narrows => truncation).
        expect(new Set(mod.values)).toEqual(new Set(canonical));
        // Same ORDER — an ENUM value's ordinal is its stored representation; reordering would rewrite live data.
        expect({ file: mod.file, values: mod.values }).toEqual({ file: mod.file, values: canonical });
      }
    });
  }

  it('regression: audit_events.eventType — 0005, 0022, 0043 are identical and carry review_session_transition', () => {
    const ev = MODIFIES.filter((m) => m.column === 'eventType');
    expect(ev.map((m) => m.file)).toEqual(
      expect.arrayContaining([
        '0005_fold_l1_1_matter_state_engine.sql',
        '0022_fold_pm_1_deadline_audit_events.sql',
        '0043_egress_control_plane_1_inc2_outbox.sql',
      ]),
    );
    const lists = ev.map((m) => m.values);
    for (const l of lists) {
      expect(l).toEqual(lists[0]); // all identical (the fix)
      expect(l).toContain('review_session_transition'); // the value truncated on the failed re-run
      expect(l).toContain('deadline_fired');
      expect(l).toContain('deadline_acknowledged');
      expect(l).toContain('disposition');
    }
    expect(lists[0]).toHaveLength(13);
    // The original base ordinals (positions 1..9) are preserved — no existing audit row is reinterpreted.
    expect(lists[0]!.slice(0, 9)).toEqual([
      'model_output', 'adopted', 'rejected', 'locked', 'unlocked', 'sent', 'withheld', 'authority_verified', 'judgment_required',
    ]);
    // The canonical full ordered set (mirror of 0043).
    expect(lists[0]).toEqual([
      'model_output', 'adopted', 'rejected', 'locked', 'unlocked', 'sent', 'withheld', 'authority_verified',
      'judgment_required', 'disposition', 'deadline_fired', 'deadline_acknowledged', 'review_session_transition',
    ]);
  });

  it('single-MODIFY columns (extractionStatus, status, type) are structurally safe — one MODIFY, nothing widens later', () => {
    for (const col of ['extractionStatus', 'status', 'type']) {
      const mods = MODIFIES.filter((m) => m.column === col);
      expect(mods.length).toBe(1); // exactly one allowlisted MODIFY => re-run is a self-no-op, never narrows
    }
  });
});
