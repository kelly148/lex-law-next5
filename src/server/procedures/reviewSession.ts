/**
 * reviewSession.* tRPC procedures — Phase 4b (Ch 21.9)
 *
 * Procedures:
 *   reviewSession.create               — open session, fan out reviewer jobs
 *   reviewSession.updateSelection      — autosave selections
 *   reviewSession.updateGlobalInstructions — autosave global instructions
 *   reviewSession.get                  — fetch session with feedback + evaluation
 *   reviewSession.regenerate           — commit selections, delegate to document.regenerate
 *   reviewSession.regenerateSingleReviewer — single-reviewer regeneration
 *   reviewSession.abandon              — transition to abandoned
 *
 * Hard boundaries (enforced):
 *   - Decision #41: evaluator always uses EVALUATOR_MODEL env — never attorney-selectable
 *   - Decision #42: selectedReviewers required; no server-side default
 *   - R4: all LLM-producing paths use executeCanonicalMutation
 *   - R5: positive-selection only — only feedback_manual_selections rows are written
 *   - R10: activeSessionKey uniqueness enforced at DB level (generated column)
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';
import {
  executeCanonicalMutation,
  // EGRESS-CONTROL-PLANE-1 Inc 2 (durable outbox): register an already-committed reviewer continuation
  // and run it via the SAME deferred path (sync inline + async background); the atomic claim dedupes.
  registerDeferredContinuation,
  runDeferredCanonicalJob,
} from '../db/canonicalMutation.js';
import { REVIEWER_TITLES, EVALUATOR_MODEL, PRIMARY_DRAFTER_MODEL, resolveReviewerModel, type ReviewerKey, type LiteReviewerKey, type AnyReviewerKey } from '../llm/config.js';
import { getReviewerCeiling } from '../llm/modelCapabilities.js';
// EGRESS-CONTROL-PLANE-1 Inc 2 (durable outbox): the reusable reviewer-job factory (build the queued job
// row + the canonical-mutation closures from durable input) — shared with the dispatcher's reconstruction.
// The reviewer prompt parse/feedback persistence now lives INSIDE the factory.
import {
  buildReviewerJobRow,
  buildReviewerCanonicalParams,
  reviewerIdempotencyKey,
  type ReviewerDurableInput,
} from '../jobs/reviewerJobFactory.js';
import { buildEvaluatorSystemPrompt, buildEvaluatorUserPrompt } from '../llm/prompts/evaluatorPrompt.js';
import { parseEvaluatorOutputFull } from '../llm/parsers/evaluatorOutputParse.js';
import { EvaluatorOutputSchema, SendabilityVerdictSchema } from '../../shared/schemas/phase4b.js';
import { extractEmbeddedFeedbackCards } from '../llm/parsers/embeddedFeedbackCards.js';
import { buildSendabilitySystemPrompt, buildSendabilityUserPrompt } from '../llm/prompts/sendabilityPrompt.js';
import { parseSendabilityOutput } from '../llm/parsers/sendabilityOutputParse.js';
// EGRESS-CONTROL-PLANE-1: checkSendability now routes through the DOCUMENT egress control plane (was a raw
// resolveAdapter(...).generate — see egress/documentEgress.ts), so reviewSession.ts no longer reaches a
// provider primitive directly (removed from the architecture guard's REGISTRY_ALLOWED).
import { documentEgressSend } from '../egress/documentEgress.js';
import type { EgressSubject } from '../../shared/schemas/egress.js';
import {
  isMultiReviewerEnabled,
  isReviewerSelectionCountAllowed,
  isEvaluatorEnabled,
  isReviewerAsyncEnabled,
} from '../config/featureFlags.js';
import { insertJob, getJobByIdempotencyKey, requeueTerminalReviewerJob } from '../db/queries/jobs.js';
import { db } from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import {
  insertReviewerLanes,
  listReviewerLanesForSession,
  resetReviewerLaneForRerun,
} from '../db/queries/reviewerLaneState.js';
import {
  buildReviewerLanesContract,
  isTerminalLaneStatus,
  isLaneRerunnable,
  type ReviewerLaneView,
  type ReviewerLanesContract,
} from '../../shared/schemas/reviewerLaneState.js';

// REVIEWER-ASYNC-DISPLAY-1 (Component C): Component-C-owned per-reviewer terminal-deadline (condition 4,
// defense-in-depth). Must exceed the async reviewer LLM budget (720_000 ms) so a legitimately-slow
// reviewer is never reaped before it can finish; the lane sweep terminalizes anything still pending
// past this as orphaned_reaped.
const REVIEWER_LANE_TERMINAL_DEADLINE_MS = 15 * 60 * 1000; // 15 minutes
// EGRESS-CONTROL-PLANE-1 Inc 2 (CR-4): the recovery AGE-WINDOW. A session younger than this is
// CATEGORICALLY un-abandonable by the demoted recovery (decision #2: the age gate is the real safety,
// not the lane read alone). Set well above the lane terminal-deadline (15 min) AND the async reviewer
// budget (12 min), so a momentarily-stale lane read on a legitimately-in-flight session — or a just-
// committed / 'dispatching' / mid-sync session — can NEVER cause a false abandon.
const MAX_DISPATCH_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
import { buildReviewerSystemPrompt } from '../llm/prompts/reviewerPrompts.js';
import { getUserPreferences } from '../db/queries/userPreferences.js';
import { getDocumentById, updateDocumentCurrentVersion } from '../db/queries/documents.js';
import { getMatterById } from '../db/queries/matters.js';
import { recordAuditEvent } from '../db/queries/auditEvents.js';
// REVIEW-LOOP-UX-1 / R1: read projection for per-suggestion reject/defer dispositions (NEW file;
// reuses the existing FOLD-L1-1 disposition audit stream — no new table/column/migration).
import {
  listReviewSuggestionDispositionsForMatter,
  REVIEWER_SUGGESTION_TARGET_TYPE,
} from '../db/queries/reviewDisposition.js';
import { getVersionById, insertVersion, getNextVersionNumber } from '../db/queries/versions.js';
import { assembleContext } from '../context/pipeline.js';
import {
  getReviewSessionById,
  getActiveReviewSessionForDocument,
  insertReviewSession,
  updateReviewSessionState,
  // EGRESS-CONTROL-PLANE-1 Inc 2 (CR-4): companion lifecycle-phase setter, the settled-finalizer, and the
  // SOFT + fail-closed-AUDITED single-flight abandon (CAS + audit row in one tx).
  updateReviewSessionLifecyclePhase,
  setReviewSessionSettled,
  abandonReviewSessionAudited,
  // TERMINAL-SESSION-SUPERSEDE-1: soft, audited supersede (active->'regenerated', History-visible) of a
  // completed-but-unclosed session when a new review starts on the same draft.
  supersedeReviewSessionForNewReview,
  updateReviewSessionSelections,
  updateReviewSessionGlobalInstructions,
  listFeedbackForSession,
  insertFeedbackEvaluation,
  listFeedbackForDocument,
  listReviewSessionsForDocument,
  listManualSelectionsForDocument,
  getEvaluationForIteration,
  insertManualSelection,
  getNextIterationNumberForDocument,
  insertLockedDecision,
  listLockedDecisionsForDocument,
  listActiveLockedDecisionsForDocument,
  getLockedDecisionById,
  unlockLockedDecision,
  updateLockedDecision,
  insertAdoptLedgerEntry,
  listAdoptLedgerForDocument,
  listAdoptLedgerForPrompt,
  getAdoptLedgerEntryById,
  getAdoptLedgerEntryForSuggestionVersion,
  updateAdoptLedgerStatus,
  applyRegenerationToAdoptLedger,
} from '../db/queries/phase4b.js';
// NOTIFY-PRODUCERS-1: review-ready producer for the SYNC settle path (F2-off fallback; async settle
// emits from finalizeSessionLifecycleIfSettled); draft-ready producer for the review-loop regenerate.
// Idempotent per session/version + best-effort.
import { emitReviewReadyNotification, emitDraftReadyNotification } from '../db/queries/notifications.js';
import { assertNotComplete } from './documents.js';
import { type ConfirmationMode } from '../../shared/schemas/orchestration.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function assertSessionActive(state: string, procedureName: string): void {
  if (state !== 'active') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `SESSION_NOT_ACTIVE: ${procedureName} requires state='active', got '${state}'`,
    });
  }
}

/**
 * EGRESS-CONTROL-PLANE-1 Inc 2 (durable outbox): true for a MySQL/TiDB duplicate-key error. The atomic
 * outbox commit hits this when a concurrent FRESH create races on the activeSessionKey unique index — one
 * wins, the loser's WHOLE transaction rolls back (nothing persisted, no stuck-active wedge) — so the loser
 * is translated to a resumable SESSION_ALREADY_EXISTS rather than a 500.
 */
function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: string; errno?: number } | null;
  return !!e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062);
}

// ─── reviewer-prompt assembly (rerunReviewer; MIRRORS create's inline assembly) ──
// MR-CAL-6B/7B: build the bounded "## Locked Decisions" + "## Previously Adopted" sections and the
// per-reviewer durable input. These MIRROR reviewSession.create's INLINE assembly so a single-reviewer
// RE-RUN (REVIEW-LOOP-UX-1 R2) composes a byte-identical prompt against the CURRENT draft. NOTE: create
// keeps its own inline copy (its dispatch structure is source-audit-locked — REVIEWER-ASYNC-FANOUT-1), so
// if create's reviewer-prompt assembly ever changes, update these helpers in lockstep.

/** Bounded "## Locked Decisions" reviewer-prompt section (MR-CAL-6B). '' when there are no active locks. */
function buildLockedDecisionsSection(
  activeLockedDecisions: Awaited<ReturnType<typeof listActiveLockedDecisionsForDocument>>,
): string {
  const MAX_LOCKED_DECISIONS_IN_PROMPT = 50;
  const LOCKED_RATIONALE_MAX_CHARS = 500;
  if (activeLockedDecisions.length === 0) return '';
  const shown = activeLockedDecisions.slice(0, MAX_LOCKED_DECISIONS_IN_PROMPT);
  const lines = shown.map((ld, i) => {
    const rationale = (ld.rationale ?? '').replace(/\s+/g, ' ').trim().slice(0, LOCKED_RATIONALE_MAX_CHARS);
    const rationalePart = rationale ? ` Rationale: ${rationale}` : '';
    return `${i + 1}. [${ld.origin}] ${ld.summary}${rationalePart}`;
  });
  const omitted = activeLockedDecisions.length - shown.length;
  const omittedNote = omitted > 0 ? `\n(${omitted} additional locked decision(s) omitted for length.)` : '';
  return [
    '',
    '## Locked Decisions (attorney-locked — do not re-raise absent a material new fact)',
    'The supervising attorney has already decided the following for THIS document. Do not',
    're-raise these as new defects. If a genuine NEW fact in the current draft materially',
    'changes one of these, you may raise it, but mark it explicitly as a deliberate re-raise',
    '(persistence) and state the new fact — do not raise it silently.',
    ...lines,
    omittedNote,
  ].filter((s) => s !== '').join('\n');
}

/** Bounded "## Previously Adopted" reviewer-prompt section (MR-CAL-7B). '' when the adopt ledger is empty. */
function buildPreviouslyAdoptedSection(
  adoptLedgerForPrompt: Awaited<ReturnType<typeof listAdoptLedgerForPrompt>>,
): string {
  const MAX_ADOPTED_IN_PROMPT = 50;
  const ADOPTED_TEXT_MAX_CHARS = 500;
  if (adoptLedgerForPrompt.length === 0) return '';
  const shownA = adoptLedgerForPrompt.slice(0, MAX_ADOPTED_IN_PROMPT);
  const linesA = shownA.map((e, i) => {
    const txt = (e.adoptedText ?? '').replace(/\s+/g, ' ').trim().slice(0, ADOPTED_TEXT_MAX_CHARS);
    const modFlag = e.disposition === 'adopted_modified' ? ' (modified)' : '';
    return `${i + 1}.${modFlag} ${txt}`;
  });
  const omittedA = adoptLedgerForPrompt.length - shownA.length;
  const omittedNoteA = omittedA > 0 ? `\n(${omittedA} additional adopted item(s) omitted for length.)` : '';
  return [
    '',
    '## Previously Adopted (treat as intended current state — do not re-flag as new defects)',
    'The supervising attorney has already ADOPTED the following changes for THIS document',
    '(verbatim or modified). Treat them as part of the intended draft. Do not flag an adopted',
    'change as a new defect. You may still flag a genuine NEW problem the adopted text introduces,',
    'but say explicitly that it arises from the adopted change.',
    ...linesA,
    omittedNoteA,
  ].filter((s) => s !== '').join('\n');
}

/** Context for assembling ONE reviewer's durable input (the current-draft prompt + reconstruction params). */
interface ReviewerPromptContext {
  userId: string;
  matterId: string;
  documentId: string;
  documentVersionId: string;
  sessionId: string;
  iterationNumber: number;
  docTitle: string;
  currentVersionContent: string;
  lockedDecisionsSection: string;
  previouslyAdoptedSection: string;
  reviewerAsync: boolean;
}

/**
 * Build one reviewer's durable input (frozen prompt + reconstruction params) — the prompt assembly is
 * byte-identical to the established create path. Shared by create's fan-out AND rerunReviewer's single
 * re-dispatch, so a re-run reviews the CURRENT draft through the SAME factory + idempotency-keyed job slot.
 */
function buildReviewerDurableInput(reviewerRole: string, ctx: ReviewerPromptContext): ReviewerDurableInput {
  const modelString = resolveReviewerModel(reviewerRole);
  if (!modelString) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `REVIEWER_NOT_ENABLED: '${reviewerRole}' is not a valid reviewer identifier`,
    });
  }
  // MR-CAL-2: calibrated four-track prompt; legacy wrapper keys ("title"/"body"/"severity") preserved.
  const systemPrompt = buildReviewerSystemPrompt(reviewerRole as AnyReviewerKey);
  // S1a (MR-1) full document content; MR-CAL-6B locked-decisions section; MR-CAL-7B adopted section.
  const userPrompt = [
    `Review session ${ctx.sessionId}, iteration ${ctx.iterationNumber}.`,
    `Document title: ${ctx.docTitle}`,
    '',
    '## Document Content',
    ctx.currentVersionContent,
    ...(ctx.lockedDecisionsSection ? [ctx.lockedDecisionsSection] : []),
    ...(ctx.previouslyAdoptedSection ? [ctx.previouslyAdoptedSection] : []),
  ].join('\n');
  const reviewerTitle = REVIEWER_TITLES[reviewerRole as ReviewerKey | LiteReviewerKey] ?? reviewerRole;
  return {
    jobId: uuidv4(),
    userId: ctx.userId,
    matterId: ctx.matterId,
    documentId: ctx.documentId,
    documentVersionId: ctx.documentVersionId,
    reviewSessionId: ctx.sessionId,
    iterationNumber: ctx.iterationNumber,
    reviewerRole,
    reviewerTitle,
    modelString,
    systemPrompt,
    userPrompt,
    // MR-CAL-2 reviewer temperature; GEMINI-BUDGET-CAL-1 per-model ceiling; MR-LLM-GPT-1 / REVIEWER-
    // ASYNC-FANOUT-1 timeout (720 000 ms async background vs 300 000 ms sync). Frozen at enqueue.
    temperature: 0.4,
    maxTokens: getReviewerCeiling(modelString),
    timeoutMs: ctx.reviewerAsync ? 720_000 : 300_000,
    async: ctx.reviewerAsync,
  };
}

// ─── router ───────────────────────────────────────────────────────────────────

export const reviewSessionRouter = router({
  // ============================================================
  // reviewSession.create — Ch 21.9
  // Open a new review session, fan out one reviewer job per selectedReviewer,
  // and enqueue the evaluator job (env-fixed, Decision #41).
  //
  // Decision #42: selectedReviewers is REQUIRED. No server-side default.
  // R10: activeSessionKey generated column enforces uniqueness at DB level.
  // ============================================================
  create: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        iterationNumber: z.number().int().min(1),
        // Decision #42: required, non-empty.
        // MR-CAL-5B: the multi-reviewer COUNT gate is now flag-aware and enforced in
        // the resolver (isReviewerSelectionCountAllowed below), not at the schema
        // level. The schema keeps only the lower bound (at least one reviewer). When
        // MULTI_REVIEWER_ENABLED is off (default), the resolver still rejects >1 with
        // MULTI_REVIEWER_DISABLED — byte-identical to the prior MR-0G behavior.
        selectedReviewers: z.array(z.string().min(1)).min(1, {
          message: 'NO_REVIEWERS_SELECTED: at least one reviewer is required',
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      // Fetch document and validate
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'reviewSession.create');

      // Fetch matter
      const matter = await getMatterById(doc.matterId, userId);
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });

      // MR-CAL-5B: flag-aware multi-reviewer count gate (default OFF = MR-0G behavior).
      // Enforced in the resolver (not the input schema) so a single global flag
      // controls exposure. Rejects more than one reviewer with the exact
      // MULTI_REVIEWER_DISABLED message when MULTI_REVIEWER_ENABLED is off.
      if (!isReviewerSelectionCountAllowed(input.selectedReviewers.length, isMultiReviewerEnabled())) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'MULTI_REVIEWER_DISABLED: Multi-reviewer review is temporarily unavailable. Please select one reviewer.',
        });
      }

      // Validate selectedReviewers against user's enabled set (Decision #42)
      const prefs = await getUserPreferences(userId);
      const enablement = prefs.preferences.reviewerEnablement;
      // MR-LLM-LITE-1: validReviewerKeys includes both full and Lite keys.
      // Lite keys (e.g. 'gpt_lite') are always available when their parent provider
      // is enabled; they are not separately togglable in reviewerEnablement.
      const validFullKeys: ReviewerKey[] = ['claude', 'gpt', 'gemini', 'grok'];
      const validLiteKeys: LiteReviewerKey[] = ['claude_lite', 'gpt_lite', 'gemini_lite', 'grok_lite'];
      // Map Lite key → parent full key for enablement check.
      const liteToFullKey: Record<LiteReviewerKey, ReviewerKey> = {
        claude_lite: 'claude',
        gpt_lite: 'gpt',
        gemini_lite: 'gemini',
        grok_lite: 'grok',
      };

      for (const reviewerRole of input.selectedReviewers) {
        const isFullKey = validFullKeys.includes(reviewerRole as ReviewerKey);
        const isLiteKey = validLiteKeys.includes(reviewerRole as LiteReviewerKey);
        if (!isFullKey && !isLiteKey) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `REVIEWER_NOT_ENABLED: '${reviewerRole}' is not a valid reviewer identifier`,
          });
        }
        // For Lite keys, check the parent full key's enablement.
        const enablementKey: ReviewerKey = isLiteKey
          ? liteToFullKey[reviewerRole as LiteReviewerKey]
          : (reviewerRole as ReviewerKey);
        if (!enablement[enablementKey]) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `REVIEWER_NOT_ENABLED: reviewer '${reviewerRole}' is not enabled in user settings`,
          });
        }
      }

      // EGRESS-CONTROL-PLANE-1 Inc 2 (CR-4) — DEMOTED, GUARDED stuck-session recovery. The old P1
      // (unconditional auto-abandon of any active session with no in-flight reviewer JOB, keyed on
      // documentId) was REJECTED by the triad: it races a legitimate mid-dispatch session and could
      // launder a no_external hold around the gate by recreating the session. This is now a NARROW
      // legacy/stale-orphan fallback ONLY, and create's correctness no longer depends on JOB_REAPER_ENABLED.
      //
      // The live session (state='active') is resolved by documentId, but in-flight detection is SESSION-ID
      // keyed via the lane contract (R1: documentId-keyed job polling is too blunt across historical /
      // abandoned / partial / retried sessions for one document). Recovery REFUSES unless EVERY guard clears:
      //   - a HOLD lifecyclePhase (held / blocked_by_hold / partial_blocked_by_hold) -> NEVER recover (a
      //     no_external hold is deliberate; clearing it is a privileged Inc-3 act, never an auto-abandon);
      //   - any non-terminal lane (in-flight) -> refuse (the session-ID-keyed lane read);
      //   - age <= MAX_DISPATCH_WINDOW (young) -> refuse (THE real safety: a momentarily-stale lane read on
      //     a young session can never cause a false abandon — covers a just-committed / 'dispatching'
      //     session and a sync session still blocking inside create);
      //   - the session has produced viewable feedback -> refuse (never clobber a real, resumable review).
      // Only an OLD, not-in-flight, no-hold, no-feedback session is a genuine orphan; abandon it via a
      // single-flight CAS + FAIL-CLOSED audit (abandonReviewSessionAudited), then proceed. Otherwise return
      // the resumable id (the frontend resumes the existing session instead of a dead-end error).
      const existingSession = await getActiveReviewSessionForDocument(input.documentId, userId);
      if (existingSession) {
        const phase = existingSession.lifecyclePhase ?? null;
        const isHoldPhase =
          phase === 'held' || phase === 'blocked_by_hold' || phase === 'partial_blocked_by_hold';
        let attemptedAbandon = false;
        let recovered = false;
        if (!isHoldPhase) {
          const existingLanes = await listReviewerLanesForSession(existingSession.id, userId);
          const inFlight = existingLanes.some((l) => !isTerminalLaneStatus(l.status));
          const ageMs = Date.now() - existingSession.createdAt.getTime();
          if (!inFlight && ageMs > MAX_DISPATCH_WINDOW_MS) {
            const existingFeedback = await listFeedbackForSession(existingSession.id, userId);
            if (existingFeedback.length === 0) {
              attemptedAbandon = true;
              const rows = await abandonReviewSessionAudited({
                sessionId: existingSession.id,
                userId,
                matterId: doc.matterId,
                documentId: input.documentId,
                reason: 'auto_recovery',
                fromLifecyclePhase: phase,
                summary:
                  `Auto-recovered stale orphan review session ${existingSession.id} ` +
                  `(document ${input.documentId}, iteration ${existingSession.iterationNumber}): no in-flight ` +
                  `reviewer, no feedback, age ${Math.round(ageMs / 1000)}s > dispatch window.`,
              });
              if (rows === 1) {
                console.log(
                  `[CR-4] Recovered stale orphan review session ${existingSession.id} ` +
                    `(document ${input.documentId}, iteration ${existingSession.iterationNumber}).`,
                );
                recovered = true;
              }
              // rows === 0 -> another concurrent recovery won the single-flight CAS; fall through to re-resolve.
            }
          }
        }
        if (!recovered) {
          // A live (state='active') session still blocks the activeSessionKey. If we attempted CR-4
          // recovery but lost the single-flight race (rows===0), the winner already abandoned it —
          // re-resolve to see if create may now proceed.
          const stillLive = attemptedAbandon
            ? await getActiveReviewSessionForDocument(input.documentId, userId)
            : existingSession;
          if (stillLive) {
            // TERMINAL-SESSION-SUPERSEDE-1. `state='active'` is true for BOTH a genuinely-running review and
            // a done-but-unclosed one (state leaves 'active' only on an explicit Close/regenerate/abandon —
            // never on natural completion), so the old raw 409 blocked the legitimate "start a fresh review"
            // case. Decide by REAL terminality, not by `state`:
            //   - HOLD phase            -> NEVER auto-supersede (a no_external hold is deliberate; clearing it
            //                              is a privileged Inc-3 act). Resumable conflict (the client opens it).
            //   - genuinely IN-FLIGHT   -> a review is still running; clear "in progress" (NOT a raw 409). The
            //                              client resumes the running session (it carries the id).
            //   - TERMINAL              -> supersede it (active->'regenerated', the History-VISIBLE supersede
            //                              state, NOT 'abandoned'): the prior review stays viewable/comparable
            //                              in document history and the new review proceeds. Nothing is deleted.
            const livePhase = stillLive.lifecyclePhase ?? null;
            const liveIsHold =
              livePhase === 'held' || livePhase === 'blocked_by_hold' || livePhase === 'partial_blocked_by_hold';
            if (liveIsHold) {
              throw new TRPCError({
                code: 'CONFLICT',
                message: `SESSION_ALREADY_EXISTS:${stillLive.id}: a held review session exists for this document at iteration ${stillLive.iterationNumber}; resolve the hold before starting a new review`,
              });
            }
            // Terminality: any non-terminal lane => in-flight (async). For the SYNC path there are NO lanes,
            // so "all lanes terminal" alone is not enough — a young, not-yet-settled session could be a sync
            // run still blocking inside its own create. The robust terminal signal is therefore: no in-flight
            // lane AND (the session is settled [lifecyclePhase 'completed'] OR it has lanes [async, all
            // terminal] OR it is older than the dispatch window [any in-flight run is long dead]).
            const liveLanes = await listReviewerLanesForSession(stillLive.id, userId);
            const liveInFlight = liveLanes.some((l) => !isTerminalLaneStatus(l.status));
            const liveAgeMs = Date.now() - stillLive.createdAt.getTime();
            const liveTerminal =
              !liveInFlight &&
              (livePhase === 'completed' || liveLanes.length > 0 || liveAgeMs > MAX_DISPATCH_WINDOW_MS);
            if (!liveTerminal) {
              throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: `REVIEW_IN_PROGRESS:${stillLive.id}: a review is still running on this document at iteration ${stillLive.iterationNumber} — wait for it to finish before starting a new one`,
              });
            }
            const supersededRows = await supersedeReviewSessionForNewReview({
              sessionId: stillLive.id,
              userId,
              matterId: doc.matterId,
              documentId: input.documentId,
              fromLifecyclePhase: livePhase,
              summary:
                `Superseded completed review session ${stillLive.id} (document ${input.documentId}, ` +
                `iteration ${stillLive.iterationNumber}) on a new review request. Prior review retained and ` +
                `visible in document history (state 'regenerated'); no feedback / locks / ledger discarded.`,
            });
            if (supersededRows === 0) {
              // Lost the single-flight CAS (a concurrent supersede/abandon already moved it). Re-resolve; if a
              // fresh active session now holds the key (a concurrent create won), surface the resumable conflict.
              const afterRace = await getActiveReviewSessionForDocument(input.documentId, userId);
              if (afterRace) {
                throw new TRPCError({
                  code: 'CONFLICT',
                  message: `SESSION_ALREADY_EXISTS:${afterRace.id}: an active review session already exists for this document at iteration ${afterRace.iterationNumber}`,
                });
              }
            }
            // superseded (rows===1) OR the activeSessionKey is now free (afterRace null) -> fall through to the
            // normal atomic insert below; the unique index is the final backstop against a concurrent winner.
          }
        }
      }

      // MR-CAL-3E: compute the review iteration server-side from prior review
      // sessions for this document so it advances across review requests /
      // regeneration cycles. The client-supplied input.iterationNumber is now
      // advisory only — review iteration is decoupled from
      // officialSubstantiveVersionNumber, which is what makes the HistorySection
      // sequential-comparison view reachable (prior iterations < current exist).
      const iterationNumber = await getNextIterationNumberForDocument(input.documentId);

      // EGRESS-CONTROL-PLANE-1 Inc 2 (durable outbox): pre-generate the session id so the reviewer prompts,
      // lanes, and job rows can all reference it and commit ATOMICALLY below. The session row is NO LONGER
      // inserted here — it is inserted inside the outbox transaction (together with the lanes + jobs), so a
      // pre-queue throw rolls everything back and the active-with-zero-jobs wedge becomes unreachable.
      const sessionId = uuidv4();

      // S1a (MR-1): Fetch current document version for reviewer prompt content
      if (!doc.currentVersionId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NO_CURRENT_VERSION: document has no current version',
        });
      }
      const currentVersion = await getVersionById(doc.currentVersionId, userId);
      if (!currentVersion) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Current version not found' });
      }

      // MR-CAL-6B: load this document's ACTIVE locked decisions and build a bounded
      // "## Locked Decisions" section to inject into each reviewer's userPrompt. The
      // reviewer system prompt already instructs "do not re-raise locked decisions
      // absent material change" (reviewerPrompts.ts); this provides the data. When
      // there are no active locks, lockedDecisionsSection is '' and the prompt is
      // byte-identical to the pre-6B behavior. Bounded for token safety: cap the
      // number of locks listed and truncate each rationale.
      const MAX_LOCKED_DECISIONS_IN_PROMPT = 50;
      const LOCKED_RATIONALE_MAX_CHARS = 500;
      const activeLockedDecisions = await listActiveLockedDecisionsForDocument(
        input.documentId,
        userId,
      );
      let lockedDecisionsSection = '';
      if (activeLockedDecisions.length > 0) {
        const shown = activeLockedDecisions.slice(0, MAX_LOCKED_DECISIONS_IN_PROMPT);
        const lines = shown.map((ld, i) => {
          const rationale = (ld.rationale ?? '').replace(/\s+/g, ' ').trim().slice(0, LOCKED_RATIONALE_MAX_CHARS);
          const rationalePart = rationale ? ` Rationale: ${rationale}` : '';
          return `${i + 1}. [${ld.origin}] ${ld.summary}${rationalePart}`;
        });
        const omitted = activeLockedDecisions.length - shown.length;
        const omittedNote = omitted > 0 ? `\n(${omitted} additional locked decision(s) omitted for length.)` : '';
        lockedDecisionsSection = [
          '',
          '## Locked Decisions (attorney-locked — do not re-raise absent a material new fact)',
          'The supervising attorney has already decided the following for THIS document. Do not',
          're-raise these as new defects. If a genuine NEW fact in the current draft materially',
          'changes one of these, you may raise it, but mark it explicitly as a deliberate re-raise',
          '(persistence) and state the new fact — do not raise it silently.',
          ...lines,
          omittedNote,
        ].filter((s) => s !== '').join('\n');
      }

      // MR-CAL-7B: load this document's adopt-ledger entries (status active|unresolved)
      // and build a bounded "## Previously Adopted" section. This finally feeds the
      // reviewerPrompts.ts "Cumulative state carry-forward" instruction real data:
      // reviewers should treat adopted changes as intended state, not new defects.
      // Empty ledger => previouslyAdoptedSection is '' => prompt byte-identical to pre-7B.
      const MAX_ADOPTED_IN_PROMPT = 50;
      const ADOPTED_TEXT_MAX_CHARS = 500;
      const adoptLedgerForPrompt = await listAdoptLedgerForPrompt(input.documentId, userId);
      let previouslyAdoptedSection = '';
      if (adoptLedgerForPrompt.length > 0) {
        const shownA = adoptLedgerForPrompt.slice(0, MAX_ADOPTED_IN_PROMPT);
        const linesA = shownA.map((e, i) => {
          const txt = (e.adoptedText ?? '').replace(/\s+/g, ' ').trim().slice(0, ADOPTED_TEXT_MAX_CHARS);
          const modFlag = e.disposition === 'adopted_modified' ? ' (modified)' : '';
          return `${i + 1}.${modFlag} ${txt}`;
        });
        const omittedA = adoptLedgerForPrompt.length - shownA.length;
        const omittedNoteA = omittedA > 0 ? `\n(${omittedA} additional adopted item(s) omitted for length.)` : '';
        previouslyAdoptedSection = [
          '',
          '## Previously Adopted (treat as intended current state — do not re-flag as new defects)',
          'The supervising attorney has already ADOPTED the following changes for THIS document',
          '(verbatim or modified). Treat them as part of the intended draft. Do not flag an adopted',
          'change as a new defect. You may still flag a genuine NEW problem the adopted text introduces,',
          'but say explicitly that it arises from the adopted change.',
          ...linesA,
          omittedNoteA,
        ].filter((s) => s !== '').join('\n');
      }

      // EGRESS-CONTROL-PLANE-1 Inc 2 (durable outbox) — UNIFIED execution model. The pre-Inc-2 path
      // forked three ways (inline-sync / dispatcher / fire-and-forget); the fragile fire-and-forget is
      // RETIRED. Now create ALWAYS commits session(active) + lanes + ALL reviewer jobs(queued, with the
      // frozen prompt + reconstruction params in jobs.input) ATOMICALLY in ONE transaction; the LLM
      // dispatch happens POST-COMMIT, outside the tx. The reviewer runtime contract (txn2Commit/Revert/
      // buildLlmParams/onRunning) lives in the reusable factory (reviewerJobFactory) so the dispatcher can
      // reconstruct + re-transmit a queued job after a restart — the TRUE durable outbox.
      const reviewerAsync = isReviewerAsyncEnabled();
      const reviewerJobIds: string[] = [];

      // Build the per-reviewer durable input (the frozen prompt + reconstruction params). The prompt
      // assembly is byte-identical to the pre-outbox path; the result is what the factory transmits and
      // what survives a restart in jobs.input.
      const reviewers: ReviewerDurableInput[] = input.selectedReviewers.map((reviewerRole) => {
        const modelString = resolveReviewerModel(reviewerRole);
        if (!modelString) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `REVIEWER_NOT_ENABLED: '${reviewerRole}' is not a valid reviewer identifier`,
          });
        }
        // MR-CAL-2: calibrated four-track prompt; legacy wrapper keys ("title"/"body"/"severity") preserved.
        const systemPrompt = buildReviewerSystemPrompt(reviewerRole as AnyReviewerKey);
        // S1a (MR-1) full document content; MR-CAL-6B locked-decisions section; MR-CAL-7B adopted section.
        // Both sections are '' when empty, so the prompt is byte-identical to the pre-6B/7B behavior.
        const userPrompt = [
          `Review session ${sessionId}, iteration ${iterationNumber}.`,
          `Document title: ${doc.title}`,
          '',
          '## Document Content',
          currentVersion.content,
          ...(lockedDecisionsSection ? [lockedDecisionsSection] : []),
          ...(previouslyAdoptedSection ? [previouslyAdoptedSection] : []),
        ].join('\n');
        const reviewerTitle = REVIEWER_TITLES[reviewerRole as ReviewerKey | LiteReviewerKey] ?? reviewerRole;
        return {
          jobId: uuidv4(),
          userId,
          matterId: doc.matterId,
          documentId: input.documentId,
          documentVersionId: doc.currentVersionId!,
          reviewSessionId: sessionId,
          iterationNumber,
          reviewerRole,
          reviewerTitle,
          modelString,
          systemPrompt,
          userPrompt,
          // MR-CAL-2 reviewer temperature; GEMINI-BUDGET-CAL-1 per-model ceiling; MR-LLM-GPT-1 / REVIEWER-
          // ASYNC-FANOUT-1 timeout (720 000 ms async background vs 300 000 ms sync). Frozen at enqueue.
          temperature: 0.4,
          maxTokens: getReviewerCeiling(modelString),
          timeoutMs: reviewerAsync ? 720_000 : 300_000,
          async: reviewerAsync,
        };
      });

      // ── ATOMIC OUTBOX COMMIT ──────────────────────────────────────────────────────────────────────
      // session(active) + ALL lanes (async only) + ALL reviewer jobs(queued, input populated) commit in
      // ONE transaction; NO external dispatch inside the tx. A throw anywhere here rolls EVERYTHING back,
      // so the "active session with zero jobs" wedge is UNREACHABLE (root-cause fix). A concurrent FRESH
      // create racing on the activeSessionKey unique index fails the insert -> caught below as a resumable
      // SESSION_ALREADY_EXISTS. The lanes are written async-only (the SYNC path keeps no lane rows, so its
      // display path is byte-for-byte unchanged); the jobs are committed in BOTH modes (the durable outbox).
      const laneDeadlineAt = new Date(Date.now() + REVIEWER_LANE_TERMINAL_DEADLINE_MS);
      // The session id create returns is the one insertReviewSession reports — in production it ECHOES the
      // pre-generated `sessionId` (insertReviewSession returns data.id), so this is identical to returning
      // `sessionId`; capturing it through the tx keeps the established create contract (the returned session
      // id comes from the insert) intact for callers.
      let committedSessionId = sessionId;
      try {
        committedSessionId = await db.transaction(async (tx) => {
          const insertedSessionId = await insertReviewSession(
            {
              id: sessionId,
              userId,
              documentId: input.documentId,
              iterationNumber,
              selectedReviewers: input.selectedReviewers,
            },
            tx,
          );
          if (reviewerAsync) {
            await insertReviewerLanes(
              reviewers.map((r) => ({
                userId,
                matterId: doc.matterId,
                documentId: input.documentId,
                versionId: doc.currentVersionId!,
                reviewSessionId: sessionId,
                iterationNumber,
                reviewerRole: r.reviewerRole,
                reviewerTitle: r.reviewerTitle,
                terminalDeadlineAt: laneDeadlineAt,
              })),
              tx,
            );
          }
          for (const r of reviewers) {
            await insertJob(buildReviewerJobRow(r), tx);
          }
          return insertedSessionId;
        });
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          // A concurrent FRESH create won the activeSessionKey (or idempotency) slot; THIS whole tx rolled
          // back (nothing persisted — no stuck active). Return the resumable id of the session that won.
          const winner = await getActiveReviewSessionForDocument(input.documentId, userId);
          throw new TRPCError({
            code: 'CONFLICT',
            message: `SESSION_ALREADY_EXISTS:${winner?.id ?? 'unknown'}: an active review session already exists for this document`,
          });
        }
        throw err; // any other failure: the tx already rolled back -> no session, no orphan job, no wedge.
      }

      // ── POST-COMMIT TRANSMIT (outside the tx) ─────────────────────────────────────────────────────
      // The session is committed 'active' + jobs 'queued' (+ lanes async). Transmit each reviewer via the
      // SAME runJob half (the factory params), so a lost in-process run is recoverable from jobs.input.
      if (reviewerAsync) {
        // 'dispatching' marks the brief commit->handoff window (recovery refuses a young 'dispatching'
        // session via the age guard). Register each continuation + kick a BACKGROUND run for immediacy; the
        // durable poll loop (reconstruct-from-input) is the restart backstop and runJob's atomic claim
        // dedupes. Flip back to idle in a finally — the background reviewers then run under 'active' +
        // in-flight lanes (recovery refuses via the lane read), and the existing #328 client live-refresh
        // surfaces each lane Queued->Running->Returned with no reload.
        await updateReviewSessionLifecyclePhase(sessionId, userId, 'dispatching');
        try {
          for (const r of reviewers) {
            registerDeferredContinuation(r.jobId, buildReviewerCanonicalParams(r));
          }
          for (const r of reviewers) {
            void runDeferredCanonicalJob(r.jobId).catch((e) =>
              // eslint-disable-next-line no-console
              console.error(`[reviewer-outbox] background reviewer run failed (session ${sessionId}, ${r.reviewerRole}):`, e),
            );
          }
        } finally {
          await updateReviewSessionLifecyclePhase(sessionId, userId, null);
        }
      } else {
        // SYNC inline path (prod default): run each reviewer to terminal, BLOCKING, exactly as the
        // established sync card view — but the job row was committed FIRST (atomic outbox), so the session
        // can never be left active-with-zero-jobs. Each reviewer's feedback is persisted by the factory's
        // txn2Commit before create returns, just like before.
        // REVIEWER-CONCURRENT-FANOUT-1 (F2): dispatch the reviewers CONCURRENTLY instead of one-at-a-time.
        // Reviewer work is independent — there is no reason to serialize it, and the pre-fix sequential loop
        // made an N-reviewer panel take ~N x the slowest reviewer (the Monster UAT saw a 3-reviewer create
        // sit ~3 minutes because a flaky reviewer's full timeout was awaited BEFORE the others even started).
        // Each runDeferredCanonicalJob already runs under its OWN frozen timeoutMs (300_000ms sync) + a fresh
        // AbortController, so every reviewer has an independent timeout envelope; Promise.allSettled isolates
        // failures so one slow/failing reviewer can no longer block the others. Result: create() returns in
        // ~the slowest single reviewer's time, not the SUM, and still degrades cleanly to the honest N-of-M.
        // Same models, same prompts, same persistence — each reviewer's factory txn2Commit is independent and
        // all are awaited here before the evaluator fan-in below reads the persisted feedback. Pure
        // orchestration change (serial -> parallel awaits); the async/outbox path (flag-gated) is unchanged.
        for (const r of reviewers) {
          registerDeferredContinuation(r.jobId, buildReviewerCanonicalParams(r));
        }
        const reviewerResults = await Promise.allSettled(
          reviewers.map((r) => runDeferredCanonicalJob(r.jobId)),
        );
        for (let i = 0; i < reviewers.length; i++) {
          const settled = reviewerResults[i]!;
          if (settled.status === 'fulfilled') {
            if (settled.value?.status === 'completed') reviewerJobIds.push(reviewers[i]!.jobId);
          } else {
            // A reviewer dispatch rejected outside the canonical job's own error handling — it counts as a
            // non-response (absent from reviewerJobIds), exactly as a sequential failure would, but WITHOUT
            // aborting the create or the other reviewers.
            // eslint-disable-next-line no-console
            console.error(
              `[reviewer-concurrent] reviewer ${reviewers[i]!.reviewerRole} dispatch failed (session ${sessionId}):`,
              settled.reason,
            );
          }
        }
        // SYNC has no lanes; record the session-level partial reason from the reviewer outcomes (the Inc-2
        // data foundation). Inc-2 sync has no hold gate, so a partial here is always non-response.
        const anyFailed = reviewerJobIds.length < reviewers.length;
        await setReviewSessionSettled(sessionId, userId, anyFailed ? 'non_response' : null);
        // NOTIFY-PRODUCERS-1: the SYNC review has RETURNED (no lanes; no hold gate here, so never held)
        // — emit ONE "Review ready" badge. Same producer + deterministic per-session id the async
        // finalize uses, so a document run in either mode never double-notifies. Best-effort (swallows).
        await emitReviewReadyNotification({ reviewSessionId: sessionId, userId, matterId: doc.matterId });
      }

      // EVALUATOR PATH — MR-CAL-5C (advisory output contract; default OFF)
      //
      // Gated behind isEvaluatorEnabled() (env EVALUATOR_ENABLED, default OFF) AND
      // more than one selected reviewer. The reviewer fan-out above runs inline and
      // CONCURRENTLY (REVIEWER-CONCURRENT-FANOUT-1: Promise.allSettled awaits every reviewer's
      // LLM + persist), so by the time we reach here ALL reviewer feedback for this iteration is
      // persisted and can be read to build the evaluator prompt.
      //
      // The evaluator is ADVISORY ONLY: it emits one disposition (adopt/reject/
      // neutral) + a short synthesis per reviewer suggestion, persisted to
      // feedback_evaluations and rendered as advisory icons in ReviewPane. It never
      // writes the attorney's selection, never auto-adopts, never regenerates, and
      // flags business decisions for the attorney (P8-T10). The attorney decides.
      //
      // References: MR-CAL-5A investigation; MR-CAL-5C plan; decision #41 (EVALUATOR_MODEL).
      // REVIEWER-ASYNC-FANOUT-1 Inc 1: the evaluator reads ALL reviewer feedback and must run only
      // after every reviewer completes — incompatible with the fire-and-forget async path, so it is
      // SKIPPED in async-mode v1 (advisory-only + default-OFF; evaluator fan-in is a fast-follow).
      if (!reviewerAsync && isEvaluatorEnabled() && input.selectedReviewers.length > 1) {
        const evaluatorModelString = EVALUATOR_MODEL;
        // Read the just-persisted reviewer feedback for this iteration/session.
        const evaluatorFeedbackRows = await listFeedbackForSession(sessionId, userId);
        const evaluatorSystemPrompt = buildEvaluatorSystemPrompt();
        const evaluatorUserPrompt = buildEvaluatorUserPrompt({
          documentTitle: doc.title,
          iterationNumber,
          feedbackRows: evaluatorFeedbackRows,
        });
        await executeCanonicalMutation({
          userId,
          jobType: 'evaluator',
          modelString: evaluatorModelString,
          matterId: doc.matterId,
          documentId: input.documentId,
          txn1Enqueue: async (jobId) => {
            return { jobId, preEnqueueState: doc.workflowState };
          },
          buildLlmParams: (_jobId) => ({
            systemPrompt: evaluatorSystemPrompt,
            userPrompt: evaluatorUserPrompt,
            temperature: 0.2,
            maxTokens: 8192,
            structuredOutputSchema: EvaluatorOutputSchema,
          }),
          // MR-CAL-5D: the evaluator (EVALUATOR_MODEL = Claude Opus) reasons over the
          // combined feedback of ALL reviewers in one call, so it needs the same headroom
          // as a reviewer job. Without this it falls back to the global 120 000 ms default
          // and can time out before persisting, leaving evaluation=null on otherwise
          // successful multi-reviewer runs. Matches the reviewer_feedback 300 000 ms budget.
          timeoutMs: 300_000,
          txn2Commit: async ({ jobId, output }) => {
            // Parse + validate the FULL advisory output. parseEvaluatorOutputFull throws
            // on malformed/non-conforming output, which fails the evaluator job and
            // runs txn2Revert — persisting NOTHING. Reviewer feedback is unaffected
            // (the evaluator is purely additive). FOLD-ORCH-1 Inc3b: also capture the
            // advisory issueGroups (Inc2a) — the GROUPING SOURCE for consolidation —
            // alongside the dispositions; degrade-safe (absent grouping => NULL).
            const evaluatorOutput = parseEvaluatorOutputFull(output);
            await insertFeedbackEvaluation({
              userId,
              documentId: input.documentId,
              iterationNumber,
              jobId,
              dispositions: evaluatorOutput.dispositions,
              issueGroups: evaluatorOutput.issueGroups ?? null,
            });
            void emitTelemetry(
              'generation_completed',
              { jobId, operation: 'evaluator', newVersionNumber: iterationNumber },
              { userId, matterId: doc.matterId, documentId: input.documentId, jobId },
            );
          },
          txn2Revert: async ({ jobId, errorClass }) => {
            void emitTelemetry(
              'generation_reset',
              { jobId, operation: 'evaluator', reason: errorClass === 'timeout' ? 'timeout' : 'failure' },
              { userId, matterId: doc.matterId, documentId: input.documentId, jobId },
            );
          },
          telemetryCtx: { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
        });
      } // end evaluator conditional
      void emitTelemetry(
        'review_session_created',
        {
          iterationNumber,
          reviewerCount: input.selectedReviewers.length,
          selectedReviewers: input.selectedReviewers,
        },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      return { sessionId: committedSessionId };
    }),

  // ============================================================
  // reviewSession.updateSelection — Ch 21.9
  // Autosave target for selection changes in the review pane.
  // R5: only selection rows are written (positive-selection only).
  // ============================================================
  updateSelection: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        selections: z.array(
          z.object({
            // MR-4 §3.3: canonical field; legacy feedbackId alias handled by
            // SessionSelectionSchema at the DB read layer.
            suggestionId: z.string().uuid(),
            note: z.string().nullable(),
            // MR-CAL-7B: optional attorney-edited adopted text (present => modified adopt).
            adoptedText: z.string().optional(),
            // FOLD-ORCH-1 Inc3c-2: optional per-selection confirmation MODE (e.g. the orchestration
            // bulk-acknowledge act sets 'bulk_acknowledged_low_severity_convergent'); omitted =>
            // 'individually_adopted' at adopt time. Persisted in the selections JSON.
            confirmationMode: z
              .enum([
                'bulk_acknowledged_low_severity_convergent',
                'individually_adopted',
                'individually_rejected',
                'individually_deferred',
                'synthesis_adopted',
                'divergent_resolved',
              ])
              .optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      const session = await getReviewSessionById(input.sessionId, userId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review session not found' });
      assertSessionActive(session.state, 'reviewSession.updateSelection');

      const doc = await getDocumentById(session.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'reviewSession.updateSelection');

      // Compute diff for telemetry (MR-4 §3.3: canonical suggestionId)
      const currentSelections = (session.selections ?? []) as Array<{ suggestionId: string }>;
      const currentIds = new Set(currentSelections.map((s) => s.suggestionId));
      const newIds = new Set(input.selections.map((s) => s.suggestionId));
      const added = input.selections.filter((s) => !currentIds.has(s.suggestionId)).map((s) => s.suggestionId);
      const removed = currentSelections.filter((s) => !newIds.has(s.suggestionId)).map((s) => s.suggestionId);

      const updatedSession = await updateReviewSessionSelections(
        input.sessionId,
        userId,
        input.selections,
      );

      void emitTelemetry(
        'review_selection_changed',
        {
          adoptedCount: input.selections.length,
          totalSuggestions: input.selections.length,
          added,
          removed,
        },
        { userId, matterId: doc.matterId, documentId: session.documentId, jobId: null },
      );

      return { session: updatedSession };
    }),

  // ============================================================
  // reviewSession.updateGlobalInstructions — Ch 21.9
  // Autosave target for the global instructions field.
  // ============================================================
  updateGlobalInstructions: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        globalInstructions: z.string().max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      const session = await getReviewSessionById(input.sessionId, userId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review session not found' });
      assertSessionActive(session.state, 'reviewSession.updateGlobalInstructions');

      const doc = await getDocumentById(session.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'reviewSession.updateGlobalInstructions');

      const updatedSession = await updateReviewSessionGlobalInstructions(
        input.sessionId,
        userId,
        input.globalInstructions,
      );

      void emitTelemetry(
        'global_instructions_updated',
        { instructionsLength: input.globalInstructions.length },
        { userId, matterId: doc.matterId, documentId: session.documentId, jobId: null },
      );

      return { session: updatedSession };
    }),

  // ============================================================
  // reviewSession.get — Ch 21.9
  // Fetch session with feedback rows and evaluator dispositions.
  // ============================================================
  get: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.userId;

      const session = await getReviewSessionById(input.sessionId, userId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review session not found' });

      const feedbackRows = await listFeedbackForSession(input.sessionId, userId);
      // MR-CAL-4B: attach display-only native feedback cards derived from the
      // STRUCTURED_FEEDBACK_CARDS already embedded in each suggestion body.
      // Migration-free and legacy-safe: every suggestion is returned unchanged
      // with an added nativeCards array (empty when none are present/parseable),
      // so the legacy rendering path is unaffected.
      const feedback = feedbackRows.map((row) => ({
        ...row,
        suggestions: row.suggestions.map((s) => ({
          ...s,
          nativeCards: extractEmbeddedFeedbackCards(s.body),
        })),
      }));
      const evaluation = await getEvaluationForIteration(
        session.documentId,
        session.iterationNumber,
        userId,
      );

      // REVIEWER-ASYNC-DISPLAY-1 (Component C, C-2): the server-owned per-reviewer lane contract.
      // The denominator is the IMMUTABLE EXPECTED set (session.selectedReviewers) — condition 2 — so a
      // late/unexpected lane never shrinks or inflates it (condition 11: an unexpected reviewer's lane is
      // excluded + logged). Present ONLY on the async path (lanes are written only when
      // REVIEWER_ASYNC_ENABLED): when there are no lanes, `lanes` is null and the client keeps the
      // byte-for-byte SYNC display (GUARD). The client renders + gates polling off this and STOPS using
      // deriveCompletionState for async (condition 1).
      const laneRows = await listReviewerLanesForSession(input.sessionId, userId);
      let lanes: ReviewerLanesContract | null = null;
      if (laneRows.length > 0) {
        const expectedRoles = new Set(session.selectedReviewers);
        const laneByRole = new Map<string, (typeof laneRows)[number]>();
        for (const row of laneRows) {
          if (expectedRoles.has(row.reviewerRole)) {
            laneByRole.set(row.reviewerRole, row);
          } else {
            // condition 11 — never counted in the denominator
            console.warn(
              `[reviewer-async] lane for unexpected reviewer '${row.reviewerRole}' (session ${session.id}) excluded from the denominator`,
            );
          }
        }
        const views: ReviewerLaneView[] = session.selectedReviewers.map((role) => {
          const row = laneByRole.get(role);
          if (!row) {
            // expected reviewer with no lane row yet (should not happen post-create) — synthetic pending
            return {
              reviewerRole: role,
              reviewerTitle: role,
              status: 'pending',
              terminal: false,
              suggestionCount: null,
              feedbackRowId: null,
              jobStatus: null,
              failureReason: null,
              dispatchedAt: null,
              terminalizedAt: null,
              updatedAt: new Date().toISOString(),
            };
          }
          return {
            reviewerRole: row.reviewerRole,
            reviewerTitle: row.reviewerTitle,
            status: row.status,
            terminal: isTerminalLaneStatus(row.status),
            suggestionCount: row.suggestionCount,
            feedbackRowId: row.feedbackRowId,
            jobStatus: null, // display-only; the lane status (above) is authoritative
            failureReason: row.failureReason,
            dispatchedAt: null,
            terminalizedAt: row.terminalizedAt ? row.terminalizedAt.toISOString() : null,
            updatedAt: row.updatedAt.toISOString(),
          };
        });
        lanes = buildReviewerLanesContract(views);
      }

      return { session, feedback, evaluation, lanes };
    }),

  // ============================================================
  // reviewSession.getDocumentHistory — MR-2 §S2b
  // Returns all prior-iteration feedback rows for a document.
  // Used by the history view in ReviewPane to show feedback from
  // previous iterations. Excludes the current iteration (filtered
  // client-side in ReviewPane to avoid duplication).
  // Ownership: documentId must belong to userId (enforced in query).
  // ============================================================
  getDocumentHistory: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.userId;

      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });

      const allFeedback = await listFeedbackForDocument(input.documentId, userId);
      const sessions = await listReviewSessionsForDocument(input.documentId, userId);
      const selections = await listManualSelectionsForDocument(input.documentId, userId);
      // Legacy MR-2 source-regression anchor: return { feedback: allFeedback }
      return { feedback: allFeedback, sessions, selections };
    }),

  // ============================================================
  // reviewSession.regenerate — Ch 21.9
  // Commit selections across all reviewer panes, then delegate to
  // document.regenerate with consolidationMode='all_reviewers'.
  //
  // Clarification 3: thin wrapper over existing Phase 4a document.regenerate
  // path. No second regeneration primitive.
  // ============================================================
  regenerate: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      const session = await getReviewSessionById(input.sessionId, userId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review session not found' });
      assertSessionActive(session.state, 'reviewSession.regenerate');

      const doc = await getDocumentById(session.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'reviewSession.regenerate');

      // Validate: must have at least one selection OR non-empty global instructions
      // MR-4 §3.3: canonical suggestionId field after alias normalization at Zod parse layer.
      const selections = (session.selections ?? []) as Array<{ suggestionId: string; note: string | null }>;
      const hasSelections = selections.length > 0;
      const hasGlobalInstructions = (session.globalInstructions ?? '').trim().length > 0;
      if (!hasSelections && !hasGlobalInstructions) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'REVIEW_SESSION_EMPTY: session has no selections and no global instructions',
        });
      }

      // MR-4 P1: Build itemized prompt from full suggestion text.
      // Fetch all feedback rows for this session to resolve suggestionId → suggestion data.
      const allFeedbackForPrompt = await listFeedbackForSession(input.sessionId, userId);
      // Build a flat map: suggestionId → { title, body, severity, reviewerTitle, reviewerRole }
      const suggestionMap = new Map<string, { title: string; body: string; severity?: string; reviewerTitle: string; reviewerRole: string }>();
      for (const feedbackRow of allFeedbackForPrompt) {
        for (const suggestion of feedbackRow.suggestions) {
          suggestionMap.set(suggestion.suggestionId, {
            title: suggestion.title,
            body: suggestion.body,
            ...(suggestion.severity !== undefined ? { severity: suggestion.severity } : {}),
            reviewerTitle: feedbackRow.reviewerTitle,
            reviewerRole: feedbackRow.reviewerRole,
          });
        }
      }
      // Validate all selected suggestionIds resolve (fail-safe: SUGGESTION_NOT_RESOLVED)
      for (const sel of selections) {
        if (!suggestionMap.has(sel.suggestionId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `SUGGESTION_NOT_RESOLVED: selection references unknown suggestionId '${sel.suggestionId}'`,
          });
        }
      }

      // MR-CAL-7B: adopt_ledger anchors each adoption to the current (input) version.
      if (!doc.currentVersionId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NO_CURRENT_VERSION: document has no current version',
        });
      }
      const adoptedIntoVersionId = doc.currentVersionId;

      // Commit feedback_manual_selections rows (R5: positive-selection only)
      // MR-CAL-7B: additively record an adopt_ledger entry per selection (text-bearing,
      // version-anchored). The ledger is separate from selections; selections keep their
      // per-iteration role. status='unresolved' until this regeneration produces a version
      // (applyRegenerationToAdoptLedger flips it to active/superseded after commit).
      const selWithText = selections as Array<{ suggestionId: string; note: string | null; adoptedText?: string; confirmationMode?: ConfirmationMode }>;
      for (const sel of selWithText) {
        // REVIEW-LOOP-UX-1 / R1: an instant ADOPT click already committed this selection's manual-
        // selection + adopt-ledger rows at click time (same session, suggestion, and input version).
        // Skip re-inserting both here — the unique keys uniq_manual_selections and
        // uniq_adopt_ledger_session_suggestion would otherwise collide and fail the regeneration.
        const existingLedger = await getAdoptLedgerEntryForSuggestionVersion(
          input.sessionId,
          sel.suggestionId,
          adoptedIntoVersionId,
          userId,
        );
        if (existingLedger) continue;
        await insertManualSelection({
          userId,
          documentId: session.documentId,
          iterationNumber: session.iterationNumber,
          reviewSessionId: input.sessionId,
          suggestionId: sel.suggestionId,
          attorneyNote: sel.note,
        });
        const s = suggestionMap.get(sel.suggestionId)!;
        const edited = sel.adoptedText !== undefined && sel.adoptedText.trim() !== '' && sel.adoptedText !== s.body;
        const adoptLedgerId = await insertAdoptLedgerEntry({
          userId,
          documentId: session.documentId,
          matterId: doc.matterId,
          sourceSuggestionId: sel.suggestionId,
          sourceReviewerRole: s.reviewerRole,
          sourceIterationNumber: session.iterationNumber,
          reviewSessionId: input.sessionId,
          disposition: edited ? 'adopted_modified' : 'adopted_verbatim',
          originalText: s.body,
          adoptedText: edited ? sel.adoptedText! : s.body,
          adoptedIntoVersionId,
          // FOLD-ORCH-1 Inc3c-2: record HOW this was confirmed (never flattened to "adopted").
          // A normal per-suggestion checkbox is an individual adoption; the orchestration
          // bulk-acknowledge act tags its selections 'bulk_acknowledged_low_severity_convergent'.
          confirmationMode: sel.confirmationMode ?? 'individually_adopted',
        });
        void emitTelemetry(
          'adopt_ledger_entry_created',
          {
            adoptLedgerId,
            sourceSuggestionId: sel.suggestionId,
            disposition: edited ? 'adopted_modified' : 'adopted_verbatim',
            iterationNumber: session.iterationNumber,
          },
          { userId, matterId: doc.matterId, documentId: session.documentId, jobId: null },
        );
      }

      // Transition session to 'regenerated'
      await updateReviewSessionState(input.sessionId, userId, 'regenerated');

      // Emit telemetry before delegating to document.regenerate
      void emitTelemetry(
        'regeneration_started',
        {
          sessionId: input.sessionId,
          consolidationMode: 'all_reviewers',
          adoptedCount: selections.length,
        },
        { userId, matterId: doc.matterId, documentId: session.documentId, jobId: null },
      );

      // MR-4 P1: Build itemized prompt with full suggestion text (Option B: all selections
      // regardless of originating reviewer — product semantic: attorney sees consolidated view).
      const selectionLines = selections.map((sel, i) => {
        const s = suggestionMap.get(sel.suggestionId)!;
        const severityTag = s.severity ? ` [${s.severity}]` : '';
        const noteLine = sel.note ? `\n   Attorney note: ${sel.note}` : '';
        return `${i + 1}. [${s.reviewerTitle}${severityTag}] ${s.title}: ${s.body}${noteLine}`;
      });
      const selectionSummary = selections.length > 0
        ? `Apply the following ${selections.length} selected suggestion(s):\n${selectionLines.join('\n')}`
        : '';
      const globalPart = (session.globalInstructions ?? '').trim();
      const instructions = [selectionSummary, globalPart].filter(Boolean).join('\n\n');

      // Invoke document.regenerate logic directly (same executeCanonicalMutation path)
      const result = await _invokeDocumentRegenerate({
        userId,
        documentId: session.documentId,
        doc,
        instructions,
        sessionId: input.sessionId,
        consolidationMode: 'all_reviewers',
        matterId: doc.matterId,
      });

      return { jobId: result.jobId, status: result.status };
    }),

  // ============================================================
  // reviewSession.regenerateSingleReviewer — Ch 21.9
  // Commit selections for one reviewer only, then delegate to
  // document.regenerate with consolidationMode='single_reviewer'.
  // ============================================================
  regenerateSingleReviewer: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        reviewerRole: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      const session = await getReviewSessionById(input.sessionId, userId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review session not found' });
      assertSessionActive(session.state, 'reviewSession.regenerateSingleReviewer');

      const doc = await getDocumentById(session.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'reviewSession.regenerateSingleReviewer');

      // Validate reviewer is in session
      const selectedReviewers = (session.selectedReviewers ?? []) as string[];
      if (!selectedReviewers.includes(input.reviewerRole)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `REVIEWER_NOT_IN_SESSION: reviewer '${input.reviewerRole}' was not selected for this session`,
        });
      }

       // MR-4 §3.3: canonical suggestionId field after alias normalization at Zod parse layer.
      // MR-4 §2.1 Option B: regenerateSingleReviewer uses ALL current selections regardless
      // of originating reviewer — same product semantic as regenerate (consolidated view).
      // The reviewerRole parameter controls consolidationMode metadata only.
      const selections = (session.selections ?? []) as Array<{ suggestionId: string; note: string | null }>;
      const hasGlobalInstructions = (session.globalInstructions ?? '').trim().length > 0;
      if (selections.length === 0 && !hasGlobalInstructions) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `REVIEW_SESSION_EMPTY: no selections for reviewer '${input.reviewerRole}' and no global instructions`,
        });
      }
      // S4 (MR-1): D6 defensive guard — detect silent selection drop
      // If the session has selections but none matched feedback rows for this reviewer,
      // surface loudly rather than silently regenerating with only global instructions.
      // MR-4: guard is now on all selections (Option B), not reviewer-filtered subset.
      // MR-4 P1: Build itemized prompt from full suggestion text (same path as regenerate).
      const allFeedbackForPromptSingle = await listFeedbackForSession(input.sessionId, userId);
      const suggestionMapSingle = new Map<string, { title: string; body: string; severity?: string; reviewerTitle: string; reviewerRole: string }>();
      for (const feedbackRow of allFeedbackForPromptSingle) {
        for (const suggestion of feedbackRow.suggestions) {
          suggestionMapSingle.set(suggestion.suggestionId, {
            title: suggestion.title,
            body: suggestion.body,
            ...(suggestion.severity !== undefined ? { severity: suggestion.severity } : {}),
            reviewerTitle: feedbackRow.reviewerTitle,
            reviewerRole: feedbackRow.reviewerRole,
          });
        }
      }
      // Validate all selected suggestionIds resolve (fail-safe: SUGGESTION_NOT_RESOLVED)
      for (const sel of selections) {
        if (!suggestionMapSingle.has(sel.suggestionId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `SUGGESTION_NOT_RESOLVED: selection references unknown suggestionId '${sel.suggestionId}'`,
          });
        }
      }
      // MR-CAL-7B: adopt_ledger anchors each adoption to the current (input) version.
      if (!doc.currentVersionId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NO_CURRENT_VERSION: document has no current version',
        });
      }
      const adoptedIntoVersionIdSingle = doc.currentVersionId;

      // Commit all selections (R5: positive-selection only)
      // MR-CAL-7B: additively record adopt_ledger entries (same path as regenerate).
      const selWithTextSingle = selections as Array<{ suggestionId: string; note: string | null; adoptedText?: string; confirmationMode?: ConfirmationMode }>;
      for (const sel of selWithTextSingle) {
        // REVIEW-LOOP-UX-1 / R1: an instant ADOPT click already committed this selection's manual-
        // selection + adopt-ledger rows at click time (same session, suggestion, and input version).
        // Skip re-inserting both here — the unique keys uniq_manual_selections and
        // uniq_adopt_ledger_session_suggestion would otherwise collide and fail the regeneration.
        const existingLedgerSingle = await getAdoptLedgerEntryForSuggestionVersion(
          input.sessionId,
          sel.suggestionId,
          adoptedIntoVersionIdSingle,
          userId,
        );
        if (existingLedgerSingle) continue;
        await insertManualSelection({
          userId,
          documentId: session.documentId,
          iterationNumber: session.iterationNumber,
          reviewSessionId: input.sessionId,
          suggestionId: sel.suggestionId,
          attorneyNote: sel.note,
        });
        const s = suggestionMapSingle.get(sel.suggestionId)!;
        const edited = sel.adoptedText !== undefined && sel.adoptedText.trim() !== '' && sel.adoptedText !== s.body;
        const adoptLedgerId = await insertAdoptLedgerEntry({
          userId,
          documentId: session.documentId,
          matterId: doc.matterId,
          sourceSuggestionId: sel.suggestionId,
          sourceReviewerRole: s.reviewerRole,
          sourceIterationNumber: session.iterationNumber,
          reviewSessionId: input.sessionId,
          disposition: edited ? 'adopted_modified' : 'adopted_verbatim',
          originalText: s.body,
          adoptedText: edited ? sel.adoptedText! : s.body,
          adoptedIntoVersionId: adoptedIntoVersionIdSingle,
          // FOLD-ORCH-1 Inc3c-2: record the confirmation MODE (default individual adoption).
          confirmationMode: sel.confirmationMode ?? 'individually_adopted',
        });
        void emitTelemetry(
          'adopt_ledger_entry_created',
          {
            adoptLedgerId,
            sourceSuggestionId: sel.suggestionId,
            disposition: edited ? 'adopted_modified' : 'adopted_verbatim',
            iterationNumber: session.iterationNumber,
          },
          { userId, matterId: doc.matterId, documentId: session.documentId, jobId: null },
        );
      }

      // Transition session to 'regenerated'
      await updateReviewSessionState(input.sessionId, userId, 'regenerated');

      void emitTelemetry(
        'regeneration_started',
        {
          sessionId: input.sessionId,
          consolidationMode: 'single_reviewer',
          adoptedCount: selections.length,
        },
        { userId, matterId: doc.matterId, documentId: session.documentId, jobId: null },
      );

      // MR-4 P1: Build itemized prompt with full suggestion text (Option B: all selections).
      const selectionLinesSingle = selections.map((sel, i) => {
        const s = suggestionMapSingle.get(sel.suggestionId)!;
        const severityTag = s.severity ? ` [${s.severity}]` : '';
        const noteLine = sel.note ? `\n   Attorney note: ${sel.note}` : '';
        return `${i + 1}. [${s.reviewerTitle}${severityTag}] ${s.title}: ${s.body}${noteLine}`;
      });
      const selectionSummary = selections.length > 0
        ? `Apply the following ${selections.length} selected suggestion(s):\n${selectionLinesSingle.join('\n')}`
        : '';
      const globalPart = (session.globalInstructions ?? '').trim();
      const instructions = [selectionSummary, globalPart].filter(Boolean).join('\n\n');

      const result = await _invokeDocumentRegenerate({
        userId,
        documentId: session.documentId,
        doc,
        instructions,
        sessionId: input.sessionId,
        consolidationMode: 'single_reviewer',
        matterId: doc.matterId,
      });

      return { jobId: result.jobId, status: result.status };
    }),

  // ============================================================
  // reviewSession.rerunReviewer — REVIEW-LOOP-UX-1 R2
  // Re-run ONE reviewer on the CURRENT draft (a flaky/failed/timed-out/held return), leaving the other
  // lanes intact. Re-dispatches the SAME (session,reviewer) idempotency-keyed job slot through the outbox
  // factory (reviewerJobFactory) — NOT a second dispatch path. Offered ONLY for no-usable-feedback terminal
  // lanes (failure-class + blocked_by_hold), so nothing returned/adopted is discarded. The #328 live-refresh
  // surfaces the lane Queued->Running->Returned. Async-lane only (the sync path has no lanes).
  // ============================================================
  rerunReviewer: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        reviewerRole: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      if (!isReviewerAsyncEnabled()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'RERUN_REQUIRES_ASYNC: single-reviewer re-run is only available on the async reviewer lane',
        });
      }

      const session = await getReviewSessionById(input.sessionId, userId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review session not found' });
      assertSessionActive(session.state, 'reviewSession.rerunReviewer');

      const selectedReviewers = (session.selectedReviewers ?? []) as string[];
      if (!selectedReviewers.includes(input.reviewerRole)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `REVIEWER_NOT_IN_SESSION: reviewer '${input.reviewerRole}' was not selected for this session`,
        });
      }

      // The lane must be in a RE-RUNNABLE terminal state (failure-class or blocked_by_hold) — never a
      // completed_with_feedback lane (its feedback may be adopted) nor a still in-flight lane.
      const lanes = await listReviewerLanesForSession(input.sessionId, userId);
      const lane = lanes.find((l) => l.reviewerRole === input.reviewerRole);
      if (!lane) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `LANE_NOT_FOUND: no reviewer lane for '${input.reviewerRole}'` });
      }
      if (!isLaneRerunnable(lane.status)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `LANE_NOT_RERUNNABLE: lane '${input.reviewerRole}' is '${lane.status}'; re-run is offered only for a failed/timed_out/dispatch_failed/orphaned_reaped/canceled/blocked_by_hold lane`,
        });
      }

      // Locate the EXISTING (session,reviewer) job slot by its durable-outbox idempotency key — the re-run
      // reuses it, never forks a new dispatch path / job row.
      const idempotencyKey = reviewerIdempotencyKey(input.sessionId, input.reviewerRole);
      const existingJob = await getJobByIdempotencyKey(idempotencyKey, userId);
      if (!existingJob) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `RERUN_JOB_NOT_FOUND: no reviewer job for '${input.reviewerRole}'` });
      }

      // Re-compose the durable input against the CURRENT draft (the frozen prompt was cleared on the prior
      // terminal): current version + current locked decisions + current adopt ledger -> a byte-identical
      // assembly to create (shared helpers). Reuse the EXISTING job id for the slot.
      const doc = await getDocumentById(session.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'reviewSession.rerunReviewer');
      if (!doc.currentVersionId) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'NO_CURRENT_VERSION: document has no current version' });
      }
      const currentVersion = await getVersionById(doc.currentVersionId, userId);
      if (!currentVersion) throw new TRPCError({ code: 'NOT_FOUND', message: 'Current version not found' });

      const lockedDecisionsSection = buildLockedDecisionsSection(
        await listActiveLockedDecisionsForDocument(session.documentId, userId),
      );
      const previouslyAdoptedSection = buildPreviouslyAdoptedSection(
        await listAdoptLedgerForPrompt(session.documentId, userId),
      );

      const durableInput: ReviewerDurableInput = {
        ...buildReviewerDurableInput(input.reviewerRole, {
          userId,
          matterId: doc.matterId,
          documentId: session.documentId,
          documentVersionId: doc.currentVersionId,
          sessionId: input.sessionId,
          iterationNumber: session.iterationNumber,
          docTitle: doc.title,
          currentVersionContent: currentVersion.content,
          lockedDecisionsSection,
          previouslyAdoptedSection,
          reviewerAsync: true,
        }),
        jobId: existingJob.id, // reuse the EXISTING (session,reviewer) job slot — no new row
      };

      // Re-queue the existing terminal job (status->queued + fresh input) FIRST: its conditional UPDATE is
      // the single-winner guard, so a double-click / concurrent re-run can requeue at most once. Then reset
      // the lane to 'pending' (clear terminal markers, arm a fresh deadline) and re-dispatch via the SAME
      // deferred path; runJob's atomic claim dedupes, and the #328 live-refresh shows the lane move.
      const requeued = await requeueTerminalReviewerJob(
        existingJob.id,
        userId,
        buildReviewerJobRow(durableInput).input as Record<string, unknown>,
      );
      if (requeued === 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `RERUN_IN_PROGRESS: reviewer '${input.reviewerRole}' is no longer in a re-runnable state (already re-running?)`,
        });
      }
      const laneDeadlineAt = new Date(Date.now() + REVIEWER_LANE_TERMINAL_DEADLINE_MS);
      await resetReviewerLaneForRerun(input.sessionId, input.reviewerRole, userId, laneDeadlineAt);

      registerDeferredContinuation(existingJob.id, buildReviewerCanonicalParams(durableInput));
      void runDeferredCanonicalJob(existingJob.id).catch((e) =>
        // eslint-disable-next-line no-console
        console.error(
          `[reviewer-outbox] background reviewer RE-RUN failed (session ${input.sessionId}, ${input.reviewerRole}):`,
          e,
        ),
      );

      return { jobId: existingJob.id, reviewerRole: input.reviewerRole, status: 'queued' as const };
    }),

  // ============================================================
  // reviewSession.abandon — Ch 21.9
  // Transition session to abandoned.
  // ============================================================
  abandon: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      const session = await getReviewSessionById(input.sessionId, userId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review session not found' });
      assertSessionActive(session.state, 'reviewSession.abandon');

      const doc = await getDocumentById(session.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });

      // EGRESS-CONTROL-PLANE-1 Inc 2 (CR-4): SOFT + fail-closed-AUDITED abandon. assertSessionActive above
      // guarantees state='active', so the single-flight CAS transitions it (rows===1) unless a concurrent
      // op already moved it. The CAS + the append-only audit row commit in ONE tx — a failed audit write
      // rolls the abandon back (no silent / un-audited abandon). NO destructive cascade: feedback / lanes /
      // locks / ledger are all retained (the review stays in document history).
      await abandonReviewSessionAudited({
        sessionId: input.sessionId,
        userId,
        matterId: doc.matterId,
        documentId: session.documentId,
        reason: 'attorney',
        fromLifecyclePhase: session.lifecyclePhase ?? null,
        summary:
          `Attorney abandoned review session ${input.sessionId} ` +
          `(document ${session.documentId}, iteration ${session.iterationNumber}).`,
      });

      void emitTelemetry(
        'review_session_abandoned',
        {},
        { userId, matterId: doc.matterId, documentId: session.documentId, jobId: null },
      );

      // Return the post-abandon row (state='abandoned'). The prior code returned the void result of
      // updateReviewSessionState, so this is a strict, additive improvement to the response shape.
      const updatedSession = await getReviewSessionById(input.sessionId, userId);
      return { session: updatedSession };
    }),

  // ============================================================
  // MR-CAL-6B — locked decisions (document-scoped)
  //
  // Attorney-authored locks a reviewer should respect ("do not re-raise absent
  // a material new fact"). These are PURE DB writes — no LLM call/job. The
  // advisory evaluator never writes here; only the attorney does. The reviewer
  // PROMPT already instructs "do not re-raise locked decisions absent material
  // change" (reviewerPrompts.ts); reviewSession.create injects active locks into
  // the reviewer userPrompt so that instruction has data to act on.
  // Strictness is "respect unless new facts" (NOT hard-suppress): we never
  // filter reviewer output; a deliberate re-raise can still surface a true blocker.
  // ============================================================

  // lockDecision — create a locked decision from a reviewer suggestion.
  // origin 'declined' = decline-&-lock; origin 'adopted' = lock-on-adopt.
  lockDecision: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        suggestionId: z.string().min(1),
        origin: z.enum(['declined', 'adopted']),
        summary: z.string().min(1).max(2000),
        rationale: z.string().max(4000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      const session = await getReviewSessionById(input.sessionId, userId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review session not found' });

      const doc = await getDocumentById(session.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'reviewSession.lockDecision');

      const lockedDecisionId = await insertLockedDecision({
        userId,
        documentId: session.documentId,
        matterId: doc.matterId,
        origin: input.origin,
        summary: input.summary,
        rationale: input.rationale ?? null,
        sourceSuggestionId: input.suggestionId,
        sourceIterationNumber: session.iterationNumber,
        reviewSessionId: input.sessionId,
      });

      void emitTelemetry(
        'locked_decision_created',
        {
          lockedDecisionId,
          origin: input.origin,
          sourceSuggestionId: input.suggestionId,
          iterationNumber: session.iterationNumber,
        },
        { userId, matterId: doc.matterId, documentId: session.documentId, jobId: null },
      );

      // FOLD-GOV-1a Inc 2: best-effort Matter-Record audit of the 'lock' explicit act.
      void recordAuditEvent({
        userId,
        matterId: doc.matterId,
        documentId: session.documentId,
        eventType: 'locked',
        actor: 'attorney',
        summary: `Locked decision (${input.origin}): ${input.summary}`,
        payload: { lockedDecisionId, origin: input.origin, iterationNumber: session.iterationNumber },
        reviewSessionId: input.sessionId,
        sourceSuggestionId: input.suggestionId,
      });

      return { lockedDecisionId };
    }),

  // listLockedDecisions — all locked decisions for a document (any status).
  listLockedDecisions: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      const lockedDecisions = await listLockedDecisionsForDocument(input.documentId, userId);
      return { lockedDecisions };
    }),

  // unlockDecision — status -> 'unlocked' (row preserved for audit).
  unlockDecision: protectedProcedure
    .input(z.object({ lockedDecisionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const existing = await getLockedDecisionById(input.lockedDecisionId, userId);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Locked decision not found' });

      await unlockLockedDecision(input.lockedDecisionId, userId);

      void emitTelemetry(
        'locked_decision_unlocked',
        { lockedDecisionId: input.lockedDecisionId },
        { userId, matterId: existing.matterId, documentId: existing.documentId, jobId: null },
      );

      // FOLD-GOV-1a Inc 2: best-effort Matter-Record audit of the 'unlock' explicit act.
      void recordAuditEvent({
        userId,
        matterId: existing.matterId,
        documentId: existing.documentId,
        eventType: 'unlocked',
        actor: 'attorney',
        summary: `Unlocked decision ${input.lockedDecisionId}`,
        payload: { lockedDecisionId: input.lockedDecisionId },
      });

      return { lockedDecisionId: input.lockedDecisionId };
    }),

  // updateDecision — edit summary/rationale (attorney can modify).
  updateDecision: protectedProcedure
    .input(
      z.object({
        lockedDecisionId: z.string().uuid(),
        summary: z.string().min(1).max(2000).optional(),
        rationale: z.string().max(4000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const existing = await getLockedDecisionById(input.lockedDecisionId, userId);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Locked decision not found' });

      const fields: { summary?: string; rationale?: string | null } = {};
      if (input.summary !== undefined) fields.summary = input.summary;
      if (input.rationale !== undefined) fields.rationale = input.rationale;
      if (Object.keys(fields).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No fields to update' });
      }

      await updateLockedDecision(input.lockedDecisionId, userId, fields);

      void emitTelemetry(
        'locked_decision_updated',
        { lockedDecisionId: input.lockedDecisionId, fields: Object.keys(fields) },
        { userId, matterId: existing.matterId, documentId: existing.documentId, jobId: null },
      );

      return { lockedDecisionId: input.lockedDecisionId };
    }),

  // ============================================================
  // MR-CAL-7B — cumulative adopt ledger (read + attorney status override)
  //
  // Ledger entries are CAPTURED inside regenerate/regenerateSingleReviewer (one
  // commit point with the adoption) and updated on regeneration commit; these
  // procedures are the read path and the attorney's status override. Pure DB.
  // ============================================================

  // listAdoptLedger — all ledger entries for a document (any status), newest first.
  listAdoptLedger: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      const adoptLedger = await listAdoptLedgerForDocument(input.documentId, userId);
      return { adoptLedger };
    }),

  // updateAdoptLedgerStatus — attorney override (statusSource -> 'attorney'; auto-detection
  // will never overwrite an attorney-set status thereafter).
  updateAdoptLedgerStatus: protectedProcedure
    .input(
      z.object({
        adoptLedgerId: z.string().uuid(),
        status: z.enum(['active', 'superseded', 'resolved', 'unresolved']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const existing = await getAdoptLedgerEntryById(input.adoptLedgerId, userId);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Adopt-ledger entry not found' });

      await updateAdoptLedgerStatus(input.adoptLedgerId, userId, input.status);

      void emitTelemetry(
        'adopt_ledger_status_overridden',
        { adoptLedgerId: input.adoptLedgerId, status: input.status },
        { userId, matterId: existing.matterId, documentId: existing.documentId, jobId: null },
      );

      return { adoptLedgerId: input.adoptLedgerId };
    }),

  // ============================================================
  // REVIEW-LOOP-UX-1 / R1 — inline reject / defer per reviewer suggestion
  //
  // ADOPT is unchanged: it remains the EXISTING updateSelection → adopt-ledger-at-regenerate path
  // (positive-selection only, R5), and the running ledger state is surfaced inline via the EXISTING
  // listAdoptLedger read. REJECT / DEFER is the absence of a selection, so it is recorded here as a
  // disposition on the EXISTING append-only audit stream (recordAuditEvent eventType='disposition',
  // FOLD-L1-1) — NOT a new table/column/migration. The attorney is the decision-maker; this only
  // records the decision. Owner-scoping mirrors lockDecision exactly: the session is resolved by
  // (sessionId, userId) and the document by (session.documentId, userId), so a non-owner gets
  // NOT_FOUND and can never write or read another owner's data.
  // ============================================================
  dispositionSuggestion: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        suggestionId: z.string().min(1),
        action: z.enum(['reject', 'defer']),
        rationale: z.string().max(4000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      const session = await getReviewSessionById(input.sessionId, userId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review session not found' });

      const doc = await getDocumentById(session.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'reviewSession.dispositionSuggestion');

      // Record on the EXISTING disposition audit stream (FOLD-L1-1). FAIL-VISIBLY is unnecessary for
      // an advisory triage mark, so reuse the best-effort recordAuditEvent (never throws — an
      // un-migrated audit_events table no-ops with a telemetry breadcrumb), matching lockDecision.
      void recordAuditEvent({
        userId,
        matterId: doc.matterId,
        documentId: session.documentId,
        eventType: 'disposition',
        actor: 'attorney',
        summary:
          input.action === 'reject'
            ? 'Rejected reviewer suggestion (this iteration)'
            : 'Deferred reviewer suggestion',
        targetType: REVIEWER_SUGGESTION_TARGET_TYPE,
        targetId: input.suggestionId,
        action: input.action,
        rationale: input.rationale ?? null,
        scope: 'document',
        reviewSessionId: input.sessionId,
        sourceSuggestionId: input.suggestionId,
        payload: { iterationNumber: session.iterationNumber },
      });

      void emitTelemetry(
        'review_suggestion_dispositioned',
        {
          action: input.action,
          sourceSuggestionId: input.suggestionId,
          iterationNumber: session.iterationNumber,
        },
        { userId, matterId: doc.matterId, documentId: session.documentId, jobId: null },
      );

      return { suggestionId: input.suggestionId, action: input.action };
    }),

  // ============================================================
  // REVIEW-LOOP-UX-1 / R1 — INSTANT, COMMITTED adopt (per-click adopt-ledger write)
  //
  // The operator decision: ADOPT must commit an adopt-ledger row on EACH click, not ride the
  // select→regenerate path (where the row only landed at regenerate). The ledger row binds to
  // doc.currentVersionId — the version CURRENTLY under review = the regeneration INPUT version —
  // which already exists at click time, so no schema change / migration / nullable column is needed.
  // This ALSO records the manual selection (same args shape the regenerate loop uses) so the adopted
  // suggestion is still incorporated at the next regenerate. The regenerate paths now skip
  // re-inserting any (session, suggestion, version) an instant adopt already committed, so there is
  // no double-write and no unique-index collision (uniq_adopt_ledger_session_suggestion /
  // uniq_manual_selections). Owner-scoping mirrors dispositionSuggestion EXACTLY: session by
  // (sessionId, userId) → NOT_FOUND, then document by (session.documentId, userId) → NOT_FOUND, so a
  // non-owner can never write or read another owner's data. Idempotent: a second identical click
  // returns the existing row (no duplicate insert).
  // ============================================================
  adoptSuggestion: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        suggestionId: z.string().min(1),
        adoptedText: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      const session = await getReviewSessionById(input.sessionId, userId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Review session not found' });

      const doc = await getDocumentById(session.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'reviewSession.adoptSuggestion');

      // MR-CAL-7B: adopt_ledger anchors each adoption to the current (input) version (mirror regenerate).
      if (!doc.currentVersionId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NO_CURRENT_VERSION: document has no current version',
        });
      }
      const adoptedIntoVersionId = doc.currentVersionId;

      // Resolve reviewerRole + body for this suggestion the SAME way the regenerate path builds its map.
      const allFeedbackForPrompt = await listFeedbackForSession(input.sessionId, userId);
      const suggestionMap = new Map<string, { title: string; body: string; reviewerRole: string }>();
      for (const feedbackRow of allFeedbackForPrompt) {
        for (const suggestion of feedbackRow.suggestions) {
          suggestionMap.set(suggestion.suggestionId, {
            title: suggestion.title,
            body: suggestion.body,
            reviewerRole: feedbackRow.reviewerRole,
          });
        }
      }
      const s = suggestionMap.get(input.suggestionId);
      if (!s) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `SUGGESTION_NOT_RESOLVED: selection references unknown suggestionId '${input.suggestionId}'`,
        });
      }

      // IDEMPOTENCY: if an entry already exists for (session, suggestion, current version), return it.
      const existing = await getAdoptLedgerEntryForSuggestionVersion(
        input.sessionId,
        input.suggestionId,
        adoptedIntoVersionId,
        userId,
      );
      if (existing) {
        return { adoptLedgerId: existing.id, suggestionId: input.suggestionId, idempotent: true as const };
      }

      // Record the manual selection so the adopted suggestion is still incorporated at the next
      // regenerate (same args shape the regenerate loop uses; the regenerate loop now skips this one).
      await insertManualSelection({
        userId,
        documentId: session.documentId,
        iterationNumber: session.iterationNumber,
        reviewSessionId: input.sessionId,
        suggestionId: input.suggestionId,
        attorneyNote: null,
      });

      const edited =
        input.adoptedText !== undefined && input.adoptedText.trim() !== '' && input.adoptedText !== s.body;
      const adoptLedgerId = await insertAdoptLedgerEntry({
        userId,
        documentId: session.documentId,
        matterId: doc.matterId,
        sourceSuggestionId: input.suggestionId,
        sourceReviewerRole: s.reviewerRole,
        sourceIterationNumber: session.iterationNumber,
        reviewSessionId: input.sessionId,
        disposition: edited ? 'adopted_modified' : 'adopted_verbatim',
        originalText: s.body,
        adoptedText: edited ? input.adoptedText! : s.body,
        adoptedIntoVersionId,
        // FOLD-ORCH-1 Inc3c-2: an instant per-suggestion adopt is an INDIVIDUAL adoption (the same
        // confirmationMode the regenerate/Inc3 path uses for a per-item adoption; never flattened).
        confirmationMode: 'individually_adopted',
      });

      void emitTelemetry(
        'adopt_ledger_entry_created',
        {
          adoptLedgerId,
          sourceSuggestionId: input.suggestionId,
          disposition: edited ? 'adopted_modified' : 'adopted_verbatim',
          iterationNumber: session.iterationNumber,
        },
        { userId, matterId: doc.matterId, documentId: session.documentId, jobId: null },
      );

      return { adoptLedgerId, suggestionId: input.suggestionId, idempotent: false as const };
    }),

  // listSuggestionDispositions — reject/defer dispositions recorded for THIS document's suggestions,
  // newest first. Read-only projection over the EXISTING disposition audit stream (NEW read file).
  listSuggestionDispositions: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      const all = await listReviewSuggestionDispositionsForMatter(doc.matterId, userId);
      // Narrow to dispositions on this document (the matter projection may span sibling documents).
      const dispositions = all.filter((d) => d.documentId === input.documentId);
      return { dispositions };
    }),

  // ============================================================
  // MR-CAL-8B — sendability check (ADVISORY classifier; read-only)
  //
  // Runs an LLM classifier over the current draft (+ latest reviewer feedback as
  // signal) and returns an advisory verdict. It is a QUERY: no persistence, no job
  // row, and it is NOT wired into finalize/export — so it can never block or affect
  // the send transaction (advisory-only, MR-CAL-8B decisions #1/#2/#3).
  //
  // DEGRADE-TO-UNAVAILABLE: any classifier/parse failure returns { available:false }
  // rather than throwing, so a flaky/slow/parse-failing model surfaces "sendability
  // check unavailable" and NEVER errors into the client/finalize path. The only audit
  // trace is the 'sendability_checked' telemetry event (no override store in Phase A).
  // ============================================================
  checkSendability: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.userId;

      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      if (!doc.currentVersionId) {
        return { available: false as const, reason: 'NO_CURRENT_VERSION' as const };
      }
      const currentVersion = await getVersionById(doc.currentVersionId, userId);
      if (!currentVersion) {
        return { available: false as const, reason: 'NO_CURRENT_VERSION' as const };
      }

      // Latest-iteration reviewer feedback as classifier signal (best-effort).
      const allFeedback = await listFeedbackForDocument(input.documentId, userId);
      const latestIteration = allFeedback.reduce(
        (max, f) => (f.iterationNumber > max ? f.iterationNumber : max),
        0,
      );
      const feedbackRows = allFeedback
        .filter((f) => f.iterationNumber === latestIteration)
        .map((f) => ({
          reviewerRole: f.reviewerRole,
          reviewerTitle: f.reviewerTitle,
          suggestions: f.suggestions.map((s) => ({
            suggestionId: s.suggestionId,
            title: s.title,
            body: s.body,
            ...(s.severity !== undefined ? { severity: s.severity } : {}),
          })),
        }));

      const systemPrompt = buildSendabilitySystemPrompt();
      const userPrompt = buildSendabilityUserPrompt({
        documentTitle: doc.title,
        documentType: doc.documentType,
        iterationNumber: currentVersion.iterationNumber,
        content: currentVersion.content,
        feedbackRows,
      });

      // DEGRADE-TO-UNAVAILABLE: wrap the whole LLM call + parse so nothing throws to
      // the client. Advisory-only; failure must never affect finalize/export.
      try {
        // MR-CAL-5D lesson: set an explicit 300s timeout (do not inherit the 120s default).
        const signal = AbortSignal.timeout(300_000);
        // EGRESS-CONTROL-PLANE-1: route the sendability classifier through the DOCUMENT egress control plane
        // — a SYNCHRONOUS pre-dispatch decision row + the matter/global no_external hold check + the EXISTING
        // degrade-to-unavailable. NO synthetic conversationId (the subject is the document/version); the row
        // stores a HASH of the prompt bundle, never the draft text. Under a hold (a BLOCKED row is recorded
        // first), an audit-write failure, or a hold-check that is uncertain, documentEgressSend throws and we
        // degrade to CLASSIFIER_UNAVAILABLE in the catch — never an unlogged send of full client document text.
        const subject: EgressSubject = {
          type: 'document',
          subjectId: currentVersion.id,
          matterId: doc.matterId,
          userId,
          documentId: input.documentId,
          documentVersionId: currentVersion.id,
        };
        const llmResult = await documentEgressSend({
          subject,
          surface: 'sendability',
          modelString: EVALUATOR_MODEL,
          llmParams: {
            systemPrompt,
            userPrompt,
            temperature: 0.2,
            maxTokens: 4096,
            structuredOutputSchema: SendabilityVerdictSchema,
            signal,
          },
          serializedPayload: `${systemPrompt}\n\n${userPrompt}`,
        });
        const verdict = parseSendabilityOutput(llmResult.content);
        void emitTelemetry(
          'sendability_checked',
          {
            sendable: verdict.sendable,
            blockerCount: verdict.blockers.length,
            blockerCategories: verdict.blockers.map((b) => b.category),
          },
          { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
        );
        return { available: true as const, verdict };
      } catch (err) {
        void emitTelemetry(
          'sendability_check_failed',
          { errorMessage: err instanceof Error ? err.message : String(err) },
          { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
        );
        return { available: false as const, reason: 'CLASSIFIER_UNAVAILABLE' as const };
      }
    }),
});

// ─── internal helper: invoke document.regenerate logic ────────────────────────
// Clarification 3: reuses the Phase 4a executeCanonicalMutation path.
// This is NOT a second regeneration primitive — it is the same path
// parameterized with sessionId and consolidationMode.

async function _invokeDocumentRegenerate(params: {
  userId: string;
  documentId: string;
  doc: Awaited<ReturnType<typeof getDocumentById>>;
  instructions: string;
  sessionId: string;
  consolidationMode: 'all_reviewers' | 'single_reviewer';
  matterId: string;
}): Promise<{ jobId: string; status: string }> {
  const { userId, documentId, doc, instructions, matterId } = params;

  if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
  if (!doc.currentVersionId) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'NO_CURRENT_VERSION: document has no current version',
    });
  }

  const currentVersion = await getVersionById(doc.currentVersionId, userId);
  if (!currentVersion) throw new TRPCError({ code: 'NOT_FOUND', message: 'Current version not found' });

  const matter = await getMatterById(matterId, userId);
  if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });

  const assembledCtx = await assembleContext({
    operation: 'regeneration',
    matterId,
    userId,
    documentId,
  });

  const materialsText = assembledCtx.includedMaterials
    .map((m) => `[Material: ${m.filename ?? 'Untitled'}]\n${m.textContent}`)
    .join('\n\n---\n\n');

  const systemPrompt = [
    `You are an expert legal document drafter for ${matter.clientName ?? 'a client'}.`,
    `You are revising a ${doc.documentType} document titled "${doc.title}".`,
    'Apply the attorney instructions and selected reviewer feedback below to produce an improved version.',
    'Return only the complete revised document text, no commentary.',
  ].join('\n');

  const userPromptParts = [
    `## Current Draft\n${currentVersion.content}`,
    `\n## Attorney Instructions\n${instructions}`,
    materialsText ? `\n## Matter Materials\n${materialsText}` : null,
  ].filter(Boolean).join('\n');

  const nextIterationNumber = currentVersion.iterationNumber + 1;

  const result = await executeCanonicalMutation({
    userId,
    jobType: 'regeneration',
    modelString: PRIMARY_DRAFTER_MODEL,
    matterId,
    documentId,
    txn1Enqueue: async (jobId) => {
      return { jobId, preEnqueueState: doc.workflowState };
    },
    buildLlmParams: (_jobId) => ({
      systemPrompt,
      userPrompt: userPromptParts,
      temperature: 0.3,
      maxTokens: 8192,
    }),
    txn2Commit: async ({ jobId, output }) => {
      const content = typeof output === 'string' ? output : JSON.stringify(output);
      const versionNumber = await getNextVersionNumber(documentId, userId);
      const newVersion = await insertVersion({
        userId,
        documentId,
        versionNumber,
        content,
        generatedByJobId: jobId,
        iterationNumber: nextIterationNumber,
      });
      await updateDocumentCurrentVersion(documentId, userId, newVersion.id);
      // NOTIFY-PRODUCERS-1: the review-loop "generate revised draft" committed a version — emit ONE
      // "Draft ready" badge (idempotent per versionId; same producer the document paths use). Best-effort.
      await emitDraftReadyNotification({ versionId: newVersion.id, userId, matterId });
      // MR-CAL-7B: mark adopt-ledger entries carried into this produced version and run
      // the ADVISORY survival heuristic (auto-status only; never touches attorney-set rows,
      // never deletes/hides). Failure here must NOT fail the regeneration (the new version is
      // already committed); wrap defensively.
      try {
        const ledgerResult = await applyRegenerationToAdoptLedger({
          documentId,
          userId,
          producedVersionId: newVersion.id,
          newContent: content,
        });
        void emitTelemetry(
          'adopt_ledger_regeneration_applied',
          { producedVersionId: newVersion.id, carried: ledgerResult.carried, superseded: ledgerResult.superseded },
          { userId, matterId, documentId, jobId },
        );
      } catch {
        // Advisory ledger bookkeeping is best-effort; never block a committed regeneration.
      }
      void emitTelemetry(
        'generation_completed',
        { jobId, operation: 'regeneration', newVersionNumber: versionNumber },
        { userId, matterId, documentId, jobId },
      );
    },
    txn2Revert: async ({ jobId, errorClass }) => {
      void emitTelemetry(
        'generation_reset',
        { jobId, operation: 'regeneration', reason: errorClass === 'timeout' ? 'timeout' : 'failure' },
        { userId, matterId, documentId, jobId },
      );
    },
    telemetryCtx: { userId, matterId, documentId, jobId: null },
  });

  return { jobId: result.jobId, status: result.status };
}
