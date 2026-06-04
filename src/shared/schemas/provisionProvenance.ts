/**
 * Zod schema for the provision_provenance table — FOLD-DRAFT-1 (Increment 1: data core).
 *
 * Ch 35.1 Zod Wall: every read of provision_provenance parses through this schema.
 *
 * Records, per draft SECTION (provision), where that section came from. Version-anchored.
 * DEFAULT-SAFE: provenance is recorded + surfaced, NEVER used to auto-justify outbound legal
 * assertions (mirrors KB private-by-default). `recordedBy` distinguishes an attorney attribution
 * from a system one. Enum literals are inlined here (repo convention); the Drizzle column enums
 * live in schema.ts (PROVISION_*_VALUES).
 */

import { z } from 'zod';

export const ProvisionProvenanceRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  // The provision = an outline section, identified by its order index + title for this version.
  orderIndex: z.number().int().nonnegative(),
  sectionTitle: z.string(),
  // Where the provision came from.
  originType: z.enum([
    'operative_source',
    'material',
    'adopted_suggestion',
    'template',
    'attorney_authored',
    'model_generated',
    'loi',
  ]),
  // The source/material/adoption/template id (NULL for attorney_authored / model_generated).
  // Not constrained to UUID — template/external ids may differ in shape.
  originId: z.string().nullable(),
  originLabel: z.string().nullable(),
  // Attorney attribution vs a system one (default-safe; never an auto-assertion of correctness).
  recordedBy: z.enum(['attorney', 'system']),
  notes: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ProvisionProvenanceRow = z.infer<typeof ProvisionProvenanceRowSchema>;
export type ProvisionOriginType = ProvisionProvenanceRow['originType'];
export type ProvisionRecordedBy = ProvisionProvenanceRow['recordedBy'];
