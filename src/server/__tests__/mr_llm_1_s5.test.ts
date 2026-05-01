/**
 * mr_llm_1_s5.test.ts — MR-LLM-1 S5 Integration Tests
 *
 * T13: Schema regression — proves (a) the original poison shape (raw JS array)
 *      is still rejected by the canonical JobOutputSchema, AND (b) the
 *      normalized string form (JSON.stringify of the same array) is accepted
 *      via the z.string() variant. Together these prove no schema weakening.
 *
 * T14: Verifies that the reviewer feedback path (txn2Commit in reviewSession.ts)
 *      correctly handles a string content value (post-normalization) by
 *      confirming parseFeedbackOutput can parse the raw JSON string.
 */

import { describe, it, expect } from 'vitest';
import { parseFeedbackOutput } from '../llm/parsers/feedbackParser.js';
import { JobOutputSchema } from '../../shared/schemas/jobs.js';

describe('MR-LLM-1 S5 — Integration: reviewer path handles string content', () => {
  // The raw JS array — this is the shape that caused the original ZodError
  const RAW_ARRAY = [
    { title: 'Fix heading', body: 'The heading is inconsistent with the brief.', severity: 'major' },
    { title: 'Typo on page 3', body: 'Spelling error in paragraph 2.', severity: 'minor' },
  ];

  const VALID_ARRAY_JSON = JSON.stringify(RAW_ARRAY);

  // ── T13 — Schema regression: poison shape rejected, normalized string accepted ──
  it('T13: JobOutputSchema rejects raw array (a) and accepts JSON string (b) — no schema weakening', () => {
    // (a) The original poison shape: a raw JS array passed directly to JobOutputSchema.
    //     This is what the pre-fix adapters returned via `result.data as Record<string, unknown>`.
    //     It must STILL be rejected — proving no schema weakening occurred.
    const rejectResult = JobOutputSchema.safeParse(RAW_ARRAY);
    expect(rejectResult.success).toBe(false);

    // (b) The normalized form: JSON.stringify of the same array.
    //     This is what the post-fix adapters return (rawText string).
    //     It must be accepted via the z.string() variant.
    const acceptResult = JobOutputSchema.safeParse(VALID_ARRAY_JSON);
    expect(acceptResult.success).toBe(true);
    if (acceptResult.success) {
      expect(typeof acceptResult.data).toBe('string');
    }
  });

  // ── T14 — parseFeedbackOutput correctly parses a raw JSON string ──
  it('T14: parseFeedbackOutput parses a JSON string of suggestions (simulating post-normalization reviewer path)', () => {
    // Post-normalization, the adapter returns content as a string.
    // txn2Commit in reviewSession.ts does:
    //   const rawOutput = typeof output === 'string' ? output : JSON.stringify(output);
    // When output is already a string, rawOutput === output (no double-serialization).
    const rawOutput = typeof VALID_ARRAY_JSON === 'string' ? VALID_ARRAY_JSON : JSON.stringify(VALID_ARRAY_JSON);
    const suggestions = parseFeedbackOutput(rawOutput);

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]!.title).toBe('Fix heading');
    expect(suggestions[1]!.severity).toBe('minor');
  });
});
