/**
 * JOB-RECOVERY-1 — dispatcher-side recovery (Component B: B-2 reaper + B-4 durable retry).
 *
 * GUARD: with JOB_REAPER_ENABLED OFF, no sweep runs (getStaleRunningJobs is never called) and the
 * retry counter uses Component A's in-memory Map (setJobDispatchAttempts is never called) — byte-
 * for-byte unchanged.
 * B-2: a stale 'running' job is reaped to 'timed_out' by the sweep (flag ON); not touched (flag OFF).
 * B-4: the durable attempt count (persisted in jobs.input) drives the bound across a simulated
 * restart (in-memory Map cleared) — a job already at the bound terminalizes instead of restarting; a
 * fresh failure re-queues AND persists the incremented count.
 *
 * jobs queries are mocked (no DB); driven via runReaperOnceForTest / runPollOnceForTest.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/queries/jobs.js', () => ({
  getQueuedJobs: vi.fn(async () => []),
  getStaleRunningJobs: vi.fn(async () => []),
  markJobTimedOut: vi.fn(async () => {}),
  setJobDispatchAttempts: vi.fn(async () => {}),
  requeueJob: vi.fn(async () => 1),
  markJobFailed: vi.fn(async () => {}),
  insertJob: vi.fn(async () => 'job'),
  markJobRunning: vi.fn(async () => 1),
  markJobCompleted: vi.fn(async () => 1),
  markJobCancelled: vi.fn(async () => 1),
  updateJobHeartbeat: vi.fn(async () => {}),
  getJobById: vi.fn(),
  getPublicJobById: vi.fn(),
  listJobsForDocument: vi.fn(),
  listJobsForMatter: vi.fn(),
  pollJobs: vi.fn(),
}));

import {
  getStaleRunningJobs,
  markJobTimedOut,
  setJobDispatchAttempts,
  requeueJob,
  markJobFailed,
  getQueuedJobs,
} from '../db/queries/jobs.js';
import {
  registerJobHandler,
  runReaperOnceForTest,
  runPollOnceForTest,
  settleDispatchesForTest,
  clearHandlersForTest,
  resetDispatcherJobStateForTest,
} from '../jobs/dispatcher.js';

const mStale = vi.mocked(getStaleRunningJobs);
const mTimedOut = vi.mocked(markJobTimedOut);
const mSetAttempts = vi.mocked(setJobDispatchAttempts);
const mRequeue = vi.mocked(requeueJob);
const mFailed = vi.mocked(markJobFailed);
const mQueued = vi.mocked(getQueuedJobs);

function runningJob(id: string) {
  return { id, userId: 'u1', jobType: 'reviewer_feedback', matterId: null, documentId: null, status: 'running' };
}
function queuedJob(id: string, dispatchAttempts: number) {
  return {
    id,
    userId: 'u1',
    jobType: 'reviewer_feedback',
    matterId: null,
    documentId: null,
    status: 'queued',
    input: { roleMetadata: { dispatchAttempts } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearHandlersForTest();
  resetDispatcherJobStateForTest();
  delete process.env['JOB_REAPER_ENABLED'];
});
afterEach(() => {
  clearHandlersForTest();
  resetDispatcherJobStateForTest();
  delete process.env['JOB_REAPER_ENABLED'];
});

describe('B-2 — orphan reaper', () => {
  it('flag ON: a stale running job is terminalized to timed_out', async () => {
    process.env['JOB_REAPER_ENABLED'] = 'true';
    mStale.mockResolvedValue([runningJob('orphan-1') as never]);
    await runReaperOnceForTest();
    expect(mStale).toHaveBeenCalledTimes(1);
    expect(mTimedOut).toHaveBeenCalledTimes(1);
    expect(mTimedOut).toHaveBeenCalledWith('orphan-1', 'u1', expect.stringContaining('Reaped'));
  });

  it('GUARD flag OFF: no sweep runs (getStaleRunningJobs never called, nothing reaped)', async () => {
    delete process.env['JOB_REAPER_ENABLED'];
    await runReaperOnceForTest();
    expect(mStale).not.toHaveBeenCalled();
    expect(mTimedOut).not.toHaveBeenCalled();
  });
});

describe('B-4 — durable retry counter', () => {
  it('flag ON + durable count at the bound: terminalizes across a simulated restart (Map cleared)', async () => {
    process.env['JOB_REAPER_ENABLED'] = 'true';
    resetDispatcherJobStateForTest(); // simulate restart: the in-memory _requeueAttempts is empty
    registerJobHandler('reviewer_feedback', vi.fn(async () => { throw new Error('boom'); }));
    // durable count = 2 (survived in jobs.input); +1 = 3 = MAX_HANDLER_ATTEMPTS -> terminalize, not requeue.
    mQueued.mockResolvedValue([queuedJob('j-dur', 2) as never]);
    await runPollOnceForTest();
    await settleDispatchesForTest();
    expect(mFailed).toHaveBeenCalledTimes(1);
    expect(mFailed).toHaveBeenCalledWith('j-dur', 'u1', 'dispatcher_retry_exhausted', expect.any(String));
    expect(mRequeue).not.toHaveBeenCalled();
    expect(mSetAttempts).not.toHaveBeenCalled();
  });

  it('flag ON + fresh failure: re-queues AND persists the incremented count durably', async () => {
    process.env['JOB_REAPER_ENABLED'] = 'true';
    registerJobHandler('reviewer_feedback', vi.fn(async () => { throw new Error('boom'); }));
    mQueued.mockResolvedValue([queuedJob('j-new', 0) as never]); // durable count 0 -> +1 = 1 < 3 -> requeue
    await runPollOnceForTest();
    await settleDispatchesForTest();
    expect(mSetAttempts).toHaveBeenCalledTimes(1);
    expect(mSetAttempts).toHaveBeenCalledWith('j-new', 'u1', 1);
    expect(mRequeue).toHaveBeenCalledTimes(1);
    expect(mFailed).not.toHaveBeenCalled();
  });

  it('GUARD flag OFF: uses the in-memory Map (no durable persist) — a count-2 job restarts at 0 and re-queues', async () => {
    delete process.env['JOB_REAPER_ENABLED'];
    resetDispatcherJobStateForTest(); // restart -> Map empty
    registerJobHandler('reviewer_feedback', vi.fn(async () => { throw new Error('boom'); }));
    mQueued.mockResolvedValue([queuedJob('j-off', 2) as never]); // durable count ignored when flag OFF
    await runPollOnceForTest();
    await settleDispatchesForTest();
    // in-memory Map fresh (0) -> attempts 1 < 3 -> requeue; durable persist NOT used
    expect(mSetAttempts).not.toHaveBeenCalled();
    expect(mRequeue).toHaveBeenCalledTimes(1);
    expect(mFailed).not.toHaveBeenCalled();
  });
});
