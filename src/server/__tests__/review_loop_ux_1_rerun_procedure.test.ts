/**
 * REVIEW-LOOP-UX-1 R2 — reviewSession.rerunReviewer PROCEDURE behavior (single-reviewer re-run).
 *
 * Covers the safety claims the predicate test cannot: the re-run reuses the EXISTING (session,reviewer)
 * job slot (no new insertJob, idempotency key intact), re-composes against the CURRENT draft, surfaces a
 * CONFLICT when the slot is no longer re-queueable (the single-winner guard — finding #1's affectedRows
 * fix), and gates on async / reviewer-in-session / lane-re-runnable. DB-free (the query layer is mocked).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { appRouter } from '../router.js';
import type { Request, Response } from 'express';
import { clearTelemetryBuffer } from '../test-utils/setup.js';
import * as phase4bQueries from '../db/queries/phase4b.js';
import * as documentQueries from '../db/queries/documents.js';
import * as versionQueries from '../db/queries/versions.js';
import * as jobQueries from '../db/queries/jobs.js';
import * as laneQueries from '../db/queries/reviewerLaneState.js';
import * as canonical from '../db/canonicalMutation.js';
import * as flags from '../config/featureFlags.js';

vi.mock('../db/queries/phase4b.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/phase4b.js')>();
  return {
    ...actual,
    getReviewSessionById: vi.fn(),
    listActiveLockedDecisionsForDocument: vi.fn().mockResolvedValue([]),
    listAdoptLedgerForPrompt: vi.fn().mockResolvedValue([]),
  };
});
vi.mock('../db/queries/documents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/documents.js')>();
  return { ...actual, getDocumentById: vi.fn() };
});
vi.mock('../db/queries/versions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/versions.js')>();
  return { ...actual, getVersionById: vi.fn() };
});
vi.mock('../db/queries/jobs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/jobs.js')>();
  return { ...actual, getJobByIdempotencyKey: vi.fn(), requeueTerminalReviewerJob: vi.fn(), insertJob: vi.fn() };
});
vi.mock('../db/queries/reviewerLaneState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/reviewerLaneState.js')>();
  return { ...actual, listReviewerLanesForSession: vi.fn(), resetReviewerLaneForRerun: vi.fn() };
});
vi.mock('../db/canonicalMutation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/canonicalMutation.js')>();
  return { ...actual, registerDeferredContinuation: vi.fn(), runDeferredCanonicalJob: vi.fn().mockResolvedValue(null) };
});
vi.mock('../config/featureFlags.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/featureFlags.js')>();
  return { ...actual, isReviewerAsyncEnabled: vi.fn().mockReturnValue(true) };
});

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '22222222-2222-2222-2222-222222222222';
const DOC_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const MATTER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CUR_VERSION_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const JOB_ID = '99999999-9999-9999-9999-999999999999';

function caller() {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId: USER_ID });
}

// Mocks the full happy-path chain for a 'failed' lane whose 'failed' job is re-queueable.
function mockHappyChain(over: { laneStatus?: string; jobStatus?: string; requeued?: number } = {}): void {
  vi.mocked(phase4bQueries.getReviewSessionById).mockResolvedValue({
    state: 'active',
    selectedReviewers: ['gpt'],
    iterationNumber: 1,
    documentId: DOC_ID,
  } as Awaited<ReturnType<typeof phase4bQueries.getReviewSessionById>>);
  vi.mocked(laneQueries.listReviewerLanesForSession).mockResolvedValue([
    { reviewerRole: 'gpt', status: over.laneStatus ?? 'failed' },
  ] as unknown as Awaited<ReturnType<typeof laneQueries.listReviewerLanesForSession>>);
  vi.mocked(jobQueries.getJobByIdempotencyKey).mockResolvedValue({
    id: JOB_ID,
    status: over.jobStatus ?? 'failed',
  } as Awaited<ReturnType<typeof jobQueries.getJobByIdempotencyKey>>);
  vi.mocked(documentQueries.getDocumentById).mockResolvedValue({
    id: DOC_ID,
    matterId: MATTER_ID,
    title: 'Test Contract',
    workflowState: 'drafting',
    currentVersionId: CUR_VERSION_ID,
  } as Awaited<ReturnType<typeof documentQueries.getDocumentById>>);
  vi.mocked(versionQueries.getVersionById).mockResolvedValue({
    id: CUR_VERSION_ID,
    content: 'The CURRENT draft text under review.',
  } as Awaited<ReturnType<typeof versionQueries.getVersionById>>);
  vi.mocked(jobQueries.requeueTerminalReviewerJob).mockResolvedValue(over.requeued ?? 1);
  vi.mocked(laneQueries.resetReviewerLaneForRerun).mockResolvedValue(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(flags.isReviewerAsyncEnabled).mockReturnValue(true);
  vi.mocked(phase4bQueries.listActiveLockedDecisionsForDocument).mockResolvedValue([]);
  vi.mocked(phase4bQueries.listAdoptLedgerForPrompt).mockResolvedValue([]);
});
afterEach(() => clearTelemetryBuffer());

describe('reviewSession.rerunReviewer — REVIEW-LOOP-UX-1 R2', () => {
  it('refuses when async lanes are OFF (RERUN_REQUIRES_ASYNC)', async () => {
    vi.mocked(flags.isReviewerAsyncEnabled).mockReturnValue(false);
    await expect(caller().reviewSession.rerunReviewer({ sessionId: SESSION_ID, reviewerRole: 'gpt' })).rejects.toThrow(
      /RERUN_REQUIRES_ASYNC/,
    );
  });

  it('refuses a lane that is NOT re-runnable (completed_with_feedback)', async () => {
    mockHappyChain({ laneStatus: 'completed_with_feedback' });
    await expect(caller().reviewSession.rerunReviewer({ sessionId: SESSION_ID, reviewerRole: 'gpt' })).rejects.toThrow(
      /LANE_NOT_RERUNNABLE/,
    );
  });

  it('refuses a reviewer not in the session', async () => {
    mockHappyChain();
    await expect(
      caller().reviewSession.rerunReviewer({ sessionId: SESSION_ID, reviewerRole: 'claude' }),
    ).rejects.toThrow(/REVIEWER_NOT_IN_SESSION/);
  });

  it('HAPPY: reuses the EXISTING job slot (no insertJob), re-composes against the CURRENT draft, re-dispatches', async () => {
    mockHappyChain();
    const result = await caller().reviewSession.rerunReviewer({ sessionId: SESSION_ID, reviewerRole: 'gpt' });

    // Looked up the EXISTING (session,reviewer) slot by its idempotency key — no new job row.
    expect(jobQueries.getJobByIdempotencyKey).toHaveBeenCalledWith(`${SESSION_ID}:gpt`, USER_ID);
    expect(jobQueries.insertJob).not.toHaveBeenCalled();

    // Re-queued THAT job id with a fresh input bound to the CURRENT version (not a stale snapshot).
    expect(jobQueries.requeueTerminalReviewerJob).toHaveBeenCalledTimes(1);
    const [reqJobId, reqUserId, reqInput] = vi.mocked(jobQueries.requeueTerminalReviewerJob).mock.calls[0]!;
    expect(reqJobId).toBe(JOB_ID);
    expect(reqUserId).toBe(USER_ID);
    const recon = (reqInput as { reviewerReconstruction: { documentVersionId: string } }).reviewerReconstruction;
    expect(recon.documentVersionId).toBe(CUR_VERSION_ID); // CURRENT draft, design decision (d)
    expect(JSON.stringify(reqInput)).toContain('The CURRENT draft text under review.');

    // Reset the lane + re-dispatched through the SAME deferred path with the SAME job id.
    expect(laneQueries.resetReviewerLaneForRerun).toHaveBeenCalledTimes(1);
    expect(canonical.registerDeferredContinuation).toHaveBeenCalledTimes(1);
    expect(vi.mocked(canonical.registerDeferredContinuation).mock.calls[0]![0]).toBe(JOB_ID);
    expect(canonical.runDeferredCanonicalJob).toHaveBeenCalledWith(JOB_ID);

    expect(result).toEqual({ jobId: JOB_ID, reviewerRole: 'gpt', status: 'queued' });
  });

  it('surfaces CONFLICT (RERUN_IN_PROGRESS) when the slot is no longer re-queueable (requeue affectedRows=0)', async () => {
    // finding #1 fix: requeueTerminalReviewerJob honestly returns 0 when its conditional UPDATE matched no
    // row (a concurrent re-run already won, or the job is no longer terminal) -> the procedure must CONFLICT,
    // NOT silently proceed. It must also NOT reset the lane or re-dispatch.
    mockHappyChain({ requeued: 0 });
    await expect(caller().reviewSession.rerunReviewer({ sessionId: SESSION_ID, reviewerRole: 'gpt' })).rejects.toThrow(
      /RERUN_IN_PROGRESS/,
    );
    expect(laneQueries.resetReviewerLaneForRerun).not.toHaveBeenCalled();
    expect(canonical.registerDeferredContinuation).not.toHaveBeenCalled();
    expect(canonical.runDeferredCanonicalJob).not.toHaveBeenCalled();
  });
});
