/**
 * Document-extraction schemas (Zod Wall) — FOLD-PM-2.
 *
 * Structured fields extracted from a material's already-extracted text by the
 * deterministic, no-egress document-type parsers (title commitment / deed / survey /
 * settlement statement). This is the single source of the document-type enum —
 * schema.ts (the material_extraction table) imports DOCUMENT_TYPE_VALUES from here.
 *
 * Honesty floor (mirrors intake/ocrExtract.classifyOcr): a field detected only by a
 * weak heuristic (confidence below the floor) has its VALUE withheld (null) while the
 * field + its confidence stay visible, so the attorney sees what was sought and how
 * trustworthy it is. Attorney-facing only — never an egress contract.
 */

import { z } from 'zod';

export const DOCUMENT_TYPE_VALUES = [
  'title_commitment',
  'deed',
  'survey',
  'settlement_statement',
  'unknown',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPE_VALUES)[number];

/** One extracted field. value is null when not found OR withheld below the confidence floor. */
export const ExtractedFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string().nullable(),
  confidence: z.number().int().min(0).max(100),
  withheld: z.boolean(), // true when a value was detected but withheld below the honesty floor
});
export type ExtractedField = z.infer<typeof ExtractedFieldSchema>;

/** The pure engine's result for one document's text. */
export const DocumentExtractionResultSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPE_VALUES),
  typeConfidence: z.number().int().min(0).max(100),
  overallConfidence: z.number().int().min(0).max(100),
  lowConfidence: z.boolean(),
  fields: z.array(ExtractedFieldSchema),
  warnings: z.array(z.string()),
});
export type DocumentExtractionResult = z.infer<typeof DocumentExtractionResultSchema>;

/** The persisted row (one latest extraction per material), owner+matter scoped. */
export const MaterialExtractionRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  materialId: z.string().uuid(),
  documentType: z.enum(DOCUMENT_TYPE_VALUES),
  typeConfidence: z.number().int().min(0).max(100),
  overallConfidence: z.number().int().min(0).max(100),
  lowConfidence: z.boolean(),
  fields: z.array(ExtractedFieldSchema),
  warnings: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MaterialExtractionRow = z.infer<typeof MaterialExtractionRowSchema>;
