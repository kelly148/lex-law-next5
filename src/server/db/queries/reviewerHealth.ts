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
import { jobs, reviewSessions, telemetryEvents, adoptLedger } from '../schema.js';
import { ownerScope } from '../ownerScope.js';

/** An active session older than this (minutes) is flagged as a possible stuck session. */
export const STUCK_SESSION_MINUTES = 10;

/** W7 — per-reviewer-lane health over the window (the 4 panel-composition signals). */
export interface ReviewerLaneHealth {
  /** reviewer_output_captured events for this lane. */
  outputsCaptured: number;
  /** outputs that failed to parse (parseOk === false) — the structured-output fragility signal. */
  parseFailures: number;
  /** outputs that returned zero suggestions (parsedSuggestionCount === 0) — the empty-review signal. */
  emptyReviews: number;
  /** adopt_ledger entries sourced from this lane — the finding-adoption signal. */
  findingsAdopted: number;
}

export interface ReviewerHealthSnapshot {
  windowHours: number;
  generatedAt: string;
  /** reviewer_feedback job outcomes over the window — the reviewer-lane reliability signal. */
  reviewerJobs: { total: number; byStatus: Record<string, number> };
  /** W7 — per-lane (reviewerRole) health over the window: parse-failure, empty-review, finding-adoption.
   *  Aggregated from the ALWAYS-ON telemetry sink (reviewer_output_captured) + the adopt_ledger. */
  perLane: Record<string, ReviewerLaneHealth>;
  /** W7 — count of active sessions older than STUCK_SESSION_MINUTES (the stuck-session signal). */
  stuckSessionCount: number;
  /** review sessions still 'active' (owner-scoped). A long-lived active session with no running job is the
   *  stuck-session symptom; ageMinutes lets the panel flag the suspicious ones. */
  activeSessions: Array<{
    id: string;
    documentId: string;
    lifecyclePhase: string | null;
    createdAt: string;
    ageMinutes: number;
    /** SESSION-UNSTICK-1: server-authoritative "meets the possibly-stuck heuristic" flag (ageMinutes >=
     *  STUCK_SESSION_MINUTES). Gates the manual per-session Abandon action on Diagnostics. */
    isPossiblyStuck: boolean;
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
  const activeSessions = activeRows.map((s) => {
    const ageMinutes = Math.round((now - s.createdAt.getTime()) / 60_000);
    return {
      id: s.id,
      documentId: s.documentId,
      lifecyclePhase: s.lifecyclePhase,
      createdAt: s.createdAt.toISOString(),
      ageMinutes,
      isPossiblyStuck: ageMinutes >= STUCK_SESSION_MINUTES,
    };
  });
  const stuckSessionCount = activeSessions.filter((s) => s.isPossiblyStuck).length;

  // W7 — per-lane reviewer-output health from the ALWAYS-ON telemetry sink (reviewer_output_captured):
  // parse-failure (parseOk === false) + empty-review (parsedSuggestionCount === 0), by reviewer lane.
  // Owner-scoped + windowed; JS-aggregated over a single attorney's small row set (no GROUP BY).
  const perLane: Record<string, ReviewerLaneHealth> = {};
  const lane = (role: string): ReviewerLaneHealth =>
    (perLane[role] ??= { outputsCaptured: 0, parseFailures: 0, emptyReviews: 0, findingsAdopted: 0 });

  const outputRows = await db
    .select({ payload: telemetryEvents.payload })
    .from(telemetryEvents)
    .where(
      and(
        ownerScope(telemetryEvents.userId, userId),
        eq(telemetryEvents.eventType, 'reviewer_output_captured'),
        gte(telemetryEvents.createdAt, since),
      ),
    );
  for (const r of outputRows) {
    const p = r.payload as { reviewerRole?: string; parseOk?: boolean; parsedSuggestionCount?: number | null };
    const l = lane(typeof p.reviewerRole === 'string' ? p.reviewerRole : 'unknown');
    l.outputsCaptured++;
    if (p.parseOk === false) l.parseFailures++;
    if (p.parsedSuggestionCount === 0) l.emptyReviews++;
  }

  // W7 — finding-adoption per lane: an adopt_ledger entry means the attorney adopted a reviewer suggestion.
  const adoptRows = await db
    .select({ role: adoptLedger.sourceReviewerRole })
    .from(adoptLedger)
    .where(and(ownerScope(adoptLedger.userId, userId), gte(adoptLedger.createdAt, since)));
  for (const r of adoptRows) lane(r.role).findingsAdopted++;

  return {
    windowHours,
    generatedAt: new Date().toISOString(),
    reviewerJobs: { total: reviewerJobRows.length, byStatus },
    perLane,
    stuckSessionCount,
    activeSessions,
  };
}
