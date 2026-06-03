/**
 * Canonical Mutation Pattern Helper (Ch 23)
 *
 * Every LLM-producing procedure in Phase 3+ consumes this helper.
 * It encapsulates the two-transaction lifecycle that prevents the Bug 5 class
 * of failure (LLM call with no timeout, document stuck in an invalid in-flight state).
 *
 * TWO-TRANSACTION LIFECYCLE (Ch 23.1):
 *
 *   Transaction 1 — enqueue:
 *     1. Validate preconditions via conditional checks on current state.
 *     2. Write in-flight state (advance workflowState, insert jobs row with status='queued').
 *     3. Emit job_queued telemetry.
 *     4. Commit.
 *
 *   Between transactions — the LLM call:
 *     Outside any DB transaction. Can take seconds to minutes.
 *     lastHeartbeatAt updated at Ch 8.5 checkpoints.
 *
 *   Transaction 2 — commit or revert:
 *     On success: write output, advance workflowState to terminal, mark job completed.
 *     On failure: revert workflowState to pre-enqueue state, mark job failed/timed_out.
 *     Uses conditional UPDATE to prevent race conditions (Ch 23.2).
 *
 * SIGNATURE:
 *   executeCanonicalMutation({ txn1Enqueue, llmCall, txn2Commit, txn2Revert })
 *
 * USAGE (Phase 3+):
 *   Every LLM-producing procedure calls executeCanonicalMutation.
 *   No procedure enqueues jobs via any other path.
 *   Code review verifies no side-channel paths exist (Phase 2 acceptance criterion).
 *
 * TEST INJECTION:
 *   setJobWriteFunctions() allows tests to inject no-op job write functions
 *   so the acceptance tests can run without a real database connection.
 *   This is the same pattern as setTelemetryDbWriter() in emitTelemetry.ts.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  insertJob,
  markJobRunning,
  markJobCompleted,
  markJobFailed,
  markJobTimedOut,
  markJobCancelled,
  updateJobHeartbeat,
} from './queries/jobs.js';
import { emitTelemetry, type TelemetryContext } from '../telemetry/emitTelemetry.js';
import { getPromptVersionForJobType } from '../llm/promptVersions.js';
import { resolveAdapter } from '../llm/registry.js';
import { classifyProviderError, type LlmGenerateParams } from '../llm/types.js';
import { getLlmFetchTimeoutMs, parseModelString } from '../llm/config.js';
import { buildMatterStateContextBlock } from '../matterState/injection.js';
import { buildActivePaProfileForMatter, type LoadedPaProfile } from '../practiceKb/profileInjection.js';
import { recordKbEvent } from './queries/kbEvents.js';
import type { NewJob, JobType } from './schema.js';

// ============================================================
// FOLD-L1-2 — matter-state injection provider (test-injectable)
// ============================================================
// Every LLM job dispatched through this single chokepoint receives the current matter
// state, prepended to its systemPrompt (the "no cold reviews" precondition). The provider
// is overridable for tests (mirrors setJobWriteFunctions / setTestLlmAdapter); the default
// reads the L1-1 Matter-State Engine. The call site invokes it BEST-EFFORT so a matter-
// state read can never break a model call.

type MatterStateProvider = (args: {
  matterId: string;
  userId: string;
  documentId?: string;
}) => Promise<string>;

let _matterStateProvider: MatterStateProvider | null = null;

/** Override the matter-state injection provider for tests. Pass null to restore the default. */
export function setMatterStateProvider(fn: MatterStateProvider | null): void {
  _matterStateProvider = fn;
}

function getMatterStateProvider(): MatterStateProvider {
  return _matterStateProvider ?? buildMatterStateContextBlock;
}

// ============================================================
// FOLD-KB-1 Inc4 — per-PA instruction-profile injection provider (test-injectable)
// ============================================================
// The attorney's CONFIRMED per-practice-area master prompt auto-loads here (Fork E). Like
// matter-state, it is best-effort and only matter-scoped jobs inject. Unlike practice memos
// (which never auto-inject), this is the attorney's own instruction layer. Returns null when
// there is no confirmed paKey / no active profile => base prompt (never a mismatched PA).

type PaProfileProvider = (args: { matterId: string; userId: string }) => Promise<LoadedPaProfile | null>;

let _paProfileProvider: PaProfileProvider | null = null;

/** Override the per-PA profile provider for tests. Pass null to restore the default. */
export function setPaProfileProvider(fn: PaProfileProvider | null): void {
  _paProfileProvider = fn;
}

function getPaProfileProvider(): PaProfileProvider {
  return _paProfileProvider ?? buildActivePaProfileForMatter;
}

// ============================================================
// Types
// ============================================================

export interface Txn1EnqueueResult {
  /** The job ID created by Transaction 1 */
  jobId: string;
  /** The document's pre-enqueue state (for revert in Transaction 2) */
  preEnqueueState?: string;
}

export interface Txn2CommitParams {
  jobId: string;
  output: unknown;
  tokensPrompt: number;
  tokensCompletion: number;
}

export interface Txn2RevertParams {
  jobId: string;
  errorClass: string;
  errorMessage: string;
}

export interface CanonicalMutationParams {
  /** userId from session context (Ch 35.2) */
  userId: string;
  /** The job type being enqueued (Ch 8.2) */
  jobType: JobType;
  /** The model string "provider:model" to use */
  modelString: string;
  /** Optional matter/document context for the job row */
  matterId?: string;
  documentId?: string;
  /**
   * Transaction 1: validate preconditions, write in-flight state, return job context.
   * Called inside a DB transaction. Must throw on precondition failure.
   * Returns the job ID to use (caller can supply a pre-generated UUID or let
   * the helper generate one).
   */
  txn1Enqueue: (jobId: string) => Promise<Txn1EnqueueResult>;
  /**
   * Build the LLM call parameters (system prompt, user prompt, schema, etc.)
   * Called after Transaction 1 commits, before the LLM call.
   */
  buildLlmParams: (jobId: string) => Omit<LlmGenerateParams, 'signal'>;
  /**
   * Transaction 2 — success path: write output, advance document state.
   * Called inside a DB transaction after the LLM call succeeds.
   */
  txn2Commit: (params: Txn2CommitParams) => Promise<void>;
  /**
   * Transaction 2 — failure/timeout/cancel path: revert document state.
   * Called inside a DB transaction after the LLM call fails or times out.
   */
  txn2Revert: (params: Txn2RevertParams) => Promise<void>;
  /**
   * Optional per-call LLM fetch timeout in milliseconds.
   * Overrides the global DEFAULT_LLM_FETCH_TIMEOUT_MS for this specific job.
   * Use only for job types whose provider is known to require a longer budget
   * (e.g. reviewer_feedback with gpt-5 which has TTFT > 80s at high load).
   * Defaults to getLlmFetchTimeoutMs() (120 000 ms) when not set.
   * MR-LLM-GPT-1: introduced to allow reviewer_feedback to use 300 000 ms.
   */
  timeoutMs?: number;
  /** Telemetry context for all events emitted during this mutation */
  telemetryCtx: TelemetryContext;
}

export interface CanonicalMutationResult {
  jobId: string;
  status: 'completed' | 'failed' | 'timed_out' | 'cancelled';
}

// ============================================================
// Job write function injection (for test isolation)
// ============================================================

type JobWriteFunctions = {
  insertJob: typeof insertJob;
  markJobRunning: typeof markJobRunning;
  markJobCompleted: typeof markJobCompleted;
  markJobFailed: typeof markJobFailed;
  markJobTimedOut: typeof markJobTimedOut;
  markJobCancelled: typeof markJobCancelled;
  updateJobHeartbeat: typeof updateJobHeartbeat;
};

let _jobWriteFunctions: JobWriteFunctions | null = null;

/**
 * Override the job write functions for test isolation.
 * Pass null to restore the real DB functions.
 *
 * This allows acceptance tests to run without a real database connection
 * while still exercising the full canonical mutation lifecycle.
 */
export function setJobWriteFunctions(fns: JobWriteFunctions | null): void {
  _jobWriteFunctions = fns;
}

function getJobWriteFunctions(): JobWriteFunctions {
  if (_jobWriteFunctions !== null) return _jobWriteFunctions;
  return {
    insertJob,
    markJobRunning,
    markJobCompleted,
    markJobFailed,
    markJobTimedOut,
    markJobCancelled,
    updateJobHeartbeat,
  };
}

// ============================================================
// AbortController registry
// Maps jobId → AbortController so job.cancel can fire the signal
// ============================================================

const _abortControllers = new Map<string, AbortController>();

export function getAbortController(jobId: string): AbortController | undefined {
  return _abortControllers.get(jobId);
}

export function registerAbortController(jobId: string, controller: AbortController): void {
  _abortControllers.set(jobId, controller);
}

export function unregisterAbortController(jobId: string): void {
  _abortControllers.delete(jobId);
}

// ============================================================
// Main helper
// ============================================================

/**
 * Execute the canonical two-transaction mutation pattern.
 *
 * This function:
 *   1. Calls txn1Enqueue to create the job row and advance document state.
 *   2. Emits job_queued telemetry.
 *   3. Transitions job to 'running' (via markJobRunning).
 *   4. Emits job_started telemetry.
 *   5. Calls the LLM adapter with a timeout AbortSignal.
 *   6. On success: calls txn2Commit, marks job completed, emits job_completed.
 *   7. On failure: calls txn2Revert, marks job failed/timed_out, emits appropriate event.
 *
 * The caller's txn1Enqueue and txn2Commit/txn2Revert are responsible for
 * document-level state transitions. This helper manages only the job row
 * and telemetry.
 */
export async function executeCanonicalMutation(
  params: CanonicalMutationParams,
): Promise<CanonicalMutationResult> {
  const {
    userId,
    jobType,
    modelString,
    matterId,
    documentId,
    txn1Enqueue,
    buildLlmParams,
    txn2Commit,
    txn2Revert,
    telemetryCtx,
    timeoutMs,
  } = params;

  const jobId = uuidv4();
  const { providerId, modelId } = parseModelString(modelString);
  const promptVersion = getPromptVersionForJobType(jobType);
  const jw = getJobWriteFunctions();

  // ──────────────────────────────────────────────────────────
  // Transaction 1: enqueue
  // ──────────────────────────────────────────────────────────
  const newJob: NewJob = {
    id: jobId,
    userId,
    matterId: matterId ?? null,
    documentId: documentId ?? null,
    jobType,
    providerId,
    modelId,
    promptVersion, // captured at creation; immutable (R11)
    status: 'queued',
    queuedAt: new Date(),
    input: {} as Record<string, unknown>, // will be populated by buildLlmParams
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await jw.insertJob(newJob);

  // Call txn1Enqueue to let the procedure write its in-flight document state
  await txn1Enqueue(jobId);

  // Emit job_queued telemetry (Ch 25.4)
  void emitTelemetry(
    'job_queued',
    { jobType, promptVersion },
    { ...telemetryCtx, jobId },
  );

  // ──────────────────────────────────────────────────────────
  // Transition to running
  // ──────────────────────────────────────────────────────────
  const startTime = Date.now();
  const rowsAffected = await jw.markJobRunning(jobId, userId);
  if (rowsAffected === 0) {
    // Job was cancelled between enqueue and pickup — this is a valid race
    return { jobId, status: 'cancelled' };
  }

  // Emit job_started telemetry (Ch 25.4)
  void emitTelemetry(
    'job_started',
    { jobType, providerId, modelId, promptVersion },
    { ...telemetryCtx, jobId },
  );

  // ──────────────────────────────────────────────────────────
  // Between transactions: LLM call
  // ──────────────────────────────────────────────────────────
  const abortController = new AbortController();
  // MR-LLM-GPT-1: use caller-supplied timeoutMs when provided (e.g. reviewer_feedback
  // with gpt-5 needs 300 000 ms); fall back to global default for all other jobs.
  const effectiveTimeoutMs = timeoutMs ?? getLlmFetchTimeoutMs();
  const timeoutSignal = AbortSignal.timeout(effectiveTimeoutMs);

  // Combine timeout signal with the job's abort controller
  // so job.cancel can fire the abort
  registerAbortController(jobId, abortController);

  // Create a combined signal that aborts on either timeout or cancel
  const combinedSignal = AbortSignal.any
    ? AbortSignal.any([timeoutSignal, abortController.signal])
    : abortController.signal; // fallback for environments without AbortSignal.any

  let llmParams = buildLlmParams(jobId);

  // FOLD-L1-2: inject the current matter state into the systemPrompt so no model call
  // dispatches "cold". Best-effort: a failed read degrades to no-injection (byte-identical
  // prompt) rather than failing the call. Only matter-scoped jobs (matterId present) inject.
  if (matterId) {
    let matterStateBlock = '';
    try {
      matterStateBlock = await getMatterStateProvider()({
        matterId,
        userId,
        ...(documentId !== undefined ? { documentId } : {}),
      });
    } catch (err) {
      void emitTelemetry(
        'procedure_error',
        {
          procedureName: 'matterStateInjection',
          errorCode: 'MATTER_STATE_INJECT_FAILED',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
        { ...telemetryCtx, jobId },
      );
    }
    if (matterStateBlock) {
      llmParams = { ...llmParams, systemPrompt: `${matterStateBlock}\n\n${llmParams.systemPrompt}` };
    }
  }

  // FOLD-KB-1 Inc4 (Fork E): auto-load the attorney's CONFIRMED per-PA master prompt, prepended
  // OUTERMOST (it is the attorney's own top-level instruction). Best-effort: a failed/absent load
  // degrades to the base prompt (byte-identical) — never a mismatched PA. Captures the loaded
  // profile id+version for THIS job in the append-only kb_events trail (R11 immutability) — no
  // jobs-table change required.
  if (matterId) {
    try {
      const profile = await getPaProfileProvider()({ matterId, userId });
      if (profile && profile.body) {
        llmParams = { ...llmParams, systemPrompt: `${profile.body}\n\n${llmParams.systemPrompt}` };
        void recordKbEvent({
          userId,
          action: 'pa_profile_loaded_for_job',
          targetType: 'pa_instruction_profile',
          targetId: profile.profileId,
          summary: `Loaded PA profile (paKey=${profile.paKey}, v${profile.version}) for job`,
          payload: { jobId, profileId: profile.profileId, version: profile.version, paKey: profile.paKey },
        });
      }
    } catch (err) {
      void emitTelemetry(
        'procedure_error',
        {
          procedureName: 'paProfileInjection',
          errorCode: 'PA_PROFILE_INJECT_FAILED',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
        { ...telemetryCtx, jobId },
      );
    }
  }

  const adapter = resolveAdapter(modelString);

  // Update heartbeat before LLM call (Ch 8.5 checkpoint 2)
  await jw.updateJobHeartbeat(jobId, userId);

  let llmResult: Awaited<ReturnType<typeof adapter.generate>>;
  try {
    llmResult = await adapter.generate({ ...llmParams, signal: combinedSignal });
  } catch (err) {
    unregisterAbortController(jobId);
    const elapsedMs = Date.now() - startTime;

    // Determine if this was a timeout or cancellation
    const isTimeout =
      err instanceof Error &&
      (err.name === 'AbortError' || err.name === 'TimeoutError') &&
      timeoutSignal.aborted;

    const isCancelled =
      err instanceof Error &&
      (err.name === 'AbortError' || err.name === 'TimeoutError') &&
      abortController.signal.aborted;

    if (isCancelled) {
      // Transaction 2 — cancel path
      const revertParams: Txn2RevertParams = {
        jobId,
        errorClass: 'other',
        errorMessage: 'Cancelled by attorney',
      };
      try {
        await txn2Revert(revertParams);
      } catch (revertErr) {
        await jw.markJobFailed(jobId, userId, 'revert_failed', `Revert after cancel failed: ${String(revertErr)}`);
        void emitTelemetry(
          'job_failed',
          { jobType, errorClass: 'revert_failed', errorMessage: String(revertErr) },
          { ...telemetryCtx, jobId },
        );
        return { jobId, status: 'failed' };
      }
      await jw.markJobCancelled(jobId, userId);
      void emitTelemetry(
        'job_cancelled',
        { jobType, elapsedMs, cancelOrigin: 'attorney' },
        { ...telemetryCtx, jobId },
      );
      return { jobId, status: 'cancelled' };
    }

    if (isTimeout) {
      // Transaction 2 — timeout path
      const revertParams: Txn2RevertParams = {
        jobId,
        errorClass: 'timeout',
        errorMessage: `Job timed out after ${elapsedMs}ms`,
      };
      try {
        await txn2Revert(revertParams);
      } catch (revertErr) {
        await jw.markJobFailed(jobId, userId, 'revert_failed', `Revert after timeout failed: ${String(revertErr)}`);
        void emitTelemetry(
          'job_failed',
          { jobType, errorClass: 'revert_failed', errorMessage: String(revertErr) },
          { ...telemetryCtx, jobId },
        );
        return { jobId, status: 'failed' };
      }
      await jw.markJobTimedOut(jobId, userId, `Job timed out after ${elapsedMs}ms`);
      void emitTelemetry(
        'job_timed_out',
        { jobType, timeoutMs: effectiveTimeoutMs, elapsedMs },
        { ...telemetryCtx, jobId },
      );
      return { jobId, status: 'timed_out' };
    }

    // Transaction 2 — failure path (HTTP/parse error)
    const errorClass = classifyProviderError(err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    const revertParams: Txn2RevertParams = { jobId, errorClass, errorMessage };
    try {
      await txn2Revert(revertParams);
    } catch (revertErr) {
      await jw.markJobFailed(jobId, userId, 'revert_failed', `Revert after failure failed: ${String(revertErr)}`);
      void emitTelemetry(
        'job_failed',
        { jobType, errorClass: 'revert_failed', errorMessage: String(revertErr) },
        { ...telemetryCtx, jobId },
      );
      return { jobId, status: 'failed' };
    }
    await jw.markJobFailed(jobId, userId, errorClass, errorMessage);
    void emitTelemetry(
      'job_failed',
      { jobType, errorClass, errorMessage },
      { ...telemetryCtx, jobId },
    );
    return { jobId, status: 'failed' };
  }

  unregisterAbortController(jobId);

  // Update heartbeat after LLM call returns (Ch 8.5 checkpoint 3)
  await jw.updateJobHeartbeat(jobId, userId);

  // ──────────────────────────────────────────────────────────
  // Transaction 2: commit
  // ──────────────────────────────────────────────────────────
  const elapsedMs = Date.now() - startTime;
  const commitParams: Txn2CommitParams = {
    jobId,
    output: llmResult.content,
    tokensPrompt: llmResult.tokensPrompt,
    tokensCompletion: llmResult.tokensCompletion,
  };

  try {
    await txn2Commit(commitParams);
  } catch (commitErr) {
    // Commit failed — treat as a failure with revert
    const revertParams: Txn2RevertParams = {
      jobId,
      errorClass: 'other',
      errorMessage: `Transaction 2 commit failed: ${String(commitErr)}`,
    };
    try {
      await txn2Revert(revertParams);
    } catch (revertErr) {
      await jw.markJobFailed(jobId, userId, 'revert_failed', `Revert after commit failure failed: ${String(revertErr)}`);
      void emitTelemetry(
        'job_failed',
        { jobType, errorClass: 'revert_failed', errorMessage: String(revertErr) },
        { ...telemetryCtx, jobId },
      );
      return { jobId, status: 'failed' };
    }
    await jw.markJobFailed(jobId, userId, 'other', String(commitErr));
    void emitTelemetry(
      'job_failed',
      { jobType, errorClass: 'other', errorMessage: String(commitErr) },
      { ...telemetryCtx, jobId },
    );
    return { jobId, status: 'failed' };
  }

  await jw.markJobCompleted(
    jobId,
    userId,
    llmResult.content,
    llmResult.tokensPrompt,
    llmResult.tokensCompletion,
  );

  void emitTelemetry(
    'job_completed',
    {
      jobType,
      tokensPrompt: llmResult.tokensPrompt,
      tokensCompletion: llmResult.tokensCompletion,
      durationMs: elapsedMs,
    },
    { ...telemetryCtx, jobId },
  );

  return { jobId, status: 'completed' };
}
