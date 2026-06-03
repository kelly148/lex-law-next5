/**
 * Zod schema for reusable_artifacts — FOLD-L1-4 (MM-8a registry + MM-8b cross-matter gate).
 *
 * Ch 35.1 Zod Wall: every read of reusable_artifacts parses through this schema.
 *
 * Anti-contamination: reusableScope defaults to 'matter_only'; widening to 'cross_matter'
 * is an explicit attorney act, and the gate service additionally requires a per-use opt-in.
 */

import { z } from 'zod';

export const ReusableArtifactRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  originMatterId: z.string().uuid().nullable(),
  sourceDocumentId: z.string().uuid().nullable(),
  kind: z.enum(['template', 'clause', 'memo', 'snippet']),
  title: z.string(),
  body: z.string(),
  reusableScope: z.enum(['matter_only', 'cross_matter']),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ReusableArtifactRow = z.infer<typeof ReusableArtifactRowSchema>;
export type ReusableArtifactKind = ReusableArtifactRow['kind'];
export type ReusableArtifactScope = ReusableArtifactRow['reusableScope'];

/**
 * The decision the cross-matter invocation gate returns. `allowed=false` carries a
 * machine-readable `reason` so the caller can surface a precise block.
 */
export const CrossMatterGateDecisionSchema = z.object({
  allowed: z.boolean(),
  crossMatter: z.boolean(),
  reason: z.enum([
    'same_matter',
    'firm_level',
    'cross_matter_opt_in',
    'blocked_scope_matter_only',
    'blocked_no_opt_in',
  ]),
});
export type CrossMatterGateDecision = z.infer<typeof CrossMatterGateDecisionSchema>;
