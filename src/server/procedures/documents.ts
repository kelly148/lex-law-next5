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
import { hasUndispositionedBlocker, evaluateConflictClearance } from '../db/queries/conflicts.js';
import { isConflictGateEnabled } from '../config/featureFlags.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';
import { getDocTypeConfig } from '../../shared/docTypes/docTypeConfig.js';
import { listPartiesForMatter } from '../db/queries/matterParties.js';
import { bindDocumentParty, listDocumentParties } from '../db/queries/documentParty.js';
import { resolveIndividualSubject } from '../documents/subjectBinding.js';

// ============================================================
// R12 guard helper
// ============================================================

/**
 * Throws COMPLETE_READONLY if the document is in the 'complete' workflow state.
 * Must be called at the top of every document-mutating procedure EXCEPT
 * document.setNotes and document.unfinalize (the two R12 carve-outs).
 *
 * Phase 7 exhaustiveness assertion (resolved):
 *   COMPLETE_READONLY_EXEMPT === new Set(['document.setNotes', 'document.unfinalize'])
 */

/**
 * The exhaustive set of document procedures exempt from the R12 COMPLETE_READONLY guard.
 * Exactly two: setNotes (notes on complete docs) and unfinalize (exits complete state).
 * Exported for acceptance-test verification.
 */
export const COMPLETE_READONLY_EXEMPT: ReadonlySet<string> = new Set([
  'document.setNotes',
  'document.unfinalize',
]);

export function assertNotComplete(
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
        // DOC-CLIENT-TARGET-1: the bound subject (principal) for an individual_subject document. Server-
        // required for an individual type in a multi-client matter; auto-bound for a single-client matter;
        // ignored for non-individual types.
        subjectPartyId: z.string().uuid().optional(),
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

      // Advance-to-drafting conflicts gate. This is one of the four conflict-sensitive transitions
      // (R2-PRE-CONFLICT-1 disposition §3C). The check guards the DECISION to start drafting, not
      // the matter itself.
      //
      // FLAG ON (CONFLICT_GATE_ENABLED — Inc 3b): require the matter to be AFFIRMATIVELY cleared via
      // the single shared predicate `evaluateConflictClearance` (a check ran, no undispositioned
      // blocker, AND a CONFIRMED role='client' party) — never merely "not blocked". The distinct
      // non-cleared reason (no_conflict_check / no_client_party / unconfirmed_client_party /
      // undispositioned_blocker) is surfaced so the attorney sees exactly what is missing.
      //
      // FLAG OFF (default): legacy FOLD-L0-1 (Fork A) behavior EXACTLY — only an undispositioned
      // BLOCKER on the latest check blocks; "no check yet" is allowed. Inert until the flag flip.
      if (isConflictGateEnabled()) {
        const clearance = await evaluateConflictClearance(input.matterId, ctx.userId);
        if (clearance.state !== 'CLEARED') {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `CONFLICTS_NOT_CLEARED: this matter is not conflict-cleared for drafting (${clearance.reasons.join(', ')}). Run the conflicts check, add and confirm the client party, and disposition any blocker before advancing.`,
          });
        }
      } else {
        const conflictsBlocked = await hasUndispositionedBlocker(input.matterId, ctx.userId);
        if (conflictsBlocked) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              'CONFLICTS_BLOCKER_UNDISPOSITIONED: an undispositioned blocker-severity conflict must be cleared, screened, or declined before advancing this matter to drafting.',
          });
        }
      }

      // DOC-CLIENT-TARGET-1: resolve the subject binding for an individual_subject document BEFORE
      // insert, so we never create a document we cannot legally target. Multi-client + individual type
      // REQUIRES an affirmative principal pick (no default); single-client auto-binds the sole client.
      const docTypeConfig = getDocTypeConfig(input.documentType);
      const clientPartyIds =
        docTypeConfig?.targetStructure === 'individual_subject'
          ? (await listPartiesForMatter(input.matterId, ctx.userId))
              .filter((p) => p.role === 'client')
              .map((p) => p.id)
          : [];
      const subjectResolution = resolveIndividualSubject({
        targetStructure: docTypeConfig?.targetStructure,
        clientPartyIds,
        ...(input.subjectPartyId !== undefined ? { providedSubjectPartyId: input.subjectPartyId } : {}),
      });
      if (subjectResolution.kind === 'error') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${subjectResolution.code}: ${subjectResolution.message}`,
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

      // DOC-CLIENT-TARGET-1: bind the resolved subject (individual_subject docs). bindDocumentParty
      // re-validates the role against the type config (roleKey 'subject' is declared for these types).
      if (subjectResolution.kind === 'bind') {
        await bindDocumentParty({
          userId: ctx.userId,
          matterId: input.matterId,
          documentId: doc.id,
          partyId: subjectResolution.partyId,
          roleKey: 'subject',
          createdBy: ctx.userId,
        });
      }

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
  // document.listParties — DOC-CLIENT-TARGET-1
  // The party bindings (subject + reserved roles) for a document. Owner-scoped; the client joins
  // partyId -> displayName from the matter's parties and reads role labels from the shared doc-type
  // config. Powers the sticky drafting header (Principal: <name>) + the principal selector's state.
  // ============================================================
  listParties: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return listDocumentParties(input.documentId, ctx.userId);
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
