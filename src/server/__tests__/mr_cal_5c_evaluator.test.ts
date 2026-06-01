/**
 * MR-CAL-5C — Evaluator output contract
 *
 * Covers the advisory evaluator: output parse/validation, the output schema, the
 * prompt builders (advisory / non-decisionmaking), and a source audit of the
 * reviewSession.create wiring (parse + persist + dual gate, advisory-only).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseEvaluatorOutput } from '../llm/parsers/evaluatorOutputParse.js';
import { EvaluatorOutputSchema } from '../../shared/schemas/phase4b.js';
import {
  buildEvaluatorSystemPrompt,
  buildEvaluatorUserPrompt,
} from '../llm/prompts/evaluatorPrompt.js';

const VALID = {
  dispositions: [
    { suggestionId: 's1', disposition: 'adopt', synthesisBody: 'Both reviewers agree; high priority drafting fix.' },
    { suggestionId: 's2', disposition: 'neutral', synthesisBody: 'Turns on a business decision — flagged for the attorney.' },
  ],
};

describe('MR-CAL-5C parseEvaluatorOutput', () => {
  it('parses the canonical wrapped object (as a string)', () => {
    const out = parseEvaluatorOutput(JSON.stringify(VALID));
    expect(out).toHaveLength(2);
    expect(out[0]!.disposition).toBe('adopt');
    expect(out[1]!.suggestionId).toBe('s2');
  });

  it('parses an already-parsed object', () => {
    expect(parseEvaluatorOutput(VALID)).toHaveLength(2);
  });

  it('tolerates a bare dispositions array', () => {
    const out = parseEvaluatorOutput(JSON.stringify(VALID.dispositions));
    expect(out).toHaveLength(2);
  });

  it('throws on malformed JSON (caller fails the job, persists nothing)', () => {
    expect(() => parseEvaluatorOutput('{not valid json')).toThrow();
  });

  it('throws on a non-conforming disposition value', () => {
    expect(() =>
      parseEvaluatorOutput(JSON.stringify({ dispositions: [{ suggestionId: 's1', disposition: 'maybe' }] })),
    ).toThrow();
  });
});

describe('MR-CAL-5C EvaluatorOutputSchema', () => {
  it('accepts the canonical shape and allows optional synthesisBody', () => {
    expect(EvaluatorOutputSchema.safeParse(VALID).success).toBe(true);
    expect(
      EvaluatorOutputSchema.safeParse({ dispositions: [{ suggestionId: 's1', disposition: 'reject' }] }).success,
    ).toBe(true);
  });
});

describe('MR-CAL-5C evaluator prompts', () => {
  it('system prompt is advisory and non-decisionmaking', () => {
    const sys = buildEvaluatorSystemPrompt();
    expect(sys).toMatch(/ADVISORY ONLY/);
    expect(sys).toMatch(/never make the final decision/i);
    expect(sys).toMatch(/business/i);
    expect(sys).toMatch(/adopt"\|"reject"\|"neutral"/);
  });

  it('user prompt lists each suggestion by suggestionId', () => {
    const user = buildEvaluatorUserPrompt({
      documentTitle: 'POA test',
      iterationNumber: 8,
      feedbackRows: [
        {
          reviewerRole: 'gpt_lite',
          reviewerTitle: 'GPT Lite',
          suggestions: [{ suggestionId: 'abc', title: 'Blank agent fields', body: 'Add validation.', severity: 'critical' }],
        },
      ],
    });
    expect(user).toContain('suggestionId=abc');
    expect(user).toContain('GPT Lite');
  });
});

describe('MR-CAL-5C wiring — reviewSession.create source audit', () => {
  const src = readFileSync(resolve('src/server/procedures/reviewSession.ts'), 'utf8');

  it('evaluator is dual-gated: isEvaluatorEnabled() AND selectedReviewers.length > 1', () => {
    expect(src).toMatch(/isEvaluatorEnabled\(\)\s*&&\s*input\.selectedReviewers\.length > 1/);
  });

  it('evaluator parses output and persists via insertFeedbackEvaluation (not telemetry-only)', () => {
    expect(src).toContain('parseEvaluatorOutput(output)');
    expect(src).toContain('insertFeedbackEvaluation({');
    expect(src).toContain('structuredOutputSchema: EvaluatorOutputSchema');
  });

  it('evaluator persists only the advisory evaluation, not attorney selections (advisory-only)', () => {
    const evalBlockStart = src.indexOf('EVALUATOR PATH — MR-CAL-5C');
    const evalBlock = src.slice(evalBlockStart, evalBlockStart + 3000);
    expect(evalBlock).toContain('insertFeedbackEvaluation(');
    // Must not write the attorney's selection model or invoke regeneration mutations.
    expect(evalBlock).not.toContain('insertManualSelection');
    expect(evalBlock).not.toContain('updateSelection');
    expect(evalBlock).not.toContain('regenerateDocument');
  });

  // MR-CAL-5D: the evaluator must be given the same 300 000 ms budget as reviewers.
  // Without an explicit timeoutMs it falls back to the global 120 000 ms default and can
  // time out before persisting (evaluation=null on otherwise successful multi-reviewer
  // runs). Guard against regressing back to the default.
  it('evaluator job is given an explicit 300_000 ms timeout (not the 120_000 ms default)', () => {
    const evalBlockStart = src.indexOf('EVALUATOR PATH — MR-CAL-5C');
    const evalBlock = src.slice(evalBlockStart, evalBlockStart + 3000);
    expect(evalBlock).toMatch(/timeoutMs:\s*300_000/);
  });
});
