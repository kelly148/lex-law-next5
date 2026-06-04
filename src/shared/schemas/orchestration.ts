/**
 * Zod schemas + vocabularies for multi-model orchestration — FOLD-ORCH-1 (Increment 1).
 *
 * Triad disposition (PROCEED WITH NAMED CHANGES) encoded here. NAMED DESIGN CONSTRAINT:
 * the attorney's INDEPENDENT PROFESSIONAL JUDGMENT (VA Rule 2.1; legal judgment is
 * non-delegable) is a first-class design constraint — the threat model is the GRADUAL
 * EROSION of the attorney's own judgment over routine use, not an accidental click. That is
 * why "bulk-eligibility" (which items may even be group-confirmed) is the control, NOT the
 * confirm gesture. Convergence is NEVER sufficient on its own: correlated models converge on
 * confident-wrong answers (the shared-blind-spot case), so only convergent AND genuinely
 * low-risk items are bulk-eligible.
 */

import { z } from 'zod';
import { SENDABILITY_BLOCKER_SEVERITY_VALUES } from './phase4b.js';

// Reuse the reviewer/native-card severity vocabulary (BLOCKER/SUBSTANTIVE/STRUCTURAL/PRECISION/POLISH).
export const ORCH_SEVERITY_VALUES = SENDABILITY_BLOCKER_SEVERITY_VALUES;
export type OrchSeverity = (typeof ORCH_SEVERITY_VALUES)[number];

/**
 * Per-item confirmation MODE recorded for the audit trail (Increment 2/3 wiring). NOT flattened
 * to "adopted": the record distinguishes a bulk-acknowledged low-severity convergent item from
 * an individually-made decision, a deferred item, an adopted synthesis, and a resolved divergence.
 */
export const CONFIRMATION_MODE_VALUES = [
  'bulk_acknowledged_low_severity_convergent',
  'individually_adopted',
  'individually_rejected',
  'individually_deferred',
  'synthesis_adopted',
  'divergent_resolved',
] as const;
export type ConfirmationMode = (typeof CONFIRMATION_MODE_VALUES)[number];

/** One reviewer's position within a consolidated issue group (preserves the disagreement content). */
export const ReviewerPositionSchema = z.object({
  reviewerRole: z.string(),
  suggestionId: z.string(),
  position: z.string(),                 // what this reviewer actually said (the suggestion body)
  severity: z.string(),                 // the reviewer's severity for this position
  rationaleExcerpt: z.string().nullable().optional(),
});
export type ReviewerPosition = z.infer<typeof ReviewerPositionSchema>;

/**
 * A consolidated issue group fed to the PURE engine: the distinct reviewers who raised it, its
 * severity, and whether reviewers DISAGREE (divergent). `structuralLowRiskCleanup` is a POSITIVE
 * classification — true only when the implementation can affirmatively classify a STRUCTURAL item
 * as low-risk formatting/organization cleanup; absent/false keeps STRUCTURAL per-item.
 */
export const OrchestrationGroupSchema = z.object({
  issueId: z.string(),
  severity: z.string(),
  reviewerMembers: z.array(z.string()),   // distinct reviewer roles that raised this issue
  divergent: z.boolean(),
  structuralLowRiskCleanup: z.boolean().optional(),
  positions: z.array(ReviewerPositionSchema).optional(),
  evaluatorSynthesis: z.string().nullable().optional(),
});
export type OrchestrationGroup = z.infer<typeof OrchestrationGroupSchema>;

/**
 * The content-preserving L1 open item an UNDECIDED divergent issue creates/updates (Fork E).
 * Not a generic "unresolved" flag — it preserves each reviewer's position so the disagreement
 * survives. "Never auto-close": only an explicit attorney action resolves/withdraws it; a
 * divergent item disappearing from a later reviewer pass is NOT resolution.
 */
export const DivergentOpenItemSchema = z.object({
  issueSummary: z.string(),
  positions: z.array(ReviewerPositionSchema),
  evaluatorSynthesis: z.string().nullable().optional(),
  sourceReviewSessionId: z.string(),
});
export type DivergentOpenItem = z.infer<typeof DivergentOpenItemSchema>;
