/**
 * GEMINI-BUDGET-CALIBRATION-1 — Increment 1
 * Unit tests for the per-provider token-accounting module.
 *
 * Pins the per-provider split semantics that the whole calibration rests on:
 *   - OpenAI/xAI: reasoning ⊂ completion → emitted = completion - reasoning; budget = completion.
 *   - Gemini:     reasoning SEPARATE → emitted = candidates; budget = candidates + thoughts.
 *   - Anthropic:  no split → reasoning forced null; emitted = budget = output_tokens.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveTokenAccounting,
  isTruncationFinishReason,
  reasoningAccountingFor,
  splitModelString,
  estimateInputTokens,
  estimatePreflight,
  formatTokenAccounting,
  CHARS_PER_TOKEN,
} from '../tokenAccounting.js';

describe('splitModelString / reasoningAccountingFor', () => {
  it('splits provider:model', () => {
    expect(splitModelString('openai:gpt-5')).toEqual({ provider: 'openai', modelId: 'gpt-5' });
    expect(splitModelString('anthropic:claude-opus-4-5')).toEqual({ provider: 'anthropic', modelId: 'claude-opus-4-5' });
  });
  it('handles a bare string with no colon', () => {
    expect(splitModelString('mock')).toEqual({ provider: 'mock', modelId: '' });
  });
  it('maps providers to the right accounting mode', () => {
    expect(reasoningAccountingFor('openai')).toBe('within-output');
    expect(reasoningAccountingFor('xai')).toBe('within-output');
    expect(reasoningAccountingFor('google')).toBe('separate-from-output');
    expect(reasoningAccountingFor('anthropic')).toBe('unavailable');
    expect(reasoningAccountingFor('whoknows')).toBe('unavailable');
  });
});

describe('isTruncationFinishReason', () => {
  it('recognizes the per-provider truncation signals', () => {
    expect(isTruncationFinishReason('length')).toBe(true); // OpenAI / xAI
    expect(isTruncationFinishReason('MAX_TOKENS')).toBe(true); // Gemini
    expect(isTruncationFinishReason('max_tokens')).toBe(true); // Anthropic
  });
  it('does not treat normal stops as truncation', () => {
    expect(isTruncationFinishReason('stop')).toBe(false);
    expect(isTruncationFinishReason('STOP')).toBe(false);
    expect(isTruncationFinishReason('end_turn')).toBe(false);
    expect(isTruncationFinishReason(null)).toBe(false);
    expect(isTruncationFinishReason(undefined)).toBe(false);
  });
});

describe('deriveTokenAccounting — OpenAI (reasoning within completion budget)', () => {
  it('subtracts reasoning from completion to get emitted output', () => {
    const acc = deriveTokenAccounting({
      modelString: 'openai:gpt-5',
      requestedMaxTokens: 16384,
      tokensPrompt: 52000,
      tokensCompletion: 16384, // hit the ceiling
      tokensReasoning: 15000, // most of it was thinking
      finishReason: 'length',
    });
    expect(acc.reasoningAccounting).toBe('within-output');
    expect(acc.reasoningTokens).toBe(15000);
    expect(acc.emittedOutputTokens).toBe(16384 - 15000); // 1384
    expect(acc.budgetConsumedTokens).toBe(16384);
    expect(acc.totalTokens).toBe(52000 + 16384);
    expect(acc.truncated).toBe(true);
    expect(acc.distanceToTruncation).toBe(0);
    expect(acc.truncationAxis).toBe('reasoning-bound'); // reasoning >> emitted
  });

  it('falls back to completion when reasoning is not reported', () => {
    const acc = deriveTokenAccounting({
      modelString: 'openai:gpt-4.1-mini',
      requestedMaxTokens: 16384,
      tokensPrompt: 1000,
      tokensCompletion: 4000,
      // no tokensReasoning
      finishReason: 'stop',
    });
    expect(acc.reasoningTokens).toBeNull();
    expect(acc.emittedOutputTokens).toBe(4000);
    expect(acc.budgetConsumedTokens).toBe(4000);
    expect(acc.truncated).toBe(false);
    expect(acc.distanceToTruncation).toBe(16384 - 4000);
    expect(acc.emittedOutputFraction).toBe(1); // emitted == budget when reasoning unknown
    expect(acc.truncationAxis).toBe('indeterminate');
  });

  it('classifies an output-bound truncation when emitted dominates', () => {
    const acc = deriveTokenAccounting({
      modelString: 'openai:gpt-5',
      requestedMaxTokens: 16384,
      tokensPrompt: 52000,
      tokensCompletion: 16384,
      tokensReasoning: 2000, // small reasoning, lots of real output
      finishReason: 'length',
    });
    expect(acc.emittedOutputTokens).toBe(14384);
    expect(acc.truncationAxis).toBe('output-bound');
  });
});

describe('deriveTokenAccounting — Gemini (reasoning separate from output)', () => {
  it('keeps emitted = candidates and adds thoughts into the budget consumed', () => {
    const acc = deriveTokenAccounting({
      modelString: 'google:gemini-2.5-pro',
      requestedMaxTokens: 16384,
      tokensPrompt: 52000,
      tokensCompletion: 4000, // candidatesTokenCount (emitted)
      tokensReasoning: 12000, // thoughtsTokenCount (separate)
      finishReason: 'MAX_TOKENS',
    });
    expect(acc.reasoningAccounting).toBe('separate-from-output');
    expect(acc.emittedOutputTokens).toBe(4000);
    expect(acc.reasoningTokens).toBe(12000);
    expect(acc.budgetConsumedTokens).toBe(16000); // 4000 + 12000
    expect(acc.totalTokens).toBe(52000 + 16000);
    expect(acc.truncated).toBe(true);
    expect(acc.distanceToTruncation).toBe(16384 - 16000); // 384 headroom remained
    expect(acc.truncationAxis).toBe('reasoning-bound'); // thoughts > candidates
  });
});

describe('deriveTokenAccounting — Anthropic (no split available)', () => {
  it('forces reasoning to null even if a value is passed, and cannot attribute a truncation axis', () => {
    const acc = deriveTokenAccounting({
      modelString: 'anthropic:claude-opus-4-5',
      requestedMaxTokens: 16384,
      tokensPrompt: 52000,
      tokensCompletion: 16384,
      tokensReasoning: 9999, // should be ignored — Anthropic exposes no split
      finishReason: 'max_tokens',
    });
    expect(acc.reasoningAccounting).toBe('unavailable');
    expect(acc.reasoningTokens).toBeNull();
    expect(acc.emittedOutputTokens).toBe(16384);
    expect(acc.budgetConsumedTokens).toBe(16384);
    expect(acc.truncated).toBe(true);
    expect(acc.truncationAxis).toBe('indeterminate'); // cannot tell reasoning vs output
  });
});

describe('deriveTokenAccounting — edge cases', () => {
  it('returns a null distance when no budget was requested', () => {
    const acc = deriveTokenAccounting({
      modelString: 'openai:gpt-5',
      tokensPrompt: 100,
      tokensCompletion: 50,
      finishReason: 'stop',
    });
    expect(acc.requestedMaxTokens).toBeNull();
    expect(acc.distanceToTruncation).toBeNull();
  });
  it('treats negative / non-finite counts as zero and avoids divide-by-zero', () => {
    const acc = deriveTokenAccounting({
      modelString: 'anthropic:claude-opus-4-5',
      requestedMaxTokens: 16384,
      tokensPrompt: -5,
      tokensCompletion: 0,
      finishReason: 'end_turn',
    });
    expect(acc.promptTokens).toBe(0);
    expect(acc.emittedOutputFraction).toBeNull(); // budgetConsumed 0 → no fraction
  });
});

describe('formatTokenAccounting', () => {
  it('produces a single compact line including the accounting mode', () => {
    const acc = deriveTokenAccounting({
      modelString: 'google:gemini-2.5-pro',
      requestedMaxTokens: 16384,
      tokensPrompt: 52000,
      tokensCompletion: 4000,
      tokensReasoning: 12000,
      finishReason: 'MAX_TOKENS',
    });
    const line = formatTokenAccounting(acc);
    expect(line).toContain('provider=google');
    expect(line).toContain('reasoning=12000');
    expect(line).toContain('truncated=true');
    expect(line).toContain('axis=reasoning-bound');
    expect(line).toContain('acct=separate-from-output');
  });
});

describe('pre-flight estimate primitive', () => {
  it('estimates ~1 token per 4 chars', () => {
    expect(CHARS_PER_TOKEN).toBe(4);
    expect(estimateInputTokens('')).toBe(0);
    expect(estimateInputTokens('a'.repeat(400))).toBe(100);
  });
  it('estimatePreflight sums input estimate + requested budget', () => {
    const est = estimatePreflight('a'.repeat(208000), 16384); // ~52k input tokens
    expect(est.estimatedInputTokens).toBe(52000);
    expect(est.requestedMaxTokens).toBe(16384);
    expect(est.estimatedTotalTokens).toBe(52000 + 16384);
  });
});
