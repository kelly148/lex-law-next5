/**
 * Matter tRPC procedures — Ch 21.2 (Phase 3)
 *
 * Procedures:
 *   matter.create         — create a new matter (Ch 21.2.1)
 *   matter.get            — get a matter by ID (Ch 21.2.2)
 *   matter.list           — list matters for the current user (Ch 21.2.3)
 *   matter.updateMetadata — update title, clientName, practiceArea (Ch 21.2.4)
 *   matter.archive        — archive a matter (Ch 21.2.5)
 *   matter.unarchive      — unarchive a matter (Ch 21.2.6)
 *   matter.delete         — hard delete a matter (Ch 21.2.7)
 *
 * Phase auto-transition (Ch 5.3) is handled by document procedures.
 * userId is always drawn from ctx.userId (Ch 35.2) — never from input.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import {
  getMatterById,
  listMatters,
  insertMatter,
  updateMatterMetadata,
  archiveMatter,
  unarchiveMatter,
  deleteMatter,
} from '../db/queries/matters.js';
import { listDocumentsForMatter } from '../db/queries/documents.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';

export const matterRouter = router({
  // ============================================================
  // matter.create
  // ============================================================
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(256),
        clientName: z.string().max(256).nullable().optional(),
        practiceArea: z.string().max(128).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const matter = await insertMatter({
        userId: ctx.userId,
        title: input.title,
        clientName: input.clientName ?? null,
        practiceArea: input.practiceArea ?? null,
        phase: 'intake',
        archivedAt: null,
        completedAt: null,
      });

      const payload: { title: string; clientName?: string; practiceArea?: string } = {
        title: matter.title,
      };
      if (matter.clientName != null) payload.clientName = matter.clientName;
      if (matter.practiceArea != null) payload.practiceArea = matter.practiceArea;

      void emitTelemetry(
        'matter_created',
        payload,
        { userId: ctx.userId, matterId: matter.id, documentId: null, jobId: null },
      );

      return matter;
    }),

  // ============================================================
  // matter.get
  // ============================================================
  get: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const matter = await getMatterById(input.matterId, ctx.userId);
      if (!matter) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }
      return matter;
    }),

  // ============================================================
  // matter.list
  // ============================================================
  list: protectedProcedure
    .input(
      z
        .object({
          includeArchived: z.boolean().optional(),
          phase: z.enum(['intake', 'drafting', 'complete']).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const opts: { includeArchived?: boolean; phase?: 'intake' | 'drafting' | 'complete' } = {};
      if (input?.includeArchived !== undefined) opts.includeArchived = input.includeArchived;
      if (input?.phase !== undefined) opts.phase = input.phase;
      return listMatters(ctx.userId, opts);
    }),

  // ============================================================
  // matter.updateMetadata
  // ============================================================
  updateMetadata: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        title: z.string().min(1).max(256).optional(),
        clientName: z.string().max(256).nullable().optional(),
        practiceArea: z.string().max(128).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getMatterById(input.matterId, ctx.userId);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }
      if (existing.archivedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MATTER_ARCHIVED',
        });
      }

      const updates: { title?: string; clientName?: string | null; practiceArea?: string | null } = {};
      if (input.title !== undefined) updates.title = input.title;
      if (input.clientName !== undefined) updates.clientName = input.clientName;
      if (input.practiceArea !== undefined) updates.practiceArea = input.practiceArea;

      const updated = await updateMatterMetadata(
        input.matterId,
        ctx.userId,
        updates,
      );
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }

      const changedFields: Record<string, { old: unknown; new: unknown }> = {};
      if (input.title !== undefined) changedFields.title = { old: existing.title, new: input.title };
      if (input.clientName !== undefined) changedFields.clientName = { old: existing.clientName, new: input.clientName };
      if (input.practiceArea !== undefined) changedFields.practiceArea = { old: existing.practiceArea, new: input.practiceArea };

      void emitTelemetry(
        'matter_metadata_updated',
        { fields: changedFields },
        { userId: ctx.userId, matterId: input.matterId, documentId: null, jobId: null },
      );

      return updated;
    }),

  // ============================================================
  // matter.archive
  // ============================================================
  archive: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getMatterById(input.matterId, ctx.userId);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }
      if (existing.archivedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'ALREADY_ARCHIVED',
        });
      }

      const updated = await archiveMatter(input.matterId, ctx.userId);
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }

      void emitTelemetry(
        'matter_archived',
        {},
        { userId: ctx.userId, matterId: input.matterId, documentId: null, jobId: null },
      );

      return updated;
    }),

  // ============================================================
  // matter.unarchive
  // ============================================================
  unarchive: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getMatterById(input.matterId, ctx.userId);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }
      if (existing.archivedAt === null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NOT_ARCHIVED',
        });
      }

      const updated = await unarchiveMatter(input.matterId, ctx.userId);
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }

      void emitTelemetry(
        'matter_unarchived',
        {},
        { userId: ctx.userId, matterId: input.matterId, documentId: null, jobId: null },
      );

      return updated;
    }),

  // ============================================================
  // matter.delete
  // ============================================================
  delete: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getMatterById(input.matterId, ctx.userId);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }

      // Prevent deletion of matters with active documents (Ch 21.2.7)
      const docs = await listDocumentsForMatter(input.matterId, ctx.userId, {
        includeArchived: false,
      });
      if (docs.length > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MATTER_HAS_ACTIVE_DOCUMENTS',
        });
      }

      await deleteMatter(input.matterId, ctx.userId);

      // NOTE: 'matter_deleted' is not in the telemetry catalog (Ch 25 / Appendix E).
      // No telemetry emitted for matter deletion per R1 (spec is absolute).
      // A spec revision adding 'matter_deleted' to Appendix E would be required
      // before this procedure can emit an event.

      return { deleted: true };
    }),
});
