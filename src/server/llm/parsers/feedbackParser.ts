/**
 * feedbackParser — MR-1 S2
 *
 * Parses raw LLM string output from a reviewer job into validated,
 * ID-stamped feedback suggestion objects.
 *
 * Fail-loud contract:
 *   - JSON parse failure → throws with code REVIEWER_OUTPUT_MALFORMED
 *   - Schema validation failure → throws with code REVIEWER_OUTPUT_MALFORMED
 *   - Empty array [] → valid; returns [] without error
 *
 * Output shape aligns with FeedbackSuggestionSchema (src/shared/schemas/phase4b.ts)
 * and the reviewer system prompt shape requested in S1b:
 *   { title: string; body: string; severity: 'critical'|'major'|'minor' }
 * with a generated suggestionId added per item.
 */
import { z } from 'zod';

// ────────────────────────────────────────────────────────────
// Schema — inline, matches the S1b prompt shape
// ────────────────────────────────────────────────────────────
const RawSuggestionSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  severity: z.enum(['critical', 'major', 'minor']),
});

const RawSuggestionsArraySchema = z.array(RawSuggestionSchema);

// ────────────────────────────────────────────────────────────
// Output type
// ────────────────────────────────────────────────────────────
export interface ParsedFeedbackSuggestion {
  suggestionId: string;
  title: string;
  body: string;
  severity: 'critical' | 'major' | 'minor';
}

// ────────────────────────────────────────────────────────────
// Parser
// ────────────────────────────────────────────────────────────

/**
 * Parse raw LLM reviewer output into validated, ID-stamped suggestions.
 *
 * @param raw - The raw string returned by the LLM adapter.
 * @returns Array of ParsedFeedbackSuggestion (may be empty).
 * @throws Error with message starting with REVIEWER_OUTPUT_MALFORMED if
 *         the string is not valid JSON or does not match the expected schema.
 */
export function parseFeedbackOutput(raw: string): ParsedFeedbackSuggestion[] {
  // ── Step 1: JSON parse ──────────────────────────────────────
  let parsed: unknown;
  try {
    // Strip markdown code fences if the LLM wraps the JSON in ```json ... ```
    const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `REVIEWER_OUTPUT_MALFORMED: could not parse reviewer LLM output as JSON. ` +
        `Parse error: ${String(err)}. Raw output (first 200 chars): ${raw.slice(0, 200)}`,
    );
  }

  // ── Step 2: Schema validation ───────────────────────────────
  const result = RawSuggestionsArraySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `REVIEWER_OUTPUT_MALFORMED: reviewer LLM output failed schema validation. ` +
        `Errors: ${result.error.message}. ` +
        `Raw output (first 200 chars): ${raw.slice(0, 200)}`,
    );
  }

  // ── Step 3: Stamp each suggestion with a UUID ───────────────
  return result.data.map((item) => ({
    suggestionId: crypto.randomUUID(),
    title: item.title,
    body: item.body,
    severity: item.severity,
  }));
}
