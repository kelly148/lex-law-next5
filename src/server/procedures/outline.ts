/**
 * outline tRPC procedures — Phase 4b (Ch 21.8)
 *
 * Procedures:
 *   outline.generate       — enqueue outline generation job (Ch 21.8.1)
 *   outline.regenerate     — replace existing outline with fresh LLM content (Ch 21.8.2)
 *   outline.edit           — edit sections (titles, descriptions, order) (Ch 21.8.3)
 *   outline.reopenForEdit  — transition approved outline back to draft (Ch 21.8.4)
 *   outline.approve        — transition outline to approved (Ch 21.8.5)
 *   outline.skip           — explicitly skip the outline step (Ch 21.8.6)
 *   outline.get            — fetch current outline for a document (Ch 21.8.7)
 *
 * All procedures require authentication (protectedProcedure).
 * userId is always drawn from ctx.userId — never from input.
 *
 * R4: All LLM-producing procedures (generate, regenerate) use executeCanonicalMutation.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import {
  getOutlineForDocument,
  getOutlineById,
  insertDocumentOutline,
  updateDocumentOutline,
} from '../db/queries/phase4b.js';
import { getDocumentById } from '../db/queries/documents.js';
import { getMatterById } from '../db/queries/matters.js';
import { assembleContext } from '../context/pipeline.js';
import { executeCanonicalMutation } from '../db/canonicalMutation.js';
import { PRIMARY_DRAFTER_MODEL } from '../llm/config.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';
import { OutlineSectionSchema } from '../../shared/schemas/phase4b.js';

export const outlineRouter = router({
  // ============================================================
  // outline.generate — Ch 21.8.1
  // Enqueue outline generation job for a document.
  // Preconditions: document exists; no existing non-skipped outline.
  // ============================================================
  generate: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }
      const matter = await getMatterById(doc.matterId, userId);
      if (!matter) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }
      // Enforce at-most-one-outline-per-document (application-level)
      const existing = await getOutlineForDocument(input.documentId, userId);
      if (existing && existing.status !== 'skipped') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'OUTLINE_EXISTS: use outline.regenerate to replace the existing outline',
        });
      }
      // Assemble context for outline generation
      const assembledCtx = await assembleContext({
        operation: 'draft_generation',
        matterId: doc.matterId,
        userId,
        documentId: input.documentId,
      });
      const materialsText = assembledCtx.includedMaterials
        .map((m) => `[Material: ${m.filename ?? 'Untitled'}]\n${m.textContent}`)
        .join('\n\n---\n\n');
      void emitTelemetry(
        'outline_generation_started',
        { documentId: input.documentId },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );
      let closureOutlineId = '';
      const result = await executeCanonicalMutation({
        userId,
        jobType: 'outline_generation',
        modelString: PRIMARY_DRAFTER_MODEL,
        matterId: doc.matterId,
        documentId: input.documentId,
        txn1Enqueue: async (jobId) => {
          closureOutlineId = await insertDocumentOutline({
            userId,
            documentId: input.documentId,
            generatedByJobId: jobId,
          });
          return { jobId };
        },
        buildLlmParams: (_jobId) => ({
          systemPrompt: [
            'You are an expert legal document drafter.',
            'Generate a structured outline for the document described below.',
            'Return a JSON array of sections, each with: title (string), description (string), orderIndex (number starting from 0).',
            'Be specific and legally precise.',
          ].join('\n'),
          userPrompt: [
            `Document type: ${doc.documentType}`,
            `Document title: ${doc.title}`,
            `Matter: ${matter.title}`,
            materialsText ? `\n## Matter Materials\n${materialsText}` : '',
          ].filter(Boolean).join('\n'),
          temperature: 0.2,
          maxTokens: 4096,
        }),
        txn2Commit: async ({ jobId, output }) => {
          const outlineId = closureOutlineId;
          let sections: Array<{ title: string; description: string; orderIndex: number }> = [];
          try {
            const parsed = typeof output === 'string' ? JSON.parse(output) : output;
            if (Array.isArray(parsed)) {
              sections = parsed
                .map((s, i) => OutlineSectionSchema.safeParse({ ...s, orderIndex: i }))
                .filter((r) => r.success)
                .map((r) => r.data!);
            }
          } catch {
            // Leave sections empty — attorney can edit manually
          }
          await updateDocumentOutline(outlineId, userId, { sections });
          void emitTelemetry(
            'job_queued',
            { jobType: 'outline_generation', promptVersion: '1.0.0' },
            { userId, matterId: doc.matterId, documentId: input.documentId, jobId },
          );
        },
        txn2Revert: async ({ jobId, errorClass, errorMessage }) => {
          void emitTelemetry(
            'job_failed',
            { jobType: 'outline_generation', errorClass: errorClass ?? 'other', errorMessage: errorMessage ?? '' },
            { userId, matterId: doc.matterId, documentId: input.documentId, jobId },
          );
        },
        telemetryCtx: { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      });
      return { jobId: result.jobId, status: result.status };
    }),

  // ============================================================
  // outline.regenerate — Ch 21.8.2
  // Replace existing outline with fresh LLM content.
  // Preconditions: outline exists; status is 'draft' (not approved).
  // ============================================================
  regenerate: protectedProcedure
    .input(z.object({ outlineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const outline = await getOutlineById(input.outlineId, userId);
      if (!outline) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Outline not found' });
      }
      if (outline.status === 'approved') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'OUTLINE_APPROVED: use outline.reopenForEdit before regenerating',
        });
      }
      const doc = await getDocumentById(outline.documentId, userId);
      if (!doc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }
      const matter = await getMatterById(doc.matterId, userId);
      if (!matter) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }
      const assembledCtx = await assembleContext({
        operation: 'draft_generation',
        matterId: doc.matterId,
        userId,
        documentId: outline.documentId,
      });
      const materialsText = assembledCtx.includedMaterials
        .map((m) => `[Material: ${m.filename ?? 'Untitled'}]\n${m.textContent}`)
        .join('\n\n---\n\n');
      void emitTelemetry(
        'outline_regeneration_started',
        { outlineId: input.outlineId, priorStatus: outline.status },
        { userId, matterId: doc.matterId, documentId: outline.documentId, jobId: null },
      );
      const result = await executeCanonicalMutation({
        userId,
        jobType: 'outline_generation',
        modelString: PRIMARY_DRAFTER_MODEL,
        matterId: doc.matterId,
        documentId: outline.documentId,
        txn1Enqueue: async (jobId) => {
          return { jobId, outlineId: input.outlineId };
        },
        buildLlmParams: (_jobId) => ({
          systemPrompt: [
            'You are an expert legal document drafter.',
            'Regenerate a structured outline for the document described below.',
            'Return a JSON array of sections, each with: title (string), description (string), orderIndex (number starting from 0).',
          ].join('\n'),
          userPrompt: [
            `Document type: ${doc.documentType}`,
            `Document title: ${doc.title}`,
            `Matter: ${matter.title}`,
            materialsText ? `\n## Matter Materials\n${materialsText}` : '',
          ].filter(Boolean).join('\n'),
          temperature: 0.2,
          maxTokens: 4096,
        }),
        txn2Commit: async ({ jobId, output }) => {
          let sections: Array<{ title: string; description: string; orderIndex: number }> = [];
          try {
            const parsed = typeof output === 'string' ? JSON.parse(output) : output;
            if (Array.isArray(parsed)) {
              sections = parsed
                .map((s, i) => OutlineSectionSchema.safeParse({ ...s, orderIndex: i }))
                .filter((r) => r.success)
                .map((r) => r.data!);
            }
          } catch {
            // Leave sections empty
          }
          await updateDocumentOutline(input.outlineId, userId, { sections, status: 'draft' });
          void emitTelemetry(
            'job_queued',
            { jobType: 'outline_generation', promptVersion: '1.0.0' },
            { userId, matterId: doc.matterId, documentId: outline.documentId, jobId },
          );
        },
        txn2Revert: async ({ jobId, errorClass, errorMessage }) => {
          void emitTelemetry(
            'job_failed',
            { jobType: 'outline_generation', errorClass: errorClass ?? 'other', errorMessage: errorMessage ?? '' },
            { userId, matterId: doc.matterId, documentId: outline.documentId, jobId },
          );
        },
        telemetryCtx: { userId, matterId: doc.matterId, documentId: outline.documentId, jobId: null },
      });
      return { jobId: result.jobId, status: result.status };
    }),

  // ============================================================
  // outline.edit — Ch 21.8.3
  // Edit sections (titles, descriptions, order).
  // Preconditions: outline exists; status is 'draft'.
  // ============================================================
  edit: protectedProcedure
    .input(
      z.object({
        outlineId: z.string().uuid(),
        sections: z.array(
          z.object({
            title: z.string().min(1),
            description: z.string(),
            orderIndex: z.number().int().nonnegative(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const outline = await getOutlineById(input.outlineId, userId);
      if (!outline) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Outline not found' });
      }
      if (outline.status !== 'draft') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `WRONG_STATUS: outline.edit requires status='draft', got '${outline.status}'`,
        });
      }
      await updateDocumentOutline(input.outlineId, userId, { sections: input.sections });
      void emitTelemetry(
        'outline_edited',
        { outlineId: input.outlineId, sectionCount: input.sections.length },
        { userId, matterId: null, documentId: outline.documentId, jobId: null },
      );
      return { success: true };
    }),

  // ============================================================
  // outline.reopenForEdit — Ch 21.8.4
  // Transition approved outline back to draft.
  // ============================================================
  reopenForEdit: protectedProcedure
    .input(z.object({ outlineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const outline = await getOutlineById(input.outlineId, userId);
      if (!outline) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Outline not found' });
      }
      if (outline.status !== 'approved') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `WRONG_STATUS: outline.reopenForEdit requires status='approved', got '${outline.status}'`,
        });
      }
      await updateDocumentOutline(input.outlineId, userId, {
        status: 'draft',
        approvedAt: null,
      });
      void emitTelemetry(
        'outline_reopened',
        { outlineId: input.outlineId },
        { userId, matterId: null, documentId: outline.documentId, jobId: null },
      );
      return { success: true };
    }),

  // ============================================================
  // outline.approve — Ch 21.8.5
  // Transition outline to approved.
  // Preconditions: outline exists; status is 'draft'.
  // ============================================================
  approve: protectedProcedure
    .input(z.object({ outlineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const outline = await getOutlineById(input.outlineId, userId);
      if (!outline) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Outline not found' });
      }
      if (outline.status !== 'draft') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `WRONG_STATUS: outline.approve requires status='draft', got '${outline.status}'`,
        });
      }
      await updateDocumentOutline(input.outlineId, userId, {
        status: 'approved',
        approvedAt: new Date(),
      });
      void emitTelemetry(
        'outline_approved',
        { outlineId: input.outlineId, sectionCount: outline.sections.length },
        { userId, matterId: null, documentId: outline.documentId, jobId: null },
      );
      return { success: true };
    }),

  // ============================================================
  // outline.skip — Ch 21.8.6
  // Explicitly skip the outline step.
  // ============================================================
  skip: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }
      const existing = await getOutlineForDocument(input.documentId, userId);
      if (existing) {
        if (existing.status === 'approved') {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'OUTLINE_APPROVED: cannot skip an already-approved outline',
          });
        }
        // Mark existing as skipped
        await updateDocumentOutline(existing.id, userId, { status: 'skipped' });
      } else {
        // Create a skipped outline record
        const outlineId = await insertDocumentOutline({
          userId,
          documentId: input.documentId,
        });
        await updateDocumentOutline(outlineId, userId, { status: 'skipped' });
      }
      void emitTelemetry(
        'outline_skipped',
        { documentId: input.documentId },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );
      return { success: true };
    }),

  // ============================================================
  // outline.get — Ch 21.8.7
  // Fetch current outline for a document.
  // ============================================================
  get: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }
      const outline = await getOutlineForDocument(input.documentId, userId);
      return { outline };
    }),
});
