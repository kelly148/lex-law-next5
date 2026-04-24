/**
 * informationRequest tRPC procedures — Phase 4b (Ch 21.7)
 *
 * Procedures:
 *   informationRequest.generate        — enqueue matrix generation job (Ch 21.7.1)
 *   informationRequest.archive         — archive the active matrix (Ch 21.7.2)
 *   informationRequest.editQuestion    — edit item text, category, or order (Ch 21.7.3)
 *   informationRequest.addQuestion     — add new item to active matrix (Ch 21.7.4)
 *   informationRequest.deleteQuestion  — delete an item (Ch 21.7.5)
 *   informationRequest.exportText      — export as docx or plain text (Ch 21.7.6)
 *   informationRequest.attachAnswer    — attach answer to an item (Ch 21.7.7)
 *   informationRequest.markComplete    — explicitly mark matrix complete (Ch 21.7.8)
 *   informationRequest.list            — list matrices for a matter (Ch 21.7.9)
 *   informationRequest.get             — fetch matrix with all items (Ch 21.7.10)
 *
 * All procedures require authentication (protectedProcedure).
 * userId is always drawn from ctx.userId — never from input.
 *
 * No Phase 5 UI, no Phase 6 export pipeline.
 * informationRequest.exportText produces a plain-text representation only
 * (no .docx export pipeline — that is Phase 6).
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import {
  getActiveInformationRequestForMatter,
  getInformationRequestById,
  listInformationRequestsForMatter,
  insertInformationRequest,
  updateInformationRequestStatus,
  archiveInformationRequest,
  listItemsForInformationRequest,
  getInformationRequestItemById,
  insertInformationRequestItem,
  updateInformationRequestItem,
  deleteInformationRequestItem,
} from '../db/queries/phase4b.js';
import { getMatterById } from '../db/queries/matters.js';
import { executeCanonicalMutation } from '../db/canonicalMutation.js';
import { PRIMARY_DRAFTER_MODEL } from '../llm/config.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';

export const informationRequestRouter = router({
  // ============================================================
  // informationRequest.generate — Ch 21.7.1
  // Enqueue matrix generation job for a matter.
  // Preconditions: matter exists; no active (non-archived) matrix for this matter.
  // ============================================================
  generate: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const matter = await getMatterById(input.matterId, userId);
      if (!matter) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }
      // Enforce at-most-one-active-matrix-per-matter (R10 application-level check)
      const existing = await getActiveInformationRequestForMatter(input.matterId, userId);
      if (existing) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'ACTIVE_MATRIX_EXISTS: archive the current matrix before generating a new one',
        });
      }
      void emitTelemetry(
        'matrix_generation_started',
        { matterId: input.matterId },
        { userId, matterId: input.matterId, documentId: null, jobId: null },
      );
      let closureMatrixId = '';
      const result = await executeCanonicalMutation({
        userId,
        jobType: 'information_request_generation',
        modelString: PRIMARY_DRAFTER_MODEL,
        matterId: input.matterId,
        txn1Enqueue: async (jobId) => {
          closureMatrixId = await insertInformationRequest({
            userId,
            matterId: input.matterId,
            status: 'draft',
          });
          return { jobId };
        },
        buildLlmParams: (_jobId) => ({
          systemPrompt: [
            'You are a legal assistant helping to identify information needed for a legal matter.',
            'Generate a structured list of questions to gather the necessary information.',
            'Return a JSON array of objects with fields: category (string), questionText (string).',
            'Group related questions under the same category.',
          ].join('\n'),
          userPrompt: `Generate an information request matrix for a ${matter.practiceArea ?? 'legal'} matter: "${matter.title}".`,
          temperature: 0.2,
          maxTokens: 4096,
        }),
        txn2Commit: async ({ jobId, output }) => {
          const matrixId = closureMatrixId;
          // Parse LLM output and insert items
          let items: Array<{ category: string; questionText: string }> = [];
          try {
            const parsed = typeof output === 'string' ? JSON.parse(output) : output;
            if (Array.isArray(parsed)) {
              items = parsed.filter(
                (item): item is { category: string; questionText: string } =>
                  typeof item === 'object' &&
                  item !== null &&
                  typeof item.category === 'string' &&
                  typeof item.questionText === 'string',
              );
            }
          } catch {
            // If parsing fails, leave matrix empty — attorney can add questions manually
          }
          for (let i = 0; i < items.length; i++) {
            await insertInformationRequestItem({
              informationRequestId: matrixId,
              category: items[i]!.category,
              questionText: items[i]!.questionText,
              orderIndex: i,
            });
          }
          void emitTelemetry(
            'job_queued',
            { jobType: 'information_request_generation', promptVersion: '1.0.0' },
            { userId, matterId: input.matterId, documentId: null, jobId },
          );
        },
        txn2Revert: async ({ jobId, errorClass, errorMessage }) => {
          void emitTelemetry(
            'job_failed',
            { jobType: 'information_request_generation', errorClass: errorClass ?? 'other', errorMessage: errorMessage ?? '' },
            { userId, matterId: input.matterId, documentId: null, jobId },
          );
        },
        telemetryCtx: { userId, matterId: input.matterId, documentId: null, jobId: null },
      });
      return { jobId: result.jobId, status: result.status };
    }),

  // ============================================================
  // informationRequest.archive — Ch 21.7.2
  // Archive the active matrix for a matter.
  // ============================================================
  archive: protectedProcedure
    .input(z.object({ matrixId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const matrix = await getInformationRequestById(input.matrixId, userId);
      if (!matrix) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matrix not found' });
      }
      if (matrix.archivedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'ALREADY_ARCHIVED: matrix is already archived',
        });
      }
      await archiveInformationRequest(input.matrixId, userId);
      void emitTelemetry(
        'matrix_archived',
        { matrixId: input.matrixId },
        { userId, matterId: matrix.matterId, documentId: null, jobId: null },
      );
      return { success: true };
    }),

  // ============================================================
  // informationRequest.editQuestion — Ch 21.7.3
  // Edit item text, category, or order.
  // ============================================================
  editQuestion: protectedProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        category: z.string().min(1).max(64).optional(),
        questionText: z.string().min(1).optional(),
        orderIndex: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const item = await getInformationRequestItemById(input.itemId, userId);
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
      }
      // Verify the parent matrix is not archived
      const matrix = await getInformationRequestById(item.informationRequestId, userId);
      if (!matrix) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matrix not found' });
      }
      if (matrix.archivedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MATRIX_ARCHIVED: cannot edit items on an archived matrix',
        });
      }
      const updates: Partial<{ category: string; questionText: string; orderIndex: number }> = {};
      if (input.category !== undefined) updates.category = input.category;
      if (input.questionText !== undefined) updates.questionText = input.questionText;
      if (input.orderIndex !== undefined) updates.orderIndex = input.orderIndex;
      await updateInformationRequestItem(input.itemId, updates);
      void emitTelemetry(
        'matrix_item_edited',
        {
          matrixId: item.informationRequestId,
          itemId: input.itemId,
          fields: updates as Record<string, unknown>,
        },
        { userId, matterId: matrix.matterId, documentId: null, jobId: null },
      );
      return { success: true };
    }),

  // ============================================================
  // informationRequest.addQuestion — Ch 21.7.4
  // Add a new item to the active matrix.
  // ============================================================
  addQuestion: protectedProcedure
    .input(
      z.object({
        matrixId: z.string().uuid(),
        category: z.string().min(1).max(64),
        questionText: z.string().min(1),
        orderIndex: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const matrix = await getInformationRequestById(input.matrixId, userId);
      if (!matrix) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matrix not found' });
      }
      if (matrix.archivedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MATRIX_ARCHIVED: cannot add items to an archived matrix',
        });
      }
      const itemId = await insertInformationRequestItem({
        informationRequestId: input.matrixId,
        category: input.category,
        questionText: input.questionText,
        orderIndex: input.orderIndex,
      });
      void emitTelemetry(
        'matrix_item_added',
        { matrixId: input.matrixId, category: input.category },
        { userId, matterId: matrix.matterId, documentId: null, jobId: null },
      );
      return { itemId };
    }),

  // ============================================================
  // informationRequest.deleteQuestion — Ch 21.7.5
  // Delete an item from the active matrix.
  // ============================================================
  deleteQuestion: protectedProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const item = await getInformationRequestItemById(input.itemId, userId);
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
      }
      const matrix = await getInformationRequestById(item.informationRequestId, userId);
      if (!matrix) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matrix not found' });
      }
      if (matrix.archivedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MATRIX_ARCHIVED: cannot delete items from an archived matrix',
        });
      }
      await deleteInformationRequestItem(input.itemId);
      void emitTelemetry(
        'matrix_item_deleted',
        { matrixId: item.informationRequestId, itemId: input.itemId },
        { userId, matterId: matrix.matterId, documentId: null, jobId: null },
      );
      return { success: true };
    }),

  // ============================================================
  // informationRequest.exportText — Ch 21.7.6
  // Export as plain text (format='text') or docx placeholder (format='docx').
  // NOTE: No .docx export pipeline in Phase 4b (Phase 6 scope).
  //       format='docx' returns the same plain-text representation with a
  //       note that full .docx export is Phase 6.
  // ============================================================
  exportText: protectedProcedure
    .input(
      z.object({
        matrixId: z.string().uuid(),
        format: z.enum(['docx', 'text']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const matrix = await getInformationRequestById(input.matrixId, userId);
      if (!matrix) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matrix not found' });
      }
      const items = await listItemsForInformationRequest(input.matrixId, userId);
      // Group items by category
      const byCategory = new Map<string, typeof items>();
      for (const item of items) {
        const existing = byCategory.get(item.category) ?? [];
        existing.push(item);
        byCategory.set(item.category, existing);
      }
      // Build plain-text export
      const lines: string[] = [`Information Request Matrix`, `${'='.repeat(40)}`, ''];
      for (const [category, catItems] of byCategory) {
        lines.push(`## ${category}`, '');
        for (const item of catItems) {
          lines.push(`Q: ${item.questionText}`);
          if (item.answerText) {
            lines.push(`A: ${item.answerText}`);
          }
          lines.push('');
        }
      }
      void emitTelemetry(
        'matrix_exported',
        { matrixId: input.matrixId, format: input.format },
        { userId, matterId: matrix.matterId, documentId: null, jobId: null },
      );
      return {
        text: lines.join('\n'),
        format: input.format,
        note: input.format === 'docx' ? 'Full .docx export available in Phase 6.' : undefined,
      };
    }),

  // ============================================================
  // informationRequest.attachAnswer — Ch 21.7.7
  // Attach answer text to an item.
  // ============================================================
  attachAnswer: protectedProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        answerText: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const item = await getInformationRequestItemById(input.itemId, userId);
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
      }
      const matrix = await getInformationRequestById(item.informationRequestId, userId);
      if (!matrix) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matrix not found' });
      }
      if (matrix.archivedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MATRIX_ARCHIVED: cannot attach answers to an archived matrix',
        });
      }
      await updateInformationRequestItem(input.itemId, { answerText: input.answerText });
      void emitTelemetry(
        'matrix_answer_attached',
        {
          matrixId: item.informationRequestId,
          itemId: input.itemId,
        },
        { userId, matterId: matrix.matterId, documentId: null, jobId: null },
      );
      return { success: true };
    }),

  // ============================================================
  // informationRequest.markComplete — Ch 21.7.8
  // Explicitly mark matrix as complete.
  // ============================================================
  markComplete: protectedProcedure
    .input(z.object({ matrixId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const matrix = await getInformationRequestById(input.matrixId, userId);
      if (!matrix) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matrix not found' });
      }
      if (matrix.archivedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MATRIX_ARCHIVED: cannot mark an archived matrix complete',
        });
      }
      if (matrix.status === 'complete') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'ALREADY_COMPLETE: matrix is already marked complete',
        });
      }
      await updateInformationRequestStatus(input.matrixId, userId, 'complete');
      const items = await listItemsForInformationRequest(input.matrixId, userId);
      const unansweredItemCount = items.filter((i) => !i.answerText).length;
      void emitTelemetry(
        'matrix_marked_complete',
        { matrixId: input.matrixId, unansweredItemCount },
        { userId, matterId: matrix.matterId, documentId: null, jobId: null },
      );
      return { success: true };
    }),

  // ============================================================
  // informationRequest.list — Ch 21.7.9
  // List matrices for a matter (most recent first).
  // ============================================================
  list: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const matter = await getMatterById(input.matterId, userId);
      if (!matter) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }
      const matrices = await listInformationRequestsForMatter(input.matterId, userId);
      return { matrices };
    }),

  // ============================================================
  // informationRequest.get — Ch 21.7.10
  // Fetch matrix with all items.
  // ============================================================
  get: protectedProcedure
    .input(z.object({ matrixId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const matrix = await getInformationRequestById(input.matrixId, userId);
      if (!matrix) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matrix not found' });
      }
      const items = await listItemsForInformationRequest(input.matrixId, userId);
      return { matrix, items };
    }),
});
