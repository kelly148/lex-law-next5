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
  setMatterOrchestrationLanes,
  setMatterEngagementCapacity,
  archiveMatter,
  unarchiveMatter,
  deleteMatter,
} from '../db/queries/matters.js';
import { listDocumentsForMatter } from '../db/queries/documents.js';
import { ensureAutoClientParty } from '../db/queries/matterParties.js';
import { purgeMatter } from '../db/queries/matterPurge.js';
import { recordAuditEvent, listAuditEventsForMatter } from '../db/queries/auditEvents.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';
import {
  MatterOrchestrationLanesSchema,
  MatterEngagementCapacitySchema,
} from '../../shared/schemas/matters.js';

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
        // R2-PRE-JURIS-1: governing jurisdiction ('VA'|'MD'); free string (UI constrains), optional.
        jurisdiction: z.string().max(16).nullable().optional(),
        // INSTR-2B-title: the firm capacity election. Optional + defaults to 'law_firm' (the safe
        // default); only an affirmative 'title_settlement_agent' routes drafting to the Title master.
        engagementCapacity: MatterEngagementCapacitySchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const matter = await insertMatter({
        userId: ctx.userId,
        title: input.title,
        clientName: input.clientName ?? null,
        practiceArea: input.practiceArea ?? null,
        jurisdiction: input.jurisdiction ?? null,
        engagementCapacity: input.engagementCapacity ?? 'law_firm',
        phase: 'intake',
        archivedAt: null,
        completedAt: null,
      });

      // R2-PRE-CONFLICT-1 Inc 2: auto-create the (unconfirmed) client party so the client is
      // screened from creation. It cannot satisfy clearance until the attorney confirms it (Inc 3).
      await ensureAutoClientParty(matter.id, ctx.userId, matter.clientName);

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
        // R2-PRE-JURIS-1: governing jurisdiction ('VA'|'MD'); free string (UI constrains), optional.
        jurisdiction: z.string().max(16).nullable().optional(),
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

      const updates: { title?: string; clientName?: string | null; practiceArea?: string | null; jurisdiction?: string | null } = {};
      if (input.title !== undefined) updates.title = input.title;
      if (input.clientName !== undefined) updates.clientName = input.clientName;
      if (input.practiceArea !== undefined) updates.practiceArea = input.practiceArea;
      if (input.jurisdiction !== undefined) updates.jurisdiction = input.jurisdiction;

      const updated = await updateMatterMetadata(
        input.matterId,
        ctx.userId,
        updates,
      );
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }

      // R2-PRE-CONFLICT-1 Inc 2: if clientName was set/changed, ensure a client party exists
      // (idempotent — a no-op when a role='client' party already exists). Auto-created parties are
      // unconfirmed; an existing client party (manual or auto) is never overwritten or re-confirmed.
      if (input.clientName !== undefined) {
        await ensureAutoClientParty(input.matterId, ctx.userId, updated.clientName);
      }

      const changedFields: Record<string, { old: unknown; new: unknown }> = {};
      if (input.title !== undefined) changedFields.title = { old: existing.title, new: input.title };
      if (input.clientName !== undefined) changedFields.clientName = { old: existing.clientName, new: input.clientName };
      if (input.practiceArea !== undefined) changedFields.practiceArea = { old: existing.practiceArea, new: input.practiceArea };
      if (input.jurisdiction !== undefined) changedFields.jurisdiction = { old: existing.jurisdiction, new: input.jurisdiction };

      void emitTelemetry(
        'matter_metadata_updated',
        { fields: changedFields },
        { userId: ctx.userId, matterId: input.matterId, documentId: null, jobId: null },
      );

      return updated;
    }),

  // ============================================================
  // matter.setOrchestrationLanes — FOLD-ORCH-1 Inc2b (Fork C)
  // Set/clear the per-matter reviewer-lane override (explicit attorney act; owner-checked;
  // audited). Pass lanes=null to clear the override (fall back to the global default).
  // ============================================================
  setOrchestrationLanes: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        lanes: MatterOrchestrationLanesSchema.nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getMatterById(input.matterId, ctx.userId);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }

      const updated = await setMatterOrchestrationLanes(input.matterId, ctx.userId, input.lanes);
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }

      await recordAuditEvent({
        userId: ctx.userId,
        matterId: input.matterId,
        eventType: 'disposition',
        actor: 'attorney',
        summary: input.lanes
          ? 'Set per-matter reviewer lanes'
          : 'Cleared per-matter reviewer lanes (using global default)',
        targetType: 'matter',
        targetId: input.matterId,
        action: 'set_orchestration_lanes',
        scope: 'matter',
        payload: { lanes: input.lanes },
      });

      return updated;
    }),

  // ============================================================
  // matter.setEngagementCapacity — INSTR-2B-title: the affirmative capacity election that governs
  // which master prompt drafts use ('title_settlement_agent' -> Title master; 'law_firm' -> the
  // 2B-core safe default). A deliberate, owner-scoped, AUDITED act — it shifts the posture
  // governing every draft on the matter (audited as eventType 'disposition', like the other
  // matter-level attorney decisions). The default stays law_firm; this changes it explicitly.
  // ============================================================
  setEngagementCapacity: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        engagementCapacity: MatterEngagementCapacitySchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getMatterById(input.matterId, ctx.userId);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }

      const updated = await setMatterEngagementCapacity(
        input.matterId,
        ctx.userId,
        input.engagementCapacity,
      );
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      }

      const previous = existing.engagementCapacity ?? 'law_firm';
      await recordAuditEvent({
        userId: ctx.userId,
        matterId: input.matterId,
        eventType: 'disposition',
        actor: 'attorney',
        summary: `Engagement capacity set to ${input.engagementCapacity} (was ${previous})`,
        targetType: 'engagement_capacity',
        targetId: input.matterId,
        action: 'set_engagement_capacity',
        scope: 'matter',
        payload: { from: previous, to: input.engagementCapacity },
      });

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

  // ============================================================
  // matter.purge — LLN-PROD-CLEANUP-1 (cascading, owner-scoped, operator-gated)
  // ============================================================
  // Completely removes a matter AND all related rows (documents+versions+feedback+sessions,
  // parties, conflict checks/hits, analysis, open items, audit events, etc.) — unlike matter.delete
  // (matters row only), so nothing is orphaned and no phantom conflict parties remain. DESTRUCTIVE +
  // IRREVERSIBLE. Operator-gated discipline: call with dryRun=true FIRST for a per-table row-count
  // preview (writes nothing), then dryRun=false to apply. Owner-scoped; each matter purged atomically.
  purge: protectedProcedure
    .input(z.object({ matterIds: z.array(z.string().uuid()).min(1).max(50), dryRun: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const results = [];
      for (const matterId of input.matterIds) {
        results.push(await purgeMatter(matterId, ctx.userId, { dryRun: input.dryRun }));
      }
      const grandTotal = results.reduce((a, r) => a + r.total, 0);
      return { dryRun: input.dryRun, matterCount: results.length, grandTotal, results };
    }),

  // ============================================================
  // matter.auditLog — R2 #7 Matter Record ledger (READ-ONLY, owner-scoped)
  // ============================================================
  // Re-presents the matter's existing audit_events as a read-only chronological ledger (newest first)
  // for the Matter Record panel. No analytics/editing/charts (keep-list) — a plain ledger. No mutation,
  // no schema/migration; just exposes the existing listAuditEventsForMatter read.
  auditLog: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const matter = await getMatterById(input.matterId, ctx.userId);
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      return listAuditEventsForMatter(input.matterId, ctx.userId);
    }),
});
