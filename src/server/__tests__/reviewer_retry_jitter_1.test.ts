/**
 * REVIEWER-RETRY-JITTER-1 — jittered transient-retry backoff.
 *
 * Follow-up to GEMINI-NO-RETURN-1 (diagnostic: the live Gemini "no return" was a TRANSIENT under
 * the busy 4-model fan-out, amplified by lockstep no-jitter retries — concurrent lanes that hit the
 * same 429/timeout window retried in identical 500ms/1500ms steps and re-collided). These tests
 * prove the backoff is now equal-jittered and bounded, that it de-correlates, and — the guardrail —
 * that a MAX_TOKENS truncation stays NON-retryable (jitter must never re-run a truncation, per the
 * GEMINI-BUDGET-CAL truncation→api_error contract). The retry COUNT discipline (max 2; auth/parse/
 * timeout not retried) is covered by model_reliability_uat_1_retry.test.ts and reviewer_retry_suppress_1.
 */
import { describe, it, expect } from 'vitest';
import { retryBackoffMs, baseBackoffMs, isTransientRetryable } from '../db/canonicalMutation.js';
import { LlmProviderError } from '../llm/types.js';

describe('REVIEWER-RETRY-JITTER-1 — backoff', () => {
  it('the deterministic base ladder is unchanged (500ms, 1500ms)', () => {
    expect(baseBackoffMs(1)).toBe(500);
    expect(baseBackoffMs(2)).toBe(1500);
  });

  it('equal-jitter bounds each attempt to [base/2, base]', () => {
    // attempt 1: base 500 → [250, 500]
    expect(retryBackoffMs(1, () => 0)).toBe(250); // lower bound
    expect(retryBackoffMs(1, () => 1)).toBe(500); // upper bound
    // attempt 2: base 1500 → [750, 1500]
    expect(retryBackoffMs(2, () => 0)).toBe(750);
    expect(retryBackoffMs(2, () => 1)).toBe(1500);
    // a mid draw lands strictly inside the band (not the lockstep constant)
    const mid = retryBackoffMs(2, () => 0.5);
    expect(mid).toBeGreaterThan(750);
    expect(mid).toBeLessThan(1500);
  });

  it('jitter de-correlates: many distinct draws, never outside the band, never the old lockstep constant', () => {
    for (const attempt of [1, 2]) {
      const base = baseBackoffMs(attempt);
      const samples = Array.from({ length: 300 }, () => retryBackoffMs(attempt)); // real Math.random
      for (const s of samples) {
        expect(s).toBeGreaterThanOrEqual(base / 2);
        expect(s).toBeLessThanOrEqual(base);
      }
      expect(new Set(samples).size).toBeGreaterThan(10); // spread, not lockstep
      expect(samples.every((s) => s === base)).toBe(false); // never the pre-jitter fixed value
    }
  });

  it('GUARDRAIL — a MAX_TOKENS truncation stays NON-retryable (jitter never re-runs a truncation)', () => {
    const truncation = new LlmProviderError(
      'api_error',
      'Google Gemini output truncated (finishReason: MAX_TOKENS) — raise maxOutputTokens or reduce input size',
    );
    expect(isTransientRetryable(truncation)).toBe(false);
  });

  it('transient classes remain retryable (so jitter applies to the cases it should)', () => {
    expect(isTransientRetryable(new LlmProviderError('rate_limited', 'API 429: quota exceeded'))).toBe(true);
    expect(isTransientRetryable(new LlmProviderError('api_error', 'Google Gemini API error 503: overloaded'))).toBe(true);
    expect(isTransientRetryable(new LlmProviderError('api_error', 'Google Gemini fetch failed: ECONNRESET'))).toBe(true);
    expect(isTransientRetryable(new LlmProviderError('auth_error', 'API 401: bad key'))).toBe(false);
    expect(isTransientRetryable(new LlmProviderError('parse_error', 'not valid JSON'))).toBe(false);
  });
});
