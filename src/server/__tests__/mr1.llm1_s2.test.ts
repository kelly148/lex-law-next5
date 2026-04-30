/**
 * mr1.llm1_s2.test.ts — MR-LLM-1 S2
 *
 * Test 1 of the MR-LLM-1 S2 test suite.
 *
 * Verifies that the reviewer feedback buildLlmParams callback in
 * reviewSession.ts includes structuredOutputSchema (MR-LLM-1 S2 wiring).
 *
 * Approach: source-inspection fallback per §3.6 Test 1 (the buildLlmParams
 * callback is a closure inside executeCanonicalMutation; direct invocation
 * requires broad tRPC/canonicalMutation mocking which is not authorized).
 * This test reads reviewSession.ts and asserts the literal string
 * 'structuredOutputSchema' appears within the reviewer feedback
 * buildLlmParams callback definition.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('MR-LLM-1 S2 — reviewer feedback buildLlmParams wiring', () => {
  // ── Test 1 — structuredOutputSchema present in buildLlmParams ──
  it('Test 1: reviewSession.ts reviewer feedback buildLlmParams includes structuredOutputSchema', () => {
    const filePath = resolve(
      __dirname,
      '../procedures/reviewSession.ts',
    );
    const source = readFileSync(filePath, 'utf-8');

    // Locate the reviewer feedback buildLlmParams block.
    // The block is identified by its unique combination of jobType 'reviewer_feedback'
    // and the buildLlmParams callback that follows it.
    const reviewerFeedbackBlock = source.slice(
      source.indexOf("jobType: 'reviewer_feedback'"),
      source.indexOf("jobType: 'reviewer_feedback'") + 800,
    );

    expect(reviewerFeedbackBlock).toContain('buildLlmParams');
    expect(reviewerFeedbackBlock).toContain('structuredOutputSchema');
    expect(reviewerFeedbackBlock).toContain('RawSuggestionsArraySchema');
  });
});
