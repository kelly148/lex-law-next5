/**
 * Evaluator-membership grouping — FOLD-ORCH-1 (Increment 2).
 *
 * PURE. Turns the evaluator's ADVISORY issue grouping (EvaluatorOutput.issueGroups) into the
 * OrchestrationGroup[] consumed by the Increment-1 consolidation engine. This is the decided
 * GROUPING SOURCE: "evaluator membership, deterministic counts."
 *
 * NAMED-CHANGE DISCIPLINE (triad disposition, Fork B) — the evaluator LABELS membership but
 * NEVER CONSTITUTES convergence:
 *
 *   - Membership is re-derived from the REAL persisted reviewer feedback, NOT from the
 *     evaluator's claimed `reviewerRoles`. A group's `reviewerMembers` = the distinct reviewer
 *     roles whose suggestions actually appear in the feedback for that group. The evaluator's
 *     claim is a label only; the count that matters comes from real feedback (and is then
 *     intersected with the SUCCESSFUL set by the Increment-1 engine, floor >= 2). So an
 *     evaluator "this is agreed" group that maps to <2 real successful reviewers stays
 *     single_reviewer -> per-item.
 *   - Severity is derived conservatively as the MOST-SEVERE real member severity (a single
 *     BLOCKER member makes the whole group BLOCKER -> never bulk-eligible). Unknown/absent
 *     severities collapse to "" -> not bulk-eligible.
 *   - `divergent` honors an evaluator FLAG (the safe direction -> per-item) AND is independently
 *     raised when real members DISAGREE ON SEVERITY. A MISSING evaluator flag therefore never
 *     forces convergence.
 *   - `structuralLowRiskCleanup` passes through the evaluator's positive STRUCTURAL low-risk
 *     classification (only consulted for STRUCTURAL severity by the engine).
 *
 * DEGRADE-SAFE: absent/empty/malformed grouping yields NO groups -> the engine produces no
 * convergent bucket -> everything is per-item (the safe direction). Groups that reference no real
 * feedback are dropped.
 *
 * No LLM here: the evaluator already ran (MR-CAL-5C); this only re-projects its output.
 */

import type { EvaluatorIssueGroup } from '../../shared/schemas/phase4b.js';
import type { OrchestrationGroup, ReviewerPosition } from '../../shared/schemas/orchestration.js';
import {
  consolidateReviewerFeedback,
  type ConsolidationInput,
  type ConsolidationResult,
} from './consolidate.js';

/** Minimal shape of one reviewer's persisted feedback needed to ground the grouping (PURE input). */
export interface ReviewerFeedbackForGrouping {
  reviewerRole: string;
  suggestions: Array<{
    suggestionId: string;
    title?: string | undefined;
    body?: string | undefined;
    severity?: string | undefined;
  }>;
}

export interface GroupingInput {
  /** The evaluator's advisory issue grouping (EvaluatorOutput.issueGroups); optional/absent -> per-item. */
  issueGroups?: EvaluatorIssueGroup[] | undefined;
  /** The REAL persisted reviewer feedback — ground truth for membership and severity. */
  feedbackRows: ReviewerFeedbackForGrouping[];
}

/** Severity rank for the conservative "most-severe member wins" derivation (higher = more serious). */
const SEVERITY_RANK: Record<string, number> = {
  BLOCKER: 5,
  SUBSTANTIVE: 4,
  STRUCTURAL: 3,
  PRECISION: 2,
  POLISH: 1,
};

function normSeverity(s: string | undefined): string {
  return (s ?? '').trim().toUpperCase();
}

interface GroundedSuggestion {
  reviewerRole: string;
  suggestionId: string;
  title: string;
  body: string;
  severity: string; // raw label as the reviewer gave it (may be '')
}

/**
 * Index every persisted suggestion by suggestionId -> the reviewer + content that actually
 * produced it. Suggestion ids are unique per reviewer; first occurrence wins on a (defensive) tie.
 */
function indexFeedback(feedbackRows: ReviewerFeedbackForGrouping[]): Map<string, GroundedSuggestion> {
  const map = new Map<string, GroundedSuggestion>();
  for (const row of feedbackRows) {
    for (const s of row.suggestions ?? []) {
      if (!s || typeof s.suggestionId !== 'string' || s.suggestionId.length === 0) continue;
      if (map.has(s.suggestionId)) continue;
      map.set(s.suggestionId, {
        reviewerRole: row.reviewerRole,
        suggestionId: s.suggestionId,
        title: s.title ?? '',
        body: s.body ?? '',
        severity: s.severity ?? '',
      });
    }
  }
  return map;
}

/**
 * Build OrchestrationGroup[] from the evaluator's claimed issue grouping, grounded in the REAL
 * feedback. Groups referencing no real feedback are dropped. PURE.
 */
export function buildOrchestrationGroups(input: GroupingInput): OrchestrationGroup[] {
  const groups = Array.isArray(input.issueGroups) ? input.issueGroups : [];
  if (groups.length === 0) return [];

  const byId = indexFeedback(input.feedbackRows);
  const out: OrchestrationGroup[] = [];

  for (const g of groups) {
    const claimedIds = Array.isArray(g.suggestionIds) ? g.suggestionIds : [];
    // Ground the claimed membership: keep ONLY suggestionIds that exist in real feedback.
    const members: GroundedSuggestion[] = [];
    const seenIds = new Set<string>();
    for (const sid of claimedIds) {
      if (seenIds.has(sid)) continue;
      const grounded = byId.get(sid);
      if (!grounded) continue; // evaluator referenced a suggestion that does not exist -> ignore
      seenIds.add(sid);
      members.push(grounded);
    }
    if (members.length === 0) continue; // entirely-hallucinated group -> drop

    // Authoritative membership = distinct REAL reviewer roles (NOT the evaluator's claim).
    const reviewerMembers = Array.from(new Set(members.map((m) => m.reviewerRole)));

    // Conservative severity = the most-severe real member severity ("" if all unknown).
    let topRank = 0;
    let topSeverity = '';
    for (const m of members) {
      const rank = SEVERITY_RANK[normSeverity(m.severity)] ?? 0;
      if (rank > topRank) {
        topRank = rank;
        topSeverity = m.severity;
      }
    }

    // Divergent: evaluator flag (safe direction) OR real members disagree on severity.
    const distinctSeverities = new Set(members.map((m) => normSeverity(m.severity)));
    const membersDisagreeOnSeverity = distinctSeverities.size > 1;
    const divergent = g.divergent === true || membersDisagreeOnSeverity;

    const positions: ReviewerPosition[] = members.map((m) => ({
      reviewerRole: m.reviewerRole,
      suggestionId: m.suggestionId,
      position: m.body,
      severity: m.severity,
      rationaleExcerpt: null,
    }));

    out.push({
      issueId: g.issueId,
      severity: topSeverity,
      reviewerMembers,
      divergent,
      structuralLowRiskCleanup: g.structuralLowRiskCleanup === true,
      positions,
      evaluatorSynthesis: g.synthesisBody ?? null,
    });
  }

  return out;
}

export interface ConsolidateFromEvaluatorInput extends GroupingInput {
  /** The matter's toggled-on reviewer set (the denominator M). */
  intendedReviewers: string[];
  /** Reviewers that returned a substantive result this run (the successful set). */
  successfulReviewers: string[];
}

/**
 * End-to-end convenience: ground the evaluator grouping, then run the Increment-1 consolidation
 * engine over it. PURE. With no/empty issueGroups this returns a result with no convergent bucket
 * (all-per-item), which is the safe degradation.
 */
export function consolidateFromEvaluator(input: ConsolidateFromEvaluatorInput): ConsolidationResult {
  const orchestrationGroups = buildOrchestrationGroups(input);
  const consolidationInput: ConsolidationInput = {
    intendedReviewers: input.intendedReviewers,
    successfulReviewers: input.successfulReviewers,
    groups: orchestrationGroups,
  };
  return consolidateReviewerFeedback(consolidationInput);
}
