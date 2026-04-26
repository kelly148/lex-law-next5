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
import { REVIEWER_MODELS, EVALUATOR_MODEL, PRIMARY_DRAFTER_MODEL, type ReviewerKey } from '../llm/config.js';
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
  getEvaluationForIteration,
  insertManualSelection,
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

      // Fan out one reviewer job per selectedReviewer (R4: via executeCanonicalMutation)
      const reviewerJobIds: string[] = [];
      for (const reviewerRole of input.selectedReviewers) {
        const modelString = REVIEWER_MODELS[reviewerRole as ReviewerKey];
        const systemPrompt = [
          `You are a legal document reviewer (${reviewerRole}).`,
          `Review the document titled "${doc.title}" and provide structured feedback.`,
          'Return a JSON array of feedback items: [{ "suggestion": string, "rationale": string, "severity": "critical"|"major"|"minor" }]',
        ].join('\n');
        const userPrompt = `Review session ${sessionId}, iteration ${iterationNumber}.\nDocument: ${doc.title}`;

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
            maxTokens: 4096,
          }),
          txn2Commit: async ({ jobId }) => {
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

      // Enqueue evaluator job only when multiple reviewers are selected.
      // Decision #41: env-fixed, never attorney-selectable.
      // With a single reviewer there is no cross-reviewer synthesis to evaluate.
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
            feedbackId: z.string().uuid(),
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

      // Compute diff for telemetry
      const currentSelections = (session.selections ?? []) as Array<{ feedbackId: string }>;
      const currentIds = new Set(currentSelections.map((s) => s.feedbackId));
      const newIds = new Set(input.selections.map((s) => s.feedbackId));
      const added = input.selections.filter((s) => !currentIds.has(s.feedbackId)).map((s) => s.feedbackId);
      const removed = currentSelections.filter((s) => !newIds.has(s.feedbackId)).map((s) => s.feedbackId);

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
      const selections = (session.selections ?? []) as Array<{ feedbackId: string; note: string | null }>;
      const hasSelections = selections.length > 0;
      const hasGlobalInstructions = (session.globalInstructions ?? '').trim().length > 0;
      if (!hasSelections && !hasGlobalInstructions) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'REVIEW_SESSION_EMPTY: session has no selections and no global instructions',
        });
      }

      // Commit feedback_manual_selections rows (R5: positive-selection only)
      for (const sel of selections) {
        await insertManualSelection({
          userId,
          documentId: session.documentId,
          iterationNumber: session.iterationNumber,
          reviewSessionId: input.sessionId,
          suggestionId: sel.feedbackId,
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

      // Delegate to document.regenerate (Clarification 3: reuse Phase 4a path)
      // Build instructions from selections and global instructions
      const selectionSummary = selections.length > 0
        ? `Apply ${selections.length} selected suggestion(s) from all reviewers.`
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

      // Get feedback for this reviewer only
      const allFeedback = await listFeedbackForSession(input.sessionId, userId);
      const reviewerFeedbackIds = new Set(
        allFeedback
          .filter((f) => f.reviewerRole === input.reviewerRole)
          .map((f) => f.id),
      );

      const selections = (session.selections ?? []) as Array<{ feedbackId: string; note: string | null }>;
      const reviewerSelections = selections.filter((s) => reviewerFeedbackIds.has(s.feedbackId));
      const hasGlobalInstructions = (session.globalInstructions ?? '').trim().length > 0;

      if (reviewerSelections.length === 0 && !hasGlobalInstructions) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `REVIEW_SESSION_EMPTY: no selections for reviewer '${input.reviewerRole}' and no global instructions`,
        });
      }

      // Commit only this reviewer's selections (R5: positive-selection only)
      for (const sel of reviewerSelections) {
        await insertManualSelection({
          userId,
          documentId: session.documentId,
          iterationNumber: session.iterationNumber,
          reviewSessionId: input.sessionId,
          suggestionId: sel.feedbackId,
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
          adoptedCount: reviewerSelections.length,
        },
        { userId, matterId: doc.matterId, documentId: session.documentId, jobId: null },
      );

      // Delegate to document.regenerate (Clarification 3: reuse Phase 4a path)
      const selectionSummary = reviewerSelections.length > 0
        ? `Apply ${reviewerSelections.length} selected suggestion(s) from reviewer '${input.reviewerRole}'.`
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
