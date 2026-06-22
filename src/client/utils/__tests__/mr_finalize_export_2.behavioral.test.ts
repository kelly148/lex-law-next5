/**
 * mr_finalize_export_2.behavioral.test.ts — MR-FINALIZE-EXPORT-2
 *
 * Behavioral and structural tests for the MR-FINALIZE-EXPORT-2 implementation.
 * These tests verify:
 *
 *   T-FE2-1  — FinalizeDiagnosticBanner is defined in DocumentDetail.tsx and
 *               renders when finalizeMutation.error is set.
 *   T-FE2-2  — FinalizeDiagnosticBanner renders failed formatting job errorMessage
 *               when present.
 *   T-FE2-3  — FinalizeDiagnosticBanner is conditional: null/empty errorMessage
 *               does not render the diagnostic line.
 *   T-FE2-4  — finalizeMutation.error is passed to FinalizeDiagnosticBanner at
 *               the call site.
 *   T-FE2-5  — Export state disclosure: non-complete states show disclosure text.
 *   T-FE2-6  — Export state label: complete + officialFinalVersionNumber shows
 *               "Download Final DOCX"; other states show "Download DOCX".
 *   T-FE2-7  — Server: finalize txn2Commit sets officialFinalVersionNumber and
 *               advances workflowState to complete.
 *   T-FE2-8  — Server: finalize txn2Revert reverts workflowState to
 *               substantively_accepted and does NOT set officialFinalVersionNumber.
 *   T-FE2-9  — Export version-selection: complete state uses
 *               officialFinalVersionNumber only.
 *   T-FE2-10 — Export version-selection: substantively_accepted and finalizing
 *               states use officialSubstantiveVersionNumber (or currentVersionId
 *               fallback), NOT officialFinalVersionNumber.
 *   T-FE2-11 — PublicJobSchema exposes errorMessage: string | null to the client.
 *
 * All tests are source-analysis or pure-logic tests (no DOM rendering),
 * consistent with the project's node-environment vitest configuration.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');
function readSrc(relPath: string): string {
  // Normalize CRLF → LF so the source-audit `\n`-bearing assertions match on Windows checkouts too
  // (the file is CRLF locally, LF on Linux CI). No-op on LF; makes these source greps OS-independent.
  return fs.readFileSync(path.join(ROOT, 'src', relPath), 'utf-8').replace(/\r\n/g, '\n');
}

// ============================================================
// T-FE2-1 — FinalizeDiagnosticBanner: component definition and
//            mutation-error rendering
// ============================================================
describe('T-FE2-1: FinalizeDiagnosticBanner component is defined and renders on mutation error', () => {
  const docDetail = readSrc('client/pages/DocumentDetail.tsx');

  it('FinalizeDiagnosticBanner function is defined in DocumentDetail.tsx', () => {
    expect(docDetail).toContain('function FinalizeDiagnosticBanner(');
  });

  it('FinalizeDiagnosticBannerProps interface declares mutationError: Error | null', () => {
    expect(docDetail).toContain('mutationError: Error | null;');
  });

  it('banner renders when mutationError is non-null', () => {
    // Guard: returns null only when both mutationError and hasJobFailure are falsy
    expect(docDetail).toContain('if (!mutationError && !hasJobFailure) return null;');
  });

  it('banner has data-testid="finalize-diagnostic-banner"', () => {
    expect(docDetail).toContain('data-testid="finalize-diagnostic-banner"');
  });

  it('banner renders "Finalize failed" heading', () => {
    expect(docDetail).toContain('Finalize failed');
  });

  it('diagnosticMessage is derived from mutationError.message when mutationError is set', () => {
    expect(docDetail).toContain('mutationError\n    ? mutationError.message');
  });
});

// ============================================================
// T-FE2-2 — FinalizeDiagnosticBanner: failed formatting job
//            errorMessage surfacing
// ============================================================
describe('T-FE2-2: FinalizeDiagnosticBanner renders failed formatting job errorMessage', () => {
  const docDetail = readSrc('client/pages/DocumentDetail.tsx');

  it('FinalizeDiagnosticBannerProps interface declares formattingJob with status and errorMessage', () => {
    expect(docDetail).toContain('formattingJob: { status: string; errorMessage: string | null } | null;');
  });

  it('hasJobFailure is true when formattingJob.status is "failed"', () => {
    expect(docDetail).toContain("formattingJob.status === 'failed'");
  });

  it('hasJobFailure is true when formattingJob.status is "timed_out"', () => {
    expect(docDetail).toContain("formattingJob.status === 'timed_out'");
  });

  it('diagnosticMessage falls back to formattingJob.errorMessage when mutationError is null', () => {
    expect(docDetail).toContain('formattingJob?.errorMessage ?? null');
  });

  it('banner has data-testid="finalize-diagnostic-message" for the diagnostic line', () => {
    expect(docDetail).toContain('data-testid="finalize-diagnostic-message"');
  });
});

// ============================================================
// T-FE2-3 — FinalizeDiagnosticBanner: null/empty diagnostic
//            does not render the message line
// ============================================================
describe('T-FE2-3: FinalizeDiagnosticBanner is conditional on non-empty diagnosticMessage', () => {
  const docDetail = readSrc('client/pages/DocumentDetail.tsx');

  it('diagnosticMessage render is conditional (null/empty does not render)', () => {
    expect(docDetail).toContain("diagnosticMessage && diagnosticMessage.trim() !== ''");
  });

  it('banner returns null when both mutationError and hasJobFailure are falsy', () => {
    expect(docDetail).toContain('if (!mutationError && !hasJobFailure) return null;');
  });
});

// ============================================================
// T-FE2-4 — FinalizeDiagnosticBanner call site: finalizeMutation.error
//            and latestFormattingJob are passed
// ============================================================
describe('T-FE2-4: FinalizeDiagnosticBanner call site passes finalizeMutation.error and latestFormattingJob', () => {
  const docDetail = readSrc('client/pages/DocumentDetail.tsx');

  it('call site passes mutationError={finalizeMutation.error}', () => {
    expect(docDetail).toContain('mutationError={finalizeMutation.error}');
  });

  it('call site passes formattingJob={latestFormattingJob}', () => {
    expect(docDetail).toContain('formattingJob={latestFormattingJob}');
  });

  it('latestFormattingJob is derived from useDocumentJobs filtered to jobType === "formatting"', () => {
    expect(docDetail).toContain("j.jobType === 'formatting'");
  });

  it('latestFormattingJob is sorted by queuedAt descending (most recent first)', () => {
    expect(docDetail).toContain('new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime()');
  });

  it('useDocumentJobs hook is defined in DocumentDetail.tsx', () => {
    expect(docDetail).toContain('function useDocumentJobs(');
  });
});

// ============================================================
// T-FE2-5 — Export state disclosure: non-complete states show
//            disclosure text
// ============================================================
describe('T-FE2-5: Export state disclosure is shown for non-complete states', () => {
  const docDetail = readSrc('client/pages/DocumentDetail.tsx');

  it('disclosure span has data-testid="export-state-disclosure"', () => {
    expect(docDetail).toContain('data-testid="export-state-disclosure"');
  });

  it('disclosure is shown when workflowState !== "complete"', () => {
    expect(docDetail).toContain("doc.workflowState !== 'complete'");
  });

  it('finalizing state shows "Formatting in progress" disclosure', () => {
    expect(docDetail).toContain("doc.workflowState === 'finalizing'");
    expect(docDetail).toContain('Formatting in progress');
  });

  it('non-complete/non-finalizing states show "substantive/current version" disclosure', () => {
    expect(docDetail).toContain('Export uses substantive/current version (not final formatted)');
  });
});

// ============================================================
// T-FE2-6 — Export state label: "Download Final DOCX" only
//            when complete + officialFinalVersionNumber exists
// ============================================================
describe('T-FE2-6: Export button label is state-aware', () => {
  const docDetail = readSrc('client/pages/DocumentDetail.tsx');

  it('label is "Download Final DOCX" when complete and officialFinalVersionNumber is not null', () => {
    expect(docDetail).toContain(
      "doc.workflowState === 'complete' && doc.officialFinalVersionNumber !== null",
    );
    expect(docDetail).toContain('Download Final DOCX');
  });

  it('label falls back to "Download DOCX" for all other states', () => {
    expect(docDetail).toContain('Download DOCX');
  });
});

// ============================================================
// T-FE2-7 — Server: finalize txn2Commit sets
//            officialFinalVersionNumber and advances to complete
// ============================================================
describe('T-FE2-7: finalize txn2Commit sets officialFinalVersionNumber and workflowState complete', () => {
  const documents4a = readSrc('server/procedures/documents4a.ts');

  it('txn2Commit inserts a new formatted version via insertVersion', () => {
    expect(documents4a).toContain('const formattedVersion = await insertVersion(');
  });

  it('txn2Commit sets officialFinalVersionNumber to the new version number', () => {
    expect(documents4a).toContain('officialFinalVersionNumber: formattedVersion.versionNumber,');
  });

  it("txn2Commit advances workflowState to 'complete'", () => {
    // Use 'formattedVersion' as unique anchor for the finalize txn2Commit block
    // (other txn2Commit blocks do not use 'formattedVersion').
    const commitBlock = documents4a.substring(
      documents4a.indexOf('const formattedVersion = await insertVersion('),
      documents4a.indexOf('formatting_timeout'),
    );
    expect(commitBlock).toContain("'complete'");
  });

  it('txn2Commit updates currentVersionId to the formatted version', () => {
    expect(documents4a).toContain('await updateDocumentCurrentVersion(');
  });
});

// ============================================================
// T-FE2-8 — Server: finalize txn2Revert reverts to
//            substantively_accepted and does NOT set
//            officialFinalVersionNumber
// ============================================================
describe('T-FE2-8: finalize txn2Revert reverts to substantively_accepted without setting officialFinalVersionNumber', () => {
  const documents4a = readSrc('server/procedures/documents4a.ts');

  // Helper: extract the finalize txn2Revert block using unique anchors.
  // 'formatting_timeout' appears only in the finalize txn2Revert telemetry trigger.
  // We walk back from that anchor to the nearest preceding txn2Revert keyword.
  function getFinalizeRevertBlock(src: string): string {
    const revertAnchor = 'formatting_timeout';
    const revertAnchorIdx = src.indexOf(revertAnchor);
    const txn2RevertKw = 'txn2Revert: async ({ jobId, errorClass }) => {';
    let pos = 0;
    let lastRevertBefore = -1;
    let idx = src.indexOf(txn2RevertKw, pos);
    while (idx !== -1 && idx <= revertAnchorIdx) {
      lastRevertBefore = idx;
      pos = idx + 1;
      idx = src.indexOf(txn2RevertKw, pos);
    }
    const telemetryEnd = src.indexOf('telemetryCtx: { userId, matterId: doc.matterId', revertAnchorIdx);
    return src.substring(lastRevertBefore, telemetryEnd);
  }

  it("txn2Revert reverts workflowState to 'substantively_accepted'", () => {
    const revertBlock = getFinalizeRevertBlock(documents4a);
    expect(revertBlock).toContain("'substantively_accepted'");
  });

  it('txn2Revert does NOT set officialFinalVersionNumber', () => {
    const revertBlock = getFinalizeRevertBlock(documents4a);
    expect(revertBlock).not.toContain('officialFinalVersionNumber');
  });

  it('txn2Revert does NOT call insertVersion', () => {
    const revertBlock = getFinalizeRevertBlock(documents4a);
    expect(revertBlock).not.toContain('insertVersion');
  });
});

// ============================================================
// T-FE2-9 — Export version-selection: complete state uses
//            officialFinalVersionNumber only
// ============================================================
describe('T-FE2-9: Export route uses officialFinalVersionNumber only when state is complete', () => {
  const indexTs = readSrc('server/index.ts');

  it("complete branch uses officialFinalVersionNumber", () => {
    // Extract the complete branch
    const completeBranchStart = indexTs.indexOf("if (state === 'complete')");
    const completeBranchEnd = indexTs.indexOf("} else if (state === 'substantively_accepted'");
    const completeBranch = indexTs.substring(completeBranchStart, completeBranchEnd);
    expect(completeBranch).toContain('officialFinalVersionNumber');
    expect(completeBranch).not.toContain('officialSubstantiveVersionNumber');
    expect(completeBranch).not.toContain('currentVersionId');
  });

  it("complete branch calls getVersionByNumber with officialFinalVersionNumber", () => {
    const completeBranchStart = indexTs.indexOf("if (state === 'complete')");
    const completeBranchEnd = indexTs.indexOf("} else if (state === 'substantively_accepted'");
    const completeBranch = indexTs.substring(completeBranchStart, completeBranchEnd);
    expect(completeBranch).toContain('getVersionByNumber(documentId, userId, doc.officialFinalVersionNumber)');
  });
});

// ============================================================
// T-FE2-10 — Export version-selection: substantively_accepted
//             and finalizing use substantive/current, not final
// ============================================================
describe('T-FE2-10: Export route uses substantive/current version for non-complete states', () => {
  const indexTs = readSrc('server/index.ts');

  it("substantively_accepted/finalizing branch uses officialSubstantiveVersionNumber as primary", () => {
    const subBranchStart = indexTs.indexOf("} else if (state === 'substantively_accepted' || state === 'finalizing')");
    const subBranchEnd = indexTs.indexOf("} else if (state === 'drafting')");
    const subBranch = indexTs.substring(subBranchStart, subBranchEnd);
    expect(subBranch).toContain('officialSubstantiveVersionNumber');
  });

  it("substantively_accepted/finalizing branch falls back to currentVersionId when substantive is null", () => {
    const subBranchStart = indexTs.indexOf("} else if (state === 'substantively_accepted' || state === 'finalizing')");
    const subBranchEnd = indexTs.indexOf("} else if (state === 'drafting')");
    const subBranch = indexTs.substring(subBranchStart, subBranchEnd);
    expect(subBranch).toContain('currentVersionId');
  });

  it("substantively_accepted/finalizing branch does NOT use officialFinalVersionNumber", () => {
    const subBranchStart = indexTs.indexOf("} else if (state === 'substantively_accepted' || state === 'finalizing')");
    const subBranchEnd = indexTs.indexOf("} else if (state === 'drafting')");
    const subBranch = indexTs.substring(subBranchStart, subBranchEnd);
    expect(subBranch).not.toContain('officialFinalVersionNumber');
  });
});

// ============================================================
// T-FE2-11 — PublicJobSchema exposes errorMessage: string | null
// ============================================================
describe('T-FE2-11: PublicJobSchema exposes errorMessage to the client', () => {
  const jobsSchema = readSrc('shared/schemas/jobs.ts');

  it('PublicJobSchema is defined in shared/schemas/jobs.ts', () => {
    expect(jobsSchema).toContain('PublicJobSchema');
  });

  it('PublicJobSchema includes errorMessage: z.string().nullable()', () => {
    const publicSchemaBlock = jobsSchema.substring(
      jobsSchema.indexOf('export const PublicJobSchema'),
      jobsSchema.indexOf('export type PublicJob'),
    );
    expect(publicSchemaBlock).toContain('errorMessage: z.string().nullable()');
  });
});
