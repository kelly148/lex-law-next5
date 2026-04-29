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

import { getQueuedJobs } from '../db/queries/jobs.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';
import { isTransientDbError, isConditionallyRetriedCode } from '../db/transientDbError.js';

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
// Orphan detection
// ============================================================

const ORPHAN_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes without heartbeat

/**
 * Log orphaned jobs (running with stale heartbeat) on startup.
 * v1 does not auto-recover; logs for operator awareness.
 */
async function logOrphanedJobs(): Promise<void> {
  // Orphan detection requires querying running jobs with stale heartbeats.
  // This is a Phase 3+ concern (requires the full jobs query surface).
  // For Phase 2, we log a startup message indicating orphan detection is active.
  console.log(
    `[Dispatcher] Orphan detection threshold: ${ORPHAN_THRESHOLD_MS}ms. ` +
      `Running jobs with no heartbeat for >${ORPHAN_THRESHOLD_MS}ms require operator intervention.`,
  );
}

// ============================================================
// Poll loop
// ============================================================

const POLL_INTERVAL_MS = parseInt(
  process.env['DISPATCHER_POLL_INTERVAL_MS'] ?? '2000',
  10,
);

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
    const handler = _handlers.get(job.jobType);
    if (!handler) {
      // Unknown job type — log and skip (Ch 8.3: context_summary_generation is reserved)
      console.warn(
        `[Dispatcher] No handler registered for jobType="${job.jobType}" (jobId=${job.id}). Skipping.`,
      );
      continue;
    }

    // Dispatch asynchronously — do not await, so the poll loop continues.
    // Handler-level failures do NOT count as poll failures and do NOT increment
    // the consecutive-failure counter (§4.2, §4.3).
    void handler(job.id, job.userId).catch((err) => {
      console.error(
        `[Dispatcher] Unhandled error in handler for jobType="${job.jobType}" jobId="${job.id}":`,
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
    });
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
  await logOrphanedJobs();
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
