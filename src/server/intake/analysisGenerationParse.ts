/**
 * analysisGenerationParse — FOLD-L0-1 Increment 3 (Layer-0 single-lane analysis generation).
 *
 * Schema + tolerant parsing/validation for the LLM-generated matter analysis (Fork C/F).
 * Mirrors outlineParse.ts (LLN-OUTLINE-GEN-1). Two layers:
 *   1. Enforcement: matterIntake.generateAnalysis passes AnalysisGenerationSchema as
 *      structuredOutputSchema, so the provider adapter applies its JSON-only instruction,
 *      markdown-fence stripping, and object-wrapper normalization before returning.
 *   2. Defensive: parseGeneratedAnalysis (below) independently strips a whole-response
 *      markdown fence and validates against the schema, so the path is robust even when
 *      the enforcement layer is bypassed or incomplete.
 *
 * The analysis is INTERNAL attorney work-product, categorically NON-SENDABLE by type
 * (Fork F). recommendedDocuments is STRUCTURED (Fork C) — candidate documents the attorney
 * may choose to draft; the model never decides, it surfaces.
 *
 * Fail-loud contract (no silent-empty commit):
 *   - Output that is not valid JSON                       → throws ANALYSIS_GENERATION_MALFORMED
 *   - Output that does not match the schema                → throws ANALYSIS_GENERATION_MALFORMED
 *   - Output whose assessment is empty/whitespace          → throws ANALYSIS_GENERATION_EMPTY
 *   - Otherwise → returns the validated analysis content.
 */

import { z } from 'zod';

/** A single candidate document the attorney may choose to draft (Fork C — structured). */
export const RecommendedDocumentSchema = z.object({
  documentType: z.string(),
  title: z.string(),
  rationale: z.string().optional().default(''),
});
export type RecommendedDocument = z.infer<typeof RecommendedDocumentSchema>;

/**
 * Structured-output schema for the generated matter analysis. Passed as
 * structuredOutputSchema at the LLM call site so the provider adapter enforces the shape.
 * Optional arrays default to [] so a model that omits an empty field still validates.
 */
export const AnalysisGenerationSchema = z.object({
  assessment: z.string(),
  plan: z.string(),
  openQuestions: z.array(z.string()).optional().default([]),
  recommendedDocuments: z.array(RecommendedDocumentSchema).optional().default([]),
});
export type GeneratedAnalysis = z.infer<typeof AnalysisGenerationSchema>;

/**
 * Strip a whole-response markdown code fence (```json ... ``` or ``` ... ```).
 * Returns the original text if it is not a whole-response fence.
 */
function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch && fenceMatch[1] !== undefined) {
    return fenceMatch[1].trim();
  }
  return text;
}

/**
 * Parse and validate raw LLM analysis output into a usable analysis.
 *
 * @param output - The LLM adapter output (string JSON, possibly fenced, or an
 *                 already-parsed object).
 * @returns The validated analysis content.
 * @throws Error with message starting `ANALYSIS_GENERATION_MALFORMED` if the output is
 *         not valid JSON or fails schema validation, or `ANALYSIS_GENERATION_EMPTY` if the
 *         assessment is empty.
 */
export function parseGeneratedAnalysis(output: unknown): GeneratedAnalysis {
  let parsed: unknown;
  if (typeof output === 'string') {
    const stripped = stripJsonCodeFence(output);
    try {
      parsed = JSON.parse(stripped);
    } catch (err) {
      throw new Error(
        `ANALYSIS_GENERATION_MALFORMED: could not parse analysis output as JSON. Parse error: ${String(err)}`,
      );
    }
  } else {
    parsed = output;
  }

  const result = AnalysisGenerationSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `ANALYSIS_GENERATION_MALFORMED: analysis output did not match the expected shape. ${result.error.issues[0]?.message ?? ''}`,
    );
  }

  if (result.data.assessment.trim().length === 0) {
    throw new Error('ANALYSIS_GENERATION_EMPTY: the model returned an empty assessment');
  }

  return result.data;
}
