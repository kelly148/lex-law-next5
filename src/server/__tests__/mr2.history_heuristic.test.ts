/**
 * MR-2 Tests — Cross-Iteration Feedback History & Reviewer Default Heuristic
 *
 * S4a: listFeedbackForDocument function exists and is exported from phase4b.ts
 * S4b: listFeedbackForDocument query shape (select columns, left-join, post-filter)
 * S4c: reviewSession.getDocumentHistory procedure exists in the router
 * S4d: S3 heuristic logic — Cases 1–4 (static analysis of ReviewPane.tsx)
 * S4e: HistorySection component exists and uses getDocumentHistory
 * S4f: S1 evaluator path inline comment is present
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
// S4d: S3 heuristic Cases 1–4 in ReviewPane.tsx
// ============================================================
describe('S4d: S3 reviewer default heuristic', () => {
  const reviewPane = readSrc('client/components/ReviewPane.tsx');

  it('fetches document history in CreateSessionView', () => {
    expect(reviewPane).toContain('trpc.reviewSession.getDocumentHistory.useQuery({ documentId })');
  });

  it('Case 1: iterationNumber === 1 falls back to first enabled reviewer', () => {
    expect(reviewPane).toContain('iterationNumber === 1');
    expect(reviewPane).toContain('return fallback');
  });

  it('Case 2: uses reviewerRole from most recent prior iteration', () => {
    expect(reviewPane).toContain('fb.iterationNumber < iterationNumber');
    expect(reviewPane).toContain('fb.iterationNumber > best.iterationNumber ? fb : best');
    expect(reviewPane).toContain('const priorRole = mostRecent.reviewerRole');
  });

  it('Case 3: no prior feedback falls back to first enabled reviewer', () => {
    expect(reviewPane).toContain('if (priorRows.length === 0) return fallback');
  });

  it('Case 4: disabled prior reviewer falls back to first enabled reviewer', () => {
    expect(reviewPane).toContain('if (!enabledReviewers.includes(priorRole)) return fallback');
  });

  it('advisory text is rendered when iterationNumber > 1 and prior feedback exists', () => {
    expect(reviewPane).toContain('Last iteration used ${mostRecent.reviewerTitle}.');
    expect(reviewPane).toContain('{advisoryText && (');
  });

  it('defaultApplied ref prevents re-applying the default on subsequent renders', () => {
    expect(reviewPane).toContain('defaultApplied.current = true');
    expect(reviewPane).toContain('if (!defaultApplied.current && derivedDefault)');
  });
});

// ============================================================
// S4e: HistorySection component
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

  it('groups rows by iterationNumber descending', () => {
    expect(reviewPane).toContain('.sort(([a], [b]) => b - a)');
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
