/**
 * Context pipeline tRPC procedures — Ch 21.11 (Phase 3)
 *
 *   contextPipeline.preview — preview what context would be assembled for an
 *                             operation, without enqueuing a job
 *
 * This is the only client-callable surface of the context pipeline.
 * The assembleContext() function is internal and called by operation-enqueuing
 * procedures (Phase 4a+).
 *
 * PINNED_OVERFLOW (Ch 20.2 / Ch 21.11):
 *   If pinned materials alone exceed the budget, the preview returns a
 *   PINNED_OVERFLOW error so the attorney can unpin materials before drafting.
 *
 * userId is always drawn from ctx.userId (Ch 35.2).
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { assembleContext, type OperationType } from '../context/pipeline.js';
import { getMatterById } from '../db/queries/matters.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';

export const contextPipelineRouter = router({
  preview: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        documentId: z.string().uuid().optional(),
        operation: z
          .enum([
            'draft_generation',
            'regeneration',
            'data_extraction',
            'review',
            'formatting',
            'information_request_generation',
            'outline_generation',
            'context_preview',
          ])
          .default('context_preview'),
        explicitSiblingIds: z.array(z.string().uuid()).optional(),
        explicitExcludeMaterialIds: z.array(z.string().uuid()).optional(),
        budgetOverride: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const matter = await getMatterById(input.matterId, ctx.userId);
      if (!matter) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }

      // Build params — omit optional fields when undefined (exactOptionalPropertyTypes)
      const assembleParams: Parameters<typeof assembleContext>[0] = {
        operation: input.operation as OperationType,
        matterId: input.matterId,
        userId: ctx.userId,
      };
      if (input.documentId !== undefined) assembleParams.documentId = input.documentId;
      if (input.explicitSiblingIds !== undefined) assembleParams.explicitSiblingIds = input.explicitSiblingIds;
      if (input.explicitExcludeMaterialIds !== undefined) assembleParams.explicitExcludeMaterialIds = input.explicitExcludeMaterialIds;
      if (input.budgetOverride !== undefined) assembleParams.budgetOverride = input.budgetOverride;

      try {
        const result = await assembleContext(assembleParams);
        const ctxDoc = input.documentId ?? null;
        void emitTelemetry(
          'materials_included_in_operation',
          {
            operation: input.operation,
            includedMaterialIds: result.includedMaterials.map((m) => m.materialId),
            pinnedCount: result.includedMaterials.filter((m) => m.pinned).length,
            tokensTotal: result.assembledTokens,
            excludedMaterialIds: result.excluded.map((e) => e.id),
            truncatedMaterialIds: result.truncated.map((t) => t.id),
          },
          { userId: ctx.userId, matterId: input.matterId, documentId: ctxDoc, jobId: null },
        );
        return result;
      } catch (err) {
        if (
          err instanceof TRPCError &&
          err.message === 'PINNED_OVERFLOW'
        ) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'PINNED_OVERFLOW',
          });
        }
        throw err;
      }
    }),
});
