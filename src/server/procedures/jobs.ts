/**
 * Job tRPC Procedures (Ch 21.10)
 *
 * Exposes job query and cancellation procedures to the client.
 *
 * Procedures:
 *   job.getById         — fetch a job with full details
 *   job.listForDocument — list jobs for a document
 *   job.listForMatter   — list jobs for a matter
 *   job.poll            — efficient poll for jobs matching filter criteria
 *   job.cancel          — attorney-initiated cancellation (Ch 21.10)
 *
 * All procedures:
 *   - Require authentication (protectedProcedure)
 *   - Draw userId from ctx.userId (Ch 35.2 — never from input)
 *   - Validate inputs with Zod
 *   - Return PublicJob shapes (not raw DB rows)
 *
 * job.cancel side effects (Ch 21.10):
 *   1. If status was 'running': fires the AbortController for the job's LLM call.
 *      The LLM fetch rejects, the canonical mutation helper catches the abort,
 *      and enters the Transaction 2 revert pathway with status='cancelled'.
 *   2. If status was 'queued': transitions directly to 'cancelled' and reverts
 *      any enqueue-side document state.
 *   3. Emits job_cancelled telemetry (Ch 25.4).
 *   4. Returns the cancelled job.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import {
  getPublicJobById,
  listJobsForDocument,
  listJobsForMatter,
  pollJobs,
  markJobCancelled,
  getJobById,
} from '../db/queries/jobs.js';
import { getAbortController } from '../db/canonicalMutation.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';

export const jobRouter = router({
  // ──────────────────────────────────────────────────────────
  // job.getById
  // ──────────────────────────────────────────────────────────
  getById: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const job = await getPublicJobById(input.jobId, ctx.userId);
      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'NOT_FOUND' });
      }
      return { job };
    }),

  // ──────────────────────────────────────────────────────────
  // job.listForDocument
  // ──────────────────────────────────────────────────────────
  listForDocument: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const jobs = await listJobsForDocument(input.documentId, ctx.userId);
      return { jobs };
    }),

  // ──────────────────────────────────────────────────────────
  // job.listForMatter
  // ──────────────────────────────────────────────────────────
  listForMatter: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const jobs = await listJobsForMatter(input.matterId, ctx.userId);
      return { jobs };
    }),

  // ──────────────────────────────────────────────────────────
  // job.poll
  // ──────────────────────────────────────────────────────────
  poll: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid().optional(),
        matterId: z.string().uuid().optional(),
        statuses: z
          .array(
            z.enum([
              'queued',
              'running',
              'completed',
              'failed',
              'timed_out',
              'cancelled',
            ]),
          )
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Build filter without undefined values (exactOptionalPropertyTypes)
      const filter: {
        documentId?: string;
        matterId?: string;
        statuses?: Array<'queued' | 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled'>;
      } = {};
      if (input.documentId !== undefined) filter.documentId = input.documentId;
      if (input.matterId !== undefined) filter.matterId = input.matterId;
      if (input.statuses !== undefined) filter.statuses = input.statuses;
      const jobs = await pollJobs(ctx.userId, filter);
      return { jobs };
    }),

  // ──────────────────────────────────────────────────────────
  // job.cancel
  // ──────────────────────────────────────────────────────────
  cancel: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch the full job row to check status and get context
      const job = await getJobById(input.jobId, ctx.userId);

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'NOT_FOUND' });
      }

      // Only queued or running jobs can be cancelled (Ch 21.10)
      if (
        job.status === 'completed' ||
        job.status === 'failed' ||
        job.status === 'timed_out' ||
        job.status === 'cancelled'
      ) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'JOB_NOT_CANCELLABLE',
        });
      }

      const startTime = job.startedAt ? Date.now() - job.startedAt.getTime() : 0;

      if (job.status === 'running') {
        // Fire the AbortController for the running LLM call (Ch 21.10)
        // The canonical mutation helper will catch the AbortError and
        // execute the Transaction 2 revert pathway with status='cancelled'.
        const controller = getAbortController(input.jobId);
        if (controller) {
          controller.abort();
          // The revert and status update happen asynchronously in the
          // canonical mutation helper. We return immediately after firing
          // the abort signal; the client polls for the final status.
        } else {
          // No abort controller found — job may have just completed.
          // Mark as cancelled directly if still in running state.
          const rowsAffected = await markJobCancelled(input.jobId, ctx.userId);
          if (rowsAffected === 0) {
            // Job transitioned to a terminal state between our check and now
            const updatedJob = await getPublicJobById(input.jobId, ctx.userId);
            if (!updatedJob) {
              throw new TRPCError({ code: 'NOT_FOUND', message: 'NOT_FOUND' });
            }
            return { job: updatedJob };
          }
        }
      } else {
        // status === 'queued': cancel directly, no LLM call to abort
        const rowsAffected = await markJobCancelled(input.jobId, ctx.userId);
        if (rowsAffected === 0) {
          // Job transitioned between our check and the update
          const updatedJob = await getPublicJobById(input.jobId, ctx.userId);
          if (!updatedJob) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'NOT_FOUND' });
          }
          return { job: updatedJob };
        }
      }

      // Emit job_cancelled telemetry (Ch 25.4)
      // cancelOrigin: 'attorney' — this is the only cancel path in v1
      void emitTelemetry(
        'job_cancelled',
        {
          jobType: job.jobType,
          elapsedMs: startTime,
          cancelOrigin: 'attorney',
        },
        {
          userId: ctx.userId,
          matterId: job.matterId,
          documentId: job.documentId,
          jobId: job.id,
        },
      );

      const updatedJob = await getPublicJobById(input.jobId, ctx.userId);
      if (!updatedJob) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'NOT_FOUND' });
      }

      return { job: updatedJob };
    }),
});
