/**
 * laneOutput.ts — TITLE-EXAM-1 (T3), the exam-lane structured output contract + fail-loud parser.
 *
 * Each lane emits a JSON ARRAY of findings whose vocabulary is single-sourced from the T1 data-model enums
 * (schema.ts), so a lane can never introduce an out-of-taxonomy source basis / sendability / classification.
 * Mirrors the reviewer feedbackParser fail-loud contract:
 *   - JSON parse failure   → throws TITLE_EXAM_LANE_OUTPUT_MALFORMED
 *   - schema validation fail → throws TITLE_EXAM_LANE_OUTPUT_MALFORMED
 *   - empty array []        → valid (a clean lane that finds no exceptions is an affirmative zero, NC-10)
 *
 * PURE. Flag-dark by construction.
 */

import { z } from 'zod';
import {
  TITLE_EXAM_SOURCE_BASIS_VALUES,
  TITLE_EXAM_SENDABILITY_VALUES,
  TITLE_EXAM_CLASSIFICATION_VALUES,
} from '../db/schema.js';

export const TitleExamLaneFindingSchema = z.object({
  /** Short attorney-facing statement of the finding. */
  title: z.string().min(1),
  /** Full finding detail. */
  detail: z.string().optional(),
  /** NC-8 typed source basis (single-sourced from the data-model vocabulary). */
  sourceBasis: z.enum(TITLE_EXAM_SOURCE_BASIS_VALUES),
  /** NC-4 sendability status. */
  sendability: z.enum(TITLE_EXAM_SENDABILITY_VALUES),
  /** §5 classification. */
  classification: z.enum(TITLE_EXAM_CLASSIFICATION_VALUES),
  /** NC-9 OCR honesty (the lane echoes what it relied on). */
  ocrDerived: z.boolean().optional(),
  ocrSourcePagePincite: z.string().optional(),
  /** NC-8 downgrade (abstract-only / OCR-only conclusion). */
  downgraded: z.boolean().optional(),
  /** B-lane research provenance — an externally-verified proposition (human-verify before external use). */
  externallyVerified: z.boolean().optional(),
});
export type TitleExamLaneFinding = z.infer<typeof TitleExamLaneFindingSchema>;

export const TitleExamLaneOutputSchema = z.array(TitleExamLaneFindingSchema);

export class TitleExamLaneOutputError extends Error {
  readonly code = 'TITLE_EXAM_LANE_OUTPUT_MALFORMED';
  constructor(message: string) {
    super(message);
    this.name = 'TitleExamLaneOutputError';
  }
}

/** Strip a leading/trailing ```json … ``` code fence if present (mirrors the reviewer fence handling). */
function stripFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?[ \t]*\r?\n?/i, '')
    .replace(/\r?\n?```$/i, '')
    .trim();
}

/**
 * Parse a lane's raw string output into validated findings. Fail-loud: any malformed JSON or out-of-schema
 * item throws TitleExamLaneOutputError (the caller terminalizes the lane as failed → single-lane banner,
 * never a silent drop). An empty array is valid.
 */
export function parseTitleExamLaneOutput(raw: string): TitleExamLaneFinding[] {
  const body = stripFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new TitleExamLaneOutputError(
      `lane output was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = TitleExamLaneOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new TitleExamLaneOutputError(`lane output did not match the finding schema: ${result.error.message}`);
  }
  return result.data;
}
