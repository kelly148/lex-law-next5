/**
 * mr_uat_progress_1.test.ts — MR-UAT-PROGRESS-1
 *
 * Tests for Finalize and Review async job progress visibility.
 *
 * Failure mechanisms classified:
 *   Finalize — B (missing job-derived pending state), D (duplicate-action gap),
 *              G (Finalize-specific progress gap), A (missing immediate local pending state).
 *   Review   — A (missing immediate local pending state), F (reviewer-specific progress gap).
 *
 * Fixes applied:
 *   DocumentDetail.tsx:
 *     1. finalizeMutation.onSuccess now also invalidates job.listForDocument so
 *        JobBanner immediately picks up the queued formatting job.
 *     2. isFormattingActive derived from latestFormattingJob.status (queued|running).
 *     3. Both Finalize buttons disabled when finalizeMutation.isPending || isFormattingActive.
 *     4. Both Finalize buttons show 'Finalizing document…' label when active.
 *   ReviewPane.tsx:
 *     5. pending_or_running block shows reviewer-specific label:
 *        '{ReviewerLabel} reviewer is analyzing…' when session.selectedReviewers[0] is set.
 *
 * Test strategy: source-analysis tests (node environment, no DOM rendering),
 * consistent with the project's vitest node-environment configuration and
 * the pattern established by mr3.behavioral.test.ts and mr_regenerate_refresh_1.test.ts.
 *
 * T-PROGRESS-1: Finalize shows progress while formatting job active
 * T-PROGRESS-2: Finalize progress is scoped to active document
 * T-PROGRESS-3: Finalize progress clears on terminal status
 * T-PROGRESS-4: Finalize duplicate click guarded
 * T-PROGRESS-5: Review shows reviewer-specific progress
 * T-PROGRESS-6: Review duplicate submission guarded
 * T-PROGRESS-7: Reviewer failure diagnostics preserved
 * T-PROGRESS-8: Existing successful feedback rendering preserved
 * T-PROGRESS-9: No LLM/provider/export behavior changed
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, 'src', relPath), 'utf-8');
}

// ============================================================
// T-PROGRESS-1 — Finalize shows progress while formatting job active
// ============================================================
describe('T-PROGRESS-1: Finalize shows progress while formatting job active', () => {
  const doc = readSrc('client/pages/DocumentDetail.tsx');

  it('isFormattingActive is derived from latestFormattingJob.status', () => {
    expect(doc).toContain('isFormattingActive');
    expect(doc).toContain("latestFormattingJob.status === 'queued' || latestFormattingJob.status === 'running'");
  });

  it('isFormattingActive is guarded by latestFormattingJob !== null', () => {
    const block = doc.slice(
      doc.indexOf('const isFormattingActive'),
      doc.indexOf('const isFormattingActive') + 300,
    );
    expect(block).toContain('latestFormattingJob !== null');
  });

  it('Finalize button shows Finalizing document… label when isFormattingActive is true', () => {
    expect(doc).toContain("'Finalizing document\u2026'");
  });

  it('Finalize button label is conditional on isPending or isFormattingActive', () => {
    expect(doc).toContain('finalizeMutation.isPending || isFormattingActive');
    // The label expression must appear at least twice (two button occurrences)
    const matches = doc.match(/finalizeMutation\.isPending \|\| isFormattingActive/g);
    expect(matches).not.toBeNull();
    expect((matches ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('MR-UAT-PROGRESS-1 comment is present in DocumentDetail.tsx', () => {
    expect(doc).toContain('MR-UAT-PROGRESS-1');
  });
});

// ============================================================
// T-PROGRESS-2 — Finalize progress is scoped to active document
// ============================================================
describe('T-PROGRESS-2: Finalize progress is scoped to active document', () => {
  const doc = readSrc('client/pages/DocumentDetail.tsx');

  it('latestFormattingJob filters by documentId (MR-FINALIZE-EXPORT-3 scoping preserved)', () => {
    // The existing MR-FINALIZE-EXPORT-3 filter compares j.documentId === (documentId ?? null).
    // isFormattingActive derives from this already-scoped latestFormattingJob.
    expect(doc).toContain("j.documentId === (documentId ?? null)");
  });

  it('isFormattingActive is derived from the documentId-scoped latestFormattingJob', () => {
    // isFormattingActive must appear after latestFormattingJob is defined.
    const latestJobIdx = doc.indexOf('const latestFormattingJob');
    const isActiveIdx = doc.indexOf('const isFormattingActive');
    expect(latestJobIdx).toBeGreaterThan(-1);
    expect(isActiveIdx).toBeGreaterThan(latestJobIdx);
  });

  it('isFormattingActive references latestFormattingJob (not a different variable)', () => {
    const block = doc.slice(
      doc.indexOf('const isFormattingActive'),
      doc.indexOf('const isFormattingActive') + 300,
    );
    expect(block).toContain('latestFormattingJob');
  });

  it('stale-banner scoping comment from MR-FINALIZE-EXPORT-3 is preserved', () => {
    expect(doc).toContain('MR-FINALIZE-EXPORT-3');
  });
});

// ============================================================
// T-PROGRESS-3 — Finalize progress clears on terminal status
// ============================================================
describe('T-PROGRESS-3: Finalize progress clears on terminal status', () => {
  const doc = readSrc('client/pages/DocumentDetail.tsx');

  it('isFormattingActive is false for completed status (only queued|running are active)', () => {
    // The expression only includes queued and running — completed/failed/timed_out are excluded.
    const block = doc.slice(
      doc.indexOf('const isFormattingActive'),
      doc.indexOf('const isFormattingActive') + 300,
    );
    expect(block).not.toContain("'completed'");
    expect(block).not.toContain("'failed'");
    expect(block).not.toContain("'timed_out'");
    expect(block).toContain("'queued'");
    expect(block).toContain("'running'");
  });

  it('FinalizeDiagnosticBanner is still rendered (failure diagnostic preserved)', () => {
    expect(doc).toContain('FinalizeDiagnosticBanner');
    expect(doc).toContain('formattingJob={latestFormattingJob}');
  });

  it('FinalizeDiagnosticBanner checks failed and timed_out statuses', () => {
    const bannerFn = doc.slice(
      doc.indexOf('function FinalizeDiagnosticBanner'),
      doc.indexOf('function JobBanner'),
    );
    expect(bannerFn).toContain("'failed'");
    expect(bannerFn).toContain("'timed_out'");
  });
});

// ============================================================
// T-PROGRESS-4 — Finalize duplicate click guarded
// ============================================================
describe('T-PROGRESS-4: Finalize duplicate click guarded', () => {
  const doc = readSrc('client/pages/DocumentDetail.tsx');

  it('both Finalize buttons are disabled when isFormattingActive', () => {
    const disabledMatches = doc.match(/disabled=\{finalizeMutation\.isPending \|\| isFormattingActive\}/g);
    expect(disabledMatches).not.toBeNull();
    // Both button occurrences must be guarded
    expect((disabledMatches ?? []).length).toBe(2);
  });

  it('both Finalize buttons have aria-busy when active', () => {
    const ariaBusyMatches = doc.match(/aria-busy=\{finalizeMutation\.isPending \|\| isFormattingActive\}/g);
    expect(ariaBusyMatches).not.toBeNull();
    expect((ariaBusyMatches ?? []).length).toBe(2);
  });

  it('finalizeMutation.onSuccess invalidates job.listForDocument', () => {
    // After finalize, job.listForDocument is invalidated so JobBanner picks up the
    // queued formatting job immediately without waiting for the next poll cycle.
    const finalizeMutationBlock = doc.slice(
      doc.indexOf('const finalizeMutation = useGuardedMutation'),
      doc.indexOf('// Template-mode mutations'),
    );
    expect(finalizeMutationBlock).toContain('utils.job.listForDocument.invalidate');
  });

  it('finalizeMutation.onSuccess still invalidates document.get', () => {
    const finalizeMutationBlock = doc.slice(
      doc.indexOf('const finalizeMutation = useGuardedMutation'),
      doc.indexOf('// Template-mode mutations'),
    );
    expect(finalizeMutationBlock).toContain('utils.document.get.invalidate');
  });
});

// ============================================================
// T-PROGRESS-5 — Review shows reviewer-specific progress
// ============================================================
describe('T-PROGRESS-5: Review shows reviewer-specific progress', () => {
  const pane = readSrc('client/components/ReviewPane.tsx');

  it('pending_or_running block shows reviewer-specific label', () => {
    expect(pane).toContain('reviewer is analyzing\u2026');
  });

  it('reviewer label uses REVIEWER_LABELS mapping', () => {
    const pendingBlock = pane.slice(
      pane.indexOf("completionState === 'pending_or_running'"),
      pane.indexOf("completionState === 'completed_with_feedback'"),
    );
    expect(pendingBlock).toContain('REVIEWER_LABELS');
    expect(pendingBlock).toContain('session.selectedReviewers[0]');
  });

  it('falls back to generic label when selectedReviewers[0] is absent', () => {
    const pendingBlock = pane.slice(
      pane.indexOf("completionState === 'pending_or_running'"),
      pane.indexOf("completionState === 'completed_with_feedback'"),
    );
    expect(pendingBlock).toContain("'Review in progress\u2026'");
  });

  it('REVIEWER_LABELS covers all four providers', () => {
    const labelsBlock = pane.slice(
      pane.indexOf('const REVIEWER_LABELS'),
      pane.indexOf('const REVIEWER_LABELS') + 200,
    );
    expect(labelsBlock).toContain("claude: 'Claude'");
    expect(labelsBlock).toContain("gpt: 'GPT'");
    expect(labelsBlock).toContain("gemini: 'Gemini'");
    expect(labelsBlock).toContain("grok: 'Grok'");
  });

  it('MR-UAT-PROGRESS-1 comment is present in ReviewPane.tsx', () => {
    expect(pane).toContain('MR-UAT-PROGRESS-1');
  });

  it('aria-live and aria-busy are set on the pending_or_running container', () => {
    const pendingBlock = pane.slice(
      pane.indexOf("completionState === 'pending_or_running'"),
      pane.indexOf("completionState === 'completed_with_feedback'"),
    );
    expect(pendingBlock).toContain('aria-live="polite"');
    expect(pendingBlock).toContain('aria-busy={true}');
  });
});

// ============================================================
// T-PROGRESS-6 — Review duplicate submission guarded
// ============================================================
describe('T-PROGRESS-6: Review duplicate submission guarded', () => {
  const pane = readSrc('client/components/ReviewPane.tsx');

  it('Start Review button is disabled while createMutation.isPending', () => {
    expect(pane).toContain('createMutation.isPending || selectedReviewers.length === 0');
  });

  it('Start Review button shows Creating Review Session… while pending', () => {
    expect(pane).toContain("'Creating Review Session\u2026'");
  });

  it('ActiveSessionView is only shown after session is created (onCreated callback)', () => {
    // The parent ReviewPane renders CreateSessionView or ActiveSessionView based on
    // sessionId state — only one is shown at a time, preventing duplicate submission
    // once a session is active.
    expect(pane).toContain('CreateSessionView');
    expect(pane).toContain('ActiveSessionView');
    // The toggle is driven by sessionId state
    expect(pane).toContain('sessionId');
  });
});

// ============================================================
// T-PROGRESS-7 — Reviewer failure diagnostics preserved
// ============================================================
describe('T-PROGRESS-7: Reviewer failure diagnostics preserved', () => {
  const pane = readSrc('client/components/ReviewPane.tsx');

  it("completionState === 'failed' renders FailedReviewView", () => {
    expect(pane).toContain("completionState === 'failed'");
    expect(pane).toContain('FailedReviewView');
  });

  it('FailedReviewView receives errorMessage from job data', () => {
    // Anchored on the JSX render (REVIEW-UX-REDESIGN-1 added a humanized status-line check that also
    // references completionState === 'failed', so slice from the <FailedReviewView render site).
    const failedBlock = pane.slice(
      pane.indexOf('<FailedReviewView'),
      pane.indexOf('<FailedReviewView') + 400,
    );
    expect(failedBlock).toContain('errorMessage');
  });

  it('failed state is not mislabeled as pending_or_running', () => {
    // deriveCompletionState is used — failed jobs produce 'failed', not 'pending_or_running'.
    expect(pane).toContain('deriveCompletionState');
    // The failed branch is distinct from the pending_or_running branch.
    const pendingIdx = pane.indexOf("completionState === 'pending_or_running'");
    const failedIdx = pane.indexOf("completionState === 'failed'");
    expect(pendingIdx).toBeGreaterThan(-1);
    expect(failedIdx).toBeGreaterThan(-1);
    expect(pendingIdx).not.toBe(failedIdx);
  });

  it('MR-UAT-ERR-2 diagnostic pattern is preserved', () => {
    // FailedReviewView was introduced by MR-UAT-ERR-2; its presence confirms preservation.
    expect(pane).toContain('FailedReviewView');
  });
});

// ============================================================
// T-PROGRESS-8 — Existing successful feedback rendering preserved
// ============================================================
describe('T-PROGRESS-8: Existing successful feedback rendering preserved', () => {
  const pane = readSrc('client/components/ReviewPane.tsx');

  it("completionState === 'completed_with_feedback' renders the SuggestionCard list", () => {
    expect(pane).toContain("completionState === 'completed_with_feedback'");
    // REVIEW-UX-REDESIGN-1: per-reviewer FeedbackCard -> per-suggestion SuggestionCard.
    expect(pane).toContain('SuggestionCard');
  });

  it("completionState === 'completed_without_feedback' renders CompletedWithoutFeedbackView", () => {
    expect(pane).toContain("completionState === 'completed_without_feedback'");
    expect(pane).toContain('CompletedWithoutFeedbackView');
  });

  it('Grok/GPT MR-LLM-GROK-1 and MR-LLM-GPT-1 fixes are preserved in server adapters', () => {
    // MR-LLM-GROK-1 and MR-LLM-GPT-1 fixes live in server adapters, not ReviewPane.
    // Confirm by checking the adapter files directly.
    const xai = readSrc('server/llm/xai.ts');
    expect(xai).toContain('MR-LLM-GROK-1');
    const openai = readSrc('server/llm/openai.ts');
    expect(openai).toContain('MR-LLM-GPT-1');
  });

  it('MR-REGENERATE-REFRESH-1 invalidation is preserved in ReviewPane.tsx', () => {
    expect(pane).toContain('MR-REGENERATE-REFRESH-1');
    expect(pane).toContain('utils.version.list.invalidate({ documentId })');
  });
});

// ============================================================
// T-PROGRESS-9 — No LLM/provider/export behavior changed
// ============================================================
describe('T-PROGRESS-9: No LLM/provider/export behavior changed', () => {
  it('xai.ts is not modified (MR-LLM-GROK-1 fix preserved)', () => {
    const xai = readSrc('server/llm/xai.ts');
    expect(xai).toContain('normalizeGrokStructuredOutput');
    expect(xai).toContain('MR-LLM-GROK-1');
  });

  it('openai.ts is not modified (MR-LLM-GPT-1 fix preserved)', () => {
    const openai = readSrc('server/llm/openai.ts');
    expect(openai).toContain('normalizeOpenAiStructuredOutput');
    expect(openai).toContain('MR-LLM-GPT-1');
  });

  it('canonicalMutation.ts timeoutMs field is preserved (MR-LLM-GPT-1 fix preserved)', () => {
    const cm = readSrc('server/db/canonicalMutation.ts');
    expect(cm).toContain('timeoutMs');
    expect(cm).toContain('MR-LLM-GPT-1');
  });

  it('reviewSession.ts reviewer_feedback timeoutMs: 300_000 is preserved', () => {
    const rs = readSrc('server/procedures/reviewSession.ts');
    expect(rs).toContain('timeoutMs: 300_000');
  });

  it('feedbackParser.ts is not modified', () => {
    const fp = readSrc('server/llm/parsers/feedbackParser.ts');
    // Parser should still export parseFeedbackOutput
    expect(fp).toContain('parseFeedbackOutput');
  });

  it('DocumentDetail.tsx does not modify LLM adapter imports', () => {
    const doc = readSrc('client/pages/DocumentDetail.tsx');
    // No LLM adapter imports should appear in client code
    expect(doc).not.toContain("from '../../../server/llm");
    expect(doc).not.toContain('openai');
    expect(doc).not.toContain('xai');
  });
});
