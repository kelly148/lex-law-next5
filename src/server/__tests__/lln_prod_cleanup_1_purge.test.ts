/**
 * LLN-PROD-CLEANUP-1 — purgeMatter coverage + safety (source analysis; no test DB).
 *
 * The load-bearing guard: cross-check matterPurge.ts against schema.ts so that EVERY table carrying a
 * `matterId` column is handled by the purge (minus the deliberately-excluded analytics log). If a future
 * migration adds a matter-scoped table and the author forgets to purge it, THIS TEST FAILS — preventing
 * the orphan/phantom-party class of bug the purge exists to avoid. Also asserts the document/request
 * child tables are covered, the dryRun discipline (no writes when dryRun), and that KB-level /
 * firm-level tables are NOT purged per matter.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const schema = read('src/server/db/schema.ts');
const purge = read('src/server/db/queries/matterPurge.ts');

// Parse schema.ts into { constName -> block } and detect which blocks carry a matterId column.
function tablesWithMatterId(): string[] {
  const out: string[] = [];
  const re = /export const (\w+) = mysqlTable\(/g;
  const starts: { name: string; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(schema)) !== null) starts.push({ name: m[1]!, idx: m.index });
  for (let i = 0; i < starts.length; i++) {
    const block = schema.slice(starts[i]!.idx, i + 1 < starts.length ? starts[i + 1]!.idx : schema.length);
    if (/\bmatterId:\s*char\(/.test(block)) out.push(starts[i]!.name);
  }
  return out;
}

describe('LLN-PROD-CLEANUP-1: purgeMatter covers every matter-scoped table', () => {
  // telemetry_events is an analytics log with a NULLABLE matterId — deliberately not purged.
  const ALLOWED_EXCLUSIONS = new Set(['telemetryEvents']);

  it('every table with a matterId column is referenced by the purge (or explicitly excluded)', () => {
    const matterTables = tablesWithMatterId();
    // sanity: we found a meaningful set, not zero (guards a broken parser)
    expect(matterTables.length).toBeGreaterThan(15);
    const missing = matterTables.filter((t) => !ALLOWED_EXCLUSIONS.has(t) && !purge.includes(t));
    expect(missing, `matter-scoped tables not handled by purgeMatter: ${missing.join(', ')}`).toEqual([]);
  });

  it('the deliberately-excluded analytics log is NOT purged per matter', () => {
    expect(purge).not.toContain('telemetryEvents');
  });

  it('document-child and request-child tables are covered (not matterId-scoped, easy to miss)', () => {
    for (const t of [
      'versions',
      'documentOutlines',
      'documentReferences',
      'feedback',
      'feedbackEvaluations',
      'feedbackManualSelections',
      'reviewSessions',
      'informationRequestItems',
    ]) {
      expect(purge, `purge must cover child table ${t}`).toContain(t);
    }
  });

  it('KB-level / firm-level tables are NOT purged per matter (kb_events, templates, reusable artifacts, PA/memos)', () => {
    expect(purge).not.toContain('kbEvents');
    expect(purge).not.toContain('templateVersions');
    expect(purge).not.toContain('reusableArtifacts');
    expect(purge).not.toContain('paInstructionProfiles');
    expect(purge).not.toContain('practiceMemos');
  });

  it('dryRun discipline: deletes are guarded (no writes when dryRun) and counts always computed', () => {
    expect(purge).toContain('if (!dryRun && n > 0)');
    expect(purge).toContain('count(*)');
    // the matters row delete is also dryRun-guarded
    expect(purge).toContain('if (!dryRun) {');
  });

  it('owner-scoped throughout (every delete carries ownerScope/userId) and atomic per matter', () => {
    expect(purge).toContain('db.transaction');
    expect(purge).toContain('ownerScope(matters.userId, userId)');
    expect(purge).toContain('ownerScope(table.userId as any, userId)');
  });

  it('matter.purge procedure is exposed with the dryRun flag (operator-gated preview-then-apply)', () => {
    const matters = read('src/server/procedures/matters.ts');
    expect(matters).toContain('purge: protectedProcedure');
    expect(matters).toContain('dryRun: z.boolean()');
    expect(matters).toContain('purgeMatter(matterId, ctx.userId, { dryRun: input.dryRun })');
  });
});
