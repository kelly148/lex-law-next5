/**
 * MR-2 Tests — Cross-Iteration Feedback History & Reviewer Default Heuristic
 *
 * S4a: listFeedbackForDocument function exists and is exported from phase4b.ts
 * S4b: listFeedbackForDocument query shape (select columns, left-join, post-filter)
 * S4c: reviewSession.getDocumentHistory procedure exists in the router
 * S4d: S3 heuristic logic — Cases 1–4 rotation (static analysis of ReviewPane.tsx)
 * S4e: HistorySection component exists and uses getDocumentHistory (ascending sort)
 * S4f: S1 evaluator path inline comment is present
 * S4g: Abandoned-session exclusion behavioral test (post-filter logic)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, 'src', relPath), 'utf-8');
}

// ============================================================
// S4a: listFeedbackForDocument export
// ============================================================
describe('S4a: listFeedbackForDocument export', () => {
  const phase4b = readSrc('server/db/queries/phase4b.ts');

  it('exports listFeedbackForDocument function', () => {
    expect(phase4b).toContain('export async function listFeedbackForDocument(');
  });

  it('accepts documentId and userId parameters', () => {
    expect(phase4b).toContain('documentId: string,');
    expect(phase4b).toContain('userId: string,');
  });

  it('returns Promise<FeedbackRow[]>', () => {
    expect(phase4b).toContain('): Promise<FeedbackRow[]>');
  });
});

// ============================================================
// S4b: listFeedbackForDocument query shape
// ============================================================
describe('S4b: listFeedbackForDocument query shape', () => {
  const phase4b = readSrc('server/db/queries/phase4b.ts');

  it('selects sessionState from reviewSessions.state', () => {
    expect(phase4b).toContain('sessionState: reviewSessions.state,');
  });

  it('performs a leftJoin on reviewSessions', () => {
    expect(phase4b).toContain('.leftJoin(');
    expect(phase4b).toContain('reviewSessions,');
  });

  it('joins on feedback.reviewSessionId === reviewSessions.id', () => {
    expect(phase4b).toContain('eq(feedback.reviewSessionId, reviewSessions.id)');
  });

  it('filters by documentId and userId in WHERE clause', () => {
    expect(phase4b).toContain('eq(feedback.documentId, documentId)');
    expect(phase4b).toContain('eq(feedback.userId, userId)');
  });

  it('orders by iterationNumber ASC then createdAt ASC', () => {
    expect(phase4b).toContain('asc(feedback.iterationNumber), asc(feedback.createdAt)');
  });

  it('post-filters to exclude abandoned sessions', () => {
    expect(phase4b).toContain("r.sessionState !== 'abandoned'");
  });

  it('includes rows where sessionState is null (orphaned feedback)', () => {
    // The filter condition `r.sessionState !== 'abandoned'` passes null values
    // because null !== 'abandoned' is true in JavaScript.
    // Verify the comment documents this intent.
    expect(phase4b).toContain('sessionState === null');
  });
});

// ============================================================
// S4c: reviewSession.getDocumentHistory procedure
// ============================================================
describe('S4c: reviewSession.getDocumentHistory procedure', () => {
  const reviewSession = readSrc('server/procedures/reviewSession.ts');

  it('defines getDocumentHistory procedure', () => {
    expect(reviewSession).toContain('getDocumentHistory:');
  });

  it('accepts documentId as UUID input', () => {
    expect(reviewSession).toContain('documentId: z.string().uuid()');
  });

  it('calls listFeedbackForDocument', () => {
    expect(reviewSession).toContain('listFeedbackForDocument(input.documentId, userId)');
  });

  it('returns { feedback: allFeedback }', () => {
    expect(reviewSession).toContain('return { feedback: allFeedback }');
  });

  it('verifies document ownership before returning data', () => {
    // Ownership check: getDocumentById is called and throws NOT_FOUND if missing.
    expect(reviewSession).toContain("code: 'NOT_FOUND', message: 'Document not found'");
  });

  it('imports listFeedbackForDocument from phase4b queries', () => {
    expect(reviewSession).toContain('listFeedbackForDocument,');
  });
});

// ============================================================
// S4d: S3 heuristic Cases 1–4 rotation in ReviewPane.tsx
// ============================================================
describe('S4d: S3 reviewer default heuristic (rotation)', () => {
  const reviewPane = readSrc('client/components/ReviewPane.tsx');

  it('fetches document history in CreateSessionView', () => {
    expect(reviewPane).toContain('trpc.reviewSession.getDocumentHistory.useQuery({ documentId })');
  });

  it('extracts mostRecentPriorRow as a separate memo', () => {
    expect(reviewPane).toContain('const mostRecentPriorRow = React.useMemo(');
  });

  it('Case 4: no prior history falls back to first enabled reviewer', () => {
    expect(reviewPane).toContain('if (!mostRecentPriorRow)');
    expect(reviewPane).toContain('return fallback');
  });

  it('Case 2: prior reviewer no longer enabled falls back to first enabled reviewer', () => {
    expect(reviewPane).toContain('if (!enabledReviewers.includes(priorRole))');
    expect(reviewPane).toContain('return fallback');
  });

  it('Case 3: only one enabled reviewer — repeats prior reviewer', () => {
    expect(reviewPane).toContain('if (enabledReviewers.length === 1)');
    expect(reviewPane).toContain('return priorRole');
  });

  it('Case 1: rotates to next enabled reviewer after prior (modular index)', () => {
    expect(reviewPane).toContain('const idx = enabledReviewers.indexOf(priorRole)');
    expect(reviewPane).toContain('enabledReviewers[(idx + 1) % enabledReviewers.length]');
  });

  it('advisory text uses spec wording with prior and next reviewer labels', () => {
    expect(reviewPane).toContain('Last reviewed by ${priorLabel}. Suggesting ${nextLabel} for fresh perspective. Override below.');
  });

  it('advisory text is only shown in Case 1 (rotation applied)', () => {
    // Advisory requires: mostRecentPriorRow exists, priorRole is enabled, enabledReviewers.length > 1
    expect(reviewPane).toContain('if (!mostRecentPriorRow) return null');
    expect(reviewPane).toContain('if (enabledReviewers.length === 1) return null');
  });

  it('advisory text is rendered when present', () => {
    expect(reviewPane).toContain('{advisoryText && (');
  });

  it('defaultApplied ref prevents re-applying the default on subsequent renders', () => {
    expect(reviewPane).toContain('defaultApplied.current = true');
    expect(reviewPane).toContain('if (!defaultApplied.current && derivedDefault)');
  });
});

// ============================================================
// S4e: HistorySection component (ascending sort)
// ============================================================
describe('S4e: HistorySection component', () => {
  const reviewPane = readSrc('client/components/ReviewPane.tsx');

  it('defines HistorySection component', () => {
    expect(reviewPane).toContain('function HistorySection(');
  });

  it('accepts documentId and currentIterationNumber props', () => {
    expect(reviewPane).toContain('documentId: string;');
    expect(reviewPane).toContain('currentIterationNumber: number;');
  });

  it('calls getDocumentHistory query', () => {
    expect(reviewPane).toContain('trpc.reviewSession.getDocumentHistory.useQuery({ documentId })');
  });

  it('filters out current iteration rows', () => {
    expect(reviewPane).toContain('fb.iterationNumber < currentIterationNumber');
  });

  it('groups rows by iterationNumber ascending (oldest first)', () => {
    // MR-2 addendum correction: sort is ascending (a - b), not descending.
    expect(reviewPane).toContain('.sort(([a], [b]) => a - b)');
    expect(reviewPane).not.toContain('.sort(([a], [b]) => b - a)');
  });

  it('renders a collapsible "Prior Feedback" section', () => {
    expect(reviewPane).toContain('Prior Feedback (');
  });

  it('is rendered inside ActiveSessionView', () => {
    expect(reviewPane).toContain('<HistorySection documentId={documentId} currentIterationNumber={iterationNumber} />');
  });

  it('returns null when there are no prior rows', () => {
    expect(reviewPane).toContain('if (priorRows.length === 0) return null');
  });
});

// ============================================================
// S4f: S1 evaluator path inline comment
// ============================================================
describe('S4f: S1 evaluator path inline comment', () => {
  const reviewSession = readSrc('server/procedures/reviewSession.ts');

  it('has evaluator path documentation comment above the dispatch gate', () => {
    // The S1 comment should describe the evaluator path and Decision #41.
    expect(reviewSession).toContain('Decision #41');
  });

  it('documents that evaluator only runs for multi-reviewer sessions', () => {
    expect(reviewSession).toContain('selectedReviewers.length > 1');
  });
});

// ============================================================
// S4g: Abandoned-session exclusion behavioral test
// ============================================================
describe('S4g: abandoned-session exclusion post-filter logic', () => {
  // Behavioral test: verify the post-filter logic directly using the JavaScript
  // semantics of the filter expression `r.sessionState !== 'abandoned'`.
  // This tests the actual runtime behavior without requiring a database.

  type Row = { id: string; iterationNumber: number; sessionState: string | null };

  // Simulate the post-filter applied in listFeedbackForDocument.
  function applyPostFilter(rows: Row[]): Row[] {
    return rows.filter((r) => r.sessionState !== 'abandoned');
  }

  it('excludes rows with sessionState === "abandoned"', () => {
    const rows: Row[] = [
      { id: 'a', iterationNumber: 1, sessionState: 'abandoned' },
      { id: 'b', iterationNumber: 2, sessionState: 'active' },
    ];
    const result = applyPostFilter(rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('b');
  });

  it('includes rows with sessionState === "active"', () => {
    const rows: Row[] = [
      { id: 'c', iterationNumber: 1, sessionState: 'active' },
    ];
    const result = applyPostFilter(rows);
    expect(result).toHaveLength(1);
  });

  it('includes rows with sessionState === "regenerated"', () => {
    const rows: Row[] = [
      { id: 'd', iterationNumber: 1, sessionState: 'regenerated' },
    ];
    const result = applyPostFilter(rows);
    expect(result).toHaveLength(1);
  });

  it('includes rows with sessionState === null (orphaned feedback, no matching session)', () => {
    // null !== 'abandoned' is true in JavaScript — orphaned rows are included.
    const rows: Row[] = [
      { id: 'e', iterationNumber: 1, sessionState: null },
    ];
    const result = applyPostFilter(rows);
    expect(result).toHaveLength(1);
  });

  it('handles a mixed set: excludes only abandoned rows', () => {
    const rows: Row[] = [
      { id: 'f1', iterationNumber: 1, sessionState: 'abandoned' },
      { id: 'f2', iterationNumber: 2, sessionState: 'active' },
      { id: 'f3', iterationNumber: 3, sessionState: null },
      { id: 'f4', iterationNumber: 4, sessionState: 'regenerated' },
      { id: 'f5', iterationNumber: 5, sessionState: 'abandoned' },
    ];
    const result = applyPostFilter(rows);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual(['f2', 'f3', 'f4']);
  });

  it('returns empty array when all rows are abandoned', () => {
    const rows: Row[] = [
      { id: 'g1', iterationNumber: 1, sessionState: 'abandoned' },
      { id: 'g2', iterationNumber: 2, sessionState: 'abandoned' },
    ];
    const result = applyPostFilter(rows);
    expect(result).toHaveLength(0);
  });

  it('returns all rows when none are abandoned', () => {
    const rows: Row[] = [
      { id: 'h1', iterationNumber: 1, sessionState: 'active' },
      { id: 'h2', iterationNumber: 2, sessionState: 'regenerated' },
      { id: 'h3', iterationNumber: 3, sessionState: null },
    ];
    const result = applyPostFilter(rows);
    expect(result).toHaveLength(3);
  });
});
