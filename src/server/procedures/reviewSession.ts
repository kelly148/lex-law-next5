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
import { REVIEWER_MODELS, REVIEWER_TITLES, EVALUATOR_MODEL, PRIMARY_DRAFTER_MODEL, type ReviewerKey } from '../llm/config.js';
import { parseFeedbackOutput, RawSuggestionsArraySchema } from '../llm/parsers/feedbackParser.js';
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
  listFeedbackForDocument,
  getEvaluationForIteration,
  insertManualSelection,
  insertFeedback,
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
        // Decision #42: required, non-empty
        // MR-0G: max(1) gate — multi-reviewer path is structurally broken (MR-0 D1-D5).
        // Reject at schema level before any LLM dispatch occurs.
        selectedReviewers: z.array(z.string().min(1)).min(1, {
          message: 'NO_REVIEWERS_SELECTED: at least one reviewer is required',
        }).max(1, {
          message: 'MULTI_REVIEWER_DISABLED: Multi-reviewer review is temporarily unavailable. Please select one reviewer.',
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

      // Validate selectedReviewers against user's enabled set (Decision #42)
      const prefs = await getUserPreferences(userId);
      const enablement = prefs.preferences.reviewerEnablement;
      const validReviewerKeys: ReviewerKey[] = ['claude', 'gpt', 'gemini', 'grok'];

      for (const reviewerRole of input.selectedReviewers) {
        if (!validReviewerKeys.includes(reviewerRole as ReviewerKey)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `REVIEWER_NOT_ENABLED: '${reviewerRole}' is not a valid reviewer identifier`,
          });
        }
        if (!enablement[reviewerRole as ReviewerKey]) {
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

      // Determine iteration number
      const iterationNumber = input.iterationNumber;

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
      // Fan out one reviewer job per selectedReviewer (R4: via executeCanonicalMutation)
      const reviewerJobIds: string[] = [];
      for (const reviewerRole of input.selectedReviewers) {
        const modelString = REVIEWER_MODELS[reviewerRole as ReviewerKey];
        // S1b (MR-1): Updated system prompt requests title/body/severity shape
        const systemPrompt = [
          `You are a legal document reviewer (${reviewerRole}).`,
          'Review the document and provide structured feedback.',
          'Return a JSON array of feedback items with this exact shape:',
          '[{ "title": "Short issue title (under 80 characters)", "body": "Detailed feedback and recommendation", "severity": "critical"|"major"|"minor" }]',
          'Return an empty array [] if you have no feedback. Do not include any text outside the JSON array.',
        ].join('\n');
        // S1a (MR-1): Include full document content in the userPrompt
        const userPrompt = [
          `Review session ${sessionId}, iteration ${iterationNumber}.`,
          `Document title: ${doc.title}`,
          '',
          '## Document Content',
          currentVersion.content,
        ].join('\n');
        const reviewerTitle = REVIEWER_TITLES[reviewerRole as ReviewerKey] ?? reviewerRole;
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
          // S3b (MR-1): Parse LLM output and persist to feedback table
          txn2Commit: async ({ jobId, output }) => {
            const rawOutput = typeof output === 'string' ? output : JSON.stringify(output);
            const suggestions = parseFeedbackOutput(rawOutput);
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

      // EVALUATOR PATH — STRUCTURALLY INERT (MR-2 §S1)
      //
      // This dispatch gate fires when input.selectedReviewers.length > 1.
      // MR-0G's .max(1) constraint on the API schema makes this branch
      // unreachable in supported workflow.
      //
      // The evaluator system/user prompts and persistence path are not
      // part of the sequential single-reviewer product model per
      // Operating Plan v1.2 §1.3. The attorney is the synthesizer
      // across iterations; automated cross-synthesis is not required.
      //
      // If future product evidence supports automated synthesis,
      // evaluator repair or full decommissioning should be scoped as a
      // separate engagement (post-MR-3 cleanup or new feature work).
      //
      // References: MR-0 close-out (D3, D4 evaluator-path defects);
      // MR-0G acceptance (multi-reviewer gate); MR-2 close-out.
      if (input.selectedReviewers.length > 1) {
      const evaluatorModelString = EVALUATOR_MODEL;
      void executeCanonicalMutation({
        userId,
        jobType: 'evaluator',
        modelString: evaluatorModelString,
        matterId: doc.matterId,
        documentId: input.documentId,
        txn1Enqueue: async (jobId) => {
          return { jobId, preEnqueueState: doc.workflowState };
        },
        buildLlmParams: (_jobId) => ({
          systemPrompt: [
            'You are a legal document evaluation AI.',
            'Evaluate the reviewer feedback and produce structured dispositions.',
            'Return a JSON object: { "dispositions": [{ "feedbackId": string, "disposition": "adopt"|"reject"|"defer", "rationale": string }] }',
          ].join('\n'),
          userPrompt: `Evaluate feedback for review session ${sessionId}, iteration ${iterationNumber}.`,
          temperature: 0.2,
          maxTokens: 4096,
        }),
        txn2Commit: async ({ jobId }) => {
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

      const feedback = await listFeedbackForSession(input.sessionId, userId);
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
      return { feedback: allFeedback };
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
