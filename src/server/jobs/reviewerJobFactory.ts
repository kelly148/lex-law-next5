/**
 * reviewerJobFactory — EGRESS-CONTROL-PLANE-1 Increment 2 (durable outbox + CR-4)
 *
 * The reviewer_feedback job's runtime params (txn2Commit/txn2Revert/buildLlmParams/onRunning) are
 * CLOSURES that capture the document, session, reviewer role, and prompts. Before this increment they
 * lived ONLY in an in-memory Map (_deferredJobParams), so a process restart between commit and run
 * stranded the queued job forever. This module is the single place that:
 *
 *   1. SERIALIZES everything needed to reconstruct a reviewer call into jobs.input (buildReviewerJobRow),
 *      so a committed-but-not-yet-run job survives a restart (the TRUE durable outbox);
 *   2. REBUILDS the canonical-mutation params from that durable input (buildReviewerCanonicalParams),
 *      reused VERBATIM by reviewSession.create (at enqueue) AND the dispatcher (reconstruct-after-restart),
 *      so there is exactly one reviewer runtime contract;
 *   3. FINALIZES the session lifecycle when all lanes settle (finalizeSessionLifecycleIfSettled), recording
 *      the partial-by-hold vs partial-by-non-response reason — the Inc-2 data foundation for the Inc-3 send gate.
 *
 * The output schema (RawSuggestionsArraySchema) and the latency knobs are RE-DERIVED from jobType +
 * modelString (deterministic), so they are intentionally NOT stored in jobs.input. The prompt text in
 * jobs.input is CLEARED on terminal (markJob* reset input to {}), so it never lingers as a second copy.
 *
 * INCREMENT-3 SEAM (do NOT wire here): the per-reviewer transmit is runJob -> adapter.generate (inside the
 * canonical chokepoint, already on the egress CI-guard allowlist). In Inc 3 that single call is wrapped by
 * the Inc-1 egress primitive as a `document_job` EgressSubject — the durable input above already carries
 * everything that subject needs (matterId / documentId / documentVersionId / jobId / userId / modelString).
 */
import { parseModelString, resolveReviewerLatencyTuning } from '../llm/config.js';
import { getPromptVersionForJobType } from '../llm/promptVersions.js';
import { parseFeedbackOutput, RawSuggestionsArraySchema } from '../llm/parsers/feedbackParser.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';
import type { NewJob } from '../db/schema.js';
import type { CanonicalMutationParams } from '../db/canonicalMutation.js';
import { insertFeedback, setReviewSessionSettled } from '../db/queries/phase4b.js';
import {
  markReviewerLaneRunning,
  markReviewerLaneTerminal,
  listReviewerLanesForSession,
} from '../db/queries/reviewerLaneState.js';
import {
  TERMINAL_LANE_STATUSES,
  HOLD_BLOCKED_LANE_STATUSES,
  FAILURE_LANE_STATUSES,
} from '../../shared/schemas/reviewerLaneState.js';
import type { JobRow } from '../../shared/schemas/jobs.js';
import type { SessionPartialReasonValue } from '../../shared/schemas/phase4b.js';

const REVIEWER_JOB_TYPE = 'reviewer_feedback' as const;

/**
 * Everything needed to (a) build the queued reviewer job row for the atomic outbox commit and
 * (b) rebuild the canonical-mutation closures — at enqueue AND after a restart.
 */
export interface ReviewerDurableInput {
  jobId: string;
  userId: string;
  matterId: string;
  documentId: string;
  documentVersionId: string;
  reviewSessionId: string;
  iterationNumber: number;
  reviewerRole: string;
  reviewerTitle: string;
  modelString: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  /** True when the reviewer runs on the async lane (lanes exist); false for the sync inline path. */
  async: boolean;
}

/** The per-(session, lane) durable-outbox idempotency key (one reviewer job per session+role). */
export function reviewerIdempotencyKey(reviewSessionId: string, reviewerRole: string): string {
  return `${reviewSessionId}:${reviewerRole}`;
}

/**
 * Build the QUEUED reviewer job row for the atomic outbox commit. jobs.input carries the FROZEN prompt
 * (systemPrompt/userPrompt) plus the structural reconstruction params; idempotencyKey enforces one
 * reviewer job per (session, lane). The dispatcher reconstructs from this exact shape after a restart.
 */
export function buildReviewerJobRow(input: ReviewerDurableInput): NewJob {
  const { providerId, modelId } = parseModelString(input.modelString);
  const now = new Date();
  // Built as a plain Record (the jobs.input column type); validated against JobInputSchema on READ.
  const jobInput: Record<string, unknown> = {
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    materialsManifest: [],
    roleMetadata: {},
    reviewerReconstruction: {
      reviewSessionId: input.reviewSessionId,
      reviewerRole: input.reviewerRole,
      reviewerTitle: input.reviewerTitle,
      modelString: input.modelString,
      iterationNumber: input.iterationNumber,
      matterId: input.matterId,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      timeoutMs: input.timeoutMs,
      async: input.async,
    },
  };
  return {
    id: input.jobId,
    userId: input.userId,
    matterId: input.matterId,
    documentId: input.documentId,
    idempotencyKey: reviewerIdempotencyKey(input.reviewSessionId, input.reviewerRole),
    jobType: REVIEWER_JOB_TYPE,
    providerId,
    modelId,
    promptVersion: getPromptVersionForJobType(REVIEWER_JOB_TYPE),
    status: 'queued',
    queuedAt: now,
    input: jobInput,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Rebuild the canonical-mutation params (the runtime contract) from durable input. Used by
 * reviewSession.create at enqueue AND by the dispatcher to reconstruct a continuation-less job after a
 * restart. The output schema + latency knobs are re-derived (deterministic from jobType + modelString).
 */
export function buildReviewerCanonicalParams(input: ReviewerDurableInput): CanonicalMutationParams {
  const {
    userId,
    matterId,
    documentId,
    documentVersionId,
    reviewSessionId,
    iterationNumber,
    reviewerRole,
    reviewerTitle,
    modelString,
    systemPrompt,
    userPrompt,
    temperature,
    maxTokens,
    timeoutMs,
    async: isAsync,
  } = input;

  const params: CanonicalMutationParams = {
    userId,
    jobType: REVIEWER_JOB_TYPE,
    modelString,
    matterId,
    documentId,
    // txn1Enqueue is NOT invoked in the outbox path: the job row is inserted atomically in the commit
    // transaction, and runJob (the run half) never calls it. Provided only to satisfy the contract.
    txn1Enqueue: async (jobId) => ({ jobId }),
    buildLlmParams: (_jobId) => ({
      systemPrompt,
      userPrompt,
      temperature,
      structuredOutputSchema: RawSuggestionsArraySchema,
      maxTokens,
      // Flag-gated, gpt-5-reviewer-only latency knobs; null (spread adds nothing) otherwise — re-derived,
      // so a tuning flip applies on the NEXT run without re-storing input (matches the pre-outbox path).
      ...(resolveReviewerLatencyTuning(REVIEWER_JOB_TYPE, modelString) ?? {}),
    }),
    ...(isAsync
      ? {
          onRunning: async () => {
            // DOC-PANE-LANE-RUNNING-1: flip pending->running when the model call starts (best-effort,
            // guarded to non-terminal). Async-only — the sync path has no lanes.
            await markReviewerLaneRunning(reviewSessionId, reviewerRole, userId);
          },
        }
      : {}),
    timeoutMs,
    txn2Commit: async ({ jobId, output }) => {
      const rawOutput = typeof output === 'string' ? output : JSON.stringify(output);
      // MR-CAL-2G: capture the raw reviewer output for calibration auditability BEFORE the parse can throw.
      let parsedSuggestions: ReturnType<typeof parseFeedbackOutput> | null = null;
      let parseError: unknown = null;
      try {
        parsedSuggestions = parseFeedbackOutput(rawOutput);
      } catch (err) {
        parseError = err;
      }
      void emitTelemetry(
        'reviewer_output_captured',
        {
          jobId,
          reviewerRole,
          reviewerModel: modelString,
          iterationNumber,
          rawOutput,
          rawOutputLength: rawOutput.length,
          parseOk: parseError === null,
          parsedSuggestionCount: parsedSuggestions ? parsedSuggestions.length : null,
        },
        { userId, matterId, documentId, jobId },
      );
      if (parseError !== null) throw parseError;
      const suggestions = parsedSuggestions!;
      const feedbackRowId = await insertFeedback({
        userId,
        documentId,
        versionId: documentVersionId,
        iterationNumber,
        reviewSessionId,
        jobId,
        reviewerRole,
        reviewerModel: modelString,
        reviewerTitle,
        suggestions,
      });
      if (isAsync) {
        // Terminalize the lane from job completion (condition 3), AFTER insertFeedback (condition 10).
        // Best-effort: a lane-write failure must not break feedback persistence; the deadline sweep backstops.
        void markReviewerLaneTerminal(reviewSessionId, reviewerRole, userId, {
          status: suggestions.length > 0 ? 'completed_with_feedback' : 'completed_without_feedback',
          suggestionCount: suggestions.length,
          feedbackRowId,
        }).catch((e) => console.error(`[reviewer-outbox] lane commit-update failed (${reviewerRole}):`, e));
        void finalizeSessionLifecycleIfSettled(reviewSessionId, userId);
      }
      void emitTelemetry(
        'generation_completed',
        { jobId, operation: 'reviewer_feedback', newVersionNumber: iterationNumber },
        { userId, matterId, documentId, jobId },
      );
    },
    txn2Revert: async ({ jobId, errorClass }) => {
      void emitTelemetry(
        'generation_reset',
        { jobId, operation: 'reviewer_feedback', reason: errorClass === 'timeout' ? 'timeout' : 'failure' },
        { userId, matterId, documentId, jobId },
      );
      if (isAsync) {
        void markReviewerLaneTerminal(reviewSessionId, reviewerRole, userId, {
          status: errorClass === 'timeout' ? 'timed_out' : 'failed',
          failureReason: errorClass,
        }).catch((e) => console.error(`[reviewer-outbox] lane revert-update failed (${reviewerRole}):`, e));
        void finalizeSessionLifecycleIfSettled(reviewSessionId, userId);
      }
    },
    telemetryCtx: { userId, matterId, documentId, jobId: null },
  };
  return params;
}

/**
 * Reconstruct the reviewer params from a persisted job row (the dispatcher's restart fallback). Returns
 * null when the row is not a reconstructable reviewer job — a non-reviewer jobType, or input that was
 * CLEARED on terminal (prompt absent) — so the dispatcher leaves it alone instead of busy-polling.
 */
export function reconstructReviewerParamsFromJob(job: JobRow): CanonicalMutationParams | null {
  if (job.jobType !== REVIEWER_JOB_TYPE) return null;
  const r = job.input.reviewerReconstruction;
  const systemPrompt = job.input.systemPrompt;
  const userPrompt = job.input.userPrompt;
  if (!r || !systemPrompt || !userPrompt) return null;
  return buildReviewerCanonicalParams({
    jobId: job.id,
    userId: job.userId,
    matterId: r.matterId,
    documentId: r.documentId,
    documentVersionId: r.documentVersionId,
    reviewSessionId: r.reviewSessionId,
    iterationNumber: r.iterationNumber,
    reviewerRole: r.reviewerRole,
    reviewerTitle: r.reviewerTitle,
    modelString: r.modelString,
    systemPrompt,
    userPrompt,
    temperature: r.temperature,
    maxTokens: r.maxTokens,
    timeoutMs: r.timeoutMs,
    async: r.async,
  });
}

/**
 * BEST-EFFORT: once ALL of a session's reviewer lanes are terminal, mark the session 'completed'
 * (companion lifecycle phase) and record the partial-fan-out reason — the Inc-2 data foundation the Inc-3
 * send gate reads. Hold-block takes precedence over non-response (a deliberate "don't transmit" must be
 * acknowledged even alongside an unrelated failure). NEVER throws into the reviewer txn2 path; the read-
 * time derivation (reviewSession.get's lanes contract) and the setReviewSessionSettled guard backstop it.
 * No-ops on the sync path (no lanes) — sync finalization happens in reviewSession.create.
 */
export async function finalizeSessionLifecycleIfSettled(
  reviewSessionId: string,
  userId: string,
): Promise<void> {
  try {
    const lanes = await listReviewerLanesForSession(reviewSessionId, userId);
    if (lanes.length === 0) return;
    const allTerminal = lanes.every((l) => TERMINAL_LANE_STATUSES.has(l.status));
    if (!allTerminal) return;
    let holdBlocked = false;
    let failed = false;
    for (const l of lanes) {
      if (HOLD_BLOCKED_LANE_STATUSES.has(l.status)) holdBlocked = true;
      else if (FAILURE_LANE_STATUSES.has(l.status)) failed = true;
    }
    const partialReason: SessionPartialReasonValue | null = holdBlocked
      ? 'blocked_by_hold'
      : failed
        ? 'non_response'
        : null;
    await setReviewSessionSettled(reviewSessionId, userId, partialReason);
  } catch (e) {
    console.error(`[reviewer-outbox] finalizeSessionLifecycleIfSettled failed (session ${reviewSessionId}):`, e);
  }
}
