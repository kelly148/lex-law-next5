/**
 * EGRESS-CONTROL-PLANE-1 Increment 2 — durable outbox + CR-4 / STUCK-SESSION-RECOVERY (gating tests).
 *
 * Coverage maps to the triad's merged gating set. BEHAVIORAL where the logic is extractable (the durable
 * reviewer-job factory, the CAS single-flight, the partial-reason classification, the fail-closed audited
 * abandon, lane-status classification); SOURCE-AUDIT for the reviewSession.create / dispatcher WIRING —
 * the established repo convention for create() (see reviewer_async_fanout_1 / mr_cal_3e), because driving
 * the full create resolver needs broad tRPC + DB mocking. Full end-to-end behavior is the mandatory
 * operator post-deploy live-verification (this rebuilt the live dispatch path).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── vi.mock the pooled db connection so importing phase4b (for the CAS + audited-abandon behavioral
//    tests) never opens a real connection. The fail-closed abandon test drives db.transaction through
//    this fake tx; the CAS test passes its OWN fake executor (so it does not touch this mock). ──
const h = vi.hoisted(() => {
  let insertThrows = false;
  const calls = { update: 0, insert: 0, transaction: 0 };
  const tx = {
    update: () => {
      calls.update += 1;
      return { set: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }) };
    },
    insert: () => ({
      values: () => {
        calls.insert += 1;
        if (insertThrows) throw new Error('AUDIT_WRITE_FAILED (simulated)');
        return Promise.resolve();
      },
    }),
  };
  return {
    tx,
    calls,
    setInsertThrows: (v: boolean) => {
      insertThrows = v;
    },
    reset: () => {
      insertThrows = false;
      calls.update = 0;
      calls.insert = 0;
      calls.transaction = 0;
    },
  };
});
vi.mock('../db/connection.js', () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      h.calls.transaction += 1;
      return cb(h.tx);
    },
  },
}));

import {
  reviewerIdempotencyKey,
  buildReviewerJobRow,
  buildReviewerCanonicalParams,
  reconstructReviewerParamsFromJob,
  type ReviewerDurableInput,
} from '../jobs/reviewerJobFactory.js';
import { JobInputSchema, type JobRow } from '../../shared/schemas/jobs.js';
import {
  deriveSessionPartialReason,
  buildReviewerLanesContract,
  TERMINAL_LANE_STATUSES,
  FAILURE_LANE_STATUSES,
  HOLD_BLOCKED_LANE_STATUSES,
  type ReviewerLaneView,
} from '../../shared/schemas/reviewerLaneState.js';
import {
  updateReviewSessionStateCas,
  abandonReviewSessionAudited,
  supersedeReviewSessionForNewReview,
} from '../db/queries/phase4b.js';

const repoRoot = resolve(__dirname, '../../..');
const read = (p: string): string => readFileSync(resolve(repoRoot, p), 'utf8');
const reviewSessionSrc = read('src/server/procedures/reviewSession.ts');
const dispatcherSrc = read('src/server/jobs/dispatcher.ts');
const jobsQuerySrc = read('src/server/db/queries/jobs.ts');
const matterPurgeSrc = read('src/server/db/queries/matterPurge.ts');

const UUID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function sampleInput(over: Partial<ReviewerDurableInput> = {}): ReviewerDurableInput {
  return {
    jobId: UUID(1),
    userId: UUID(2),
    matterId: UUID(3),
    documentId: UUID(4),
    documentVersionId: UUID(5),
    reviewSessionId: UUID(6),
    iterationNumber: 2,
    reviewerRole: 'claude',
    reviewerTitle: 'Claude',
    modelString: 'anthropic:claude-opus-4-5',
    systemPrompt: 'SYSTEM PROMPT (frozen at enqueue)',
    userPrompt: 'USER PROMPT with the full draft text',
    temperature: 0.4,
    maxTokens: 16384,
    timeoutMs: 720_000,
    async: true,
    ...over,
  };
}

function laneView(status: ReviewerLaneView['status'], over: Partial<ReviewerLaneView> = {}): ReviewerLaneView {
  return {
    reviewerRole: 'claude',
    reviewerTitle: 'Claude',
    status,
    terminal: TERMINAL_LANE_STATUSES.has(status),
    suggestionCount: status === 'completed_with_feedback' ? 1 : null,
    feedbackRowId: null,
    jobStatus: null,
    failureReason: null,
    dispatchedAt: null,
    terminalizedAt: null,
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// BEHAVIORAL — the durable reviewer-job factory (the heart of the outbox + reconstruct-after-restart)
// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('durable outbox — reviewer job row carries everything to reconstruct (gating: idempotency key, durable input)', () => {
  it('idempotency key is per (session, lane)', () => {
    expect(reviewerIdempotencyKey(UUID(6), 'claude')).toBe(`${UUID(6)}:claude`);
    // distinct per reviewer lane, identical across re-derivation (so a re-enqueue collides on the unique index)
    expect(reviewerIdempotencyKey(UUID(6), 'gpt')).not.toBe(reviewerIdempotencyKey(UUID(6), 'claude'));
  });

  it('buildReviewerJobRow commits a QUEUED row with the idempotency key + frozen prompt + reconstruction params', () => {
    const row = buildReviewerJobRow(sampleInput());
    expect(row.id).toBe(UUID(1));
    expect(row.jobType).toBe('reviewer_feedback');
    expect(row.status).toBe('queued');
    expect(row.idempotencyKey).toBe(`${UUID(6)}:claude`);
    // jobs.input must validate against the Zod Wall AND carry the reconstruction payload + prompt text.
    const parsed = JobInputSchema.parse(row.input);
    expect(parsed.systemPrompt).toBe('SYSTEM PROMPT (frozen at enqueue)');
    expect(parsed.userPrompt).toContain('full draft text');
    expect(parsed.reviewerReconstruction?.reviewSessionId).toBe(UUID(6));
    expect(parsed.reviewerReconstruction?.documentVersionId).toBe(UUID(5));
    expect(parsed.reviewerReconstruction?.modelString).toBe('anthropic:claude-opus-4-5');
    expect(parsed.reviewerReconstruction?.async).toBe(true);
  });
});

describe('durable outbox — reconstruct-after-restart (gating: a committed job re-transmits from jobs.input)', () => {
  // Simulate a process restart: the in-memory continuation is GONE; only the committed job row remains.
  function jobRowFrom(input: ReviewerDurableInput): JobRow {
    const newJob = buildReviewerJobRow(input);
    return {
      id: newJob.id,
      userId: newJob.userId,
      matterId: newJob.matterId ?? null,
      documentId: newJob.documentId ?? null,
      idempotencyKey: newJob.idempotencyKey ?? null,
      jobType: 'reviewer_feedback',
      providerId: 'anthropic',
      modelId: 'claude-opus-4-5',
      promptVersion: 'v1',
      status: 'queued',
      queuedAt: new Date(0),
      startedAt: null,
      completedAt: null,
      lastHeartbeatAt: null,
      input: JobInputSchema.parse(newJob.input),
      output: null,
      errorClass: null,
      errorMessage: null,
      tokensPrompt: null,
      tokensCompletion: null,
      tokensReasoning: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as JobRow;
  }

  it('rebuilds the canonical params from the committed job row alone (the in-memory map is not consulted)', () => {
    const params = reconstructReviewerParamsFromJob(jobRowFrom(sampleInput()));
    expect(params).not.toBeNull();
    expect(params!.jobType).toBe('reviewer_feedback');
    expect(params!.modelString).toBe('anthropic:claude-opus-4-5');
    // the rebuilt buildLlmParams returns the FROZEN prompts (so the re-transmit is byte-identical)
    const llm = params!.buildLlmParams(UUID(1));
    expect(llm.systemPrompt).toBe('SYSTEM PROMPT (frozen at enqueue)');
    expect(llm.userPrompt).toContain('full draft text');
  });

  it('refuses to reconstruct when jobs.input was CLEARED on terminal (no second copy of client content to re-send)', () => {
    const cleared = { ...jobRowFrom(sampleInput()), input: JobInputSchema.parse({}) } as JobRow;
    expect(reconstructReviewerParamsFromJob(cleared)).toBeNull();
  });

  it('refuses to reconstruct a non-reviewer job', () => {
    const other = { ...jobRowFrom(sampleInput()), jobType: 'draft_generation' } as JobRow;
    expect(reconstructReviewerParamsFromJob(other)).toBeNull();
  });

  it('buildReviewerCanonicalParams round-trips identically to the at-enqueue params (same factory)', () => {
    const input = sampleInput();
    const atEnqueue = buildReviewerCanonicalParams(input);
    const reconstructed = reconstructReviewerParamsFromJob(jobRowFrom(input))!;
    expect(reconstructed.buildLlmParams(UUID(1))).toEqual(atEnqueue.buildLlmParams(UUID(1)));
    expect(reconstructed.timeoutMs).toBe(atEnqueue.timeoutMs);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// BEHAVIORAL — partial-by-HOLD vs partial-by-non-response (gating: the Inc-2 data foundation)
// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('partial-fan-out classification — hold-block is DISTINCT from non-response (gating: partial-by-hold)', () => {
  it('blocked_by_hold is TERMINAL, is NOT a FAILURE class, and IS a hold-block class', () => {
    expect(TERMINAL_LANE_STATUSES.has('blocked_by_hold')).toBe(true);
    expect(FAILURE_LANE_STATUSES.has('blocked_by_hold')).toBe(false);
    expect(HOLD_BLOCKED_LANE_STATUSES.has('blocked_by_hold')).toBe(true);
  });

  it('a hold-blocked lane -> partialReason "blocked_by_hold" (needs the Inc-3 attorney acknowledgment)', () => {
    const reason = deriveSessionPartialReason([laneView('completed_with_feedback'), laneView('blocked_by_hold')]);
    expect(reason).toBe('blocked_by_hold');
  });

  it('a failed/timed-out lane (no hold) -> partialReason "non_response" (informational)', () => {
    expect(deriveSessionPartialReason([laneView('completed_with_feedback'), laneView('failed')])).toBe('non_response');
    expect(deriveSessionPartialReason([laneView('timed_out')])).toBe('non_response');
  });

  it('hold takes PRECEDENCE over a co-occurring non-response (a deliberate withhold must be acknowledged)', () => {
    const reason = deriveSessionPartialReason([laneView('failed'), laneView('blocked_by_hold')]);
    expect(reason).toBe('blocked_by_hold');
  });

  it('a clean (all completed) set -> partialReason null', () => {
    expect(deriveSessionPartialReason([laneView('completed_with_feedback'), laneView('completed_without_feedback')])).toBeNull();
  });

  it('the reviewer lanes contract surfaces partialReason through the EXISTING reviewSession.get path', () => {
    const contract = buildReviewerLanesContract([laneView('completed_with_feedback'), laneView('blocked_by_hold')]);
    expect(contract.partialReason).toBe('blocked_by_hold');
    expect(contract.allTerminal).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// BEHAVIORAL — CAS single-flight + SOFT, fail-closed-AUDITED abandon (gating: CAS, abandon audited)
// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('CAS state transition — single-flight (gating: CAS transition)', () => {
  function fakeExecutor(affectedRows: number) {
    return {
      update: () => ({ set: () => ({ where: () => Promise.resolve([{ affectedRows }]) }) }),
    } as unknown as Parameters<typeof updateReviewSessionStateCas>[4];
  }

  it('returns 1 when THIS caller transitions the row (active -> abandoned)', async () => {
    expect(await updateReviewSessionStateCas(UUID(6), UUID(2), 'active', 'abandoned', fakeExecutor(1))).toBe(1);
  });

  it('returns 0 when it LOST the race (the row already moved) — only one concurrent recovery wins', async () => {
    expect(await updateReviewSessionStateCas(UUID(6), UUID(2), 'active', 'abandoned', fakeExecutor(0))).toBe(0);
  });
});

describe('SOFT, fail-closed-AUDITED abandon (gating: abandon non-destructive + audited; fail-closed audit)', () => {
  it('on success: CAS abandon + an audit row both run inside one transaction; reason recorded; returns 1', async () => {
    h.reset();
    const rows = await abandonReviewSessionAudited({
      sessionId: UUID(6),
      userId: UUID(2),
      matterId: UUID(3),
      documentId: UUID(4),
      reason: 'auto_recovery',
      fromLifecyclePhase: null,
      summary: 'stale orphan recovered',
    });
    expect(rows).toBe(1);
    expect(h.calls.transaction).toBe(1);
    expect(h.calls.update).toBe(1); // the CAS abandon
    expect(h.calls.insert).toBe(1); // the audit row (same tx)
  });

  it('FAIL-CLOSED: an audit-write failure REJECTS the abandon (the tx rolls back — no silent abandon)', async () => {
    h.reset();
    h.setInsertThrows(true);
    await expect(
      abandonReviewSessionAudited({
        sessionId: UUID(6),
        userId: UUID(2),
        matterId: UUID(3),
        documentId: UUID(4),
        reason: 'attorney',
        fromLifecyclePhase: null,
        summary: 'attorney abandon',
      }),
    ).rejects.toThrow(/AUDIT_WRITE_FAILED/);
    h.setInsertThrows(false);
  });
});

// ============================================================
// TERMINAL-SESSION-SUPERSEDE-1 — a completed-but-unclosed session is superseded (NOT abandoned) so a new
// review proceeds without the 409; in-flight stays blocked with a clear message; hold never supersedes.
// ============================================================
describe('TERMINAL-SESSION-SUPERSEDE-1 — supersede helper (gating: History-VISIBLE supersede + audited + fail-closed)', () => {
  it('on success: CAS active->regenerated + an audit row in ONE tx; returns 1 (NOT abandoned — stays in History)', async () => {
    h.reset();
    const rows = await supersedeReviewSessionForNewReview({
      sessionId: UUID(6),
      userId: UUID(2),
      matterId: UUID(3),
      documentId: UUID(4),
      fromLifecyclePhase: 'completed',
      summary: 'superseded on new review',
    });
    expect(rows).toBe(1);
    expect(h.calls.transaction).toBe(1);
    expect(h.calls.update).toBe(1); // the CAS active->regenerated
    expect(h.calls.insert).toBe(1); // the audit row (same tx)
  });

  it('FAIL-CLOSED: an audit-write failure REJECTS the supersede (tx rolls back — no silent transition)', async () => {
    h.reset();
    h.setInsertThrows(true);
    await expect(
      supersedeReviewSessionForNewReview({
        sessionId: UUID(6),
        userId: UUID(2),
        matterId: UUID(3),
        documentId: UUID(4),
        fromLifecyclePhase: 'completed',
        summary: 'superseded on new review',
      }),
    ).rejects.toThrow(/AUDIT_WRITE_FAILED/);
    h.setInsertThrows(false);
  });
});

describe('TERMINAL-SESSION-SUPERSEDE-1 — reviewSession.create wiring (source-audit, house convention)', () => {
  it('supersedes a TERMINAL existing session to the History-VISIBLE "regenerated" state (NOT "abandoned")', () => {
    expect(reviewSessionSrc).toContain('await supersedeReviewSessionForNewReview({');
    // the supersede helper CASes active->'regenerated' (asserted in phase4b; here confirm create calls it,
    // not abandon, for the terminal-but-unclosed case).
    expect(reviewSessionSrc).toContain('const supersededRows = await supersedeReviewSessionForNewReview(');
  });

  it('decides by REAL terminality, not by state: sync needs settled/old, async needs all-lanes-terminal', () => {
    expect(reviewSessionSrc).toContain('const liveInFlight = liveLanes.some((l) => !isTerminalLaneStatus(l.status));');
    expect(reviewSessionSrc).toContain(
      "(livePhase === 'completed' || liveLanes.length > 0 || liveAgeMs > MAX_DISPATCH_WINDOW_MS)",
    );
  });

  it('a genuinely IN-FLIGHT review returns a clear REVIEW_IN_PROGRESS message, NOT a raw SESSION_ALREADY_EXISTS 409', () => {
    expect(reviewSessionSrc).toContain('REVIEW_IN_PROGRESS:${stillLive.id}');
    expect(reviewSessionSrc).toContain("code: 'PRECONDITION_FAILED'");
  });

  it('a HOLD phase is NEVER auto-superseded (resumable conflict; clearing a hold is a privileged act)', () => {
    expect(reviewSessionSrc).toContain(
      "livePhase === 'held' || livePhase === 'blocked_by_hold' || livePhase === 'partial_blocked_by_hold'",
    );
  });

  it('a lost single-flight CAS re-resolves and only conflicts if a fresh active session now holds the key', () => {
    expect(reviewSessionSrc).toContain('if (supersededRows === 0) {');
    expect(reviewSessionSrc).toContain('const afterRace = await getActiveReviewSessionForDocument(input.documentId, userId);');
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// SOURCE-AUDIT — reviewSession.create durable-outbox + demoted-recovery WIRING (house convention)
// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('reviewSession.create — atomic outbox commit (gating: rollback-on-throw, double-create, SESSION_ALREADY_EXISTS)', () => {
  it('commits session + lanes + ALL reviewer jobs in ONE db.transaction (so a pre-queue throw rolls everything back)', () => {
    expect(reviewSessionSrc).toContain('await db.transaction(async (tx) => {');
    expect(reviewSessionSrc).toContain('await insertReviewSession(');
    expect(reviewSessionSrc).toContain('await insertReviewerLanes(');
    expect(reviewSessionSrc).toContain('await insertJob(buildReviewerJobRow(r), tx);');
    // session insert is now INSIDE the tx — no standalone pre-tx session row (the old wedge source)
    expect(reviewSessionSrc).not.toContain('const sessionId = await insertReviewSession(');
  });

  it('a concurrent FRESH create losing the activeSessionKey slot -> resumable SESSION_ALREADY_EXISTS (not a 500)', () => {
    expect(reviewSessionSrc).toContain('isDuplicateKeyError(err)');
    expect(reviewSessionSrc).toContain('SESSION_ALREADY_EXISTS:${winner?.id');
  });

  it('post-commit transmit marks the brief dispatching phase and flips it back (recovery-refusal marker)', () => {
    expect(reviewSessionSrc).toContain("updateReviewSessionLifecyclePhase(sessionId, userId, 'dispatching')");
    expect(reviewSessionSrc).toContain('updateReviewSessionLifecyclePhase(sessionId, userId, null)');
    expect(reviewSessionSrc).toContain('runDeferredCanonicalJob(r.jobId)');
  });

  it('the fragile fire-and-forget fork is RETIRED (async now uses the durable deferred path)', () => {
    expect(reviewSessionSrc).not.toContain('const reviewerResultPromise = executeCanonicalMutation(reviewerParams);');
    expect(reviewSessionSrc).not.toContain('await enqueueCanonicalJobForDispatcher(reviewerParams);');
  });
});

describe('reviewSession.create — DEMOTED recovery (gating: never abandons in-flight/young; session-ID scoped; owner isolation)', () => {
  it("is NOT gated on JOB_REAPER_ENABLED (create's correctness no longer depends on the reaper flag)", () => {
    expect(reviewSessionSrc).not.toContain('if (isJobReaperEnabled())');
    expect(reviewSessionSrc).not.toContain("import { isJobReaperEnabled }");
  });

  it('in-flight detection is SESSION-ID keyed via the lane contract (not documentId-keyed job polling)', () => {
    expect(reviewSessionSrc).toContain('await listReviewerLanesForSession(existingSession.id, userId)');
    expect(reviewSessionSrc).toContain('existingLanes.some((l) => !isTerminalLaneStatus(l.status))');
    expect(reviewSessionSrc).not.toContain("await pollJobs(userId, {");
  });

  it('refuses a HOLD phase and a YOUNG session, and only abandons an old, not-in-flight, no-feedback orphan', () => {
    expect(reviewSessionSrc).toContain("phase === 'held' || phase === 'blocked_by_hold' || phase === 'partial_blocked_by_hold'");
    expect(reviewSessionSrc).toContain('ageMs > MAX_DISPATCH_WINDOW_MS');
    expect(reviewSessionSrc).toContain('existingFeedback.length === 0');
  });

  it('recovery abandon is the single-flight CAS + fail-closed audit, reason auto_recovery, owner-scoped', () => {
    expect(reviewSessionSrc).toContain('abandonReviewSessionAudited({');
    expect(reviewSessionSrc).toContain("reason: 'auto_recovery'");
    expect(reviewSessionSrc).toContain('SESSION_ALREADY_EXISTS:${stillLive.id}');
  });
});

describe('dispatcher — durable reconstruct-after-restart wiring (gating: reconstruct-from-input)', () => {
  it('registers the reviewer handler when the dispatcher OR async is enabled (async no longer fire-and-forget)', () => {
    expect(dispatcherSrc).toContain('if (!isJobDispatcherEnabled() && !isReviewerAsyncEnabled()) return;');
  });
  it('reconstructs a continuation-less queued reviewer job from jobs.input instead of skipping it', () => {
    expect(dispatcherSrc).toContain('reconstructReviewerParamsFromJob(job)');
    expect(dispatcherSrc).toContain('registerDeferredContinuation(jobId, params)');
  });
});

describe('jobs.input retention + matter-purge (gating: input nulled on terminal + purge-covered)', () => {
  it('every terminal job write clears input to {} (no lingering second copy of client content)', () => {
    // appears in markJobCompleted / markJobFailed / markJobTimedOut / markJobCancelled
    const occurrences = jobsQuerySrc.split('input: {} as Record<string, unknown>,').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });
  it('the jobs table (and thus jobs.input) is purged with the matter', () => {
    expect(matterPurgeSrc).toContain("step('jobs', jobs, byMatter(jobs))");
  });
});
