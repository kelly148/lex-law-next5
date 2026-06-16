/**
 * Jobs table query wrapper — Zod Wall (Ch 35.1, Ch 4.6)
 *
 * This module is the SOLE read path for the jobs table.
 * Every row returned by Drizzle is parsed through JobRowSchema before
 * any application code touches the value.
 *
 * Pattern (same as server/db/queries/users.ts):
 *   1. Execute the Drizzle query.
 *   2. For each row, call parseJobRow() which calls JobRowSchema.parse().
 *   3. On ZodError: emit zod_parse_failed telemetry and rethrow.
 *   4. Return the parsed, type-safe result.
 *
 * Raw Drizzle results are NEVER returned directly to callers.
 *
 * WRITE PATH:
 *   Inserts and updates are also in this module to keep all jobs table
 *   access in one place. Writes do not go through the Zod Wall (they
 *   construct the row from typed inputs), but they do validate inputs
 *   using Zod schemas before writing.
 */

import { eq, and, desc, inArray, lt, or, isNull } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import { jobs, type NewJob } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { JobRowSchema, PublicJobSchema, type JobRow, type PublicJob } from '../../../shared/schemas/jobs.js';
import { emitTelemetry, type TelemetryContext } from '../../telemetry/emitTelemetry.js';

// ============================================================
// Internal Zod Wall parse helper
// ============================================================

function parseJobRow(
  raw: unknown,
  ctx: { userId: string; jobId?: string },
): JobRow {
  try {
    return JobRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      // Emit zod_parse_failed telemetry (Ch 25.9)
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'JobRowSchema',
          tableName: 'jobs',
          errorPath: err.errors[0]?.path.join('.') ?? 'unknown',
          errorMessage: err.errors[0]?.message ?? 'unknown',
        },
        {
          userId: ctx.userId,
          jobId: ctx.jobId ?? null,
          matterId: null,
          documentId: null,
        },
      );
    }
    throw err;
  }
}

// ============================================================
// Read queries
// ============================================================

/**
 * Fetch a job by ID. Returns null if not found.
 * Validates ownership (job.userId === userId).
 */
export async function getJobById(
  jobId: string,
  userId: string,
): Promise<JobRow | null> {
  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1);

  if (rows.length === 0) return null;
  return parseJobRow(rows[0], { userId, jobId });
}

/**
 * Fetch the public (client-safe) shape of a job by ID.
 */
export async function getPublicJobById(
  jobId: string,
  userId: string,
): Promise<PublicJob | null> {
  const row = await getJobById(jobId, userId);
  if (!row) return null;
  return PublicJobSchema.parse(row);
}

/**
 * List jobs for a document, ordered by most recent first.
 */
export async function listJobsForDocument(
  documentId: string,
  userId: string,
): Promise<PublicJob[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.documentId, documentId), eq(jobs.userId, userId)))
    .orderBy(desc(jobs.createdAt));

  return rows.map((row) => {
    const parsed = parseJobRow(row, { userId, jobId: row.id });
    return PublicJobSchema.parse(parsed);
  });
}

/**
 * List jobs for a matter, ordered by most recent first.
 */
export async function listJobsForMatter(
  matterId: string,
  userId: string,
): Promise<PublicJob[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.matterId, matterId), eq(jobs.userId, userId)))
    .orderBy(desc(jobs.createdAt));

  return rows.map((row) => {
    const parsed = parseJobRow(row, { userId, jobId: row.id });
    return PublicJobSchema.parse(parsed);
  });
}

/**
 * Poll for jobs matching a filter. Used by the UI to update status displays.
 * Returns only public job shapes.
 */
export async function pollJobs(
  userId: string,
  filter: {
    documentId?: string;
    matterId?: string;
    statuses?: Array<'queued' | 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled'>;
  },
): Promise<PublicJob[]> {
  const conditions = [eq(jobs.userId, userId)];

  if (filter.documentId) {
    conditions.push(eq(jobs.documentId, filter.documentId));
  }
  if (filter.matterId) {
    conditions.push(eq(jobs.matterId, filter.matterId));
  }
  if (filter.statuses && filter.statuses.length > 0) {
    conditions.push(inArray(jobs.status, filter.statuses));
  }

  const rows = await db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .orderBy(desc(jobs.updatedAt));

  return rows.map((row) => {
    const parsed = parseJobRow(row, { userId, jobId: row.id });
    return PublicJobSchema.parse(parsed);
  });
}

// ============================================================
// Write operations
// ============================================================

/**
 * Insert a new job row. Returns the created job's ID.
 * Used by the canonical mutation pattern helper (Transaction 1).
 */
export async function insertJob(
  newJob: NewJob,
  // EGRESS-CONTROL-PLANE-1 Inc 2 (durable outbox): pass a Drizzle `tx` to enlist the job insert in the
  // SAME transaction as the session + lanes, so session(active) + lanes + ALL reviewer jobs(queued)
  // commit ATOMICALLY (a pre-queue throw rolls everything back -> the active-with-zero-jobs wedge is
  // unreachable). Defaults to the pooled `db` (byte-for-byte unchanged for every existing caller).
  executor: Pick<typeof db, 'insert'> = db,
): Promise<string> {
  await executor.insert(jobs).values(newJob);
  return newJob.id;
}

/**
 * Update job status to 'running' and set startedAt + lastHeartbeatAt.
 * Used by the dispatcher when picking up a queued job.
 * Returns the number of rows affected (0 = job already moved to another state).
 */
export async function markJobRunning(
  jobId: string,
  userId: string,
): Promise<number> {
  const now = new Date();
  // EGRESS-CONTROL-PLANE-1 Inc 2 (idempotency / no-double-transmit): the atomic claim must be a TRUE
  // single-winner. Return the conditional UPDATE's OWN affectedRows — the rows THIS statement actually
  // transitioned queued->running — NOT a post-hoc `SELECT ... WHERE status='running'`. The old SELECT
  // returned 1 to EVERY concurrent caller once ANY of them flipped the row, so two runners (e.g. a
  // background kick AND the durable dispatcher poll claiming the same committed reviewer job) would BOTH
  // pass the rowsAffected===0 guard in runJob and BOTH call adapter.generate -> a double transmit of
  // confidential reviewer content. affectedRows is single-winner regardless of the CLIENT_FOUND_ROWS flag:
  // the loser's WHERE (status='queued') matches zero rows once the winner has flipped it, so it gets 0.
  const res = await db
    .update(jobs)
    .set({
      status: 'running',
      startedAt: now,
      lastHeartbeatAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.userId, userId),
        eq(jobs.status, 'queued'), // conditional UPDATE (Ch 23.2) — the single-winner claim
      ),
    );
  const header = res[0] as { affectedRows?: number } | undefined;
  return header?.affectedRows ?? 0;
}

/**
 * Update the heartbeat timestamp for a running job.
 * Step-based per Ch 8.5.
 */
export async function updateJobHeartbeat(
  jobId: string,
  userId: string,
): Promise<void> {
  await db
    .update(jobs)
    .set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.userId, userId),
        eq(jobs.status, 'running'),
      ),
    );
}

/**
 * Mark a job as completed with output and token counts.
 * Used by the canonical mutation pattern helper (Transaction 2 — success path).
 * Returns rows affected (0 = CONFLICT).
 */
export async function markJobCompleted(
  jobId: string,
  userId: string,
  output: unknown,
  tokensPrompt: number,
  tokensCompletion: number,
  // REVIEWER-LATENCY-1 Step 0: provider-reported reasoning/thinking tokens, written AS-REPORTED.
  // null when the provider/model does not report it (Anthropic always; others when absent). The
  // value already exists in LlmGenerateResult.tokensReasoning — this persists it; it is NOT
  // obtained by any new request to the provider (persistence-only increment).
  //   OpenAI  : reasoning_tokens — a SUBSET of tokensCompletion.
  //   Gemini  : thoughtsTokenCount — SEPARATE from tokensCompletion.
  //   xAI     : best-effort reasoning_tokens as captured.
  //   Anthropic: not captured -> null.
  tokensReasoning: number | null = null,
): Promise<number> {
  const now = new Date();
  await db
    .update(jobs)
    .set({
      status: 'completed',
      completedAt: now,
      lastHeartbeatAt: now,
      output: output as Record<string, unknown>,
      tokensPrompt,
      tokensCompletion,
      tokensReasoning,
      // EGRESS-CONTROL-PLANE-1 Inc 2: clear the durable-outbox reconstruction payload (prompt text) on
      // terminal — input is consumed BEFORE this write, and must not linger as a second copy of client
      // content (decision #1). input is .notNull(), so reset to {} (never SQL NULL).
      input: {} as Record<string, unknown>,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.userId, userId),
        eq(jobs.status, 'running'), // conditional UPDATE (Ch 23.2)
      ),
    );
  // MySQL does not support .returning(); verify the update took effect with a SELECT.
  const check = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'completed')))
    .limit(1);
  return check.length;
}

/**
 * Mark a job as failed with error details.
 * Used by the canonical mutation pattern helper (Transaction 2 — failure path).
 */
export async function markJobFailed(
  jobId: string,
  userId: string,
  errorClass: string,
  errorMessage: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(jobs)
    .set({
      status: 'failed',
      completedAt: now,
      lastHeartbeatAt: now,
      errorClass,
      errorMessage,
      // EGRESS-CONTROL-PLANE-1 Inc 2: clear the durable-outbox reconstruction payload on terminal (no
      // lingering copy of client content). input is .notNull(), so reset to {} (never SQL NULL).
      input: {} as Record<string, unknown>,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.userId, userId),
        inArray(jobs.status, ['running', 'queued']),
      ),
    );
}

/**
 * Mark a job as timed_out.
 * Used by the dispatcher when AbortSignal fires (Ch 8.6).
 */
export async function markJobTimedOut(
  jobId: string,
  userId: string,
  errorMessage: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(jobs)
    .set({
      status: 'timed_out',
      completedAt: now,
      lastHeartbeatAt: now,
      errorClass: 'timeout',
      errorMessage,
      // EGRESS-CONTROL-PLANE-1 Inc 2: clear the durable-outbox reconstruction payload on terminal.
      input: {} as Record<string, unknown>,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.userId, userId),
        eq(jobs.status, 'running'),
      ),
    );
}

/**
 * Mark a job as cancelled.
 * Used by job.cancel procedure (Ch 21.10).
 * Works for both queued and running jobs.
 */
export async function markJobCancelled(
  jobId: string,
  userId: string,
): Promise<number> {
  const now = new Date();
  await db
    .update(jobs)
    .set({
      status: 'cancelled',
      completedAt: now,
      lastHeartbeatAt: now,
      errorClass: 'other',
      errorMessage: 'Cancelled by attorney',
      // EGRESS-CONTROL-PLANE-1 Inc 2: clear the durable-outbox reconstruction payload on terminal.
      input: {} as Record<string, unknown>,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.userId, userId),
        inArray(jobs.status, ['queued', 'running']),
      ),
    );
  // MySQL does not support .returning(); verify the update took effect with a SELECT.
  const check = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'cancelled')))
    .limit(1);
  return check.length;
}

/**
 * Fetch all jobs currently in 'queued' status for the dispatcher.
 * Used by the in-process dispatcher poll loop.
 * Returns full JobRow (not PublicJob) for dispatcher use.
 */
export async function getQueuedJobs(ctx: TelemetryContext): Promise<JobRow[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, 'queued'))
    .orderBy(jobs.queuedAt);

  return rows.map((row) =>
    parseJobRow(row, { userId: ctx.userId ?? row.userId, jobId: row.id }),
  );
}

/**
 * DISPATCHER-COMPLETE-1 (D-3): re-queue a job (running|queued -> queued) so the dispatcher
 * picks it up again on a later poll, used on a bounded handler retry. Conditional UPDATE so a
 * job already in a terminal state (completed/failed/timed_out/cancelled) is NOT resurrected.
 * Reuses the existing status enum value 'queued' — no migration. Returns rows affected
 * (1 = re-queued; 0 = already terminal / not this user's job).
 */
export async function requeueJob(
  jobId: string,
  userId: string,
): Promise<number> {
  const now = new Date();
  await db
    .update(jobs)
    .set({ status: 'queued', updatedAt: now })
    .where(
      and(
        eq(jobs.id, jobId),
        ownerScope(jobs.userId, userId), // FOLD-AUTH-1 owner chokepoint (not an inline filter — ratchet)
        inArray(jobs.status, ['running', 'queued']), // conditional UPDATE (Ch 23.2)
      ),
    );
  // MySQL does not support .returning(); verify the update took effect with a SELECT.
  const check = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued')))
    .limit(1);
  return check.length;
}

/**
 * JOB-RECOVERY-1 (B-2): fetch 'running' jobs whose heartbeat is stale (older than `staleBefore`)
 * or missing — orphans left in 'running' by a crash/restart mid-job. SYSTEM-WIDE read with NO owner
 * filter (same shape as getQueuedJobs, which the FOLD-AUTH-1 ratchet exempts); each returned row
 * carries its own userId so the caller's terminal write stays owner-correct. Returns full JobRow[].
 */
export async function getStaleRunningJobs(
  staleBefore: Date,
  ctx: TelemetryContext,
): Promise<JobRow[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, 'running'),
        // A running job normally has lastHeartbeatAt set by markJobRunning; reap both a stale
        // heartbeat and the (anomalous) null-heartbeat running job.
        or(lt(jobs.lastHeartbeatAt, staleBefore), isNull(jobs.lastHeartbeatAt)),
      ),
    )
    .orderBy(jobs.lastHeartbeatAt);

  return rows.map((row) =>
    parseJobRow(row, { userId: ctx.userId ?? row.userId, jobId: row.id }),
  );
}

/**
 * JOB-RECOVERY-1 (B-4): persist the dispatcher's bounded-retry attempt count durably in the job's
 * input at `input.roleMetadata.dispatchAttempts` — an OPEN bag that survives the Zod Wall (a
 * top-level key would be stripped by the non-strict JobInputSchema). Read-modify-write, owner-scoped,
 * conditional on a non-terminal status so a completed/failed job is never resurrected. Makes
 * Component A's in-memory retry counter restart-durable (the [A->B seam]).
 */
export async function setJobDispatchAttempts(
  jobId: string,
  userId: string,
  attempts: number,
): Promise<void> {
  const row = await getJobById(jobId, userId);
  if (!row) return;
  const nextInput = {
    ...row.input,
    roleMetadata: { ...row.input.roleMetadata, dispatchAttempts: attempts },
  };
  await db
    .update(jobs)
    .set({ input: nextInput, updatedAt: new Date() })
    .where(
      and(
        eq(jobs.id, jobId),
        ownerScope(jobs.userId, userId), // FOLD-AUTH-1 owner chokepoint (not an inline filter — ratchet)
        inArray(jobs.status, ['running', 'queued']),
      ),
    );
}
