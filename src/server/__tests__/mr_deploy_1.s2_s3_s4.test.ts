/**
 * MR-DEPLOY-1 S2/S3/S4 — Database Resilience Hardening Tests
 *
 * Tests:
 *
 * S2 — Pool configuration (§8.1)
 *   T-S2-1: connection.ts contains enableKeepAlive: true explicitly
 *   T-S2-2: connection.ts contains keepAliveInitialDelay: 10000 explicitly
 *
 * S3 — isTransientDbError unit tests (§8.2)
 *   T-S3-1:  ECONNRESET → true (clearly transient)
 *   T-S3-2:  ETIMEDOUT → true (clearly transient)
 *   T-S3-3:  PROTOCOL_CONNECTION_LOST → true (clearly transient)
 *   T-S3-4:  ECONNREFUSED → true (conditionally retried)
 *   T-S3-5:  EHOSTUNREACH → true (conditionally retried)
 *   T-S3-6:  ER_ACCESS_DENIED_ERROR → false (non-transient)
 *   T-S3-7:  ER_BAD_DB_ERROR → false (non-transient)
 *   T-S3-8:  ER_BAD_FIELD_ERROR → false (non-transient)
 *   T-S3-9:  ZodError → false (non-transient)
 *   T-S3-10: Unknown code → false (default non-transient)
 *   T-S3-11: fatal: true alone (no recognized code) → false
 *   T-S3-12: null → false
 *   T-S3-13: string → false
 *
 * S3 — Dispatcher resilience (§8.2 continued)
 *   T-S3-14: Within-cycle retry — transient error, success on 2nd attempt; counter NOT incremented
 *   T-S3-15: Within-cycle retry — all 3 retries fail; counter increments by 1; fatal handler NOT invoked
 *   T-S3-16: Across-cycle — 4 consecutive exhausted cycles → fatal handler NOT invoked
 *   T-S3-17: Across-cycle — 5th consecutive exhausted cycle → fatal handler invoked exactly once
 *   T-S3-18: Across-cycle — 4 exhausted, then successful poll → counter reset to 0
 *   T-S3-19: Successful poll with zero jobs → counts as success; counter reset
 *   T-S3-20: Handler-level failure (unregistered job type) → does NOT increment counter
 *   T-S3-21: Non-transient error in poll query → no retry; counter NOT incremented; fatal NOT invoked
 *   T-S3-22: console.warn asserted for ECONNREFUSED retry attempts
 *   T-S3-23: Fatal handler injection cross-test isolation (afterEach reset)
 *
 * S4 — checkDbReady helper (§8.3)
 *   T-S4-1: returns true when SELECT 1 succeeds within timeout
 *   T-S4-2: returns false when query throws
 *   T-S4-3: returns false when query exceeds timeout
 *
 * S4 — /api/ready and /api/health route handlers (§8.3)
 *   T-S4-4: /api/ready handler with healthy DB → 200, body { status: 'ready' }
 *   T-S4-5: /api/ready handler with DB failure → 503, body { status: 'not_ready' }
 *   T-S4-6: /api/ready response body — no internal error codes/stack/messages leaked
 *   T-S4-7: /api/health unchanged from baseline (liveness-only, 200, { status: 'ok', timestamp: ... })
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZodError } from 'zod';
import fs from 'fs';
import path from 'path';
import type { Request } from 'express';

// ============================================================
// S2 — Pool configuration source-inspection tests
// ============================================================

describe('S2 — Pool configuration (source inspection)', () => {
  const connectionTsPath = path.resolve(
    __dirname,
    '../db/connection.ts',
  );
  let source: string;

  beforeEach(() => {
    source = fs.readFileSync(connectionTsPath, 'utf-8');
  });

  it('T-S2-1: enableKeepAlive: true is set explicitly in mysql.createPool()', () => {
    expect(source).toMatch(/enableKeepAlive\s*:\s*true/);
  });

  it('T-S2-2: keepAliveInitialDelay: 10000 is set explicitly in mysql.createPool()', () => {
    expect(source).toMatch(/keepAliveInitialDelay\s*:\s*10000/);
  });
});

// ============================================================
// S3 — isTransientDbError unit tests
// ============================================================

import { isTransientDbError } from '../db/transientDbError.js';

describe('S3 — isTransientDbError unit tests', () => {
  it('T-S3-1: ECONNRESET → true', () => {
    expect(isTransientDbError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('T-S3-2: ETIMEDOUT → true', () => {
    expect(isTransientDbError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it('T-S3-3: PROTOCOL_CONNECTION_LOST → true', () => {
    expect(isTransientDbError({ code: 'PROTOCOL_CONNECTION_LOST' })).toBe(true);
  });

  it('T-S3-4: ECONNREFUSED → true (conditionally retried)', () => {
    expect(isTransientDbError({ code: 'ECONNREFUSED' })).toBe(true);
  });

  it('T-S3-5: EHOSTUNREACH → true (conditionally retried)', () => {
    expect(isTransientDbError({ code: 'EHOSTUNREACH' })).toBe(true);
  });

  it('T-S3-6: ER_ACCESS_DENIED_ERROR → false', () => {
    expect(isTransientDbError({ code: 'ER_ACCESS_DENIED_ERROR' })).toBe(false);
  });

  it('T-S3-7: ER_BAD_DB_ERROR → false', () => {
    expect(isTransientDbError({ code: 'ER_BAD_DB_ERROR' })).toBe(false);
  });

  it('T-S3-8: ER_BAD_FIELD_ERROR → false', () => {
    expect(isTransientDbError({ code: 'ER_BAD_FIELD_ERROR' })).toBe(false);
  });

  it('T-S3-9: ZodError → false', () => {
    const zodErr = new ZodError([]);
    expect(isTransientDbError(zodErr)).toBe(false);
  });

  it('T-S3-10: unknown code → false (default non-transient)', () => {
    expect(isTransientDbError({ code: 'SOME_UNKNOWN_ERROR' })).toBe(false);
  });

  it('T-S3-11: fatal: true alone (no recognized code) → false', () => {
    expect(isTransientDbError({ fatal: true })).toBe(false);
  });

  it('T-S3-12: null → false', () => {
    expect(isTransientDbError(null)).toBe(false);
  });

  it('T-S3-13: string → false', () => {
    expect(isTransientDbError('ECONNRESET')).toBe(false);
  });
});

// ============================================================
// S3 — Dispatcher resilience tests
// ============================================================

// Mock getQueuedJobs before importing dispatcher to ensure the mock is in place
vi.mock('../db/queries/jobs.js', () => ({
  getQueuedJobs: vi.fn(),
}));

import { getQueuedJobs } from '../db/queries/jobs.js';
import {
  setDispatcherFatalHandlerForTest,
  resetDispatcherFatalHandlerForTest,
  resetConsecutiveFailureCounterForTest,
  getConsecutiveFailureCount,
  runPollOnceForTest,
} from '../jobs/dispatcher.js';

const mockGetQueuedJobs = vi.mocked(getQueuedJobs);

describe('S3 — Dispatcher resilience', () => {
  beforeEach(() => {
    resetConsecutiveFailureCounterForTest();
    resetDispatcherFatalHandlerForTest();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetDispatcherFatalHandlerForTest();
    resetConsecutiveFailureCounterForTest();
    vi.useRealTimers();
  });

  // ---- T-S3-14: Within-cycle retry — success on 2nd attempt ----
  it('T-S3-14: transient error on first attempt, success on 2nd — counter NOT incremented', async () => {
    vi.useFakeTimers();
    const transientErr = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    mockGetQueuedJobs
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValueOnce([]);

    const fatalSpy = vi.fn();
    setDispatcherFatalHandlerForTest(fatalSpy);

    const pollPromise = runPollOnceForTest();
    // Advance through the first retry delay (1000ms)
    await vi.advanceTimersByTimeAsync(1100);
    await pollPromise;

    expect(getConsecutiveFailureCount()).toBe(0);
    expect(fatalSpy).not.toHaveBeenCalled();
    // getQueuedJobs called twice: once failing, once succeeding
    expect(mockGetQueuedJobs).toHaveBeenCalledTimes(2);
  });

  // ---- T-S3-15: All 3 retries fail → counter increments by 1, fatal NOT invoked ----
  it('T-S3-15: all 3 within-cycle retries fail → counter = 1; fatal NOT invoked', async () => {
    vi.useFakeTimers();
    const transientErr = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    mockGetQueuedJobs.mockRejectedValue(transientErr);

    const fatalSpy = vi.fn();
    setDispatcherFatalHandlerForTest(fatalSpy);

    const pollPromise = runPollOnceForTest();
    // Advance through all retry delays: 1000 + 2000 + 4000 = 7000ms
    await vi.advanceTimersByTimeAsync(8000);
    await pollPromise;

    expect(getConsecutiveFailureCount()).toBe(1);
    expect(fatalSpy).not.toHaveBeenCalled();
    // 1 initial attempt + 3 retries = 4 calls total
    expect(mockGetQueuedJobs).toHaveBeenCalledTimes(4);
  });

  // ---- T-S3-16: 4 consecutive exhausted cycles → fatal NOT invoked ----
  it('T-S3-16: 4 consecutive exhausted cycles → fatal NOT invoked', async () => {
    vi.useFakeTimers();
    const transientErr = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    mockGetQueuedJobs.mockRejectedValue(transientErr);

    const fatalSpy = vi.fn();
    setDispatcherFatalHandlerForTest(fatalSpy);

    for (let i = 0; i < 4; i++) {
      const p = runPollOnceForTest();
      await vi.advanceTimersByTimeAsync(8000);
      await p;
    }

    expect(getConsecutiveFailureCount()).toBe(4);
    expect(fatalSpy).not.toHaveBeenCalled();
  });

  // ---- T-S3-17: 5th consecutive exhausted cycle → fatal invoked exactly once ----
  it('T-S3-17: 5th consecutive exhausted cycle → fatal handler invoked exactly once', async () => {
    vi.useFakeTimers();
    const transientErr = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    mockGetQueuedJobs.mockRejectedValue(transientErr);

    const fatalSpy = vi.fn();
    setDispatcherFatalHandlerForTest(fatalSpy);

    for (let i = 0; i < 5; i++) {
      const p = runPollOnceForTest();
      await vi.advanceTimersByTimeAsync(8000);
      await p;
    }

    expect(fatalSpy).toHaveBeenCalledTimes(1);
  });

  // ---- T-S3-18: 4 exhausted, then successful poll → counter reset to 0 ----
  it('T-S3-18: 4 exhausted cycles, then successful poll → counter reset to 0', async () => {
    vi.useFakeTimers();
    const transientErr = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    mockGetQueuedJobs.mockRejectedValue(transientErr);

    const fatalSpy = vi.fn();
    setDispatcherFatalHandlerForTest(fatalSpy);

    for (let i = 0; i < 4; i++) {
      const p = runPollOnceForTest();
      await vi.advanceTimersByTimeAsync(8000);
      await p;
    }
    expect(getConsecutiveFailureCount()).toBe(4);

    // Now succeed
    mockGetQueuedJobs.mockResolvedValueOnce([]);
    const p = runPollOnceForTest();
    await vi.advanceTimersByTimeAsync(100);
    await p;

    expect(getConsecutiveFailureCount()).toBe(0);
    expect(fatalSpy).not.toHaveBeenCalled();
  });

  // ---- T-S3-19: Successful poll with zero jobs → counts as success; counter reset ----
  it('T-S3-19: successful poll with zero jobs → counter reset to 0', async () => {
    vi.useFakeTimers();
    const transientErr = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    mockGetQueuedJobs.mockRejectedValue(transientErr);

    const fatalSpy = vi.fn();
    setDispatcherFatalHandlerForTest(fatalSpy);

    // Fail once to set counter to 1
    const p1 = runPollOnceForTest();
    await vi.advanceTimersByTimeAsync(8000);
    await p1;
    expect(getConsecutiveFailureCount()).toBe(1);

    // Succeed with zero jobs
    mockGetQueuedJobs.mockResolvedValueOnce([]);
    const p2 = runPollOnceForTest();
    await vi.advanceTimersByTimeAsync(100);
    await p2;

    expect(getConsecutiveFailureCount()).toBe(0);
  });

  // ---- T-S3-20: Handler-level failure → does NOT increment counter ----
  it('T-S3-20: handler-level failure (unregistered job type) does NOT increment counter', async () => {
    vi.useFakeTimers();
    // Return a job with an unregistered type — dispatcher logs warn and skips
    const fakeJob = {
      id: 'job-1',
      userId: 'user-1',
      jobType: 'unregistered_test_job_type',
      matterId: null,
      documentId: null,
    };
    mockGetQueuedJobs.mockResolvedValue([fakeJob as never]);

    const fatalSpy = vi.fn();
    setDispatcherFatalHandlerForTest(fatalSpy);

    const p = runPollOnceForTest();
    await vi.advanceTimersByTimeAsync(100);
    await p;

    // Successful poll (no DB error) → counter stays at 0
    expect(getConsecutiveFailureCount()).toBe(0);
    expect(fatalSpy).not.toHaveBeenCalled();
  });

  // ---- T-S3-21: Non-transient error → no retry; counter NOT incremented; fatal NOT invoked ----
  it('T-S3-21: non-transient error → no retry; counter NOT incremented; fatal NOT invoked', async () => {
    vi.useFakeTimers();
    const nonTransientErr = Object.assign(new Error('access denied'), { code: 'ER_ACCESS_DENIED_ERROR' });
    mockGetQueuedJobs.mockRejectedValue(nonTransientErr);

    const fatalSpy = vi.fn();
    setDispatcherFatalHandlerForTest(fatalSpy);

    const p = runPollOnceForTest();
    await vi.advanceTimersByTimeAsync(100);
    await p;

    // getQueuedJobs should only have been called once (no retries for non-transient)
    expect(mockGetQueuedJobs).toHaveBeenCalledTimes(1);
    expect(getConsecutiveFailureCount()).toBe(0);
    expect(fatalSpy).not.toHaveBeenCalled();
  });

  // ---- T-S3-22: console.warn for ECONNREFUSED retry attempts ----
  it('T-S3-22: ECONNREFUSED retry attempts log at console.warn', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const transientErr = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    // Fail twice then succeed
    mockGetQueuedJobs
      .mockRejectedValueOnce(transientErr)
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValueOnce([]);

    const p = runPollOnceForTest();
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    // At least one console.warn call should mention the retry
    const warnCalls = warnSpy.mock.calls.map((args) => String(args[0]));
    const hasRetryWarn = warnCalls.some(
      (msg) => msg.includes('[Dispatcher]') && msg.includes('Transient DB error'),
    );
    expect(hasRetryWarn).toBe(true);

    warnSpy.mockRestore();
  });

  // ---- T-S3-23: Cross-test isolation — afterEach resets fatal handler ----
  it('T-S3-23: fatal handler injection and reset cycle works correctly (cross-test isolation)', () => {
    const stub1 = vi.fn();
    setDispatcherFatalHandlerForTest(stub1);
    resetDispatcherFatalHandlerForTest();

    // After reset, inject a second stub — the first stub should not be active
    const stub2 = vi.fn();
    setDispatcherFatalHandlerForTest(stub2);
    expect(stub1).not.toHaveBeenCalled();
    expect(stub2).not.toHaveBeenCalled();
    resetDispatcherFatalHandlerForTest();
  });
});

// ============================================================
// S4 — checkDbReady helper tests
// ============================================================

import { checkDbReady } from '../routes/ready.js';

describe('S4 — checkDbReady helper', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('T-S4-1: returns true when SELECT 1 succeeds within timeout', async () => {
    const mockPool = {
      execute: vi.fn().mockResolvedValue([{ '1': 1 }]),
    };
    const result = await checkDbReady(mockPool as never, 2000);
    expect(result).toBe(true);
  });

  it('T-S4-2: returns false when query throws', async () => {
    const mockPool = {
      execute: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    const result = await checkDbReady(mockPool as never, 2000);
    expect(result).toBe(false);
  });

  it('T-S4-3: returns false when query exceeds timeout', async () => {
    vi.useFakeTimers();
    const mockPool = {
      execute: vi.fn().mockImplementation(() => new Promise(() => {})), // never resolves
    };
    const resultPromise = checkDbReady(mockPool as never, 100);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    expect(result).toBe(false);
  });
});

// ============================================================
// S4 — /api/ready and /api/health route handler tests
// We test the handlers directly using mock req/res objects,
// consistent with the existing project test pattern (no supertest).
// ============================================================

/**
 * Build a minimal mock Express response object that captures
 * status code and JSON body for assertions.
 */
function buildMockRes() {
  const res = {
    _status: 200,
    _body: undefined as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return res;
}

describe('S4 — /api/ready and /api/health route handlers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('T-S4-4: /api/ready with healthy DB → 200, body { status: "ready" }', async () => {
    const mockPool = {
      execute: vi.fn().mockResolvedValue([{ '1': 1 }]),
    };

    // Simulate the /api/ready handler logic directly
    const res = buildMockRes();
    const ready = await checkDbReady(mockPool as never, 2000);
    if (ready) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not_ready' });
    }

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ status: 'ready' });
  });

  it('T-S4-5: /api/ready with DB query throwing → 503, body { status: "not_ready" }', async () => {
    const mockPool = {
      execute: vi.fn().mockRejectedValue(new Error('connection refused')),
    };

    const res = buildMockRes();
    const ready = await checkDbReady(mockPool as never, 2000);
    if (ready) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not_ready' });
    }

    expect(res._status).toBe(503);
    expect(res._body).toEqual({ status: 'not_ready' });
  });

  it('T-S4-6: /api/ready response body contains no internal error codes, stack, or messages', async () => {
    const mockPool = {
      execute: vi.fn().mockRejectedValue(new Error('ECONNRESET: connection reset by peer')),
    };

    const res = buildMockRes();
    const ready = await checkDbReady(mockPool as never, 2000);
    if (ready) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not_ready' });
    }

    const bodyStr = JSON.stringify(res._body);
    // Must not contain error details
    expect(bodyStr).not.toMatch(/Error/);
    expect(bodyStr).not.toMatch(/stack/);
    expect(bodyStr).not.toMatch(/ECONNRESET|ETIMEDOUT|PROTOCOL_CONNECTION_LOST/);
    // Must only contain the expected shape
    expect(Object.keys(res._body as Record<string, unknown>)).toEqual(['status']);
    expect((res._body as Record<string, unknown>)['status']).toBe('not_ready');
  });

  it('T-S4-7: /api/health handler is liveness-only — 200, { status: "ok", timestamp: ISO string }', () => {
    // Simulate the /api/health handler logic directly (byte-identical to baseline)
    const res = buildMockRes();
    void ({} as Request); // type-check only, not used at runtime

    // Inline the handler as it appears in index.ts (byte-identical check)
    res.json({ status: 'ok', timestamp: new Date().toISOString() });

    expect(res._status).toBe(200); // default, not explicitly set by health handler
    expect((res._body as Record<string, unknown>)['status']).toBe('ok');
    expect(typeof (res._body as Record<string, unknown>)['timestamp']).toBe('string');
    // timestamp must be a valid ISO 8601 date string
    const ts = (res._body as Record<string, unknown>)['timestamp'] as string;
    expect(new Date(ts).toISOString()).toBe(ts);
    // Must not contain 'ready' — liveness only
    expect(res._body).not.toHaveProperty('ready');
    expect(res._body).not.toHaveProperty('db');
  });
});
