/**
 * TITLE-EXAM-1 (T5) — NC-7 cross-matter contamination guards: the seed-fact hypothesis rule, the
 * source-matter-ID auto-flag, the import-justification block on reconciliation close, and the logged
 * import / do-not-import resolution (Fork-C). All pure / mock-tx.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateContamination,
  assessReconciliationClosure,
  resolveImport,
  type ClosureFindingInput,
} from '../titleExam/contaminationGuard.js';
import {
  buildImportResolutionAuditEvent,
  writeImportResolutionTx,
} from '../db/queries/titleExamContamination.js';

const CUR = 'matter-current';

describe('T5 — evaluateContamination (a seed fact is a hypothesis until re-verified)', () => {
  it('auto-flags a seed whose source-matter-ID differs from the current matter', () => {
    const v = evaluateContamination({
      currentMatterId: CUR,
      title: 'prior payoff of the DOT',
      sourceBasis: 'prior_matter_seed',
      classification: 'informational_note',
      seedSourceMatterId: 'matter-OTHER',
    });
    expect(v.isSeedDerived).toBe(true);
    expect(v.sourceMatterMismatch).toBe(true);
    expect(v.seedContaminationFlag).toBe(true);
    expect(v.reason).toContain('differs from the current matter');
  });

  it('flags a seed that would support a requirement/exception until re-verified (mustReverifyBeforeUse)', () => {
    const v = evaluateContamination({
      currentMatterId: CUR,
      title: 'release recorded',
      sourceBasis: 'prior_matter_seed',
      classification: 'closing_requirement',
      seedSourceMatterId: CUR, // same matter, but still a seed supporting a requirement
    });
    expect(v.mustReverifyBeforeUse).toBe(true);
    expect(v.seedContaminationFlag).toBe(true);
  });

  it('flags a seed that would support a vesting conclusion', () => {
    const v = evaluateContamination({
      currentMatterId: CUR,
      title: 'vesting is joint tenancy with survivorship',
      sourceBasis: 'prior_matter_seed',
      classification: 'informational_note',
    });
    expect(v.mustReverifyBeforeUse).toBe(true);
    expect(v.seedContaminationFlag).toBe(true);
  });

  it('clears the flag once the attorney re-verifies (import resolved + justification)', () => {
    const v = evaluateContamination({
      currentMatterId: CUR,
      title: 'release recorded',
      sourceBasis: 'prior_matter_seed',
      classification: 'closing_requirement',
      seedSourceMatterId: 'matter-OTHER',
      importResolved: true,
      importJustification: 'the same release is independently in THIS matter’s record at DB 900 PG 1',
    });
    expect(v.seedContaminationFlag).toBe(false);
    expect(v.mustReverifyBeforeUse).toBe(false);
  });

  it('a non-seed instrument finding is never contamination-flagged', () => {
    const v = evaluateContamination({
      currentMatterId: CUR,
      title: 'recorded deed of trust',
      sourceBasis: 'instrument',
      classification: 'closing_requirement',
    });
    expect(v.isSeedDerived).toBe(false);
    expect(v.seedContaminationFlag).toBe(false);
  });
});

describe('T5 — reconciliation close is BLOCKED until every seed import is resolved', () => {
  const findings: ClosureFindingInput[] = [
    { id: 'f1', title: 'clean instrument finding', seedContaminationFlag: false },
    { id: 'f2', title: 'unresolved seed', seedContaminationFlag: true },
  ];

  it('cannot close while a contamination-flagged finding lacks an import-justification', () => {
    const r = assessReconciliationClosure(findings);
    expect(r.canClose).toBe(false);
    expect(r.blockers.map((b) => b.id)).toEqual(['f2']);
  });

  it('can close once the seed import is resolved', () => {
    const resolved: ClosureFindingInput[] = [
      { id: 'f1', seedContaminationFlag: false },
      { id: 'f2', seedContaminationFlag: true, importResolved: true, importJustification: 're-verified here' },
    ];
    expect(assessReconciliationClosure(resolved).canClose).toBe(true);
  });
});

describe('T5 — resolveImport (silence is not import)', () => {
  it('import requires a non-empty justification', () => {
    expect(() => resolveImport('import', '   ')).toThrow(/import-justification/);
    const r = resolveImport('import', 'independently in this matter at DB 900 PG 1');
    expect(r.importResolved).toBe(true);
    expect(r.seedContaminationFlag).toBe(false);
  });

  it('do_not_import records the exclusion without requiring a justification', () => {
    const r = resolveImport('do_not_import', 'not relevant to this parcel');
    expect(r.importResolved).toBe(true);
    expect(r.importJustification).toContain('do-not-import');
  });
});

type Captured = { table: unknown; row: Record<string, unknown> };
function makeMockTx(): { tx: Parameters<typeof writeImportResolutionTx>[0]; inserts: Captured[]; updates: Captured[] } {
  const inserts: Captured[] = [];
  const updates: Captured[] = [];
  const mock = {
    insert(table: unknown) {
      return { values(row: Record<string, unknown>) { inserts.push({ table, row }); return Promise.resolve(); } };
    },
    update(table: unknown) {
      return { set(row: Record<string, unknown>) { return { where() { updates.push({ table, row }); return Promise.resolve(); } }; } };
    },
  };
  return { tx: mock as unknown as Parameters<typeof writeImportResolutionTx>[0], inserts, updates };
}

describe('T5 — logged import resolution (Fork-C)', () => {
  const BASE = { userId: 'u-1', matterId: CUR, findingId: 'f-1', sessionId: 's-1' };

  it('builds an import disposition audit row targeting the finding', () => {
    const ev = buildImportResolutionAuditEvent({ ...BASE, decision: 'import', resolvedJustification: 're-verified here' });
    expect(ev.eventType).toBe('disposition');
    expect(ev.action).toBe('import');
    expect(ev.targetType).toBe('title_exam_finding');
    expect(ev.rationale).toBe('re-verified here');
  });

  it('writes ONE audit row + clears the finding contamination block, linked by decisionEventId', async () => {
    const { tx, inserts, updates } = makeMockTx();
    const out = await writeImportResolutionTx(tx, { ...BASE, decision: 'import', justification: 're-verified here' });
    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.row['importResolved']).toBe(true);
    expect(updates[0]!.row['seedContaminationFlag']).toBe(false);
    expect(updates[0]!.row['decisionEventId']).toBe(inserts[0]!.row['id']);
    expect(out.importJustification).toBe('re-verified here');
  });

  it('refuses to write an import without a justification (silence is not import)', async () => {
    const { tx, inserts } = makeMockTx();
    await expect(writeImportResolutionTx(tx, { ...BASE, decision: 'import', justification: null })).rejects.toThrow(/import-justification/);
    expect(inserts).toHaveLength(0); // nothing written
  });
});
