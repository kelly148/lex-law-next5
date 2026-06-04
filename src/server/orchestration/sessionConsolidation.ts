/**
 * Session-level orchestration consolidation — FOLD-ORCH-1 (Increment 3b-2).
 *
 * PURE assembly that ties the Inc1/Inc2/Inc3a pieces together for one review session: it grounds
 * the evaluator's advisory issue grouping in the real feedback (Inc2a), runs the deterministic
 * bulk-eligibility engine over the matter's toggled-on set (Inc1), and projects the divergent
 * groups into content-preserving open-item registrations (Inc3a, Fork E).
 *
 * No DB / no LLM here — the procedure layer reads the session + feedback + persisted issueGroups
 * and passes them in. Keeping this pure makes the whole consolidation behavior unit-testable.
 */

import {
  buildOrchestrationGroups,
  type ReviewerFeedbackForGrouping,
} from './groupFromEvaluator.js';
import { consolidateReviewerFeedback, type ConsolidationResult } from './consolidate.js';
import { divergentOpenItemRegistration } from './divergentOpenItem.js';
import type { OpenItemSeverity } from '../../shared/schemas/openItems.js';
import type { DivergentOpenItem } from '../../shared/schemas/orchestration.js';
import type { EvaluatorIssueGroup } from '../../shared/schemas/phase4b.js';

export interface SessionConsolidationInput {
  /** The review session whose feedback is being consolidated (provenance for divergent items). */
  reviewSessionId: string;
  /** The matter's toggled-on reviewer set for this run (session.selectedReviewers — the N-of-M M). */
  intendedReviewers: string[];
  /** Each reviewer's persisted feedback (reviewerRole + suggestions). */
  feedbackRows: ReviewerFeedbackForGrouping[];
  /** The evaluator's advisory grouping captured at dispatch (Inc3b-1); null/absent => all-per-item. */
  issueGroups?: EvaluatorIssueGroup[] | null | undefined;
}

/** The registration projection for one divergent group (ready to write via registerDivergentOpenItem). */
export interface DivergentItemProjection {
  issueId: string;
  severity: OpenItemSeverity;
  summary: string;
  detail: DivergentOpenItem;
}

/** A bulk-eligible (convergent + low-risk) group with its member suggestions, for the
 *  expand-to-see bulk-confirm surface (Inc3c-2). The UI shows each member, then confirms the
 *  group by adopting its members with confirmationMode='bulk_acknowledged_low_severity_convergent'. */
export interface BulkEligibleGroupProjection {
  issueId: string;
  severity: string;
  agreedCount: number;
  members: Array<{ suggestionId: string; reviewerRole: string; position: string }>;
}

export interface SessionConsolidationProjection {
  consolidation: ConsolidationResult;
  divergentItems: DivergentItemProjection[];
  bulkEligibleGroups: BulkEligibleGroupProjection[];
}

/**
 * The reviewers that returned a SUBSTANTIVE result this run = distinct reviewer roles with at
 * least one suggestion. A reviewer that returned nothing (empty/failed lane) is NOT a successful
 * vote (Inc1 floor discipline). Order-preserving, deduplicated.
 */
export function successfulReviewersFromFeedback(rows: ReviewerFeedbackForGrouping[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if ((r.suggestions?.length ?? 0) === 0) continue;
    if (seen.has(r.reviewerRole)) continue;
    seen.add(r.reviewerRole);
    out.push(r.reviewerRole);
  }
  return out;
}

/**
 * Assemble the full consolidation for a session: classified groups + bulk-eligible ids (the Inc1
 * engine) and the content-preserving divergent-item projections (Fork E). PURE.
 */
export function assembleSessionConsolidation(
  input: SessionConsolidationInput,
): SessionConsolidationProjection {
  const groups = buildOrchestrationGroups({
    issueGroups: input.issueGroups ?? undefined,
    feedbackRows: input.feedbackRows,
  });
  const successfulReviewers = successfulReviewersFromFeedback(input.feedbackRows);
  const consolidation = consolidateReviewerFeedback({
    intendedReviewers: input.intendedReviewers,
    successfulReviewers,
    groups,
  });

  const divergentItems: DivergentItemProjection[] = consolidation.groups
    .filter((g) => g.classification === 'divergent')
    .map((cg) => {
      // The classified group always maps back to an input group (same issueId); guard anyway.
      const og = groups.find((g) => g.issueId === cg.issueId);
      const reg = divergentOpenItemRegistration(
        og ?? { issueId: cg.issueId, severity: cg.severity, reviewerMembers: [], divergent: true },
        input.reviewSessionId,
      );
      return { issueId: cg.issueId, severity: reg.severity, summary: reg.summary, detail: reg.detail };
    });

  const bulkEligibleGroups: BulkEligibleGroupProjection[] = consolidation.groups
    .filter((g) => g.classification === 'convergent_low_risk')
    .map((cg) => {
      const og = groups.find((g) => g.issueId === cg.issueId);
      const members = (og?.positions ?? []).map((p) => ({
        suggestionId: p.suggestionId,
        reviewerRole: p.reviewerRole,
        position: p.position,
      }));
      return { issueId: cg.issueId, severity: cg.severity, agreedCount: cg.agreedCount, members };
    });

  return { consolidation, divergentItems, bulkEligibleGroups };
}
