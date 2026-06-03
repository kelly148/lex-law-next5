/**
 * Zod schema for the source_authority table — FOLD-L1-1 (Fork A).
 *
 * Ch 35.1 Zod Wall: every read of source_authority parses through this schema.
 *
 * Source-of-truth tier/authority for materials and document artifacts, on two
 * orthogonal axes (authorityOrigin, lifecycle). DISTINCT from context/pipeline.ts
 * `contextPriority` (pinned|recency), which is context-window priority, not authority.
 * The tier is an explicit attorney act with a conservative default — never inferred.
 *
 * Enum literals are inlined here (repo convention, mirroring AdoptLedgerRowSchema);
 * the Drizzle column enums live in schema.ts (SOURCE_AUTHORITY_*_VALUES).
 */

import { z } from 'zod';

export const SourceAuthorityRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid().nullable(),
  subjectType: z.enum(['material', 'document', 'version']),
  subjectId: z.string().uuid(),
  authorityOrigin: z.enum([
    'operative',
    'counterparty',
    'firm',
    'client',
    'model_derived',
    'reference',
  ]),
  lifecycle: z.enum(['current_draft', 'operative', 'superseded']),
  designationSource: z.enum(['attorney', 'system', 'imported', 'counterparty', 'client']),
  label: z.string().nullable(),
  notes: z.string().nullable(),
  verificationStatus: z.enum(['unverified', 'verified', 'stale']),
  lastVerifiedAt: z.date().nullable(),
  stalenessReason: z.string().nullable(),
  effectiveFrom: z.date().nullable(),
  supersededAt: z.date().nullable(),
  supersededById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type SourceAuthorityRow = z.infer<typeof SourceAuthorityRowSchema>;
export type SourceAuthorityOrigin = SourceAuthorityRow['authorityOrigin'];
export type SourceAuthorityLifecycle = SourceAuthorityRow['lifecycle'];
export type SourceAuthoritySubjectType = SourceAuthorityRow['subjectType'];
export type SourceAuthorityDesignationSource = SourceAuthorityRow['designationSource'];
export type SourceAuthorityVerificationStatus = SourceAuthorityRow['verificationStatus'];
