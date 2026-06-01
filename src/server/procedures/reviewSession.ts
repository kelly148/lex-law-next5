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
import { executeCanonicalMutation } from '../db/canonicalMutation.js';
import { REVIEWER_TITLES, EVALUATOR_MODEL, PRIMARY_DRAFTER_MODEL, resolveReviewerModel, type ReviewerKey, type LiteReviewerKey, type AnyReviewerKey } from '../llm/config.js';
import { parseFeedbackOutput, RawSuggestionsArraySchema } from '../llm/parsers/feedbackParser.js';
import { buildEvaluatorSystemPrompt, buildEvaluatorUserPrompt } from '../llm/prompts/evaluatorPrompt.js';
import { parseEvaluatorOutput } from '../llm/parsers/evaluatorOutputParse.js';
import { EvaluatorOutputSchema } from '../../shared/schemas/phase4b.js';
import { extractEmbeddedFeedbackCards } from '../llm/parsers/embeddedFeedbackCards.js';
import {
  isMultiReviewerEnabled,
  isReviewerSelectionCountAllowed,
  isEvaluatorEnabled,
} from '../config/featureFlags.js';
import { buildReviewerSystemPrompt } from '../llm/prompts/reviewerPrompts.js';
import { getUserPreferences } from '../db/queries/userPreferences.js';
import { getDocumentById, updateDocumentCurrentVersion } from '../db/queries/documents.js';
import { getMatterById } from '../db/queries/matters.js';
import { getVersionById, insertVersion, getNextVersionNumber } from '../db/queries/versions.js';
import { assembleContext } from '../context/pipeline.js';
import {
  getReviewSessionById,
  getActiveReviewSessionForDocument,
  insertReviewSession,
  updateReviewSessionState,
  updateReviewSessionSelections,
  updateReviewSessionGlobalInstructions,
  listFeedbackForSession,
  insertFeedbackEvaluation,
  listFeedbackForDocument,
  listReviewSessionsForDocument,
  listManualSelectionsForDocument,
  getEvaluationForIteration,
  insertManualSelection,
  insertFeedback,
  getNextIterationNumberForDocument,
  insertLockedDecision,
  listLockedDecisionsForDocument,
  listActiveLockedDecisionsForDocument,
  getLockedDecisionById,
  unlockLockedDecision,
  updateLockedDecision,
} from '../db/queries/phase4b.js';
import { assertNotComplete } from './documents.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function assertSessionActive(state: string, procedureName: string): void {
  if (state !== 'active') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `SESSION_NOT_ACTIVE: ${procedureName} requires state='active', got '${state}'`,
    });
  }
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

      // Check for existing active session (R10 — also enforced at DB level)
      const existingSession = await getActiveReviewSessionForDocument(input.documentId, userId);
      if (existingSession) {
        throw new TRPCError({
          code: 'CONFLICT',
          // Include sessionId so the frontend can resume the existing session instead of showing a dead-end error.
          message: `SESSION_ALREADY_EXISTS:${existingSession.id}: an active review session already exists for this document at iteration ${existingSession.iterationNumber}`,
        });
      }

      // MR-CAL-3E: compute the review iteration server-side from prior review
      // sessions for this document so it advances across review requests /
      // regeneration cycles. The client-supplied input.iterationNumber is now
      // advisory only — review iteration is decoupled from
      // officialSubstantiveVersionNumber, which is what makes the HistorySection
      // sequential-comparison view reachable (prior iterations < current exist).
      const iterationNumber = await getNextIterationNumberForDocument(input.documentId);

      // Insert the review session row
      const sessionId = await insertReviewSession({
        userId,
        documentId: input.documentId,
        iterationNumber,
        selectedReviewers: input.selectedReviewers,
      });

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

      // Fan out one reviewer job per selectedReviewer (R4: via executeCanonicalMutation)
      const reviewerJobIds: string[] = [];
      for (const reviewerRole of input.selectedReviewers) {
        const modelString = resolveReviewerModel(reviewerRole);
        if (!modelString) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `REVIEWER_NOT_ENABLED: '${reviewerRole}' is not a valid reviewer identifier`,
          });
        }
        // MR-CAL-2: Calibrated four-track prompt while preserving the active legacy parser wrapper.
        // Legacy wrapper keys remain "title", "body", and "severity" for RawSuggestionsArraySchema.
        const systemPrompt = buildReviewerSystemPrompt(reviewerRole as AnyReviewerKey);
        // S1a (MR-1): Include full document content in the userPrompt.
        // MR-CAL-6B: append the active locked-decisions section (empty string when
        // there are none, so default behavior is unchanged).
        const userPrompt = [
          `Review session ${sessionId}, iteration ${iterationNumber}.`,
          `Document title: ${doc.title}`,
          '',
          '## Document Content',
          currentVersion.content,
          // Only present when there are active locked decisions; otherwise omitted
          // entirely so the prompt is byte-identical to pre-6B behavior.
          ...(lockedDecisionsSection ? [lockedDecisionsSection] : []),
        ].join('\n');
        const reviewerTitle = REVIEWER_TITLES[reviewerRole as ReviewerKey | LiteReviewerKey] ?? reviewerRole;
        const reviewerResult = await executeCanonicalMutation({
          userId,
          jobType: 'reviewer_feedback',
          modelString,
          matterId: doc.matterId,
          documentId: input.documentId,
          txn1Enqueue: async (jobId) => {
            return { jobId, preEnqueueState: doc.workflowState };
          },
          buildLlmParams: (_jobId) => ({
            systemPrompt,
            userPrompt,
            temperature: 0.4,
            maxTokens: 16384, // MR-LLM-1 S12: raised from 8192 to 16384 (model ceiling floor) to handle any legal document size; supersedes S11 8192 budget
            structuredOutputSchema: RawSuggestionsArraySchema,
          }),
          // MR-LLM-GPT-1: reviewer_feedback jobs use a 300 000 ms timeout.
          // GPT-5 has a TTFT of ~83 s at high load; the global 120 000 ms default
          // is insufficient. 300 000 ms (5 min) gives a safe margin for all four
          // reviewer adapters (Claude, GPT, Gemini, Grok) at any document size.
          // Non-reviewer jobs continue to use the global 120 000 ms default.
          timeoutMs: 300_000,
          // S3b (MR-1): Parse LLM output and persist to feedback table
          txn2Commit: async ({ jobId, output }) => {
            const rawOutput = typeof output === 'string' ? output : JSON.stringify(output);
            // MR-CAL-2G: capture the raw reviewer output for calibration auditability
            // BEFORE the parse can throw. The P8-T1 GPT failure is a PARSE_FAILURE, so
            // parsing defensively here is the only way to preserve the raw artifact that
            // MR-CAL-2F found was being lost. Parse-failure behavior is otherwise
            // unchanged: the error is re-thrown below so the job still fails and reverts.
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
              { userId, matterId: doc.matterId, documentId: input.documentId, jobId },
            );
            if (parseError !== null) {
              throw parseError;
            }
            // parsedSuggestions is non-null here: it is only null when parseError
            // was set, and that path threw above.
            const suggestions = parsedSuggestions!;
            await insertFeedback({
              userId,
              documentId: input.documentId,
              versionId: doc.currentVersionId!,
              iterationNumber,
              reviewSessionId: sessionId,
              jobId,
              reviewerRole,
              reviewerModel: modelString,
              reviewerTitle,
              suggestions,
            });
            void emitTelemetry(
              'generation_completed',
              { jobId, operation: 'reviewer_feedback', newVersionNumber: iterationNumber },
              { userId, matterId: doc.matterId, documentId: input.documentId, jobId },
            );
          },
          txn2Revert: async ({ jobId, errorClass }) => {
            void emitTelemetry(
              'generation_reset',
              { jobId, operation: 'reviewer_feedback', reason: errorClass === 'timeout' ? 'timeout' : 'failure' },
              { userId, matterId: doc.matterId, documentId: input.documentId, jobId },
            );
          },
          telemetryCtx: { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
        });
        reviewerJobIds.push(reviewerResult.jobId);
      }

      // EVALUATOR PATH — MR-CAL-5C (advisory output contract; default OFF)
      //
      // Gated behind isEvaluatorEnabled() (env EVALUATOR_ENABLED, default OFF) AND
      // more than one selected reviewer. The reviewer loop above runs inline and
      // sequentially (executeCanonicalMutation awaits each LLM + persist), so by the
      // time we reach here ALL reviewer feedback for this iteration is persisted and
      // can be read to build the evaluator prompt.
      //
      // The evaluator is ADVISORY ONLY: it emits one disposition (adopt/reject/
      // neutral) + a short synthesis per reviewer suggestion, persisted to
      // feedback_evaluations and rendered as advisory icons in ReviewPane. It never
      // writes the attorney's selection, never auto-adopts, never regenerates, and
      // flags business decisions for the attorney (P8-T10). The attorney decides.
      //
      // References: MR-CAL-5A investigation; MR-CAL-5C plan; decision #41 (EVALUATOR_MODEL).
      if (isEvaluatorEnabled() && input.selectedReviewers.length > 1) {
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
            // Parse + validate the advisory dispositions. parseEvaluatorOutput throws
            // on malformed/non-conforming output, which fails the evaluator job and
            // runs txn2Revert — persisting NOTHING. Reviewer feedback is unaffected
            // (the evaluator is purely additive).
            const dispositions = parseEvaluatorOutput(output);
            await insertFeedbackEvaluation({
              userId,
              documentId: input.documentId,
              iterationNumber,
              jobId,
              dispositions,
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

      return { sessionId };
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

      return { session, feedback, evaluation };
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
      // Build a flat map: suggestionId → { title, body, severity, reviewerTitle }
      const suggestionMap = new Map<string, { title: string; body: string; severity?: string; reviewerTitle: string }>();
      for (const feedbackRow of allFeedbackForPrompt) {
        for (const suggestion of feedbackRow.suggestions) {
          suggestionMap.set(suggestion.suggestionId, {
            title: suggestion.title,
            body: suggestion.body,
            ...(suggestion.severity !== undefined ? { severity: suggestion.severity } : {}),
            reviewerTitle: feedbackRow.reviewerTitle,
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

      // Commit feedback_manual_selections rows (R5: positive-selection only)
      for (const sel of selections) {
        await insertManualSelection({
          userId,
          documentId: session.documentId,
          iterationNumber: session.iterationNumber,
          reviewSessionId: input.sessionId,
          suggestionId: sel.suggestionId,
          attorneyNote: sel.note,
        });
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
      const suggestionMapSingle = new Map<string, { title: string; body: string; severity?: string; reviewerTitle: string }>();
      for (const feedbackRow of allFeedbackForPromptSingle) {
        for (const suggestion of feedbackRow.suggestions) {
          suggestionMapSingle.set(suggestion.suggestionId, {
            title: suggestion.title,
            body: suggestion.body,
            ...(suggestion.severity !== undefined ? { severity: suggestion.severity } : {}),
            reviewerTitle: feedbackRow.reviewerTitle,
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
      // Commit all selections (R5: positive-selection only)
      for (const sel of selections) {
        await insertManualSelection({
          userId,
          documentId: session.documentId,
          iterationNumber: session.iterationNumber,
          reviewSessionId: input.sessionId,
          suggestionId: sel.suggestionId,
          attorneyNote: sel.note,
        });
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

      const updatedSession = await updateReviewSessionState(input.sessionId, userId, 'abandoned');

      void emitTelemetry(
        'review_session_abandoned',
        {},
        { userId, matterId: doc.matterId, documentId: session.documentId, jobId: null },
      );

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
