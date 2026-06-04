/**
 * FOLD-ORCH-1 Increment 2 — evaluator-membership grouping (the decided GROUPING SOURCE).
 *
 * Encodes the triad-disposition named change (Fork B): the evaluator LABELS membership but NEVER
 * CONSTITUTES convergence. Membership/counts are re-derived from the REAL persisted feedback;
 * severity is the most-severe real member; divergence honors an evaluator flag AND independently
 * fires on severity disagreement; absent/malformed grouping degrades to all-per-item.
 */

import { describe, it, expect } from 'vitest';
import {
  buildOrchestrationGroups,
  consolidateFromEvaluator,
  type ReviewerFeedbackForGrouping,
} from '../orchestration/groupFromEvaluator.js';
import {
  parseEvaluatorOutput,
  parseEvaluatorOutputFull,
} from '../llm/parsers/evaluatorOutputParse.js';
import { buildEvaluatorSystemPrompt } from '../llm/prompts/evaluatorPrompt.js';
import type { EvaluatorIssueGroup } from '../../shared/schemas/phase4b.js';

// Two reviewers (claude, gpt) both raise the same PRECISION issue; ids are per-reviewer-unique.
function feedback(): ReviewerFeedbackForGrouping[] {
  return [
    {
      reviewerRole: 'claude',
      suggestions: [
        { suggestionId: 'c1', title: 'Defined term casing', body: 'Capitalize "Agreement".', severity: 'PRECISION' },
        { suggestionId: 'c2', title: 'Missing recital', body: 'Add a WHEREAS recital.', severity: 'SUBSTANTIVE' },
      ],
    },
    {
      reviewerRole: 'gpt',
      suggestions: [
        { suggestionId: 'g1', title: 'Term casing', body: 'Use "Agreement" consistently.', severity: 'PRECISION' },
      ],
    },
  ];
}

// ============================================================
// A. buildOrchestrationGroups — grounding + degradation
// ============================================================
describe('FOLD-ORCH-1 Inc2 — buildOrchestrationGroups grounding', () => {
  it('absent issueGroups -> no groups (degrade to per-item)', () => {
    expect(buildOrchestrationGroups({ feedbackRows: feedback() })).toEqual([]);
    expect(buildOrchestrationGroups({ issueGroups: [], feedbackRows: feedback() })).toEqual([]);
  });

  it('membership is the REAL reviewer roles, NOT the evaluator claim', () => {
    // Evaluator over-claims THREE reviewers, but only c1 + g1 exist in feedback.
    const groups: EvaluatorIssueGroup[] = [
      {
        issueId: 'i1',
        suggestionIds: ['c1', 'g1'],
        reviewerRoles: ['claude', 'gpt', 'gemini'], // claim includes a reviewer that never returned
        severity: 'PRECISION',
        divergent: false,
      },
    ];
    const [grp] = buildOrchestrationGroups({ issueGroups: groups, feedbackRows: feedback() });
    expect(grp).toBeDefined();
    expect(grp!.reviewerMembers.sort()).toEqual(['claude', 'gpt']); // gemini dropped — not real
    expect(grp!.positions).toHaveLength(2);
  });

  it('a group that maps to a single real reviewer keeps a single member', () => {
    const groups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1'], reviewerRoles: ['claude', 'gpt'], severity: 'PRECISION' },
    ];
    const [grp] = buildOrchestrationGroups({ issueGroups: groups, feedbackRows: feedback() });
    expect(grp!.reviewerMembers).toEqual(['claude']);
  });

  it('an entirely hallucinated group (no real suggestionIds) is dropped', () => {
    const groups: EvaluatorIssueGroup[] = [
      { issueId: 'ghost', suggestionIds: ['zzz', 'qqq'], severity: 'PRECISION' },
    ];
    expect(buildOrchestrationGroups({ issueGroups: groups, feedbackRows: feedback() })).toEqual([]);
  });

  it('partially hallucinated group keeps only the real members', () => {
    const groups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'zzz', 'g1'], severity: 'PRECISION' },
    ];
    const [grp] = buildOrchestrationGroups({ issueGroups: groups, feedbackRows: feedback() });
    expect(grp!.positions.map((p) => p.suggestionId).sort()).toEqual(['c1', 'g1']);
  });

  it('duplicate suggestionIds in a claim are de-duplicated', () => {
    const groups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'c1', 'g1'], severity: 'PRECISION' },
    ];
    const [grp] = buildOrchestrationGroups({ issueGroups: groups, feedbackRows: feedback() });
    expect(grp!.positions).toHaveLength(2);
  });
});

// ============================================================
// B. Severity derivation (most-severe member wins; conservative)
// ============================================================
describe('FOLD-ORCH-1 Inc2 — severity derivation', () => {
  it('most-severe real member determines the group severity', () => {
    const rows: ReviewerFeedbackForGrouping[] = [
      { reviewerRole: 'claude', suggestions: [{ suggestionId: 'c1', body: 'x', severity: 'PRECISION' }] },
      { reviewerRole: 'gpt', suggestions: [{ suggestionId: 'g1', body: 'y', severity: 'BLOCKER' }] },
    ];
    const groups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'PRECISION', divergent: false },
    ];
    const [grp] = buildOrchestrationGroups({ issueGroups: groups, feedbackRows: rows });
    expect((grp!.severity || '').toUpperCase()).toBe('BLOCKER'); // ignores the evaluator's softer claim
  });

  it('all-unknown severities collapse to "" (not bulk-eligible downstream)', () => {
    const rows: ReviewerFeedbackForGrouping[] = [
      { reviewerRole: 'claude', suggestions: [{ suggestionId: 'c1', body: 'x' }] },
      { reviewerRole: 'gpt', suggestions: [{ suggestionId: 'g1', body: 'y' }] },
    ];
    const groups: EvaluatorIssueGroup[] = [{ issueId: 'i1', suggestionIds: ['c1', 'g1'] }];
    const [grp] = buildOrchestrationGroups({ issueGroups: groups, feedbackRows: rows });
    expect(grp!.severity).toBe('');
  });
});

// ============================================================
// C. Divergence derivation
// ============================================================
describe('FOLD-ORCH-1 Inc2 — divergence derivation', () => {
  it('evaluator divergent flag is honored (safe direction)', () => {
    const groups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'PRECISION', divergent: true },
    ];
    const [grp] = buildOrchestrationGroups({ issueGroups: groups, feedbackRows: feedback() });
    expect(grp!.divergent).toBe(true);
  });

  it('severity disagreement among real members forces divergent even if evaluator says false', () => {
    const rows: ReviewerFeedbackForGrouping[] = [
      { reviewerRole: 'claude', suggestions: [{ suggestionId: 'c1', body: 'x', severity: 'SUBSTANTIVE' }] },
      { reviewerRole: 'gpt', suggestions: [{ suggestionId: 'g1', body: 'y', severity: 'STRUCTURAL' }] },
    ];
    const groups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'SUBSTANTIVE', divergent: false },
    ];
    const [grp] = buildOrchestrationGroups({ issueGroups: groups, feedbackRows: rows });
    expect(grp!.divergent).toBe(true);
  });

  it('agreed severity + no evaluator flag -> not divergent', () => {
    const groups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'PRECISION' },
    ];
    const [grp] = buildOrchestrationGroups({ issueGroups: groups, feedbackRows: feedback() });
    expect(grp!.divergent).toBe(false);
  });
});

// ============================================================
// D. Passthrough fields
// ============================================================
describe('FOLD-ORCH-1 Inc2 — passthrough', () => {
  it('structuralLowRiskCleanup and synthesisBody pass through', () => {
    const groups: EvaluatorIssueGroup[] = [
      {
        issueId: 'i1',
        suggestionIds: ['c1', 'g1'],
        severity: 'PRECISION',
        structuralLowRiskCleanup: true,
        synthesisBody: 'Both flag inconsistent capitalization of "Agreement".',
      },
    ];
    const [grp] = buildOrchestrationGroups({ issueGroups: groups, feedbackRows: feedback() });
    expect(grp!.structuralLowRiskCleanup).toBe(true);
    expect(grp!.evaluatorSynthesis).toContain('capitalization');
  });

  it('absent structuralLowRiskCleanup -> false, absent synthesisBody -> null', () => {
    const groups: EvaluatorIssueGroup[] = [{ issueId: 'i1', suggestionIds: ['c1', 'g1'] }];
    const [grp] = buildOrchestrationGroups({ issueGroups: groups, feedbackRows: feedback() });
    expect(grp!.structuralLowRiskCleanup).toBe(false);
    expect(grp!.evaluatorSynthesis).toBeNull();
  });
});

// ============================================================
// E. consolidateFromEvaluator — integration with the Inc1 engine
// ============================================================
describe('FOLD-ORCH-1 Inc2 — consolidateFromEvaluator', () => {
  it('convergent low-risk (2 successful, PRECISION, agreed) -> bulk-eligible', () => {
    const groups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'PRECISION', divergent: false },
    ];
    const result = consolidateFromEvaluator({
      issueGroups: groups,
      feedbackRows: feedback(),
      intendedReviewers: ['claude', 'gpt', 'gemini'],
      successfulReviewers: ['claude', 'gpt'],
    });
    const g = result.groups.find((x) => x.issueId === 'i1')!;
    expect(g.bulkEligible).toBe(true);
    expect(g.classification).toBe('convergent_low_risk');
    expect(g.agreedCount).toBe(2);
    expect(result.bulkEligibleIssueIds).toContain('i1');
  });

  it('THE SAFETY TEST: evaluator claims agreement but only 1 real successful reviewer -> single_reviewer (per-item)', () => {
    const groups: EvaluatorIssueGroup[] = [
      {
        issueId: 'i1',
        suggestionIds: ['c1'], // only claude
        reviewerRoles: ['claude', 'gpt', 'gemini'], // evaluator over-claims convergence
        severity: 'PRECISION',
        divergent: false,
      },
    ];
    const result = consolidateFromEvaluator({
      issueGroups: groups,
      feedbackRows: feedback(),
      intendedReviewers: ['claude', 'gpt', 'gemini'],
      successfulReviewers: ['claude', 'gpt', 'gemini'],
    });
    const g = result.groups.find((x) => x.issueId === 'i1')!;
    expect(g.classification).toBe('single_reviewer');
    expect(g.bulkEligible).toBe(false);
    expect(g.bucket).toBe('per_item');
  });

  it('a successful reviewer that did NOT raise the issue does not inflate the count', () => {
    // Both reviewers succeeded, but only claude raised c2 (SUBSTANTIVE) -> 1 member -> per-item.
    const groups: EvaluatorIssueGroup[] = [
      { issueId: 'i2', suggestionIds: ['c2'], severity: 'SUBSTANTIVE' },
    ];
    const result = consolidateFromEvaluator({
      issueGroups: groups,
      feedbackRows: feedback(),
      intendedReviewers: ['claude', 'gpt'],
      successfulReviewers: ['claude', 'gpt'],
    });
    const g = result.groups.find((x) => x.issueId === 'i2')!;
    expect(g.agreedCount).toBe(1);
    expect(g.classification).toBe('single_reviewer');
  });

  it('convergent BLOCKER is per-item (never bulk-eligible even when agreed)', () => {
    const rows: ReviewerFeedbackForGrouping[] = [
      { reviewerRole: 'claude', suggestions: [{ suggestionId: 'c1', body: 'x', severity: 'BLOCKER' }] },
      { reviewerRole: 'gpt', suggestions: [{ suggestionId: 'g1', body: 'y', severity: 'BLOCKER' }] },
    ];
    const groups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'BLOCKER', divergent: false },
    ];
    const result = consolidateFromEvaluator({
      issueGroups: groups,
      feedbackRows: rows,
      intendedReviewers: ['claude', 'gpt'],
      successfulReviewers: ['claude', 'gpt'],
    });
    const g = result.groups.find((x) => x.issueId === 'i1')!;
    expect(g.classification).toBe('convergent_high_risk');
    expect(g.bulkEligible).toBe(false);
  });

  it('divergent is per-item regardless of severity', () => {
    const groups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'PRECISION', divergent: true },
    ];
    const result = consolidateFromEvaluator({
      issueGroups: groups,
      feedbackRows: feedback(),
      intendedReviewers: ['claude', 'gpt'],
      successfulReviewers: ['claude', 'gpt'],
    });
    const g = result.groups.find((x) => x.issueId === 'i1')!;
    expect(g.classification).toBe('divergent');
    expect(g.bulkEligible).toBe(false);
  });

  it('degrade: no issueGroups -> no convergent bucket (all per-item)', () => {
    const result = consolidateFromEvaluator({
      feedbackRows: feedback(),
      intendedReviewers: ['claude', 'gpt'],
      successfulReviewers: ['claude', 'gpt'],
    });
    expect(result.groups).toEqual([]);
    expect(result.bulkEligibleIssueIds).toEqual([]);
  });

  it('floor: only 1 successful reviewer -> no convergence even with a 2-member group', () => {
    const groups: EvaluatorIssueGroup[] = [
      { issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'PRECISION', divergent: false },
    ];
    const result = consolidateFromEvaluator({
      issueGroups: groups,
      feedbackRows: feedback(),
      intendedReviewers: ['claude', 'gpt'],
      successfulReviewers: ['claude'], // gpt lane failed -> g1 is not a successful vote
    });
    const g = result.groups.find((x) => x.issueId === 'i1')!;
    expect(result.convergenceFloorMet).toBe(false);
    expect(g.classification).toBe('single_reviewer');
    expect(g.agreedCount).toBe(1); // only claude is successful
  });
});

// ============================================================
// F. Parser — full output incl. issueGroups; back-compat
// ============================================================
describe('FOLD-ORCH-1 Inc2 — parseEvaluatorOutputFull', () => {
  it('parses dispositions + issueGroups', () => {
    const raw = JSON.stringify({
      dispositions: [{ suggestionId: 'c1', disposition: 'adopt', synthesisBody: 'ok' }],
      issueGroups: [{ issueId: 'i1', suggestionIds: ['c1', 'g1'], severity: 'PRECISION', divergent: false }],
    });
    const out = parseEvaluatorOutputFull(raw);
    expect(out.dispositions).toHaveLength(1);
    expect(out.issueGroups).toHaveLength(1);
    expect(out.issueGroups![0]!.issueId).toBe('i1');
  });

  it('back-compat: pre-ORCH output without issueGroups still parses', () => {
    const raw = JSON.stringify({
      dispositions: [{ suggestionId: 'c1', disposition: 'reject' }],
    });
    const full = parseEvaluatorOutputFull(raw);
    expect(full.issueGroups).toBeUndefined();
    expect(parseEvaluatorOutput(raw)).toHaveLength(1); // legacy path unaffected
  });

  it('parseEvaluatorOutput ignores issueGroups and returns only dispositions', () => {
    const raw = {
      dispositions: [{ suggestionId: 'c1', disposition: 'neutral' }],
      issueGroups: [{ issueId: 'i1', suggestionIds: ['c1'] }],
    };
    const dispositions = parseEvaluatorOutput(raw);
    expect(dispositions).toHaveLength(1);
    expect(dispositions[0]!.suggestionId).toBe('c1');
  });
});

// ============================================================
// G. Prompt carries the additive grouping instruction
// ============================================================
describe('FOLD-ORCH-1 Inc2 — evaluator prompt', () => {
  it('system prompt requests the optional issueGroups grouping', () => {
    const sys = buildEvaluatorSystemPrompt();
    expect(sys).toContain('issueGroups');
    expect(sys).toContain('divergent');
    expect(sys.toLowerCase()).toContain('advisory'); // grouping never decides
  });
});
