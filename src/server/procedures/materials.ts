/**
 * Matter materials tRPC procedures — Ch 21.6 (Phase 3)
 *
 *   materials.list         — list materials for a matter
 *   materials.get          — get a single material
 *   materials.create       — create a material record (text paste path)
 *   materials.updateTags   — update tags on a material
 *   materials.updateDescription — update description
 *   materials.pin          — pin a material
 *   materials.unpin        — unpin a material
 *   materials.softDelete   — soft-delete (sets deletedAt)
 *   materials.restore      — restore a soft-deleted material
 *
 * File upload path (storageKey, fileSize, mimeType) is set by the upload
 * endpoint in Phase 5 — not a tRPC procedure.
 * userId is always drawn from ctx.userId (Ch 35.2).
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import {
  getMaterialById,
  listMaterialsForMatter,
  insertMaterial,
  updateMaterialMetadata,
  setPinnedStatus,
  softDeleteMaterial,
  undeleteMaterial,
} from '../db/queries/materials.js';
import { getMatterById } from '../db/queries/matters.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';

export const materialsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        includeDeleted: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const opts: { includeDeleted?: boolean } = {};
      if (input.includeDeleted !== undefined) opts.includeDeleted = input.includeDeleted;
      return listMaterialsForMatter(input.matterId, ctx.userId, opts);
    }),

  get: protectedProcedure
    .input(z.object({ materialId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const material = await getMaterialById(input.materialId, ctx.userId);
      if (!material) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      }
      return material;
    }),

  create: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        textContent: z.string().min(1),
        filename: z.string().max(512).nullable().optional(),
        description: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const matter = await getMatterById(input.matterId, ctx.userId);
      if (!matter) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }
      if (matter.archivedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MATTER_ARCHIVED',
        });
      }

      const material = await insertMaterial({
        userId: ctx.userId,
        matterId: input.matterId,
        filename: input.filename ?? null,
        mimeType: 'text/plain',
        fileSize: null,
        storageKey: null,
        textContent: input.textContent,
        extractionStatus: 'extracted',
        extractionError: null,
        tags: input.tags ?? [],
        description: input.description ?? null,
        pinned: false,
        uploadSource: 'paste',
        deletedAt: null,
      });

      void emitTelemetry(
        'material_pasted',
        { textContentLength: input.textContent.length },
        { userId: ctx.userId, matterId: input.matterId, documentId: null, jobId: null },
      );

      return material;
    }),

  updateTags: protectedProcedure
    .input(
      z.object({
        materialId: z.string().uuid(),
        tags: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = await getMaterialById(input.materialId, ctx.userId);
      if (!material) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      }
      if (material.deletedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MATERIAL_DELETED',
        });
      }

      const updated = await updateMaterialMetadata(
        input.materialId,
        ctx.userId,
        { tags: input.tags },
      );
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      }

      void emitTelemetry(
        'material_metadata_updated',
        { fields: { tags: { old: material.tags, new: input.tags } } },
        { userId: ctx.userId, matterId: material.matterId, documentId: null, jobId: null },
      );

      return updated;
    }),

  updateDescription: protectedProcedure
    .input(
      z.object({
        materialId: z.string().uuid(),
        description: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const material = await getMaterialById(input.materialId, ctx.userId);
      if (!material) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      }
      if (material.deletedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MATERIAL_DELETED',
        });
      }

      const updated = await updateMaterialMetadata(
        input.materialId,
        ctx.userId,
        { description: input.description },
      );
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      }

      return updated;
    }),

  pin: protectedProcedure
    .input(z.object({ materialId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const material = await getMaterialById(input.materialId, ctx.userId);
      if (!material) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      }
      if (material.deletedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MATERIAL_DELETED',
        });
      }
      if (material.pinned) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'ALREADY_PINNED',
        });
      }

      const updated = await setPinnedStatus(input.materialId, ctx.userId, true);
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      }

      void emitTelemetry(
        'material_pinned',
        {},
        { userId: ctx.userId, matterId: material.matterId, documentId: null, jobId: null },
      );

      return updated;
    }),

  unpin: protectedProcedure
    .input(z.object({ materialId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const material = await getMaterialById(input.materialId, ctx.userId);
      if (!material) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      }
      if (!material.pinned) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NOT_PINNED',
        });
      }

      const updated = await setPinnedStatus(input.materialId, ctx.userId, false);
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      }

      void emitTelemetry(
        'material_unpinned',
        {},
        { userId: ctx.userId, matterId: material.matterId, documentId: null, jobId: null },
      );

      return updated;
    }),

  softDelete: protectedProcedure
    .input(z.object({ materialId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const material = await getMaterialById(input.materialId, ctx.userId);
      if (!material) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      }
      if (material.deletedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'ALREADY_DELETED',
        });
      }

      const updated = await softDeleteMaterial(input.materialId, ctx.userId);
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      }

      void emitTelemetry(
        'material_deleted',
        { wasPinned: material.pinned },
        { userId: ctx.userId, matterId: material.matterId, documentId: null, jobId: null },
      );

      return updated;
    }),

  restore: protectedProcedure
    .input(z.object({ materialId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const material = await getMaterialById(input.materialId, ctx.userId);
      if (!material) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      }
      if (material.deletedAt === null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NOT_DELETED',
        });
      }

      const updated = await undeleteMaterial(input.materialId, ctx.userId);
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      }

      void emitTelemetry(
        'material_undeleted',
        {},
        { userId: ctx.userId, matterId: material.matterId, documentId: null, jobId: null },
      );

      return updated;
    }),
});
