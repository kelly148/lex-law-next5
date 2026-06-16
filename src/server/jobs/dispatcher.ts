/**
 * In-Process Job Dispatcher (Ch 8, Phase 2 Build Task 6)
 *
 * The dispatcher polls for queued jobs, transitions them to running,
 * invokes the LLM adapter, and handles completion/failure/timeout/cancellation.
 *
 * DESIGN:
 *   v1 uses a simple in-process polling loop. This is appropriate for
 *   single-user operational scale. v2 may introduce a proper job queue
 *   (e.g., BullMQ) if multi-user or high-throughput requirements emerge.
 *
 * HEARTBEAT (Ch 8.5):
 *   Step-based heartbeats are updated at specific checkpoints by the
 *   canonical mutation helper. The dispatcher does not manage heartbeats
 *   directly — it delegates to executeCanonicalMutation.
 *
 * ORPHAN RECOVERY (Ch 23.5):
 *   Jobs stuck in 'running' with no recent heartbeat indicate a server
 *   restart mid-job. v1 does not have automatic recovery; operator
 *   intervention is acceptable at single-user scale. The dispatcher
 *   logs orphaned jobs on startup for operator awareness.
 *
 * CANCELLATION (Ch 21.10):
 *   The dispatcher does not directly handle cancellation. When job.cancel
 *   fires the AbortController for a running job, the LLM fetch rejects
 *   with AbortError, and executeCanonicalMutation handles the revert path.
 *
 * POLL INTERVAL:
 *   Default: 2000ms (2 seconds). Configurable via DISPATCHER_POLL_INTERVAL_MS.
 *   The dispatcher uses a jittered interval to prevent thundering-herd
 *   if multiple instances are ever deployed (future-proofing).
 *
 * DB RESILIENCE (S3, MR-DEPLOY-1):
 *   On transient DB errors (ECONNRESET, ETIMEDOUT, PROTOCOL_CONNECTION_LOST,
 *   ECONNREFUSED, EHOSTUNREACH) in the poll query path:
 *     - Retry up to POLL_QUERY_MAX_RETRIES times with exponential backoff.
 *     - If all retries are exhausted, increment consecutiveTransientPollFailures.
 *     - If consecutiveTransientPollFailures reaches CONSECUTIVE_FAILURE_THRESHOLD,
 *       invoke the fatal handler (default: process.exit(1)) so Railway's
 *       ON_FAILURE restart policy can recover the process.
 *   Non-transient errors (schema errors, Zod parse failures, unknown codes)
 *   are logged once and do not increment the counter or invoke the fatal handler.
 *   Handler-level failures inside handler(...).catch(...) do NOT count as poll
 *   failures and do NOT increment the counter.
 */

import {
  getQueuedJobs,
  requeueJob,
  markJobFailed,
  markJobTimedOut,
  getStaleRunningJobs,
  setJobDispatchAttempts,
} from '../db/queries/jobs.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';
import { isTransientDbError, isConditionallyRetriedCode } from '../db/transientDbError.js';
import { isJobDispatcherEnabled, isJobReaperEnabled, isReviewerAsyncEnabled } from '../config/featureFlags.js';
import { runDeferredCanonicalJob, hasDeferredContinuation } from '../db/canonicalMutation.js';
import { reapStaleLanes } from '../db/queries/reviewerLaneState.js';
import { parseEnvInt } from '../config/parseEnvInt.js';

// ============================================================
// Dispatcher state
// ============================================================

let _isRunning = false;
let _pollTimer: ReturnType<typeof setTimeout> | null = null;

// Registry of job handlers: jobType → handler function
// Handlers are registered by Phase 3+ procedure modules.
// The dispatcher is intentionally decoupled from specific job types —
// it only knows how to poll and dispatch; job-type-specific logic
// lives in the procedure modules.
type JobHandler = (jobId: string, userId: string) => Promise<void>;
const _handlers = new Map<string, JobHandler>();

export function registerJobHandler(jobType: string, handler: JobHandler): void {
  _handlers.set(jobType, handler);
}

// ============================================================
// DISPATCHER-COMPLETE-1 — completion tracking + bounded retry (D-2 / D-3)
// ============================================================

type DispatchableJob = Awaited<ReturnType<typeof getQueuedJobs>>[number];

/**
 * Max handler attempts before a job is terminalized. On a handler THROW the job is re-queued
 * (running|queued -> queued) for a later poll; after MAX_HANDLER_ATTEMPTS throws it is marked
 * failed so it can never loop. Durable retry ACROSS a restart is Component B (JOB-RECOVERY-1) —
 * this counter is in-memory and resets on restart. [A->B seam]
 */
const MAX_HANDLER_ATTEMPTS = 3;

/** Jobs currently being run by a handler — prevents a later poll from double-dispatching the
 *  same job (a belt to the markJobRunning claim, which is the authoritative D-2 guard). */
const _inFlight = new Set<string>();

/** Per-job throw count for the bounded D-3 retry. */
const _requeueAttempts = new Map<string, number>();

/** Deferred jobs whose in-memory continuation was lost (e.g. after a restart): left 'queued'
 *  for JOB-RECOVERY-1 (Component B) and skipped here so they do not busy-poll. */
const _skipNoContinuation = new Set<string>();

/** In-flight dispatch promises, tracked so tests can await settlement. */
const _inFlightPromises = new Set<Promise<void>>();

/**
 * Run one handler with completion tracking + bounded re-queue (D-3). NOT awaited by the poll
 * loop, so multiple jobs run concurrently. A handler THROW is an infra/dispatch failure (a
 * normal job terminal is resolved INSIDE runJob without throwing): re-queue up to
 * MAX_HANDLER_ATTEMPTS, then terminalize. Handler failures never touch the poll-failure counter.
 */
async function dispatchTracked(job: DispatchableJob, handler: JobHandler): Promise<void> {
  try {
    await handler(job.id, job.userId);
    _requeueAttempts.delete(job.id);
  } catch (err) {
    // JOB-RECOVERY-1 (B-4): when the reaper is ON the attempt count is read from / persisted to the
    // job's DURABLE input (input.roleMetadata.dispatchAttempts), so retry survives a restart; when OFF
    // it uses Component A's in-memory Map (byte-for-byte). The threshold + terminalize logic is identical.
    const reaperOn = isJobReaperEnabled();
    const prior = reaperOn ? readDurableDispatchAttempts(job) : (_requeueAttempts.get(job.id) ?? 0);
    const attempts = prior + 1;
    console.error(
      `[Dispatcher] Handler threw for jobType="${job.jobType}" jobId="${job.id}" ` +
        `(attempt ${attempts}/${MAX_HANDLER_ATTEMPTS}):`,
      err,
    );
    void emitTelemetry(
      'procedure_error',
      {
        procedureName: `dispatcher.${job.jobType}`,
        errorCode: 'INTERNAL_SERVER_ERROR',
        errorMessage: err instanceof Error ? err.message : String(err),
      },
      { userId: job.userId, matterId: job.matterId, documentId: job.documentId, jobId: job.id },
    );
    if (attempts >= MAX_HANDLER_ATTEMPTS) {
      _requeueAttempts.delete(job.id);
      try {
        await markJobFailed(
          job.id,
          job.userId,
          'dispatcher_retry_exhausted',
          `Handler failed after ${attempts} attempts: ${err instanceof Error ? err.message : String(err)}`,
        );
      } catch (failErr) {
        console.error(`[Dispatcher] markJobFailed after retry exhaustion failed for jobId="${job.id}":`, failErr);
      }
    } else {
      if (reaperOn) {
        // Persist the attempt count durably so a restart does not reset retry to 0 (the [A->B seam]).
        try {
          await setJobDispatchAttempts(job.id, job.userId, attempts);
        } catch (persistErr) {
          console.error(`[Dispatcher] setJobDispatchAttempts failed for jobId="${job.id}":`, persistErr);
        }
      } else {
        _requeueAttempts.set(job.id, attempts);
      }
      try {
        await requeueJob(job.id, job.userId);
      } catch (rqErr) {
        console.error(`[Dispatcher] requeueJob failed for jobId="${job.id}":`, rqErr);
      }
    }
  } finally {
    _inFlight.delete(job.id);
  }
}

/**
 * JOB-RECOVERY-1 (B-4): read the durable dispatch-attempt count persisted by the reaper path in the
 * job's input (input.roleMetadata.dispatchAttempts — an open bag that survives the Zod Wall). Returns
 * 0 when absent/non-numeric. This is the restart-durable replacement for the in-memory _requeueAttempts.
 */
function readDurableDispatchAttempts(job: DispatchableJob): number {
  const v = job.input.roleMetadata['dispatchAttempts'];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Register the default job handlers, gated on JOB_DISPATCHER_ENABLED. Idempotent (re-registering
 * a jobType overwrites). Called from startDispatcher(); exported for tests. When the flag is OFF
 * this registers NOTHING — the dispatcher stays a no-op and the inline path is byte-for-byte
 * unchanged. The reviewer_feedback handler runs the deferred continuation the async-reviewer path
 * registered (D-1/D-4); a job with no continuation (post-restart) is left 'queued' for Component B.
 */
export function registerDefaultJobHandlers(): void {
  if (!isJobDispatcherEnabled()) return;
  registerJobHandler('reviewer_feedback', async (jobId, _userId) => {
    if (!hasDeferredContinuation(jobId)) {
      _skipNoContinuation.add(jobId);
      return;
    }
    await runDeferredCanonicalJob(jobId);
  });
}

// ============================================================
// Orphan detection
// ============================================================

const ORPHAN_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes without heartbeat

// ============================================================
// JOB-RECOVERY-1 (B-2) — orphan reaper
// ============================================================

/** How often the reaper sweeps for orphaned 'running' jobs. Hardcoded sane default (NO env var) —
 *  60s recovers a wedge promptly and is cheap at single-user v1 scale. */
const REAPER_SWEEP_INTERVAL_MS = 60 * 1000;

/** Separate timer handle for the reaper sweep (independent of the poll loop; cleared by stopDispatcher). */
let _reaperTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * JOB-RECOVERY-1 (B-2): the orphan reaper. When JOB_REAPER_ENABLED is OFF this is a no-op (logs the
 * threshold for operator awareness — as the old stub did — then returns). When ON, it finds 'running'
 * jobs with a stale/missing heartbeat (orphaned by a crash/restart) and terminalizes each to
 * 'timed_out'. Fully wrapped so a transient DB error can never reject into the poll-failure counter /
 * fatal handler (header §4.2/§4.3): reaper failures are isolated.
 */
async function reapStaleJobs(): Promise<void> {
  if (!isJobReaperEnabled()) {
    console.log(
      `[Dispatcher] Orphan reaper disabled (JOB_REAPER_ENABLED off). Stale threshold: ${ORPHAN_THRESHOLD_MS}ms; ` +
        `orphaned 'running' jobs require operator intervention.`,
    );
    return;
  }
  const systemCtx = { userId: 'system', matterId: null, documentId: null, jobId: null };
  try {
    const staleBefore = new Date(Date.now() - ORPHAN_THRESHOLD_MS);
    const stale = await getStaleRunningJobs(staleBefore, systemCtx);
    for (const job of stale) {
      try {
        await markJobTimedOut(
          job.id,
          job.userId,
          `Reaped by JOB-RECOVERY-1: no heartbeat for >${ORPHAN_THRESHOLD_MS}ms (orphaned by crash/restart)`,
        );
        void emitTelemetry(
          'job_timed_out',
          { jobType: job.jobType, timeoutMs: ORPHAN_THRESHOLD_MS, elapsedMs: ORPHAN_THRESHOLD_MS },
          { userId: job.userId, matterId: job.matterId, documentId: job.documentId, jobId: job.id },
        );
      } catch (reapErr) {
        console.error(`[Reaper] failed to reap orphaned job ${job.id}:`, reapErr);
      }
    }
    if (stale.length > 0) {
      console.log(`[Reaper] terminalized ${stale.length} orphaned running job(s).`);
    }
  } catch (sweepErr) {
    // Reaper errors are isolated — they must NOT touch the poll-failure counter / fatal handler.
    console.error('[Reaper] sweep failed:', sweepErr);
  }
}

/** Schedule the recurring reaper sweep (separate from the poll loop; cleared by stopDispatcher). */
function scheduleReaperSweep(): void {
  if (!_isRunning) return;
  _reaperTimer = setTimeout(async () => {
    await reapStaleJobs();
    scheduleReaperSweep();
  }, REAPER_SWEEP_INTERVAL_MS);
}

// ============================================================
// REVIEWER-ASYNC-DISPLAY-1 (Component C, C-2) — lane deadline sweep
// ============================================================
// Component C OWNS a per-reviewer terminal-deadline (condition 4, defense-in-depth) — it does NOT
// delegate lane liveness to JOB-RECOVERY-1's job reaper. This sweep terminalizes any reviewer lane
// left non-terminal past its terminalDeadlineAt as 'orphaned_reaped'. Gated on REVIEWER_ASYNC_ENABLED
// (independent of JOB_REAPER_ENABLED); a no-op when the async display is OFF (sync stays byte-for-byte).
const LANE_REAPER_SWEEP_INTERVAL_MS = 60 * 1000;
let _laneReaperTimer: ReturnType<typeof setTimeout> | null = null;

async function reapStaleLanesSweep(): Promise<void> {
  if (!isReviewerAsyncEnabled()) return;
  const systemCtx = { userId: 'system', matterId: null, documentId: null, jobId: null };
  try {
    const reaped = await reapStaleLanes(new Date(), systemCtx);
    if (reaped > 0) {
      console.log(`[LaneReaper] terminalized ${reaped} lane(s) past their deadline (orphaned_reaped).`);
    }
  } catch (sweepErr) {
    // Isolated — a lane-sweep error must never touch the poll-failure counter / fatal handler.
    console.error('[LaneReaper] sweep failed:', sweepErr);
  }
}

/** Schedule the recurring lane deadline sweep (separate timer; cleared by stopDispatcher). */
function scheduleLaneReaperSweep(): void {
  if (!_isRunning) return;
  _laneReaperTimer = setTimeout(async () => {
    await reapStaleLanesSweep();
    scheduleLaneReaperSweep();
  }, LANE_REAPER_SWEEP_INTERVAL_MS);
}

// ============================================================
// Poll loop
// ============================================================

// CONFIG-VALIDATION-HARDENING-1: guard against a malformed interval becoming NaN. A NaN here would
// flow into jitteredInterval() -> setTimeout(NaN), which Node treats as 0 — a CPU-spinning poll loop.
// An invalid/non-positive value falls back to the documented 2000ms default.
const POLL_INTERVAL_MS = parseEnvInt(process.env['DISPATCHER_POLL_INTERVAL_MS'], 2000);

// Jitter: ±20% of poll interval to prevent thundering-herd
function jitteredInterval(): number {
  const jitter = POLL_INTERVAL_MS * 0.2;
  return POLL_INTERVAL_MS + (Math.random() * 2 - 1) * jitter;
}

// ============================================================
// S3 — DB resilience constants and state
// ============================================================

/** Maximum within-cycle retries on a transient DB error in the poll query path. */
const POLL_QUERY_MAX_RETRIES = 3;

/**
 * Exponential backoff delays (ms) for within-cycle retries.
 * Index 0 = delay before retry 1, index 1 = before retry 2, etc.
 */
const POLL_QUERY_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/**
 * Number of consecutive across-cycle transient poll failures (each representing
 * an exhausted within-cycle retry sequence) before the fatal handler is invoked.
 * Tunable via this named constant; do NOT introduce an env var without operator
 * authorization (Rule 11).
 */
const CONSECUTIVE_FAILURE_THRESHOLD = 5;

/** Tracks consecutive across-cycle transient poll failures. */
let _consecutiveTransientPollFailures = 0;

// ============================================================
// S3 — Fatal handler (test-injectable)
// ============================================================

/**
 * Default fatal handler: exits the process with code 1 so Railway's
 * ON_FAILURE restart policy can recover.
 *
 * TEST-ONLY: Use setDispatcherFatalHandlerForTest / resetDispatcherFatalHandlerForTest
 * to inject a stub. The injected handler is invoked in place of process.exit(1).
 * Always call resetDispatcherFatalHandlerForTest() in afterEach to prevent
 * cross-test pollution.
 */
let _fatalHandler: () => void = () => {
  process.exit(1);
};

/**
 * TEST-ONLY: Replace the fatal handler with a stub.
 * Must be paired with resetDispatcherFatalHandlerForTest() in afterEach.
 */
export function setDispatcherFatalHandlerForTest(fn: () => void): void {
  _fatalHandler = fn;
}

/**
 * TEST-ONLY: Reset the fatal handler to the default (process.exit(1)).
 * Call in afterEach to prevent cross-test pollution.
 */
export function resetDispatcherFatalHandlerForTest(): void {
  _fatalHandler = () => {
    process.exit(1);
  };
}

// ============================================================
// S3 — Consecutive failure counter reset (exported for tests)
// ============================================================

/**
 * TEST-ONLY: Reset the consecutive transient poll failure counter to 0.
 * Call in beforeEach/afterEach to prevent cross-test state pollution.
 */
export function resetConsecutiveFailureCounterForTest(): void {
  _consecutiveTransientPollFailures = 0;
}

/**
 * Read the current consecutive failure counter value.
 * Exported for test assertions.
 */
export function getConsecutiveFailureCount(): number {
  return _consecutiveTransientPollFailures;
}

// ============================================================
// S3 — Sleep helper for retry backoff
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// S3 — Poll query with within-cycle retry
// ============================================================

/**
 * Attempt getQueuedJobs() with within-cycle exponential backoff on transient errors.
 *
 * - On transient error: retry up to POLL_QUERY_MAX_RETRIES times.
 * - On non-transient error: rethrow immediately (no retry).
 * - If all retries are exhausted: throws the last error (caller increments counter).
 *
 * @returns The queued jobs array on success.
 * @throws  The last error if all retries are exhausted, or immediately on non-transient.
 */
async function pollQueryWithRetry(): Promise<Awaited<ReturnType<typeof getQueuedJobs>>> {
  const systemCtx = { userId: 'system', matterId: null, documentId: null, jobId: null };

  let lastErr: unknown;

  for (let attempt = 0; attempt <= POLL_QUERY_MAX_RETRIES; attempt++) {
    try {
      const result = await getQueuedJobs(systemCtx);
      return result;
    } catch (err) {
      if (!isTransientDbError(err)) {
        // Non-transient: surface immediately, no retry.
        throw err;
      }

      lastErr = err;

      if (attempt < POLL_QUERY_MAX_RETRIES) {
        const delayMs = POLL_QUERY_RETRY_DELAYS_MS[attempt] ?? 1000;
        const isConditional = isConditionallyRetriedCode(err);
        const logFn = isConditional ? console.warn : console.info;
        logFn(
          `[Dispatcher] Transient DB error on poll query (attempt ${attempt + 1}/${POLL_QUERY_MAX_RETRIES}), ` +
            `retrying in ${delayMs}ms:`,
          err,
        );
        await sleep(delayMs);
      }
    }
  }

  // All retries exhausted — throw to let pollOnce() increment the counter.
  throw lastErr;
}

// ============================================================
// Poll loop — pollOnce
// ============================================================

async function pollOnce(): Promise<void> {
  let queuedJobs: Awaited<ReturnType<typeof getQueuedJobs>>;

  try {
    queuedJobs = await pollQueryWithRetry();
  } catch (err) {
    if (isTransientDbError(err)) {
      // Within-cycle retries exhausted on a transient error.
      _consecutiveTransientPollFailures += 1;
      console.warn(
        `[Dispatcher] Poll query failed after ${POLL_QUERY_MAX_RETRIES} retries ` +
          `(consecutive transient failures: ${_consecutiveTransientPollFailures}/${CONSECUTIVE_FAILURE_THRESHOLD}):`,
        err,
      );

      if (_consecutiveTransientPollFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
        console.error(
          `[Dispatcher] Consecutive transient poll failure threshold reached ` +
            `(${CONSECUTIVE_FAILURE_THRESHOLD}). Invoking fatal handler.`,
          err,
        );
        _fatalHandler();
      }
    } else {
      // Non-transient error: log once, do NOT increment counter, do NOT invoke fatal handler.
      // Continue polling — schema/programmer errors should surface for CI/test detection.
      console.error('[Dispatcher] Non-transient poll error (no retry, counter not incremented):', err);
    }
    return;
  }

  // Successful poll — reset the consecutive failure counter.
  _consecutiveTransientPollFailures = 0;

  for (const job of queuedJobs) {
    // DISPATCHER-COMPLETE-1: skip jobs already in flight (D-2 belt to the markJobRunning claim)
    // or left for recovery (no in-memory continuation after a restart — Component B reaps them).
    if (_skipNoContinuation.has(job.id)) continue;
    if (_inFlight.has(job.id)) continue;
    const handler = _handlers.get(job.jobType);
    if (!handler) {
      // Unknown job type — log and skip (Ch 8.3: context_summary_generation is reserved)
      console.warn(
        `[Dispatcher] No handler registered for jobType="${job.jobType}" (jobId=${job.id}). Skipping.`,
      );
      continue;
    }

    // Dispatch with completion tracking + bounded retry (D-3) — NOT awaited, so the poll loop
    // continues and multiple jobs run concurrently. Handler-level failures do NOT count as poll
    // failures and do NOT increment the consecutive-failure counter (§4.2, §4.3).
    _inFlight.add(job.id);
    const dispatch = dispatchTracked(job, handler);
    _inFlightPromises.add(dispatch);
    void dispatch.finally(() => _inFlightPromises.delete(dispatch));
  }
}

function schedulePoll(): void {
  if (!_isRunning) return;
  _pollTimer = setTimeout(async () => {
    await pollOnce();
    schedulePoll();
  }, jitteredInterval());
}

// ============================================================
// Public API
// ============================================================

/**
 * Start the dispatcher. Called once from server/index.ts.
 * Idempotent — calling start() when already running is a no-op.
 */
export async function startDispatcher(): Promise<void> {
  if (_isRunning) return;
  _isRunning = true;
  // DISPATCHER-COMPLETE-1: flag-gated handler registration. No-op when JOB_DISPATCHER_ENABLED
  // is OFF, so the dispatcher stays a no-op and the inline path is unchanged.
  registerDefaultJobHandlers();
  // JOB-RECOVERY-1 (B-2): startup sweep + schedule the periodic reaper. Both no-op when
  // JOB_REAPER_ENABLED is OFF (reapStaleJobs returns early; the timer is only armed when ON), so
  // flag-OFF startup is unchanged.
  await reapStaleJobs();
  if (isJobReaperEnabled()) {
    scheduleReaperSweep();
  }
  // REVIEWER-ASYNC-DISPLAY-1 (C-2): Component C's own lane deadline sweep — startup pass + periodic
  // timer, gated on REVIEWER_ASYNC_ENABLED (no-op when OFF, so sync startup is unchanged).
  await reapStaleLanesSweep();
  if (isReviewerAsyncEnabled()) {
    scheduleLaneReaperSweep();
  }
  console.log(
    `[Dispatcher] Started. Poll interval: ~${POLL_INTERVAL_MS}ms (±20% jitter).`,
  );
  schedulePoll();
}

/**
 * Stop the dispatcher. Used in tests and graceful shutdown.
 */
export function stopDispatcher(): void {
  _isRunning = false;
  if (_pollTimer !== null) {
    clearTimeout(_pollTimer);
    _pollTimer = null;
  }
  // JOB-RECOVERY-1 (B-2): clear the reaper timer too, or it leaks across tests / graceful shutdown.
  if (_reaperTimer !== null) {
    clearTimeout(_reaperTimer);
    _reaperTimer = null;
  }
  // REVIEWER-ASYNC-DISPLAY-1 (C-2): clear the lane deadline sweep timer too.
  if (_laneReaperTimer !== null) {
    clearTimeout(_laneReaperTimer);
    _laneReaperTimer = null;
  }
}

/**
 * Check if the dispatcher is running.
 */
export function isDispatcherRunning(): boolean {
  return _isRunning;
}

/**
 * TEST-ONLY: Run one poll cycle directly (bypasses the setTimeout schedule).
 * Allows unit tests to drive the poll loop without starting the full dispatcher.
 * Do NOT call in production code.
 */
export async function runPollOnceForTest(): Promise<void> {
  return pollOnce();
}

/**
 * TEST-ONLY: run one reaper sweep directly (bypasses the REAPER_SWEEP_INTERVAL_MS timer).
 * JOB-RECOVERY-1 (B-2). Gated internally by JOB_REAPER_ENABLED (no-op when OFF).
 */
export async function runReaperOnceForTest(): Promise<void> {
  return reapStaleJobs();
}

/**
 * TEST-ONLY: run one lane deadline sweep directly (bypasses the LANE_REAPER_SWEEP_INTERVAL_MS timer).
 * REVIEWER-ASYNC-DISPLAY-1 (C-2). Gated internally by REVIEWER_ASYNC_ENABLED (no-op when OFF).
 */
export async function runLaneReaperOnceForTest(): Promise<void> {
  return reapStaleLanesSweep();
}

// ============================================================
// DISPATCHER-COMPLETE-1 — test seams
// ============================================================

/** TEST-ONLY: is a handler registered for this jobType? */
export function hasHandlerForTest(jobType: string): boolean {
  return _handlers.has(jobType);
}

/** TEST-ONLY: clear all registered handlers (prevents cross-test pollution). */
export function clearHandlersForTest(): void {
  _handlers.clear();
}

/** TEST-ONLY: reset the in-flight / retry / skip state. Call in afterEach. */
export function resetDispatcherJobStateForTest(): void {
  _inFlight.clear();
  _requeueAttempts.clear();
  _skipNoContinuation.clear();
}

/** TEST-ONLY: await all in-flight dispatches (pollOnce does not await them). */
export async function settleDispatchesForTest(): Promise<void> {
  await Promise.allSettled([..._inFlightPromises]);
}
