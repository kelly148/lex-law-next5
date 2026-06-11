/**
 * JOB-RECOVERY-1 — B-3 stuck-active-session self-heal (source-audit).
 *
 * Source-audit style — the established convention in this repo for reviewSession.create wiring (see
 * mr_cal_3e.test.ts). Asserts that the create-guard self-heals a stuck-active session when the reaper
 * is ON: if NO reviewer job for the document is still in flight, the existing active session is
 * recovered (abandoned — migration-free; releases the active-session unique index so the next create
 * proceeds) instead of throwing SESSION_ALREADY_EXISTS. Owner-scoped; flag-OFF throws as today. The
 * migration-free recovery contract is asserted against phase4b (abandoned is an accepted state and
 * getActiveReviewSessionForDocument filters state='active', so an abandoned session unblocks create).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');
const reviewSession = read('src/server/procedures/reviewSession.ts');
const phase4b = read('src/server/db/queries/phase4b.ts');

describe('B-3 — create-guard self-heal wiring (reviewSession.create)', () => {
  it('is flag-gated on JOB_REAPER_ENABLED (OFF = throws SESSION_ALREADY_EXISTS as today)', () => {
    expect(reviewSession).toContain('isJobReaperEnabled');
    expect(reviewSession).toContain('if (isJobReaperEnabled())');
    // the throw path is preserved (only taken when not recovered)
    expect(reviewSession).toContain('if (!recovered) {');
    expect(reviewSession).toContain('SESSION_ALREADY_EXISTS:');
  });

  it('recovers only when NO reviewer job for the document is still in flight (queued/running)', () => {
    expect(reviewSession).toContain("statuses: ['queued', 'running']");
    expect(reviewSession).toContain("(j) => j.jobType === 'reviewer_feedback'");
    expect(reviewSession).toContain('liveReviewers.length === 0');
  });

  it('recovery = abandon the existing session (migration-free) so the next create can proceed', () => {
    expect(reviewSession).toContain(
      "await updateReviewSessionState(existingSession.id, userId, 'abandoned');",
    );
  });

  it('is owner-scoped (pollJobs + updateReviewSessionState both carry userId)', () => {
    expect(reviewSession).toContain('await pollJobs(userId, {');
    expect(reviewSession).toContain('updateReviewSessionState(existingSession.id, userId,');
  });
});

describe('B-3 — phase4b migration-free recovery contract', () => {
  it("'abandoned' is an accepted review-session state (no migration / new enum value needed)", () => {
    expect(phase4b).toContain("state: 'active' | 'regenerated' | 'abandoned'");
  });

  it('getActiveReviewSessionForDocument filters state=active, so an abandoned session unblocks the next create', () => {
    expect(phase4b).toContain('export async function getActiveReviewSessionForDocument');
    expect(phase4b).toContain("eq(reviewSessions.state, 'active')");
  });
});
