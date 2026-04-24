/**
 * Document tRPC procedures — Phase 3 scope (Ch 21.3–21.4)
 *
 * Phase 3 includes ONLY non-drafting document procedures:
 *   document.create         — create a new document record (Ch 21.3.1)
 *   document.get            — get a document by ID (Ch 21.3.2)
 *   document.list           — list documents for a matter (Ch 21.3.3)
 *   document.updateTitle    — update document title (Ch 21.3.4)
 *   document.setNotes       — set notes (R12 carve-out — allowed on complete docs)
 *   document.archive        — archive a document (Ch 21.4)
 *   document.unarchive      — unarchive a document (Ch 21.4)
 *   document.unfinalize     — move complete → finalizing (R12 carve-out)
 *
 * PHASE 4a ONLY (not implemented here):
 *   document.generateDraft, document.regenerate, document.finalize,
 *   document.acceptSubstantiveUnformatted, document.extractVariables,
 *   document.populateFromMatter, document.detach, document.requestReview,
 *   document.updateVariableMap
 *
 * R12 COMPLETE_READONLY guard:
 *   All document-mutating procedures (except setNotes and unfinalize) MUST
 *   reject with COMPLETE_READONLY if workflowState === 'complete'.
 *   Phase 3 carries a placeholder comment for the Phase 4a exhaustiveness
 *   assertion (the full set {unfinalize, setNotes} cannot be proven until
 *   finalize/complete-state transitions exist in Phase 4a).
 *
 * userId is always drawn from ctx.userId (Ch 35.2) — never from input.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import {
  getDocumentById,
  listDocumentsForMatter,
  insertDocument,
  updateDocumentWorkflowState,
  updateDocumentNotes,
  updateDocumentTitle,
  archiveDocument,
  unarchiveDocument,
} from '../db/queries/documents.js';
import {
  getMatterById,
  updateMatterPhase,
} from '../db/queries/matters.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';

// ============================================================
// R12 guard helper
// ============================================================

/**
 * Throws COMPLETE_READONLY if the document is in the 'complete' workflow state.
 * Must be called at the top of every document-mutating procedure EXCEPT
 * document.setNotes and document.unfinalize (the two R12 carve-outs).
 *
 * Phase 4a will add the exhaustiveness assertion:
 *   assert(COMPLETE_READONLY_EXEMPT_PROCEDURES === new Set(['document.unfinalize', 'document.setNotes']))
 */
function assertNotComplete(
  workflowState: string,
  procedureName: string,
): void {
  if (workflowState === 'complete') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `COMPLETE_READONLY: procedure '${procedureName}' cannot mutate a complete document`,
    });
  }
}

// ============================================================
// Matter phase auto-transition helper (Ch 5.3)
// ============================================================

/**
 * After any document state change, check if the matter's phase should
 * auto-transition. Called as a side effect (fire-and-forget).
 *
 * Rules (Ch 5.3):
 *   - If any non-archived document is non-complete → matter phase = 'drafting'
 *   - If all non-archived documents are complete → matter phase = 'complete'
 *   - If no non-archived documents exist → matter phase = 'intake'
 */
async function maybeSyncMatterPhase(
  matterId: string,
  userId: string,
): Promise<void> {
  const matter = await getMatterById(matterId, userId);
  if (!matter || matter.archivedAt !== null) return;

  const allDocs = await listDocumentsForMatter(matterId, userId, {
    includeArchived: false,
  });

  if (allDocs.length === 0) {
    if (matter.phase !== 'intake') {
      await updateMatterPhase(matterId, userId, 'intake', null);
      void emitTelemetry(
        'matter_phase_advanced',
        { fromPhase: matter.phase, toPhase: 'intake', trigger: 'any_document_unfinalized' },
        { userId, matterId, documentId: null, jobId: null },
      );
    }
    return;
  }

  const hasNonComplete = allDocs.some((d) => d.workflowState !== 'complete');
  const targetPhase = hasNonComplete ? 'drafting' : 'complete';
  const completedAt =
    targetPhase === 'complete' ? (matter.completedAt ?? new Date()) : null;

  if (matter.phase !== targetPhase) {
    await updateMatterPhase(matterId, userId, targetPhase, completedAt);
    const trigger: 'first_document_created' | 'all_documents_complete' | 'any_document_unfinalized' =
      targetPhase === 'complete' ? 'all_documents_complete' : 'any_document_unfinalized';
    void emitTelemetry(
      'matter_phase_advanced',
      { fromPhase: matter.phase, toPhase: targetPhase, trigger },
      { userId, matterId, documentId: null, jobId: null },
    );
  }
}

// Alias to fix typo in original
const maybySyncMatterPhase = maybeSyncMatterPhase;

// ============================================================
// Router
// ============================================================

export const documentRouter = router({
  // ============================================================
  // document.create
  // ============================================================
  create: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        title: z.string().min(1).max(256),
        documentType: z.string().min(1).max(64),
        customTypeLabel: z.string().max(256).nullable().optional(),
        draftingMode: z.enum(['template', 'iterative']),
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

      const doc = await insertDocument({
        userId: ctx.userId,
        matterId: input.matterId,
        title: input.title,
        documentType: input.documentType,
        customTypeLabel: input.customTypeLabel ?? null,
        draftingMode: input.draftingMode,
        templateBindingStatus: 'bound',
        templateVersionId: null,
        templateSnapshot: null,
        variableMap: null,
        workflowState: 'drafting',
        currentVersionId: null,
        officialSubstantiveVersionNumber: null,
        officialFinalVersionNumber: null,
        completedAt: null,
        archivedAt: null,
        notes: null,
      });

      const docPayload: {
        matterId: string;
        documentType: string;
        draftingMode: 'template' | 'iterative';
        title: string;
        customTypeLabel?: string;
        templateVersionId?: string;
      } = {
        matterId: input.matterId,
        documentType: doc.documentType,
        draftingMode: doc.draftingMode,
        title: doc.title,
      };
      if (doc.customTypeLabel != null) docPayload.customTypeLabel = doc.customTypeLabel;
      if (doc.templateVersionId != null) docPayload.templateVersionId = doc.templateVersionId;

      void emitTelemetry(
        'document_created',
        docPayload,
        { userId: ctx.userId, matterId: input.matterId, documentId: doc.id, jobId: null },
      );

      // Sync matter phase (intake → drafting)
      void maybySyncMatterPhase(input.matterId, ctx.userId);

      return doc;
    }),

  // ============================================================
  // document.get
  // ============================================================
  get: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const doc = await getDocumentById(input.documentId, ctx.userId);
      if (!doc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }
      return doc;
    }),

  // ============================================================
  // document.list
  // ============================================================
  list: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        includeArchived: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const opts: { includeArchived?: boolean } = {};
      if (input.includeArchived !== undefined) opts.includeArchived = input.includeArchived;
      return listDocumentsForMatter(input.matterId, ctx.userId, opts);
    }),

  // ============================================================
  // document.updateTitle
  // ============================================================
  updateTitle: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        title: z.string().min(1).max(256),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await getDocumentById(input.documentId, ctx.userId);
      if (!doc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }
      // R12 guard
      assertNotComplete(doc.workflowState, 'document.updateTitle');

      const updated = await updateDocumentTitle(
        input.documentId,
        ctx.userId,
        input.title,
      );
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }

      void emitTelemetry(
        'document_metadata_updated',
        { fields: { title: { old: doc.title, new: input.title } } },
        { userId: ctx.userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      return updated;
    }),

  // ============================================================
  // document.setNotes — R12 carve-out (allowed on complete docs)
  // ============================================================
  setNotes: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        notes: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await getDocumentById(input.documentId, ctx.userId);
      if (!doc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }
      // NOTE: No R12 guard here — setNotes is a carve-out (Ch 35.1 / R12).
      // Phase 4a exhaustiveness assertion: COMPLETE_READONLY_EXEMPT = {setNotes, unfinalize}

      const updated = await updateDocumentNotes(
        input.documentId,
        ctx.userId,
        input.notes,
      );
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }

      void emitTelemetry(
        'document_metadata_updated',
        { fields: { notes: { old: doc.notes, new: input.notes } } },
        { userId: ctx.userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      return updated;
    }),

  // ============================================================
  // document.archive
  // ============================================================
  archive: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await getDocumentById(input.documentId, ctx.userId);
      if (!doc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }
      // R12 guard
      assertNotComplete(doc.workflowState, 'document.archive');
      if (doc.archivedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'ALREADY_ARCHIVED',
        });
      }
      const updated = await archiveDocument(input.documentId, ctx.userId);
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }
      void emitTelemetry(
        'document_archived',
        {},
        { userId: ctx.userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );
      // Sync matter phase
      void maybySyncMatterPhase(doc.matterId, ctx.userId);
      return updated;
    }),

  // ============================================================
  // document.unarchive
  // ============================================================
  unarchive: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await getDocumentById(input.documentId, ctx.userId);
      if (!doc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }
      if (doc.archivedAt === null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NOT_ARCHIVED',
        });
      }
      const updated = await unarchiveDocument(input.documentId, ctx.userId);
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }
      void emitTelemetry(
        'document_unarchived',
        {},
        { userId: ctx.userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );
      // Sync matter phase
      void maybySyncMatterPhase(doc.matterId, ctx.userId);
      return updated;
    }),

  // ============================================================
  // document.unfinalize — R12 carve-out (complete → finalizing)
  // ============================================================
  unfinalize: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await getDocumentById(input.documentId, ctx.userId);
      if (!doc) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }
      // NOTE: No R12 guard here — unfinalize is the mechanism to EXIT the
      // complete state. It is the second R12 carve-out alongside setNotes.
      // Phase 4a exhaustiveness assertion: COMPLETE_READONLY_EXEMPT = {setNotes, unfinalize}
      if (doc.workflowState !== 'complete') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'DOCUMENT_NOT_COMPLETE',
        });
      }
      const updated = await updateDocumentWorkflowState(
        input.documentId,
        ctx.userId,
        'finalizing',
        { completedAt: null },
      );
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }
      void emitTelemetry(
        'unfinalized',
        {},
        { userId: ctx.userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );
      // Sync matter phase (complete → drafting)
      void maybySyncMatterPhase(doc.matterId, ctx.userId);
      return updated;
    }),
});
