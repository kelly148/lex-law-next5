/**
 * Provision-provenance tRPC procedures — FOLD-DRAFT-1 (Increment 2: capture surface + read API).
 *
 * Records + reads where each draft section (provision) came from. The capture is an explicit
 * ATTORNEY act (recordedBy='attorney'), owner-checked + audited; the origin pairing is validated
 * (source-referencing types require an originId). DEFAULT-SAFE: this never injects into prompts,
 * never auto-justifies outbound assertions — it records + surfaces only (the UI is Inc3).
 *
 * userId is always ctx.userId (Ch 35.2); ownership flows through the owner-scoped query wrappers.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getDocumentById } from '../db/queries/documents.js';
import {
  insertProvisionProvenance,
  listProvisionProvenanceForVersion,
  listProvisionProvenanceForDocument,
} from '../db/queries/provisionProvenance.js';
import { recordAuditEvent } from '../db/queries/auditEvents.js';
import { validateProvenanceOrigin } from '../draft/provenanceRules.js';

const ORIGIN_TYPE_ENUM = z.enum([
  'operative_source',
  'material',
  'adopted_suggestion',
  'template',
  'attorney_authored',
  'model_generated',
  'loi',
]);

export const provisionProvenanceRouter = router({
  // ============================================================
  // provisionProvenance.listForVersion / listForDocument — READ (owner-scoped)
  // ============================================================
  listForVersion: protectedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .query(({ ctx, input }) => listProvisionProvenanceForVersion(input.versionId, ctx.userId)),

  listForDocument: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(({ ctx, input }) => listProvisionProvenanceForDocument(input.documentId, ctx.userId)),

  // ============================================================
  // provisionProvenance.record — capture (explicit attorney act; owner-checked; audited)
  // ============================================================
  record: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        versionId: z.string().uuid(),
        orderIndex: z.number().int().nonnegative(),
        sectionTitle: z.string().min(1).max(256),
        originType: ORIGIN_TYPE_ENUM,
        originId: z.string().max(64).nullable().optional(),
        originLabel: z.string().max(512).nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await getDocumentById(input.documentId, ctx.userId);
      if (!doc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }

      const originId = input.originId ?? null;
      const valid = validateProvenanceOrigin(input.originType, originId);
      if (!valid.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: valid.reason ?? 'Invalid provenance origin' });
      }

      const row = await insertProvisionProvenance({
        userId: ctx.userId,
        matterId: doc.matterId,
        documentId: input.documentId,
        versionId: input.versionId,
        orderIndex: input.orderIndex,
        sectionTitle: input.sectionTitle,
        originType: input.originType,
        originId,
        originLabel: input.originLabel ?? null,
        recordedBy: 'attorney',
        notes: input.notes ?? null,
      });

      await recordAuditEvent({
        userId: ctx.userId,
        matterId: doc.matterId,
        documentId: input.documentId,
        eventType: 'disposition',
        actor: 'attorney',
        summary: `Recorded provision provenance for "${input.sectionTitle}" (${input.originType})`,
        targetType: 'provision_provenance',
        targetId: row.id,
        action: 'record_provision_provenance',
        scope: 'document',
        payload: { originType: input.originType, originId, versionId: input.versionId },
      });

      return row;
    }),
});
