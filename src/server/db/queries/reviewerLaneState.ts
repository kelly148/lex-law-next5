/**
 * reviewer_lanes query wrapper — Zod Wall (REVIEWER-ASYNC-DISPLAY-1, Gate 0 Component C).
 *
 * SOLE read/write path for the reviewer_lanes table. Every row returned is parsed through
 * ReviewerLaneRowSchema before any caller touches it (mirrors postureProvenance.ts / jobs.ts).
 *
 * Semantics:
 *  - The expected lane set is inserted ONCE at iteration creation (insertReviewerLanes), before
 *    dispatch (condition 2). status='pending'.
 *  - Job completion (txn2Commit/txn2Revert) calls markReviewerLaneTerminal UNCONDITIONALLY — the
 *    latest terminal wins per reviewer (condition 1, even for a late retry that supersedes an earlier
 *    orphaned_reaped). One row per (reviewSessionId, reviewerRole) → idempotent (condition 3).
 *  - The deadline sweep (reapStaleLanes) only reaps NON-terminal lanes, so it never clobbers a real
 *    terminal — Component C's own per-lane deadline (condition 4, defense-in-depth, not delegated to B).
 *  - Owner-scoped via ownerScope (FOLD-AUTH-1 chokepoint); the sweep is a system read + per-row
 *    owner-correct write (same shape as getStaleRunningJobs).
 */
import { v4 as uuidv4 } from 'uuid';
import { eq, and, asc, lt, inArray } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import { reviewerLanes, type NewReviewerLane } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { emitTelemetry, type TelemetryContext } from '../../telemetry/emitTelemetry.js';
import {
  ReviewerLaneRowSchema,
  type ReviewerLaneRow,
  type ReviewerLaneStatus,
} from '../../../shared/schemas/reviewerLaneState.js';

const NON_TERMINAL_LANE_STATUSES: ReviewerLaneStatus[] = ['pending', 'dispatched', 'running'];

function parseRow(raw: unknown, ctx: { userId: string }): ReviewerLaneRow {
  try {
    return ReviewerLaneRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'ReviewerLaneRowSchema',
          tableName: 'reviewer_lanes',
          errorPath: err.errors[0]?.path.join('.') ?? 'unknown',
          errorMessage: err.errors[0]?.message ?? 'unknown',
        },
        { userId: ctx.userId, jobId: null, matterId: null, documentId: null },
      );
    }
    throw err;
  }
}

// ── Writes ──

/**
 * Insert the EXPECTED lane set for an iteration (condition 2) — one row per reviewerRole, status
 * 'pending', BEFORE dispatch. Caller supplies the immutable expected set (selectedReviewers).
 */
export async function insertReviewerLanes(
  lanes: Array<{
    userId: string;
    matterId: string;
    documentId: string;
    versionId: string;
    reviewSessionId: string;
    iterationNumber: number;
    reviewerRole: string;
    reviewerTitle: string;
    terminalDeadlineAt: Date;
  }>,
): Promise<void> {
  if (lanes.length === 0) return;
  const rows: NewReviewerLane[] = lanes.map((l) => ({
    id: uuidv4(),
    userId: l.userId,
    matterId: l.matterId,
    documentId: l.documentId,
    versionId: l.versionId,
    reviewSessionId: l.reviewSessionId,
    iterationNumber: l.iterationNumber,
    reviewerRole: l.reviewerRole,
    reviewerTitle: l.reviewerTitle,
    jobId: null,
    status: 'pending',
    suggestionCount: null,
    feedbackRowId: null,
    failureReason: null,
    terminalDeadlineAt: l.terminalDeadlineAt,
    terminalizedAt: null,
  }));
  await db.insert(reviewerLanes).values(rows);
}

/**
 * Terminalize a lane from job completion/recovery (condition 3 — NOT from reviewSession.get).
 * UNCONDITIONAL on the unique (session, reviewer) row so the LATEST terminal wins (condition 1).
 */
export async function markReviewerLaneTerminal(
  reviewSessionId: string,
  reviewerRole: string,
  userId: string,
  fields: {
    status: ReviewerLaneStatus;
    suggestionCount?: number | null;
    feedbackRowId?: string | null;
    failureReason?: string | null;
  },
): Promise<void> {
  const now = new Date();
  await db
    .update(reviewerLanes)
    .set({
      status: fields.status,
      suggestionCount: fields.suggestionCount ?? null,
      feedbackRowId: fields.feedbackRowId ?? null,
      failureReason: fields.failureReason ?? null,
      terminalizedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(reviewerLanes.reviewSessionId, reviewSessionId),
        eq(reviewerLanes.reviewerRole, reviewerRole),
        ownerScope(reviewerLanes.userId, userId),
      ),
    );
}

/** The enqueue itself failed (no job ever ran) → terminal 'dispatch_failed' (only if not already terminal). */
export async function markReviewerLaneDispatchFailed(
  reviewSessionId: string,
  reviewerRole: string,
  userId: string,
  failureReason: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(reviewerLanes)
    .set({ status: 'dispatch_failed', failureReason, terminalizedAt: now, updatedAt: now })
    .where(
      and(
        eq(reviewerLanes.reviewSessionId, reviewSessionId),
        eq(reviewerLanes.reviewerRole, reviewerRole),
        ownerScope(reviewerLanes.userId, userId),
        inArray(reviewerLanes.status, NON_TERMINAL_LANE_STATUSES),
      ),
    );
}

/**
 * Component-C deadline sweep (condition 4): terminalize non-terminal lanes whose terminalDeadlineAt
 * has passed -> 'orphaned_reaped'. SYSTEM-wide read (no owner filter — like getStaleRunningJobs);
 * each terminal write is owner-correct via the row's own userId. Never clobbers a terminal lane.
 * Returns the number of lanes reaped.
 */
export async function reapStaleLanes(staleBefore: Date, ctx: TelemetryContext): Promise<number> {
  const rows = await db
    .select()
    .from(reviewerLanes)
    .where(
      and(
        inArray(reviewerLanes.status, NON_TERMINAL_LANE_STATUSES),
        lt(reviewerLanes.terminalDeadlineAt, staleBefore),
      ),
    );
  const parsed = rows.map((r) => parseRow(r, { userId: ctx.userId ?? 'system' }));
  let reaped = 0;
  for (const lane of parsed) {
    const now = new Date();
    await db
      .update(reviewerLanes)
      .set({
        status: 'orphaned_reaped',
        failureReason: 'Lane terminal-deadline exceeded (orphaned by crash/restart)',
        terminalizedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(reviewerLanes.id, lane.id),
          ownerScope(reviewerLanes.userId, lane.userId),
          inArray(reviewerLanes.status, NON_TERMINAL_LANE_STATUSES),
        ),
      );
    reaped += 1;
  }
  return reaped;
}

// ── Reads (Zod Wall) ──

/** All lanes for a session, owner-scoped, ordered by reviewerRole. */
export async function listReviewerLanesForSession(
  reviewSessionId: string,
  userId: string,
): Promise<ReviewerLaneRow[]> {
  const rows = await db
    .select()
    .from(reviewerLanes)
    .where(and(eq(reviewerLanes.reviewSessionId, reviewSessionId), ownerScope(reviewerLanes.userId, userId)))
    .orderBy(asc(reviewerLanes.reviewerRole));
  return rows.map((r) => parseRow(r, { userId }));
}
