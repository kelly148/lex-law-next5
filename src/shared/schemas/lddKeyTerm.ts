/**
 * Zod schema for the ldd_key_term table — FOLD-DRAFT-1 / LDD (Increment 1: data core).
 *
 * Ch 35.1 Zod Wall: every read of ldd_key_term parses through this schema.
 *
 * The "key-term dictionary" behind the LDD (LOI-vs-draft diff): per draft document+version, the
 * defined/operative terms whose agreed VALUE must stay consistent between the operative source
 * (LOI / engagement letter / material) and the current draft — e.g. "Governing Law" =
 * "Commonwealth of Virginia", "Purchase Price" = "$1,200,000". DEFAULT-SAFE / READ-ONLY posture:
 * the dictionary is recorded + surfaced and (in a later increment) compared against the draft to
 * FLAG drift; it NEVER edits the draft and never auto-justifies an outbound assertion. The
 * attorney remains the decision-maker. `recordedBy` distinguishes an attorney entry from a system
 * one. Enum literals are inlined here (repo convention); the Drizzle column enums live in
 * schema.ts (LDD_KEY_TERM_*_VALUES). The sourceType<->sourceId invariant is enforced at record
 * time by a later increment (mirrors provenanceRules.ts), not by this row schema.
 */

import { z } from 'zod';

export const LddKeyTermRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  // The defined/operative term whose value must stay consistent (e.g. "Governing Law").
  termLabel: z.string(),
  // The agreed value for that term, taken from the operative source / LOI (e.g. "Virginia").
  expectedValue: z.string(),
  // Where the expected value came from.
  sourceType: z.enum([
    'loi',
    'operative_source',
    'material',
    'attorney_specified',
  ]),
  // The LOI/source/material id (NULL for attorney_specified, which has no concrete source).
  // Not constrained to UUID — external/source ids may differ in shape.
  sourceId: z.string().nullable(),
  notes: z.string().nullable(),
  // Attorney attribution vs a system one (default-safe; never an auto-assertion of correctness).
  recordedBy: z.enum(['attorney', 'system']),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type LddKeyTermRow = z.infer<typeof LddKeyTermRowSchema>;
export type LddKeyTermSourceType = LddKeyTermRow['sourceType'];
export type LddKeyTermRecordedBy = LddKeyTermRow['recordedBy'];
