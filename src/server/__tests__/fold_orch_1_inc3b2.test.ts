/**
 * FOLD-ORCH-1 Increment 3b-2 — session consolidation assembly (PURE).
 *
 * Tests the pure assembly that the orchestration.getConsolidation / registerDivergentItems
 * procedures call: successful-reviewer derivation, the end-to-end classification, and the
 * content-preserving divergent-item projection. The tRPC procedures + DB reads/writes run live
 * (no test DB); the Inc1/Inc2/Inc3a pieces they compose are tested in their own suites.
 */

import { describe, it, expect } from 'vitest';
import {
  assembleSessionConsolidation,
  successfulReviewersFromFeedback,
} from '../orchestration/sessionConsolidation.js';
import type { ReviewerFeedbackForGrouping } from '../orchestration/groupFromEvaluator.js';
import type { EvaluatorIssueGroup } from '../../shared/schemas/phase4b.js';

function feedback(): ReviewerFeedbackForGrouping[] {
  return [
    { reviewerRole: 'claude', suggestions: [{ suggestionId: 'c1', body: 'Capitalize "Agreement".', severity: 'PRECISION' }] },
    { reviewerRole: 'gpt', suggestions: [{ suggestionId: 'g1', body: 'Use "Agreement" consistently.', severity: 'PRECISION' }] },
  ];
}

// ============================================================
// A. successfulReviewersFromFeedback
// ============================================================
describe('FOLD-ORCH-1 Inc3b-2 — successfulReviewersFromFeedback', () => {
  it('counts distinct reviewers with >=1 suggestion; excludes empty lanes; dedupes', () => {
    const rows: ReviewerFeedbackForGrouping[] = [
      { reviewerRole: 'claude', suggestions: [{ suggestionId: 'c1', body: 'x' }] },
      { reviewerRole: 'gpt', suggestions: [] }, // empty lane — not a successful vote
      { reviewerRole: 'claude', suggestions: [{ suggestionId: 'c2', body: 'y' }] }, // dup role
    ];
    expect(successfulReviewersFromFeedback(rows)).toEqual(['claude']);
  });

  it('both reviewers with suggestions -> both successful', () => {
    expect(successfulReviewersFromFeedback(feedback())).toEqual(['claude', 'gpt']);
  });
});

// ============================================================
// B. assembleSessionConsolidation — end-to-end
// ============================================================
describe('FOLD-ORCH-1 Inc3b-2 — assembleSessionConsolidation', () => {
  it('convergent low-risk (2 successful, PRECISION, agreed) -> bulk-eligible, no divergent items', () => {
    const issueGroups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'PRECISION', divergent: false },
    ];
    const proj = assembleSessionConsolidation({
      reviewSessionId: 'sess-1',
      intendedReviewers: ['claude', 'gpt', 'gemini'],
      feedbackRows: feedback(),
      issueGroups,
    });
    expect(proj.consolidation.bulkEligibleIssueIds).toContain('i1');
    // REVIEWER-NO-RETURN-RELABEL-1: gemini wrote NO feedback row here -> a true non-return.
    expect(proj.consolidation.denominator).toEqual({
      intended: 3,
      successful: 2,
      missing: ['gemini'],
      completedEmpty: [],
      noReturn: ['gemini'],
    });
    expect(proj.divergentItems).toHaveLength(0);
  });

  it('REVIEWER-NO-RETURN-RELABEL-1: a completed-but-empty reviewer is "no suggestions", an absent one is "no return"', () => {
    const rows: ReviewerFeedbackForGrouping[] = [
      { reviewerRole: 'claude', suggestions: [{ suggestionId: 'c1', body: 'x', severity: 'PRECISION' }] }, // returned
      { reviewerRole: 'gpt', suggestions: [] }, // COMPLETED, empty row -> completedEmpty / "No suggestions"
      // 'gemini' is intended but wrote NO feedback row -> noReturn / "No return"
    ];
    const proj = assembleSessionConsolidation({
      reviewSessionId: 'sess-empty-vs-noreturn',
      intendedReviewers: ['claude', 'gpt', 'gemini'],
      feedbackRows: rows,
      issueGroups: null,
    });
    expect(proj.consolidation.denominator).toEqual({
      intended: 3,
      successful: 1,
      missing: ['gpt', 'gemini'],
      completedEmpty: ['gpt'], // empty lane != failed lane
      noReturn: ['gemini'],
    });
  });

  it('divergent group -> a content-preserving divergent item (per-item, never auto-close)', () => {
    // Severity is derived from the REAL members (most-severe), not the evaluator's claim — use
    // SUBSTANTIVE members so the open-item severity maps to 'substantive'.
    const rows: ReviewerFeedbackForGrouping[] = [
      { reviewerRole: 'claude', suggestions: [{ suggestionId: 'c1', body: 'Add a liability cap.', severity: 'SUBSTANTIVE' }] },
      { reviewerRole: 'gpt', suggestions: [{ suggestionId: 'g1', body: 'No cap is needed.', severity: 'SUBSTANTIVE' }] },
    ];
    const issueGroups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'SUBSTANTIVE', divergent: true },
    ];
    const proj = assembleSessionConsolidation({
      reviewSessionId: 'sess-1',
      intendedReviewers: ['claude', 'gpt'],
      feedbackRows: rows,
      issueGroups,
    });
    expect(proj.consolidation.bulkEligibleIssueIds).toEqual([]);
    expect(proj.divergentItems).toHaveLength(1);
    const item = proj.divergentItems[0]!;
    expect(item.issueId).toBe('i1');
    expect(item.severity).toBe('substantive');
    expect(item.detail.positions).toHaveLength(2); // content preserved
    expect(item.detail.sourceReviewSessionId).toBe('sess-1');
  });

  it('degrade: no issueGroups -> all-per-item, no bulk-eligible, no divergent items', () => {
    const proj = assembleSessionConsolidation({
      reviewSessionId: 'sess-1',
      intendedReviewers: ['claude', 'gpt'],
      feedbackRows: feedback(),
      issueGroups: null,
    });
    expect(proj.consolidation.groups).toEqual([]);
    expect(proj.consolidation.bulkEligibleIssueIds).toEqual([]);
    expect(proj.divergentItems).toEqual([]);
  });

  it('a failed lane shrinks the successful denominator (floor discipline)', () => {
    const issueGroups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'PRECISION', divergent: false },
    ];
    // gpt returned nothing this run -> only claude is successful -> below floor -> per-item.
    const rows: ReviewerFeedbackForGrouping[] = [
      { reviewerRole: 'claude', suggestions: [{ suggestionId: 'c1', body: 'x', severity: 'PRECISION' }] },
      { reviewerRole: 'gpt', suggestions: [] },
    ];
    const proj = assembleSessionConsolidation({
      reviewSessionId: 'sess-1',
      intendedReviewers: ['claude', 'gpt'],
      feedbackRows: rows,
      issueGroups,
    });
    expect(proj.consolidation.convergenceFloorMet).toBe(false);
    expect(proj.consolidation.bulkEligibleIssueIds).toEqual([]);
  });
});
