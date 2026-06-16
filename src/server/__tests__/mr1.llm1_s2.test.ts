/**
 * mr1.llm1_s2.test.ts — MR-LLM-1 S2
 *
 * Test 1 of the MR-LLM-1 S2 test suite.
 *
 * Verifies that the reviewer feedback buildLlmParams callback includes
 * structuredOutputSchema (MR-LLM-1 S2 wiring).
 *
 * Approach: source-inspection fallback per §3.6 Test 1 (the buildLlmParams
 * callback is a closure inside the canonical-mutation params; direct
 * invocation requires broad tRPC/canonicalMutation mocking which is not
 * authorized). This test reads the source and asserts the literal string
 * 'structuredOutputSchema' appears within the reviewer feedback
 * buildLlmParams callback definition.
 *
 * EGRESS-CONTROL-PLANE-1 Increment 2 (durable outbox + CR-4) moved the
 * reviewer EXECUTION closures (buildLlmParams/txn2Commit/txn2Revert/onRunning)
 * OUT of reviewSession.ts INTO the reusable factory
 * src/server/jobs/reviewerJobFactory.ts (buildReviewerCanonicalParams), so the
 * dispatcher can reconstruct a reviewer job after a restart. The reviewer
 * buildLlmParams wiring this test guards now lives there; the assertion is
 * pointed at reviewerJobFactory.ts accordingly. Intent is unchanged: the
 * reviewer feedback buildLlmParams callback must carry
 * structuredOutputSchema: RawSuggestionsArraySchema.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('MR-LLM-1 S2 — reviewer feedback buildLlmParams wiring', () => {
  // ── Test 1 — structuredOutputSchema present in buildLlmParams ──
  it('Test 1: reviewer feedback buildLlmParams includes structuredOutputSchema', () => {
    // EGRESS-CONTROL-PLANE-1 Inc 2 relocated the reviewer execution closures
    // (including buildLlmParams) from reviewSession.ts into the reusable
    // reviewerJobFactory. The reviewer feedback buildLlmParams wiring now lives
    // in buildReviewerCanonicalParams there.
    const filePath = resolve(
      __dirname,
      '../jobs/reviewerJobFactory.ts',
    );
    const source = readFileSync(filePath, 'utf-8');

    // Locate the reviewer feedback buildLlmParams block. The factory is the
    // reviewer_feedback runtime contract (REVIEWER_JOB_TYPE = 'reviewer_feedback')
    // and its sole buildLlmParams closure is the reviewer one — anchor on the
    // 'buildLlmParams:' property assignment (not the doc-comment mention) and
    // slice from that callback to capture its body.
    const buildLlmParamsIndex = source.indexOf('buildLlmParams:');
    const reviewerFeedbackBlock = source.slice(
      buildLlmParamsIndex,
      buildLlmParamsIndex + 800,
    );

    expect(buildLlmParamsIndex).toBeGreaterThanOrEqual(0);
    expect(reviewerFeedbackBlock).toContain('buildLlmParams');
    expect(reviewerFeedbackBlock).toContain('structuredOutputSchema');
    expect(reviewerFeedbackBlock).toContain('RawSuggestionsArraySchema');
  });
});
