/**
 * DISPATCHER-COMPLETE-1 — dispatcher poll loop (Component A: D-1, D-2, D-3, flag-gating).
 *
 * D-1/D-4 — handler registration is flag-gated: registerDefaultJobHandlers() registers the
 * reviewer_feedback handler ONLY when JOB_DISPATCHER_ENABLED; OFF registers nothing (no-op).
 * D-2 — a job already in flight is not double-dispatched by a later poll.
 * D-3 — a throwing handler is re-queued up to the bound, then terminalized (no infinite loop).
 * Flag-OFF — with no handler registered, a queued job is skipped (inline path unchanged).
 *
 * jobs queries are mocked (no DB); the dispatcher is driven via runPollOnceForTest +
 * settleDispatchesForTest (mirrors mr_deploy_1.s2_s3_s4.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the jobs query surface BEFORE importing the dispatcher (vi.mock is hoisted).
vi.mock('../db/queries/jobs.js', () => ({
  getQueuedJobs: vi.fn(),
  requeueJob: vi.fn(async () => 1),
  markJobFailed: vi.fn(async () => {}),
  insertJob: vi.fn(async () => 'job'),
  markJobRunning: vi.fn(async () => 1),
  markJobCompleted: vi.fn(async () => 1),
  markJobTimedOut: vi.fn(async () => {}),
  markJobCancelled: vi.fn(async () => 1),
  updateJobHeartbeat: vi.fn(async () => {}),
  getJobById: vi.fn(),
  getPublicJobById: vi.fn(),
  listJobsForDocument: vi.fn(),
  listJobsForMatter: vi.fn(),
  pollJobs: vi.fn(),
}));

import { getQueuedJobs, requeueJob, markJobFailed } from '../db/queries/jobs.js';
import {
  registerJobHandler,
  registerDefaultJobHandlers,
  runPollOnceForTest,
  settleDispatchesForTest,
  hasHandlerForTest,
  clearHandlersForTest,
  resetDispatcherJobStateForTest,
} from '../jobs/dispatcher.js';

const mockGetQueuedJobs = vi.mocked(getQueuedJobs);
const mockRequeue = vi.mocked(requeueJob);
const mockMarkFailed = vi.mocked(markJobFailed);

function fakeJob(id: string, jobType = 'reviewer_feedback') {
  return { id, userId: 'u1', jobType, matterId: null, documentId: null, status: 'queued' };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearHandlersForTest();
  resetDispatcherJobStateForTest();
  delete process.env['JOB_DISPATCHER_ENABLED'];
});
afterEach(() => {
  clearHandlersForTest();
  resetDispatcherJobStateForTest();
  delete process.env['JOB_DISPATCHER_ENABLED'];
});

describe('D-1/D-4 — handler registration is flag-gated', () => {
  it('registerDefaultJobHandlers registers reviewer_feedback ONLY when JOB_DISPATCHER_ENABLED', () => {
    delete process.env['JOB_DISPATCHER_ENABLED'];
    registerDefaultJobHandlers();
    expect(hasHandlerForTest('reviewer_feedback')).toBe(false);

    process.env['JOB_DISPATCHER_ENABLED'] = 'true';
    registerDefaultJobHandlers();
    expect(hasHandlerForTest('reviewer_feedback')).toBe(true);
  });
});

describe('D-2 — no double-dispatch (in-flight guard + claim)', () => {
  it('a job already in flight is not dispatched again by the next poll', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const handler = vi.fn(async () => {
      await gate;
    });
    registerJobHandler('reviewer_feedback', handler);
    mockGetQueuedJobs.mockResolvedValue([fakeJob('j1') as never]);

    await runPollOnceForTest(); // dispatch 1 — handler in-flight, blocked
    await runPollOnceForTest(); // poll 2 sees j1 still 'queued' but in-flight -> skip
    expect(handler).toHaveBeenCalledTimes(1);

    release();
    await settleDispatchesForTest();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('D-3 — bounded retry then terminalize', () => {
  it('a throwing handler re-queues up to the bound, then marks the job failed (no infinite loop)', async () => {
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    registerJobHandler('reviewer_feedback', handler);
    mockGetQueuedJobs.mockResolvedValue([fakeJob('j2') as never]);

    await runPollOnceForTest();
    await settleDispatchesForTest();
    expect(mockRequeue).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed).not.toHaveBeenCalled();

    await runPollOnceForTest();
    await settleDispatchesForTest();
    expect(mockRequeue).toHaveBeenCalledTimes(2);
    expect(mockMarkFailed).not.toHaveBeenCalled();

    await runPollOnceForTest();
    await settleDispatchesForTest();
    expect(mockRequeue).toHaveBeenCalledTimes(2); // bounded — no further re-queue
    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed).toHaveBeenCalledWith('j2', 'u1', 'dispatcher_retry_exhausted', expect.any(String));
    expect(handler).toHaveBeenCalledTimes(3);
  });
});

describe('flag-OFF — dispatcher stays a no-op', () => {
  it('with no registered handler, a queued job is skipped (no requeue, no fail)', async () => {
    mockGetQueuedJobs.mockResolvedValue([fakeJob('j3') as never]);
    await runPollOnceForTest();
    await settleDispatchesForTest();
    expect(mockRequeue).not.toHaveBeenCalled();
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });
});
