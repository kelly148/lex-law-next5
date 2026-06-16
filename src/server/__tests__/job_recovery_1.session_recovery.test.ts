/**
 * JOB-RECOVERY-1 B-3 — SUPERSEDED by EGRESS-CONTROL-PLANE-1 Inc 2 (CR-4 / STUCK-SESSION-RECOVERY).
 *
 * The original B-3 self-heal was the "P1" the CR-4 triad REJECTED: an unconditional documentId-keyed
 * auto-abandon of any active session with no in-flight reviewer JOB, gated on JOB_REAPER_ENABLED — which
 * races a legitimate mid-dispatch session and could launder a no_external hold around the gate by
 * recreating the session. CR-4 DEMOTED it to a narrow, guarded, SESSION-ID-keyed stale-orphan fallback
 * (age-window + single-flight CAS + fail-closed audit; never touches a hold / in-flight / young /
 * feedback-bearing session) and removed create's dependence on JOB_REAPER_ENABLED.
 *
 * This source-audit pins the SUPERSESSION so the rejected P1 can never silently return. The full demoted-
 * recovery + durable-outbox contract is covered behaviorally in egress_control_plane_1_inc2_outbox.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const reviewSession = readFileSync(resolve(repoRoot, 'src/server/procedures/reviewSession.ts'), 'utf8');
const phase4b = readFileSync(resolve(repoRoot, 'src/server/db/queries/phase4b.ts'), 'utf8');

describe('CR-4 — the rejected P1 self-heal is REMOVED from reviewSession.create', () => {
  it('create no longer gates recovery on JOB_REAPER_ENABLED', () => {
    expect(reviewSession).not.toContain('if (isJobReaperEnabled())');
  });
  it('create no longer uses documentId-keyed job polling to decide recovery', () => {
    expect(reviewSession).not.toContain('await pollJobs(userId, {');
    expect(reviewSession).not.toContain('liveReviewers.length === 0');
  });
  it('create no longer unconditionally abandons via updateReviewSessionState in the create guard', () => {
    expect(reviewSession).not.toContain("await updateReviewSessionState(existingSession.id, userId, 'abandoned');");
  });
});

describe('CR-4 — the demoted, guarded recovery replaces it', () => {
  it('recovery is session-ID-keyed (lane contract) + age-window + no-feedback + hold-refusal', () => {
    expect(reviewSession).toContain('await listReviewerLanesForSession(existingSession.id, userId)');
    expect(reviewSession).toContain('ageMs > MAX_DISPATCH_WINDOW_MS');
    expect(reviewSession).toContain('existingFeedback.length === 0');
    expect(reviewSession).toContain(
      "phase === 'held' || phase === 'blocked_by_hold' || phase === 'partial_blocked_by_hold'",
    );
  });
  it('recovery abandon is a single-flight CAS + fail-closed audit (soft; no destructive cascade)', () => {
    expect(reviewSession).toContain('abandonReviewSessionAudited({');
    expect(phase4b).toContain('export async function abandonReviewSessionAudited');
    expect(phase4b).toContain('export async function updateReviewSessionStateCas');
  });
  it('the resumable SESSION_ALREADY_EXISTS id is preserved for a genuinely live session', () => {
    expect(reviewSession).toContain('SESSION_ALREADY_EXISTS:${stillLive.id}');
  });
});

describe('phase4b — soft abandon contract (no destructive cascade)', () => {
  it("'abandoned' remains an accepted review-session state (soft transition)", () => {
    expect(phase4b).toContain("state: 'active' | 'regenerated' | 'abandoned'");
  });
  it('getActiveReviewSessionForDocument filters state=active (an abandoned session unblocks the next create)', () => {
    expect(phase4b).toContain('export async function getActiveReviewSessionForDocument');
    expect(phase4b).toContain("eq(reviewSessions.state, 'active')");
  });
});
