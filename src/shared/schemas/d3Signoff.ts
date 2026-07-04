/**
 * Zod Wall schema for the deed_signoff table — D3-SIGNOFF (source-anchored deed sign-off), A.1.
 *
 * Every read of deed_signoff parses through DeedSignoffRowSchema. Enum literals are inlined here (repo
 * convention, mirroring AdoptLedgerRowSchema); the Drizzle column enums live in schema.ts. NC-1: the record
 * carries comparator RESULTS + value HASHES + a displayed-comparison snapshot hash — never model-composed or
 * corrected operative text.
 */
import { z } from 'zod';

/** The recorded gate mode at sign-off (a record is only ever created in observe/enforce, never 'off'). */
export const D3_SIGNOFF_GATE_MODE_VALUES = ['observe', 'enforce'] as const;
export const D3_SIGNOFF_VERDICT_VALUES = ['pass', 'blocked', 'overridden'] as const;
/** NC-D3-1/D3-6 per-value provenance class — how a compared value was obtained (honesty about OCR-derivation). */
export const D3_SIGNOFF_PROVENANCE_CLASS_VALUES = ['extraction_verbatim', 'ocr_derived', 'manual', 'withheld'] as const;

/** NC-D3-1 dual-prong attestation set (+ the retained not-OCR-only prong). */
export const D3SignoffAttestationsSchema = z.object({
  // Prong (a): the deterministic comparator passed.
  comparatorPassed: z.boolean(),
  // Prong (b): the attorney attests comparison against the ORIGINAL instrument (not merely the extracted text).
  attorneyAttestedVsOriginal: z.boolean(),
  // The RETAINED not-OCR-only attestation (dropping it would be a safety regression, NC-D3-1).
  notOcrOnly: z.boolean(),
});
export type D3SignoffAttestations = z.infer<typeof D3SignoffAttestationsSchema>;

/** NC-D3-6 per-field comparator result: hashes of the actual compared values + provenance class + confirmation. */
export const D3SignoffFieldResultSchema = z.object({
  field: z.string(), // 'legal_description' | 'grantor' | 'grantee' | 'parcel_id' | …
  status: z.enum(['match', 'mismatch', 'absent', 'not_applicable', 'withheld']),
  sourceValueHash: z.string().nullable(),
  draftValueHash: z.string().nullable(),
  provenanceClass: z.enum(D3_SIGNOFF_PROVENANCE_CLASS_VALUES).nullable(),
  confirmed: z.boolean(),
});

export const D3SignoffComparisonSchema = z.object({
  fields: z.array(D3SignoffFieldResultSchema),
  sourceMaterialIds: z.array(z.string()),
  // Hash of the displayed comparison so what the attorney saw is reconstructable (NC-D3-6).
  snapshotHash: z.string(),
});
export type D3SignoffComparison = z.infer<typeof D3SignoffComparisonSchema>;

/** NC-D3-3 high-friction override record (structured reason + text). NULL when no override. */
export const D3SignoffOverrideSchema = z
  .object({ reasonCode: z.string(), reasonText: z.string().nullable() })
  .nullable();

export const DeedSignoffRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
  gateMode: z.enum(D3_SIGNOFF_GATE_MODE_VALUES),
  verdict: z.enum(D3_SIGNOFF_VERDICT_VALUES),
  comparatorPassed: z.boolean(),
  comparatorVersion: z.string(),
  assembledContentHash: z.string(),
  sourceFactsHash: z.string(),
  forkProvenance: z.string(),
  attestations: D3SignoffAttestationsSchema,
  comparison: D3SignoffComparisonSchema,
  override: D3SignoffOverrideSchema,
  attorneyUserId: z.string().uuid(),
  createdAt: z.date(),
});
export type DeedSignoffRow = z.infer<typeof DeedSignoffRowSchema>;
