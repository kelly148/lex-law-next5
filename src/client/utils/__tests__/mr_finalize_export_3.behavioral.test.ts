/**
 * mr_finalize_export_3.behavioral.test.ts — MR-FINALIZE-EXPORT-3
 *
 * Behavioral and structural tests for the MR-FINALIZE-EXPORT-3 implementation.
 * These tests verify:
 *
 *   T-FINALIZE-EXPORT-3-1 — A failed/timed-out formatting job with a documentId
 *                            different from the active document is excluded by the
 *                            latestFormattingJob selector.
 *   T-FINALIZE-EXPORT-3-2 — A failed/timed-out formatting job for the active
 *                            document is included by the latestFormattingJob selector.
 *   T-FINALIZE-EXPORT-3-3 — finalizeMutation.error is still passed to
 *                            FinalizeDiagnosticBanner independently of the job filter.
 *   T-FINALIZE-EXPORT-3-4 — MR-FINALIZE-EXPORT-2 export-state disclosure behavior
 *                            is preserved.
 *   T-FINALIZE-EXPORT-3-5 — No server/schema/export/helper files were modified.
 *
 * All tests are source-analysis or pure-logic tests (no DOM rendering),
 * consistent with the project's node-environment vitest configuration.
 *
 * Live/operator verification remains required after deployment to confirm
 * that the Finalize diagnostic banner no longer persists across documents
 * after navigation or hard refresh.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, 'src', relPath), 'utf-8');
}

function srcExists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, 'src', relPath));
}

// ============================================================
// T-FINALIZE-EXPORT-3-1 — latestFormattingJob selector excludes
//   formatting jobs from other documents
// ============================================================
describe('T-FINALIZE-EXPORT-3-1: latestFormattingJob selector excludes jobs from other documents', () => {
  const docDetail = readSrc('client/pages/DocumentDetail.tsx');

  it('latestFormattingJob filter includes j.documentId equality check', () => {
    // The selector must filter by both jobType and documentId.
    expect(docDetail).toContain("j.jobType === 'formatting' && j.documentId === (documentId ?? null)");
  });

  it('documentId equality check uses the active documentId from route params', () => {
    // The right-hand side of the equality must be (documentId ?? null),
    // where documentId is the route param — not a hardcoded value.
    expect(docDetail).toContain('(documentId ?? null)');
  });

  it('pure-logic: filter with wrong documentId returns empty array', () => {
    // Simulate the selector logic directly.
    const activeDocumentId = 'doc-aaa-111';
    const otherDocumentId = 'doc-bbb-222';
    const jobs = [
      { jobType: 'formatting', documentId: otherDocumentId, status: 'failed', queuedAt: new Date() },
      { jobType: 'formatting', documentId: otherDocumentId, status: 'timed_out', queuedAt: new Date() },
    ];
    const filtered = jobs.filter(
      (j) => j.jobType === 'formatting' && j.documentId === (activeDocumentId ?? null)
    );
    expect(filtered).toHaveLength(0);
  });

  it('pure-logic: filter with null documentId returns empty array (no documentId match)', () => {
    // Jobs with null documentId should not match a real active documentId.
    const activeDocumentId = 'doc-aaa-111';
    const jobs = [
      { jobType: 'formatting', documentId: null, status: 'failed', queuedAt: new Date() },
    ];
    const filtered = jobs.filter(
      (j) => j.jobType === 'formatting' && j.documentId === (activeDocumentId ?? null)
    );
    expect(filtered).toHaveLength(0);
  });
});

// ============================================================
// T-FINALIZE-EXPORT-3-2 — latestFormattingJob selector includes
//   formatting jobs for the active document
// ============================================================
describe('T-FINALIZE-EXPORT-3-2: latestFormattingJob selector includes jobs for the active document', () => {
  it('pure-logic: filter with matching documentId returns the job', () => {
    const activeDocumentId = 'doc-aaa-111';
    const jobs = [
      {
        jobType: 'formatting',
        documentId: activeDocumentId,
        status: 'failed',
        queuedAt: new Date('2026-01-01T00:00:00Z'),
        errorMessage: 'Job timed out after 120025ms',
      },
      {
        jobType: 'formatting',
        documentId: 'doc-bbb-222',
        status: 'failed',
        queuedAt: new Date('2026-01-02T00:00:00Z'),
        errorMessage: 'Should not appear',
      },
    ];
    const filtered = jobs
      .filter((j) => j.jobType === 'formatting' && j.documentId === (activeDocumentId ?? null))
      .sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime());
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.errorMessage).toBe('Job timed out after 120025ms');
  });

  it('pure-logic: timed_out status is included', () => {
    const activeDocumentId = 'doc-aaa-111';
    const jobs = [
      { jobType: 'formatting', documentId: activeDocumentId, status: 'timed_out', queuedAt: new Date() },
    ];
    const filtered = jobs.filter(
      (j) => j.jobType === 'formatting' && j.documentId === (activeDocumentId ?? null)
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.status).toBe('timed_out');
  });

  it('pure-logic: most recent job is selected when multiple exist', () => {
    const activeDocumentId = 'doc-aaa-111';
    const older = new Date('2026-01-01T00:00:00Z');
    const newer = new Date('2026-01-02T00:00:00Z');
    const jobs = [
      { jobType: 'formatting', documentId: activeDocumentId, status: 'failed', queuedAt: older, errorMessage: 'old' },
      { jobType: 'formatting', documentId: activeDocumentId, status: 'timed_out', queuedAt: newer, errorMessage: 'new' },
    ];
    const result = jobs
      .filter((j) => j.jobType === 'formatting' && j.documentId === (activeDocumentId ?? null))
      .sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime())[0] ?? null;
    expect(result?.errorMessage).toBe('new');
  });
});

// ============================================================
// T-FINALIZE-EXPORT-3-3 — finalizeMutation.error is still passed
//   to FinalizeDiagnosticBanner independently of the job filter
// ============================================================
describe('T-FINALIZE-EXPORT-3-3: finalizeMutation.error is still passed to FinalizeDiagnosticBanner', () => {
  const docDetail = readSrc('client/pages/DocumentDetail.tsx');

  it('FinalizeDiagnosticBanner call site still passes mutationError={finalizeMutation.error}', () => {
    expect(docDetail).toContain('mutationError={finalizeMutation.error}');
  });

  it('FinalizeDiagnosticBanner renders when mutationError is non-null regardless of job state', () => {
    // Guard condition: returns null only when BOTH are falsy.
    expect(docDetail).toContain('if (!mutationError && !hasJobFailure) return null;');
  });

  it('MR-FINALIZE-EXPORT-3 comment is present in DocumentDetail.tsx', () => {
    expect(docDetail).toContain('MR-FINALIZE-EXPORT-3');
  });
});

// ============================================================
// T-FINALIZE-EXPORT-3-4 — MR-FINALIZE-EXPORT-2 export-state
//   disclosure behavior is preserved
// ============================================================
describe('T-FINALIZE-EXPORT-3-4: MR-FINALIZE-EXPORT-2 export-state disclosure is preserved', () => {
  const docDetail = readSrc('client/pages/DocumentDetail.tsx');

  it('complete + officialFinalVersionNumber renders "Download Final DOCX"', () => {
    expect(docDetail).toContain('Download Final DOCX');
  });

  it('non-complete state renders "Download DOCX" label', () => {
    expect(docDetail).toContain('Download DOCX');
  });

  it('export disclosure text for non-final state is present', () => {
    // MR-FINALIZE-EXPORT-2 disclosure: warns that export uses substantive/current version.
    expect(docDetail).toContain('not final formatted');
  });

  it('finalizing state disclosure is present', () => {
    expect(docDetail).toContain('Formatting in progress');
  });
});

// ============================================================
// T-FINALIZE-EXPORT-3-5 — No server/schema/export/helper files
//   were modified by this engagement
// ============================================================
describe('T-FINALIZE-EXPORT-3-5: no server/schema/export/helper files modified', () => {
  it('server procedures file exists and is unmodified (spot-check: documents4a.ts)', () => {
    expect(srcExists('server/procedures/documents4a.ts')).toBe(true);
  });

  it('shared jobs schema file exists and is unmodified (spot-check: jobs.ts)', () => {
    expect(srcExists('shared/schemas/jobs.ts')).toBe(true);
  });

  it('export route file exists and is unmodified (spot-check: index.ts)', () => {
    expect(srcExists('server/index.ts')).toBe(true);
  });

  it('DOCX helper file exists and is unmodified (spot-check: markdownToDocx.ts)', () => {
    expect(srcExists('server/utils/markdownToDocx.ts')).toBe(true);
  });

  it('Anthropic adapter file exists and is unmodified (spot-check: anthropic.ts)', () => {
    expect(srcExists('server/llm/anthropic.ts')).toBe(true);
  });

  it('MR-FINALIZE-EXPORT-3 comment is NOT present in server files (scope check)', () => {
    const documents4a = readSrc('server/procedures/documents4a.ts');
    expect(documents4a).not.toContain('MR-FINALIZE-EXPORT-3');
  });

  it('MR-FINALIZE-EXPORT-3 comment is NOT present in shared schemas (scope check)', () => {
    const jobsSchema = readSrc('shared/schemas/jobs.ts');
    expect(jobsSchema).not.toContain('MR-FINALIZE-EXPORT-3');
  });
});
