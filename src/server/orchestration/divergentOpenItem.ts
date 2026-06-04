/**
 * Divergent open-item construction — FOLD-ORCH-1 (Increment 3, Fork E).
 *
 * PURE. Maps a divergent OrchestrationGroup (from the Inc1/Inc2 consolidation) into the
 * content-preserving payload persisted as an open_items row. The open_items registry already
 * guarantees "never auto-close" (only an explicit attorney resolve/withdraw changes status; a
 * later pass that omits the item never closes it) — so Fork E's lifecycle rule is satisfied by
 * registering the divergence as an ordinary open item with statusSource='auto'.
 *
 * Content-preserving: per-reviewer positions (severity + rationale excerpt) and the optional
 * evaluator synthesis are carried in the open item's `detail` JSON, not collapsed to the summary.
 */

import type { OrchestrationGroup, DivergentOpenItem } from '../../shared/schemas/orchestration.js';
import type { OpenItemSeverity } from '../../shared/schemas/openItems.js';

/**
 * Map the orchestration severity vocabulary onto the coarser open_items severity. BLOCKER stays a
 * blocker (send-blocking via countOpenBlockers); PRECISION/POLISH are polish; everything else
 * (incl. unknown) is substantive — a divergent disagreement always at least surfaces for a
 * decision, and unknown never silently downgrades.
 */
export function mapOrchSeverityToOpenItemSeverity(severity: string): OpenItemSeverity {
  switch ((severity ?? '').trim().toUpperCase()) {
    case 'BLOCKER':
      return 'blocker';
    case 'PRECISION':
    case 'POLISH':
      return 'polish';
    case 'SUBSTANTIVE':
    case 'STRUCTURAL':
      return 'substantive';
    default:
      return 'substantive';
  }
}

/**
 * Build the content-preserving DivergentOpenItem payload from a divergent group. issueSummary
 * prefers the evaluator synthesis, else a derived line; positions and synthesis are preserved.
 */
export function buildDivergentOpenItem(
  group: OrchestrationGroup,
  sourceReviewSessionId: string,
): DivergentOpenItem {
  const synthesis = group.evaluatorSynthesis ?? null;
  return {
    issueSummary: synthesis ?? `Reviewers disagree on issue "${group.issueId}".`,
    positions: group.positions ?? [],
    evaluatorSynthesis: synthesis,
    sourceReviewSessionId,
  };
}

/**
 * The full registration projection for a divergent group: the open_items severity, the summary
 * line, and the content-preserving detail payload. The dispatch (Inc3b) spreads this into
 * registerDivergentOpenItem. PURE.
 */
export function divergentOpenItemRegistration(
  group: OrchestrationGroup,
  sourceReviewSessionId: string,
): { severity: OpenItemSeverity; summary: string; detail: DivergentOpenItem } {
  const detail = buildDivergentOpenItem(group, sourceReviewSessionId);
  return {
    severity: mapOrchSeverityToOpenItemSeverity(group.severity),
    summary: detail.issueSummary,
    detail,
  };
}
