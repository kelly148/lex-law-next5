/**
 * REVIEWER-RETRY-SUPPRESS-1
 *
 * A request-level timeout (a SLOW model whose headers/first byte exceed undici's internal window)
 * surfaces as a generic `TypeError: fetch failed`, which the adapters wrap as api_error. Before
 * this fix, isTransientRetryable matched the "fetch failed" substring and RETRIED it twice (3
 * attempts) — for a big-doc GPT-5 review that is ~3x a multi-minute call, all doomed (re-running
 * at the same budget just times out again). These tests pin that an undici timeout is NOT retried
 * while a genuine transient network blip (ECONNRESET, socket hang up) still is, and that the rest
 * of the MODEL-RELIABILITY-UAT-1 retry taxonomy is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { isUndiciTimeoutError, LlmProviderError } from '../llm/types.js';
import { isTransientRetryable } from '../db/canonicalMutation.js';

// Helpers to build realistic error chains without `any` and without relying on the ErrorOptions
// constructor: an undici timeout/network error (carries `.code`) nested as the `cause` of the
// `TypeError: fetch failed`, which is itself the `cause` of the adapter's LlmProviderError.
function withCode<E extends Error>(err: E, code: string): E {
  (err as E & { code?: string }).code = code;
  return err;
}
function withCause<E extends Error>(err: E, cause: unknown): E {
  (err as E & { cause?: unknown }).cause = cause;
  return err;
}
function adapterFetchFailed(rootCause: Error): LlmProviderError {
  const fetchErr = withCause(new TypeError('fetch failed'), rootCause);
  return new LlmProviderError('api_error', `OpenAI fetch failed: ${String(fetchErr)}`, fetchErr);
}

describe('isUndiciTimeoutError', () => {
  it('detects undici timeout codes nested in the cause chain', () => {
    for (const code of ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT']) {
      const root = withCode(new Error('timeout'), code);
      expect(isUndiciTimeoutError(adapterFetchFailed(root))).toBe(true);
    }
  });
  it('detects a timeout by message when no code is present', () => {
    const root = new Error('Headers Timeout Error');
    expect(isUndiciTimeoutError(adapterFetchFailed(root))).toBe(true);
  });
  it('detects a directly-thrown undici timeout (not wrapped)', () => {
    expect(isUndiciTimeoutError(withCode(new Error('x'), 'UND_ERR_BODY_TIMEOUT'))).toBe(true);
  });
  it('does NOT flag a genuine transient network blip', () => {
    expect(isUndiciTimeoutError(adapterFetchFailed(withCode(new Error('read ECONNRESET'), 'ECONNRESET')))).toBe(false);
    expect(isUndiciTimeoutError(adapterFetchFailed(withCode(new Error('socket hang up'), 'UND_ERR_SOCKET')))).toBe(false);
  });
  it('does NOT flag a bare "fetch failed" with no undici code/timeout message', () => {
    expect(isUndiciTimeoutError(adapterFetchFailed(new Error('fetch failed')))).toBe(false);
  });
  it('is safe on null/undefined/non-error input', () => {
    expect(isUndiciTimeoutError(null)).toBe(false);
    expect(isUndiciTimeoutError(undefined)).toBe(false);
    expect(isUndiciTimeoutError('UND_ERR_HEADERS_TIMEOUT')).toBe(false); // string, not an error chain
  });
});

describe('isTransientRetryable — undici timeout is NOT retried (the fix)', () => {
  it('returns false for a model-latency fetch-failed (undici headers timeout), despite the "fetch failed" substring', () => {
    const err = adapterFetchFailed(withCode(new Error('Headers Timeout Error'), 'UND_ERR_HEADERS_TIMEOUT'));
    expect(isTransientRetryable(err)).toBe(false);
  });
  it('returns false for an undici body timeout', () => {
    const err = adapterFetchFailed(withCode(new Error('Body Timeout Error'), 'UND_ERR_BODY_TIMEOUT'));
    expect(isTransientRetryable(err)).toBe(false);
  });
});

describe('isTransientRetryable — genuine transients still retry (composition with UAT-1)', () => {
  it('still retries a real transient network blip (ECONNRESET)', () => {
    expect(isTransientRetryable(adapterFetchFailed(withCode(new Error('read ECONNRESET'), 'ECONNRESET')))).toBe(true);
  });
  it('still retries a bare "fetch failed" (no undici code)', () => {
    expect(isTransientRetryable(adapterFetchFailed(new Error('fetch failed')))).toBe(true);
  });
  it('still retries rate_limited (429) and 5xx api_error', () => {
    expect(isTransientRetryable(new LlmProviderError('rate_limited', 'OpenAI API error 429: too many requests'))).toBe(true);
    expect(isTransientRetryable(new LlmProviderError('api_error', 'OpenAI API error 503: service unavailable'))).toBe(true);
  });
  it('still does NOT retry auth, parse, or aborts', () => {
    expect(isTransientRetryable(new LlmProviderError('auth_error', 'OpenAI API error 401'))).toBe(false);
    expect(isTransientRetryable(new LlmProviderError('parse_error', 'malformed JSON'))).toBe(false);
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isTransientRetryable(abort)).toBe(false);
  });
});
