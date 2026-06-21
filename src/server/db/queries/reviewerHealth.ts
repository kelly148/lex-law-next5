/**
 * reviewerHealth query layer — REVIEWER-HEALTH-VIEW-1 (the 5C observability panel).
 *
 * READ-ONLY, owner-scoped aggregates over EXISTING tables (jobs + review_sessions). No mutation, no new
 * egress, no migration. Owner filter goes through ownerScope() (the FOLD-AUTH chokepoint); userId is always
 * ctx.userId, never an input. The counts are aggregated in JS over a bounded, owner-scoped, windowed row set
 * (a single attorney's reviewer activity is small) rather than DB GROUP BY — simpler and provider-portable.
 */
import { and, eq, gte } from 'drizzle-orm';
import { db } from '../connection.js';
import { jobs, reviewSessions } from '../schema.js';
import { ownerScope } from '../ownerScope.js';

export interface ReviewerHealthSnapshot {
  windowHours: number;
  generatedAt: string;
  /** reviewer_feedback job outcomes over the window — the reviewer-lane reliability signal. */
  reviewerJobs: { total: number; byStatus: Record<string, number> };
  /** review sessions still 'active' (owner-scoped). A long-lived active session with no running job is the
   *  stuck-session symptom; ageMinutes lets the panel flag the suspicious ones. */
  activeSessions: Array<{
    id: string;
    documentId: string;
    lifecyclePhase: string | null;
    createdAt: string;
    ageMinutes: number;
  }>;
}

export async function getReviewerHealthSnapshot(
  userId: string,
  windowHours: number,
): Promise<ReviewerHealthSnapshot> {
  const since = new Date(Date.now() - windowHours * 3_600_000);

  const reviewerJobRows = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(
      and(
        ownerScope(jobs.userId, userId),
        eq(jobs.jobType, 'reviewer_feedback'),
        gte(jobs.queuedAt, since),
      ),
    );
  const byStatus: Record<string, number> = {};
  for (const r of reviewerJobRows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const activeRows = await db
    .select({
      id: reviewSessions.id,
      documentId: reviewSessions.documentId,
      lifecyclePhase: reviewSessions.lifecyclePhase,
      createdAt: reviewSessions.createdAt,
    })
    .from(reviewSessions)
    .where(and(ownerScope(reviewSessions.userId, userId), eq(reviewSessions.state, 'active')));

  const now = Date.now();
  const activeSessions = activeRows.map((s) => ({
    id: s.id,
    documentId: s.documentId,
    lifecyclePhase: s.lifecyclePhase,
    createdAt: s.createdAt.toISOString(),
    ageMinutes: Math.round((now - s.createdAt.getTime()) / 60_000),
  }));

  return {
    windowHours,
    generatedAt: new Date().toISOString(),
    reviewerJobs: { total: reviewerJobRows.length, byStatus },
    activeSessions,
  };
}
