/**
 * FOLD-ORCH-1 Increment 1 — consolidation + bulk-eligibility engine (the safety core).
 *
 * Encodes the triad-disposition named changes: bulk-eligibility (not the gesture) is the
 * control; convergence = actual N-of-M successful reviewer overlap (evaluator never constitutes
 * it); floor >= 2 successful returns; severity-gated eligibility; divergent never eligible.
 */

import { describe, it, expect } from 'vitest';
import {
  isBulkEligibleSeverity,
  consolidateReviewerFeedback,
  CONVERGENCE_FLOOR,
  type ConsolidationInput,
} from '../orchestration/consolidate.js';
import {
  CONFIRMATION_MODE_VALUES,
  DivergentOpenItemSchema,
} from '../../shared/schemas/orchestration.js';

function input(over: Partial<ConsolidationInput> = {}): ConsolidationInput {
  return {
    intendedReviewers: ['claude', 'gpt', 'gemini'],
    successfulReviewers: ['claude', 'gpt', 'gemini'],
    groups: [],
    ...over,
  };
}

// ============================================================
// A. Severity-gated bulk-eligibility (PURE)
// ============================================================
describe('FOLD-ORCH-1 — isBulkEligibleSeverity', () => {
  it('PRECISION and POLISH are bulk-eligible', () => {
    expect(isBulkEligibleSeverity('PRECISION')).toBe(true);
    expect(isBulkEligibleSeverity('polish')).toBe(true); // case-insensitive
  });
  it('SUBSTANTIVE and BLOCKER are NEVER bulk-eligible', () => {
    expect(isBulkEligibleSeverity('SUBSTANTIVE')).toBe(false);
    expect(isBulkEligibleSeverity('BLOCKER')).toBe(false);
  });
  it('STRUCTURAL is eligible ONLY with a positive low-risk-cleanup classification', () => {
    expect(isBulkEligibleSeverity('STRUCTURAL')).toBe(false);
    expect(isBulkEligibleSeverity('STRUCTURAL', false)).toBe(false);
    expect(isBulkEligibleSeverity('STRUCTURAL', true)).toBe(true);
  });
  it('unknown/missing severity is never bulk-eligible (conservative)', () => {
    expect(isBulkEligibleSeverity('')).toBe(false);
    expect(isBulkEligibleSeverity('weird')).toBe(false);
  });
});

// ============================================================
// B. Consolidation — convergence, floor, eligibility, divergence
// ============================================================
describe('FOLD-ORCH-1 — consolidateReviewerFeedback', () => {
  it('convergent + low-risk (>=2 successful reviewers) is bulk-eligible', () => {
    const res = consolidateReviewerFeedback(input({
      groups: [{ issueId: 'i1', severity: 'PRECISION', reviewerMembers: ['claude', 'gpt'], divergent: false }],
    }));
    const g = res.groups[0]!;
    expect(g.classification).toBe('convergent_low_risk');
    expect(g.bucket).toBe('bulk_eligible');
    expect(g.bulkEligible).toBe(true);
    expect(res.bulkEligibleIssueIds).toEqual(['i1']);
  });

  it('convergent SUBSTANTIVE is per-item even with unanimous agreement', () => {
    const res = consolidateReviewerFeedback(input({
      groups: [{ issueId: 'i1', severity: 'SUBSTANTIVE', reviewerMembers: ['claude', 'gpt', 'gemini'], divergent: false }],
    }));
    const g = res.groups[0]!;
    expect(g.convergent).toBe(true);
    expect(g.classification).toBe('convergent_high_risk');
    expect(g.bucket).toBe('per_item');
    expect(g.bulkEligible).toBe(false);
  });

  it('divergent items are never bulk-eligible (even low severity)', () => {
    const res = consolidateReviewerFeedback(input({
      groups: [{ issueId: 'i1', severity: 'PRECISION', reviewerMembers: ['claude', 'gpt'], divergent: true }],
    }));
    const g = res.groups[0]!;
    expect(g.classification).toBe('divergent');
    expect(g.bucket).toBe('per_item');
    expect(g.bulkEligible).toBe(false);
    expect(g.reason).toMatch(/cannot auto-close/i);
  });

  it('a single reviewer (evaluator-adopt-with-1-reviewer) is NOT convergent', () => {
    const res = consolidateReviewerFeedback(input({
      groups: [{ issueId: 'i1', severity: 'POLISH', reviewerMembers: ['claude'], divergent: false }],
    }));
    const g = res.groups[0]!;
    expect(g.convergent).toBe(false);
    expect(g.classification).toBe('single_reviewer');
    expect(g.bucket).toBe('per_item');
  });

  it('FLOOR: with <2 successful returns there is NO convergent bucket (degraded -> per-item)', () => {
    const res = consolidateReviewerFeedback(input({
      intendedReviewers: ['claude', 'gpt', 'gemini'],
      successfulReviewers: ['claude'], // only one returned
      groups: [{ issueId: 'i1', severity: 'PRECISION', reviewerMembers: ['claude', 'gpt'], divergent: false }],
    }));
    expect(res.convergenceFloorMet).toBe(false);
    const g = res.groups[0]!;
    expect(g.classification).toBe('single_reviewer');
    expect(g.bulkEligible).toBe(false);
  });

  it('a failed/missing lane is NOT counted as a convergent vote; denominator shows it', () => {
    // gpt + gemini intended but did not return; only claude succeeded -> a 2-member group
    // where one member (gemini) did not return counts as 1 agreed.
    const res = consolidateReviewerFeedback(input({
      intendedReviewers: ['claude', 'gpt', 'gemini', 'grok'],
      successfulReviewers: ['claude', 'gpt'],
      groups: [{ issueId: 'i1', severity: 'PRECISION', reviewerMembers: ['claude', 'gemini'], divergent: false }],
    }));
    const g = res.groups[0]!;
    // claude succeeded, gemini did not -> agreedCount = 1 -> not convergent
    expect(g.agreedCount).toBe(1);
    expect(g.classification).toBe('single_reviewer');
    expect(res.denominator).toEqual({ intended: 4, successful: 2, missing: ['gemini', 'grok'] });
  });

  it('STRUCTURAL convergent is per-item unless positively classified low-risk cleanup', () => {
    const base = { issueId: 'i1', severity: 'STRUCTURAL', reviewerMembers: ['claude', 'gpt'], divergent: false } as const;
    const perItem = consolidateReviewerFeedback(input({ groups: [{ ...base }] }));
    expect(perItem.groups[0]!.bucket).toBe('per_item');
    const eligible = consolidateReviewerFeedback(input({ groups: [{ ...base, structuralLowRiskCleanup: true }] }));
    expect(eligible.groups[0]!.bucket).toBe('bulk_eligible');
  });

  it('CONVERGENCE_FLOOR is 2', () => {
    expect(CONVERGENCE_FLOOR).toBe(2);
  });
});

// ============================================================
// C. Schemas / vocabularies
// ============================================================
describe('FOLD-ORCH-1 — schemas', () => {
  it('confirmation modes are not flattened to a single "adopted"', () => {
    expect(CONFIRMATION_MODE_VALUES).toContain('bulk_acknowledged_low_severity_convergent');
    expect(CONFIRMATION_MODE_VALUES).toContain('individually_adopted');
    expect(CONFIRMATION_MODE_VALUES).toContain('synthesis_adopted');
    expect(CONFIRMATION_MODE_VALUES).toContain('divergent_resolved');
    expect(CONFIRMATION_MODE_VALUES).not.toContain('adopted');
  });

  it('DivergentOpenItem preserves per-reviewer positions (not a generic flag)', () => {
    const parsed = DivergentOpenItemSchema.parse({
      issueSummary: 'Governing-law clause conflict',
      positions: [
        { reviewerRole: 'claude', suggestionId: 's1', position: 'Use VA law', severity: 'SUBSTANTIVE', rationaleExcerpt: null },
        { reviewerRole: 'gpt', suggestionId: 's2', position: 'Use DE law', severity: 'SUBSTANTIVE' },
      ],
      evaluatorSynthesis: null,
      sourceReviewSessionId: '00000000-0000-0000-0000-0000000000aa',
    });
    expect(parsed.positions).toHaveLength(2);
    expect(parsed.positions[0]!.position).toContain('VA');
  });
});
