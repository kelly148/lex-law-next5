/**
 * Document reference tRPC procedures — Ch 21.13 (Phase 3)
 *
 *   reference.list                  — list references for a source document
 *   reference.listInbound           — list inbound references to a document
 *   reference.add                   — add a reference from source → sibling
 *   reference.remove                — remove a reference
 *   reference.acknowledgeStale      — acknowledge staleness for a source document
 *
 * Staleness detection (Ch 21.13 / decision #4):
 *   A reference is stale when the sibling's currentVersionId has changed since
 *   the reference was created and stalenessAcknowledgedAt is null.
 *   document.finalize (Phase 4a) will gate on unacknowledged stale references.
 *
 * userId is always drawn from ctx.userId (Ch 35.2).
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import {
  getReferenceById,
  listReferencesForDocument,
  listInboundReferences,
  insertReference,
  deleteReference,
  acknowledgeStaleReferences,
} from '../db/queries/references.js';
import { getDocumentById } from '../db/queries/documents.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';

export const referenceRouter = router({
  list: protectedProcedure
    .input(z.object({ sourceDocumentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return listReferencesForDocument(input.sourceDocumentId, ctx.userId);
    }),

  listInbound: protectedProcedure
    .input(z.object({ referencedDocumentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return listInboundReferences(input.referencedDocumentId, ctx.userId);
    }),

  add: protectedProcedure
    .input(
      z.object({
        sourceDocumentId: z.string().uuid(),
        referencedDocumentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.sourceDocumentId === input.referencedDocumentId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'SELF_REFERENCE_NOT_ALLOWED',
        });
      }

      const sourceDoc = await getDocumentById(
        input.sourceDocumentId,
        ctx.userId,
      );
      if (!sourceDoc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Source document not found',
        });
      }

      const referencedDoc = await getDocumentById(
        input.referencedDocumentId,
        ctx.userId,
      );
      if (!referencedDoc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Referenced document not found',
        });
      }
      if (!referencedDoc.currentVersionId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'REFERENCED_DOCUMENT_HAS_NO_VERSION',
        });
      }

      // Check for duplicate reference
      const existing = await listReferencesForDocument(
        input.sourceDocumentId,
        ctx.userId,
      );
      const duplicate = existing.find(
        (r) => r.referencedDocumentId === input.referencedDocumentId,
      );
      if (duplicate) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'REFERENCE_ALREADY_EXISTS',
        });
      }

      const reference = await insertReference({
        userId: ctx.userId,
        sourceDocumentId: input.sourceDocumentId,
        referencedDocumentId: input.referencedDocumentId,
        referencedVersionId: referencedDoc.currentVersionId,
        stalenessAcknowledgedAt: null,
      });

      void emitTelemetry(
        'reference_added',
        {
          sourceDocumentId: input.sourceDocumentId,
          referencedDocumentId: input.referencedDocumentId,
          referencedVersionId: referencedDoc.currentVersionId,
        },
        { userId: ctx.userId, matterId: sourceDoc.matterId, documentId: input.sourceDocumentId, jobId: null },
      );

      return reference;
    }),

  remove: protectedProcedure
    .input(z.object({ referenceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const reference = await getReferenceById(input.referenceId, ctx.userId);
      if (!reference) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Reference not found',
        });
      }

      await deleteReference(input.referenceId, ctx.userId);

      const sourceDoc = await getDocumentById(
        reference.sourceDocumentId,
        ctx.userId,
      );

      void emitTelemetry(
        'reference_removed',
        { referenceId: input.referenceId },
        { userId: ctx.userId, matterId: sourceDoc?.matterId ?? null, documentId: reference.sourceDocumentId, jobId: null },
      );

      return { deleted: true };
    }),

  acknowledgeStale: protectedProcedure
    .input(z.object({ sourceDocumentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sourceDoc = await getDocumentById(
        input.sourceDocumentId,
        ctx.userId,
      );
      if (!sourceDoc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Source document not found',
        });
      }

      // Fetch stale refs before acknowledging so we can include their IDs in telemetry
      const allRefs = await listReferencesForDocument(input.sourceDocumentId, ctx.userId);
      const staleRefIds = allRefs
        .filter((r) => r.stalenessAcknowledgedAt === null)
        .map((r) => r.id);
      await acknowledgeStaleReferences(input.sourceDocumentId, ctx.userId);
      void emitTelemetry(
        'staleness_acknowledged',
        {
          staleReferenceIds: staleRefIds,
          finalizeContext: 'finalize',
        },
        { userId: ctx.userId, matterId: sourceDoc.matterId, documentId: input.sourceDocumentId, jobId: null },
      );
      return { acknowledged: true };
    }),
});
