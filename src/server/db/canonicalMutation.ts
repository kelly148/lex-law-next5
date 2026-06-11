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
import { classifyProviderError, isUndiciTimeoutError, type LlmGenerateParams } from '../llm/types.js';
import { deriveTokenAccounting, formatTokenAccounting } from '../llm/tokenAccounting.js';
import { getLlmFetchTimeoutMs, parseModelString } from '../llm/config.js';
import { buildMatterStateContextBlock } from '../matterState/injection.js';
import { buildActivePaProfileForMatter, type LoadedPaProfile } from '../practiceKb/profileInjection.js';
import { recordKbEvent } from './queries/kbEvents.js';
import { resolvePromptComposition } from '../llm/assemblePrompt.js';
import { sha256Hex } from '../llm/promptAssets.js';
import { insertPromptSnapshot } from './queries/promptSnapshots.js';
import type { NewJob, JobType, NewPromptSnapshot } from './schema.js';

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
// INSTR-1A0 — prompt-snapshot writer (test-injectable)
// ============================================================
// Every DRAFT job (draft_generation + regeneration; both paths, flag on or off) persists
// the full composed system text actually sent. BEST-EFFORT like the chokepoint's other
// provenance writes: a snapshot failure is logged loudly but never breaks a model call.

const DRAFT_SNAPSHOT_JOB_TYPES: ReadonlySet<string> = new Set(['draft_generation', 'regeneration']);

type PromptSnapshotWriter = (row: NewPromptSnapshot) => Promise<void>;

let _promptSnapshotWriter: PromptSnapshotWriter | null = null;

/** Override the prompt-snapshot writer for tests. Pass null to restore the real DB insert. */
export function setPromptSnapshotWriter(fn: PromptSnapshotWriter | null): void {
  _promptSnapshotWriter = fn;
}

function getPromptSnapshotWriter(): PromptSnapshotWriter {
  return _promptSnapshotWriter ?? insertPromptSnapshot;
}

// ============================================================
// MODEL-RELIABILITY-UAT-1 — bounded retry on transient provider failures
// ============================================================
// The single LLM chokepoint had NO retry layer: any transient blip (provider 5xx,
// 429 rate limit, a dropped socket) failed the job — and, for a multi-reviewer session,
// surfaced to the attorney as a failed lane. We add a bounded retry around the generate()
// call ONLY for transient classes. We deliberately do NOT retry:
//   - timeout aborts  — the budget is already spent; retrying multiplies wall-clock and
//                       worsens the exact "reviewer timeout" symptom this engagement chased.
//   - cancellation    — the attorney asked to stop.
//   - auth_error      — a bad/again-bad key; retrying spams a 401/403.
//   - parse_error     — deterministic-ish output shape; a re-roll is a separate decision.
//   - generic api_error (4xx / no-candidates / missing-key) — not transient.

const MAX_LLM_RETRIES = 2;

/** Backoff before retry attempt N (1-based): 500ms, 1500ms. */
function retryBackoffMs(attempt: number): number {
  return 500 * Math.pow(3, attempt - 1);
}

/**
 * Decide whether a failed generate() attempt should be retried. Transient =
 * rate_limited (429), a 5xx server error (classified api_error with a 5xx in the
 * message), or a transient network error. Aborts (timeout/cancel), auth, parse, and a
 * request-level undici timeout (a slow model — REVIEWER-RETRY-SUPPRESS-1) are never retried.
 */
export function isTransientRetryable(err: unknown): boolean {
  // Never retry an abort (timeout fired or cancel requested).
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return false;
  }
  // REVIEWER-RETRY-SUPPRESS-1: a request-level timeout that surfaces as a generic "fetch failed"
  // (undici headers/body/connect timeout) is a SLOW-RESPONSE failure, not a transient network
  // blip — re-running at the same budget just times out again. Do NOT retry it (a big-doc GPT-5
  // review otherwise burns ~3x its multi-minute wall clock on doomed reruns). Genuine transient
  // network errors (ECONNRESET, socket hang up) fall through to the retryable check below.
  //
  // REVIEWER-ASYNC-FANOUT-1 Inc 2: the background reviewer envelope is now RAISED to 720s (async
  // mode) and llmFetch raises undici's internal headers/body timeout above it, so the per-call
  // AbortSignal governs. Suppress-always REMAINS correct: a timeout at the 720s boundary means the
  // model exceeded a GENEROUS deep-reasoning budget (big-doc GPT-5 completes in ~11 min < 12), so a
  // same-budget retry would just time out again and burn another ~12 min. Re-evaluate only if a
  // genuine transient mid-stream stall (distinct from the model's normal latency) is ever observed.
  if (isUndiciTimeoutError(err)) return false;
  const cls = classifyProviderError(err);
  if (cls === 'rate_limited') return true;
  if (cls === 'auth_error' || cls === 'parse_error') return false;
  const msg = err instanceof Error ? err.message : String(err);
  // 5xx server errors are classified api_error; distinguish by the status in the message.
  if (cls === 'api_error' && /\b5\d\d\b/.test(msg)) return true;
  // Transient network failures (adapters wrap these as api_error "<provider> fetch failed: ...").
  if (/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(msg)) return true;
  return false;
}

/** A delay that resolves early if the abort signal fires (so cancel isn't blocked by backoff). */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
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
 * DISPATCHER-COMPLETE-1: this is split into enqueueJob() + runJob(), composed by
 * executeCanonicalMutation() below as `enqueueJob() then runJob()` — BYTE-FOR-BYTE
 * behavior-identical to the pre-split function for every existing (inline) caller. The
 * durable dispatcher reuses the SAME runJob() half to execute a job that was left 'queued'
 * (the deferred path), so async work survives as a real DB row + an atomic claim rather than
 * an in-process fire-and-forget promise.
 *
 * enqueueJob — Transaction 1 ONLY: insert the jobs row 'queued', advance document state via
 * txn1Enqueue, emit job_queued. Returns the new jobId. No 'running' transition, no LLM call.
 */
async function enqueueJob(params: CanonicalMutationParams): Promise<string> {
  const {
    userId,
    jobType,
    modelString,
    matterId,
    documentId,
    txn1Enqueue,
    telemetryCtx,
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

  return jobId;
}

/**
 * runJob — the run half: atomically claim the job (queued->running), call the LLM inside the
 * timeout/cancel envelope, then Transaction 2 (commit on success; revert on failure/timeout/
 * cancel). Reused VERBATIM by both executeCanonicalMutation (inline) and the dispatcher
 * (deferred). A 0-row claim means the job was cancelled, or another dispatcher worker already
 * claimed it (DISPATCHER-COMPLETE-1 D-2) — never run the job twice.
 */
async function runJob(
  jobId: string,
  params: CanonicalMutationParams,
): Promise<CanonicalMutationResult> {
  const {
    userId,
    jobType,
    modelString,
    matterId,
    documentId,
    buildLlmParams,
    txn2Commit,
    txn2Revert,
    telemetryCtx,
    timeoutMs,
  } = params;

  const { providerId, modelId } = parseModelString(modelString);
  const promptVersion = getPromptVersionForJobType(jobType);
  const jw = getJobWriteFunctions();

  // ──────────────────────────────────────────────────────────
  // Transition to running (DISPATCHER-COMPLETE-1 D-2: the atomic claim)
  // ──────────────────────────────────────────────────────────
  const startTime = Date.now();
  const rowsAffected = await jw.markJobRunning(jobId, userId);
  if (rowsAffected === 0) {
    // Cancelled between enqueue and pickup, OR another dispatcher worker already claimed it
    // (D-2) — a valid race; never run the job twice.
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

  // Combine timeout signal with the job's abort controller so job.cancel can fire the abort.
  registerAbortController(jobId, abortController);

  // MODEL-RELIABILITY-UAT-1: timeoutSignal is (re)created per attempt inside the retry
  // helper below (AbortSignal.timeout is one-shot). This outer binding holds the LAST
  // attempt's signal so the failure handler can still tell a timeout abort from a cancel
  // abort. The abortController (cancel) persists across all retry attempts; each attempt
  // gets the FULL per-job timeout budget (retries are for fast transient failures, not
  // for extending a slow call).
  let timeoutSignal!: AbortSignal;

  let llmParams = buildLlmParams(jobId);

  // INSTR-1A0: the single prompt-composition chokepoint. Decides ONCE per dispatch whether
  // the system block is a verbatim hash-pinned master asset (flag-gated; draft + Anthropic
  // drafter + exact-match T&E only) or the legacy path. Flag OFF (the default) returns
  // 'legacy' with ZERO DB reads, and the else-branch below is the pre-INSTR-1A0 code
  // byte-for-byte — zero behavior change anywhere.
  const composition = await resolvePromptComposition({
    jobType,
    modelString,
    matterId: matterId ?? null,
    documentId: documentId ?? null,
    userId,
  });

  if (composition.systemText !== null) {
    // Composed path: the master IS the ENTIRE system block. The matter-state and PA-profile
    // prepends are intentionally NOT applied here — no per-job data may enter the system
    // block (cache hygiene); matter materials/context continue to ride the user turn.
    llmParams = { ...llmParams, systemPrompt: composition.systemText };
  } else {
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
  }

  // INSTR-1A0: snapshot the FULL system block actually sent for every draft job — both
  // paths, flag on or off. Runs AFTER all assembly so the row is byte-faithful to the
  // request. Best-effort: a snapshot failure is logged loudly but never breaks the call.
  if (DRAFT_SNAPSHOT_JOB_TYPES.has(jobType)) {
    try {
      await getPromptSnapshotWriter()({
        id: uuidv4(),
        userId,
        jobId,
        matterId: matterId ?? null,
        documentId: documentId ?? null,
        jobType,
        callRole: composition.callRole,
        source: composition.source,
        assetId: composition.source === 'legacy' ? null : composition.source,
        assetSha256: composition.assetSha256,
        systemText: llmParams.systemPrompt,
        systemSha256: sha256Hex(llmParams.systemPrompt),
        flagEnabled: composition.flagEnabled,
        modelString,
        providerId,
        modelId,
        // The registry maps provider -> adapter 1:1 (resolveAdapter); recorded separately
        // so a future multi-adapter provider stays distinguishable in old rows.
        adapterId: providerId,
      });
    } catch (err) {
      void emitTelemetry(
        'procedure_error',
        {
          procedureName: 'promptSnapshot',
          errorCode: 'PROMPT_SNAPSHOT_WRITE_FAILED',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
        { ...telemetryCtx, jobId },
      );
      // eslint-disable-next-line no-console
      console.warn(`[canonicalMutation] prompt snapshot write failed for job ${jobId} (${jobType})`);
    }
  }

  const adapter = resolveAdapter(modelString);

  // Update heartbeat before LLM call (Ch 8.5 checkpoint 2)
  await jw.updateJobHeartbeat(jobId, userId);

  // MODEL-RELIABILITY-UAT-1: call generate() with a bounded retry on transient failures.
  // Each attempt re-arms a fresh timeout signal (recorded in the outer timeoutSignal for
  // the failure handler) combined with the persistent cancel controller. A cancel stops
  // retries immediately; the backoff itself is cancel-aware.
  const generateWithRetry = async (): Promise<Awaited<ReturnType<typeof adapter.generate>>> => {
    let attempt = 0;
    for (;;) {
      timeoutSignal = AbortSignal.timeout(effectiveTimeoutMs);
      const combinedSignal = AbortSignal.any
        ? AbortSignal.any([timeoutSignal, abortController.signal])
        : abortController.signal; // fallback for environments without AbortSignal.any
      try {
        return await adapter.generate({ ...llmParams, signal: combinedSignal });
      } catch (err) {
        // Cancel always stops immediately; never retry once the attorney cancelled.
        if (abortController.signal.aborted) throw err;
        if (attempt >= MAX_LLM_RETRIES || !isTransientRetryable(err)) throw err;
        attempt += 1;
        await abortableDelay(retryBackoffMs(attempt), abortController.signal);
        if (abortController.signal.aborted) throw err;
        await jw.updateJobHeartbeat(jobId, userId);
        const cls = classifyProviderError(err);
        // Surface retries in the server log (no new telemetry event type — keeps the
        // telemetry contract untouched). errorClass on the eventual failure still records
        // the final class if all retries are exhausted.
        // eslint-disable-next-line no-console
        console.warn(
          `[canonicalMutation] transient ${cls} on job ${jobId} (${jobType}); retry ${attempt}/${MAX_LLM_RETRIES}`,
        );
      }
    }
  };

  let llmResult: Awaited<ReturnType<typeof adapter.generate>>;
  try {
    llmResult = await generateWithRetry();
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

  // REVIEWER-LATENCY-1 Step 0: persist the reasoning-token count that already rides on the adapter
  // result (dropped at the DB boundary until now). Per-provider semantics are AS-REPORTED — see
  // markJobCompleted / schema.ts. null when the provider does not report it (Anthropic always).
  const tokensReasoning = llmResult.tokensReasoning ?? null;

  await jw.markJobCompleted(
    jobId,
    userId,
    llmResult.content,
    llmResult.tokensPrompt,
    llmResult.tokensCompletion,
    tokensReasoning,
  );

  void emitTelemetry(
    'job_completed',
    {
      jobType,
      tokensPrompt: llmResult.tokensPrompt,
      tokensCompletion: llmResult.tokensCompletion,
      // REVIEWER-LATENCY-1 Step 0: durable telemetry now agrees with the [token-accounting] log.
      tokensReasoning,
      durationMs: elapsedMs,
    },
    { ...telemetryCtx, jobId },
  );

  // GEMINI-BUDGET-CAL-1 (Inc 1, measurement): per-call token-accounting log — the per-provider
  // reasoning/output split, distance-to-truncation (leading indicator on a SUCCESSFUL call),
  // and emitted-output fraction. Best-effort observability ONLY: wrapped so it can never affect
  // the job outcome, emits to the server log (no telemetry-contract or schema change), and reads
  // the finish/stop reason from providerMetadata.
  try {
    const finishReason =
      (llmResult.providerMetadata?.['finishReason'] as string | undefined) ??
      (llmResult.providerMetadata?.['stopReason'] as string | undefined) ??
      null;
    const accounting = deriveTokenAccounting({
      modelString,
      requestedMaxTokens: llmParams.maxTokens ?? null,
      tokensPrompt: llmResult.tokensPrompt,
      tokensCompletion: llmResult.tokensCompletion,
      tokensReasoning: llmResult.tokensReasoning ?? null,
      finishReason,
    });
    // eslint-disable-next-line no-console
    console.info(`[token-accounting] job=${jobId} ${jobType} ${formatTokenAccounting(accounting)}`);
  } catch {
    // observability must never affect the job outcome
  }

  return { jobId, status: 'completed' };
}

/**
 * The canonical inline path: enqueue (Transaction 1) then run (claim + LLM + Transaction 2).
 * BYTE-FOR-BYTE behavior-identical to the pre-split executeCanonicalMutation — every existing
 * caller is unchanged. The enqueue/run split exists only so the dispatcher can reuse runJob().
 */
export async function executeCanonicalMutation(
  params: CanonicalMutationParams,
): Promise<CanonicalMutationResult> {
  const jobId = await enqueueJob(params);
  return runJob(jobId, params);
}

// ============================================================
// DISPATCHER-COMPLETE-1 — deferred-dispatch registry (D-1 / D-4)
// ============================================================
// The async-reviewer path (reviewSession) enqueues a job 'queued' and registers its
// continuation here keyed by jobId; the durable dispatcher later claims + runs it via the
// SAME runJob() half. In-memory + non-durable BY DESIGN: a process restart drops the
// continuation, but the jobs ROW survives in 'queued'/'running' state (a real, recoverable
// row). Durable reconstruction-from-job.input across a restart is JOB-RECOVERY-1
// (Component B) — note job.input is currently a placeholder {}, so B owns that work. [A->B seam]

const _deferredJobParams = new Map<string, CanonicalMutationParams>();

/**
 * Enqueue a job 'queued' (Transaction 1) and register its continuation for the dispatcher to
 * run later. Returns the new jobId WITHOUT running the LLM. Used behind JOB_DISPATCHER_ENABLED.
 */
export async function enqueueCanonicalJobForDispatcher(
  params: CanonicalMutationParams,
): Promise<string> {
  const jobId = await enqueueJob(params);
  _deferredJobParams.set(jobId, params);
  return jobId;
}

/**
 * True if an in-memory continuation exists for jobId. The dispatcher checks this so it never
 * claims a job whose continuation was lost to a restart — that job is left 'queued' for
 * JOB-RECOVERY-1 (Component B) to reap/reconstruct.
 */
export function hasDeferredContinuation(jobId: string): boolean {
  return _deferredJobParams.has(jobId);
}

/**
 * Run a previously-enqueued (deferred) job to terminal via runJob() — which performs the atomic
 * claim, so a lost race no-ops safely. Returns null when no continuation is registered (e.g.
 * after a restart): the job ROW is left untouched ('queued') for Component B. The continuation
 * is cleared once consumed.
 */
export async function runDeferredCanonicalJob(
  jobId: string,
): Promise<CanonicalMutationResult | null> {
  const params = _deferredJobParams.get(jobId);
  if (!params) return null;
  try {
    return await runJob(jobId, params);
  } finally {
    _deferredJobParams.delete(jobId);
  }
}

/** TEST-ONLY: clear the deferred registry between tests (mirrors setJobWriteFunctions(null)). */
export function clearDeferredJobParamsForTest(): void {
  _deferredJobParams.clear();
}
