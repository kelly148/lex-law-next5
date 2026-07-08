import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * GOV-MECH-1 Part B (FLAG-FLIP-RUNBOOK-1) coverage test. COVERAGE-MAINTAINING, NOT correctness-maintaining
 * (see the runbook honesty line): it proves every flag in featureFlags.ts has a complete row in
 * docs/FLAG_FLIP_RUNBOOK.md — it does NOT judge whether a row's content is right.
 *
 * Enforces (red-team item 6): (1) coverage — every flag has a row; (2) schema — no blank/placeholder cells;
 * (3) reverse lint — no orphan row naming a nonexistent flag. Plus synthetic proofs that each check FAILS.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const FLAGS_SRC = readFileSync(path.join(REPO_ROOT, 'src/server/config/featureFlags.ts'), 'utf8');
const RUNBOOK = readFileSync(path.join(REPO_ROOT, 'docs/FLAG_FLIP_RUNBOOK.md'), 'utf8');

const PLACEHOLDER = /^(todo|tbd|fixme|xxx|\?+|-+|—+|<.*>|n\/?a|\.\.\.)$/i;

/** Every prod flip flag = an env key read in featureFlags.ts (comments carry no `process.env[...]`, so this is
 *  robust to formatting). Currently the 38 `=== 'true'` booleans + the D3_SIGNOFF_MODE three-state. */
export function parseFlagKeys(source: string): string[] {
  const keys = new Set<string>();
  const re = /process\.env\['([A-Z0-9_]+)'\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) keys.add(m[1]!);
  return [...keys].sort();
}

/** Parse the marker-delimited runbook table into {flag, cells} rows (header + separator skipped). */
export function parseRunbookTable(md: string): { flag: string; cells: string[] }[] {
  const start = md.indexOf('<!-- FLAG-TABLE-START -->');
  const end = md.indexOf('<!-- FLAG-TABLE-END -->');
  if (start === -1 || end === -1 || end < start) throw new Error('FLAG-TABLE markers missing/malformed');
  const block = md.slice(start, end);
  const rows: { flag: string; cells: string[] }[] = [];
  for (const line of block.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.split('|').slice(1, -1).map((c) => c.trim()); // drop the leading/trailing empty splits
    if (cells.length === 0) continue;
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // markdown separator row
    if (cells[0]!.toLowerCase() === 'flag') continue; // header row
    const flag = cells[0]!.replace(/[`*]/g, '').trim();
    rows.push({ flag, cells });
  }
  return rows;
}

const EXPECTED_COLUMNS = 6; // Flag | migrations | partners | booby-traps | smoke | revert

export function auditRunbook(source: string, md: string) {
  const flags = parseFlagKeys(source);
  const rows = parseRunbookTable(md);
  const rowFlags = rows.map((r) => r.flag);
  const uncovered = flags.filter((f) => !rowFlags.includes(f)); // flag without a row
  const orphans = rowFlags.filter((f) => !flags.includes(f)); // row without a flag
  const badCells: string[] = [];
  for (const r of rows) {
    if (r.cells.length !== EXPECTED_COLUMNS) badCells.push(`${r.flag}: expected ${EXPECTED_COLUMNS} cells, got ${r.cells.length}`);
    r.cells.forEach((c, i) => {
      if (c.length === 0 || PLACEHOLDER.test(c)) badCells.push(`${r.flag}: blank/placeholder cell #${i} ("${c}")`);
    });
  }
  return { flags, rows, uncovered, orphans, badCells };
}

describe('FLAG-FLIP-RUNBOOK-1 — the runbook covers every flag, cleanly (real files)', () => {
  const audit = auditRunbook(FLAGS_SRC, RUNBOOK);

  it('discovers a sane, non-trivial flag set', () => {
    expect(audit.flags.length).toBeGreaterThanOrEqual(30);
    expect(audit.flags).toContain('CHAT_UI_1_ENABLED');
    expect(audit.flags).toContain('D3_SIGNOFF_MODE');
    expect(audit.flags).toContain('DEED_RECORDABILITY_ENABLED');
  });

  it('COVERAGE: every featureFlags flag has a runbook row', () => {
    expect(audit.uncovered, `uncovered flags: ${audit.uncovered.join(', ')}`).toEqual([]);
  });

  it('REVERSE LINT: no runbook row names a nonexistent flag', () => {
    expect(audit.orphans, `orphan rows: ${audit.orphans.join(', ')}`).toEqual([]);
  });

  it('SCHEMA: no blank or placeholder cells', () => {
    expect(audit.badCells, audit.badCells.join(' | ')).toEqual([]);
  });

  it('HARD BLOCK: CHAT_UI_1_ENABLED is called out with its 0028/0029 block', () => {
    const block = RUNBOOK.slice(RUNBOOK.indexOf('<!-- HARD-BLOCK-START -->'), RUNBOOK.indexOf('<!-- HARD-BLOCK-END -->'));
    expect(block).toContain('CHAT_UI_1_ENABLED');
    expect(block).toContain('0028');
    expect(block).toContain('0029');
  });
});

describe('FLAG-FLIP-RUNBOOK-1 — the checks actually FAIL on synthetic defects (acceptance)', () => {
  const goodTable = [
    '<!-- FLAG-TABLE-START -->',
    '| Flag | m | p | b | s | r |',
    '| --- | --- | --- | --- | --- | --- |',
    '| `A_ENABLED` | none | none | none | check | set false |',
    '<!-- FLAG-TABLE-END -->',
  ].join('\n');

  it('FAILS on a synthetic MISSING flag (flag exists, no row)', () => {
    const src = "process.env['A_ENABLED']; process.env['B_ENABLED'];";
    const { uncovered } = auditRunbook(src, goodTable);
    expect(uncovered).toEqual(['B_ENABLED']);
  });

  it('FAILS on a synthetic ORPHAN row (row exists, no flag)', () => {
    const src = "process.env['A_ENABLED'];";
    const orphanTable = goodTable.replace('| `A_ENABLED` |', '| `A_ENABLED` |\n| `GHOST_ENABLED` | none | none | none | check | set false |\n| `A_ENABLED` |').replace('| `A_ENABLED` |\n| `A_ENABLED` |', '| `A_ENABLED` |');
    // simpler: append an orphan row explicitly
    const t = goodTable.replace('<!-- FLAG-TABLE-END -->', '| `GHOST_ENABLED` | none | none | none | check | set false |\n<!-- FLAG-TABLE-END -->');
    const { orphans } = auditRunbook(src, t);
    expect(orphans).toContain('GHOST_ENABLED');
    void orphanTable;
  });

  it('FAILS on a synthetic BLANK cell', () => {
    const src = "process.env['A_ENABLED'];";
    const blank = goodTable.replace('| none | none | none | check | set false |', '|  | none | none | check | set false |');
    const { badCells } = auditRunbook(src, blank);
    expect(badCells.length).toBeGreaterThan(0);
    expect(badCells.join(' ')).toContain('A_ENABLED');
  });

  it('FAILS on a synthetic PLACEHOLDER cell (TODO)', () => {
    const src = "process.env['A_ENABLED'];";
    const todo = goodTable.replace('| none | none | none | check | set false |', '| TODO | none | none | check | set false |');
    const { badCells } = auditRunbook(src, todo);
    expect(badCells.length).toBeGreaterThan(0);
  });
});
