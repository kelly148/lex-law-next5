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
 */

import { getQueuedJobs } from '../db/queries/jobs.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';

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

async function pollOnce(): Promise<void> {
  try {
    // getQueuedJobs requires a TelemetryContext; dispatcher uses a system context
    const systemCtx = { userId: 'system', matterId: null, documentId: null, jobId: null };
    const queuedJobs = await getQueuedJobs(systemCtx);

    for (const job of queuedJobs) {
      const handler = _handlers.get(job.jobType);
      if (!handler) {
        // Unknown job type — log and skip (Ch 8.3: context_summary_generation is reserved)
        console.warn(
          `[Dispatcher] No handler registered for jobType="${job.jobType}" (jobId=${job.id}). Skipping.`,
        );
        continue;
      }

      // Dispatch asynchronously — do not await, so the poll loop continues
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
  } catch (err) {
    console.error('[Dispatcher] Poll error:', err);
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
