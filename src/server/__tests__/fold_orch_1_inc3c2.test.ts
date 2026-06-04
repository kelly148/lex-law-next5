/**
 * FOLD-ORCH-1 Increment 3c-2a — confirmation-MODE threading + bulk-eligible member exposure.
 *
 * Tests the PURE bulk-eligible-group projection (the members the expand-to-see bulk-confirm UI
 * adopts) and the additive SessionSelectionSchema.confirmationMode field. The regenerate adopt
 * threading (selection.confirmationMode -> insertAdoptLedgerEntry, default 'individually_adopted')
 * runs live (no test DB); insertAdoptLedgerEntry's confirmationMode column is covered by Inc3a.
 */

import { describe, it, expect } from 'vitest';
import { assembleSessionConsolidation } from '../orchestration/sessionConsolidation.js';
import type { ReviewerFeedbackForGrouping } from '../orchestration/groupFromEvaluator.js';
import { SessionSelectionSchema, type EvaluatorIssueGroup } from '../../shared/schemas/phase4b.js';

function feedback(): ReviewerFeedbackForGrouping[] {
  return [
    { reviewerRole: 'claude', suggestions: [{ suggestionId: 'c1', body: 'Capitalize "Agreement".', severity: 'PRECISION' }] },
    { reviewerRole: 'gpt', suggestions: [{ suggestionId: 'g1', body: 'Use "Agreement" consistently.', severity: 'PRECISION' }] },
  ];
}

// ============================================================
// A. bulkEligibleGroups exposure (the expand-to-see members)
// ============================================================
describe('FOLD-ORCH-1 Inc3c-2a — bulkEligibleGroups projection', () => {
  it('a convergent low-risk group exposes its member suggestions', () => {
    const issueGroups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'PRECISION', divergent: false },
    ];
    const proj = assembleSessionConsolidation({
      reviewSessionId: 'sess-1',
      intendedReviewers: ['claude', 'gpt'],
      feedbackRows: feedback(),
      issueGroups,
    });
    expect(proj.bulkEligibleGroups).toHaveLength(1);
    const g = proj.bulkEligibleGroups[0]!;
    expect(g.issueId).toBe('i1');
    expect(g.agreedCount).toBe(2);
    expect(g.members.map((m) => m.suggestionId).sort()).toEqual(['c1', 'g1']);
    expect(g.members.find((m) => m.suggestionId === 'c1')?.reviewerRole).toBe('claude');
    expect(g.members.find((m) => m.suggestionId === 'g1')?.position).toContain('Agreement');
  });

  it('divergent and per-item groups are NOT exposed as bulk-eligible', () => {
    const issueGroups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'SUBSTANTIVE', divergent: true },
    ];
    const proj = assembleSessionConsolidation({
      reviewSessionId: 'sess-1',
      intendedReviewers: ['claude', 'gpt'],
      feedbackRows: feedback(),
      issueGroups,
    });
    expect(proj.bulkEligibleGroups).toEqual([]);
  });

  it('no issueGroups -> no bulk-eligible groups (degrade-safe)', () => {
    const proj = assembleSessionConsolidation({
      reviewSessionId: 'sess-1',
      intendedReviewers: ['claude', 'gpt'],
      feedbackRows: feedback(),
      issueGroups: null,
    });
    expect(proj.bulkEligibleGroups).toEqual([]);
  });
});

// ============================================================
// B. SessionSelectionSchema.confirmationMode (additive JSON field)
// ============================================================
const SUGGESTION_UUID = '11111111-1111-1111-1111-111111111111';

describe('FOLD-ORCH-1 Inc3c-2a — SessionSelectionSchema.confirmationMode', () => {
  it('parses WITHOUT confirmationMode (back-compat / pre-ORCH selections)', () => {
    expect(SessionSelectionSchema.safeParse({ suggestionId: SUGGESTION_UUID, note: null }).success).toBe(true);
  });

  it('parses with a valid confirmationMode', () => {
    const parsed = SessionSelectionSchema.parse({
      suggestionId: SUGGESTION_UUID,
      note: null,
      confirmationMode: 'bulk_acknowledged_low_severity_convergent',
    });
    expect(parsed.confirmationMode).toBe('bulk_acknowledged_low_severity_convergent');
  });

  it('rejects an invalid confirmationMode', () => {
    expect(
      SessionSelectionSchema.safeParse({ suggestionId: SUGGESTION_UUID, note: null, confirmationMode: 'adopted' }).success,
    ).toBe(false);
  });
});
