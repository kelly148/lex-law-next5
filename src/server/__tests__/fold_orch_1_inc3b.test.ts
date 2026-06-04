/**
 * FOLD-ORCH-1 Increment 3b-1 — capture the evaluator's issue grouping.
 *
 * Tests the additive Zod-Wall change on feedback_evaluations (issueGroups — the GROUPING SOURCE,
 * captured from the same evaluator call that produced dispositions). The dispatch capture
 * (reviewSession evaluator path -> parseEvaluatorOutputFull -> insertFeedbackEvaluation) and the
 * DB write run live, not in unit tests (no test DB / LLM); parseEvaluatorOutputFull is covered by
 * the Inc2a suite.
 */

import { describe, it, expect } from 'vitest';
import { FeedbackEvaluationRowSchema } from '../../shared/schemas/phase4b.js';

const BASE_EVAL = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  documentId: '33333333-3333-3333-3333-333333333333',
  iterationNumber: 1,
  jobId: '44444444-4444-4444-4444-444444444444',
  dispositions: [{ suggestionId: 'c1', disposition: 'adopt' }],
  createdAt: new Date('2026-06-04T00:00:00Z'),
};

describe('FOLD-ORCH-1 Inc3b — feedback_evaluations.issueGroups Zod Wall', () => {
  it('parses WITHOUT issueGroups (back-compat / pre-ORCH evaluation rows)', () => {
    expect(FeedbackEvaluationRowSchema.safeParse(BASE_EVAL).success).toBe(true);
  });

  it('parses with issueGroups = null', () => {
    expect(FeedbackEvaluationRowSchema.safeParse({ ...BASE_EVAL, issueGroups: null }).success).toBe(true);
  });

  it('parses and preserves an issueGroups array', () => {
    const parsed = FeedbackEvaluationRowSchema.parse({
      ...BASE_EVAL,
      issueGroups: [
        { issueId: 'i1', suggestionIds: ['c1', 'g1'], reviewerRoles: ['claude', 'gpt'], severity: 'PRECISION', divergent: false },
      ],
    });
    expect(parsed.issueGroups).toHaveLength(1);
    expect(parsed.issueGroups![0]!.issueId).toBe('i1');
  });

  it('rejects a malformed issueGroups entry (missing suggestionIds)', () => {
    const bad = FeedbackEvaluationRowSchema.safeParse({
      ...BASE_EVAL,
      issueGroups: [{ issueId: 'i1', severity: 'PRECISION' }],
    });
    expect(bad.success).toBe(false);
  });
});
