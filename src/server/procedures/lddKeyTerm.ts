/**
 * LDD key-term tRPC procedures — FOLD-DRAFT-1 / LDD (Increment 2: rules + read/record API).
 *
 * Records + reads the key-term dictionary (the defined terms whose agreed value must stay
 * consistent between the operative source/LOI and the draft) and computes the LOI-vs-draft
 * comparison. Recording is an explicit ATTORNEY act (recordedBy='attorney'), owner-checked +
 * audited; the sourceType<->sourceId pairing is validated. DEFAULT-SAFE: getComparison FLAGS drift
 * (value present/absent in the current draft) — it never edits the draft, never auto-justifies an
 * outbound assertion. The attorney is the decision-maker. The UI is Inc3.
 *
 * userId is always ctx.userId (Ch 35.2); ownership flows through the owner-scoped query wrappers.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getDocumentById } from '../db/queries/documents.js';
import { getVersionById } from '../db/queries/versions.js';
import {
  insertLddKeyTerm,
  listLddKeyTermsForVersion,
  listLddKeyTermsForDocument,
} from '../db/queries/lddKeyTerm.js';
import { recordAuditEvent } from '../db/queries/auditEvents.js';
import { validateLddKeyTermSource } from '../draft/lddKeyTermRules.js';
import { compareKeyTerms, type LddComparisonResult } from '../draft/lddCompare.js';

const SOURCE_TYPE_ENUM = z.enum(['loi', 'operative_source', 'material', 'attorney_specified']);

export const lddKeyTermRouter = router({
  // ============================================================
  // lddKeyTerm.listForVersion / listForDocument — READ (owner-scoped)
  // ============================================================
  listForVersion: protectedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .query(({ ctx, input }) => listLddKeyTermsForVersion(input.versionId, ctx.userId)),

  listForDocument: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(({ ctx, input }) => listLddKeyTermsForDocument(input.documentId, ctx.userId)),

  // ============================================================
  // lddKeyTerm.record — capture (explicit attorney act; owner-checked; invariant-validated; audited)
  // ============================================================
  record: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        versionId: z.string().uuid(),
        termLabel: z.string().min(1).max(256),
        expectedValue: z.string().min(1).max(4000),
        sourceType: SOURCE_TYPE_ENUM,
        sourceId: z.string().max(64).nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await getDocumentById(input.documentId, ctx.userId);
      if (!doc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }

      const sourceId = input.sourceId ?? null;
      const valid = validateLddKeyTermSource(input.sourceType, sourceId);
      if (!valid.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: valid.reason ?? 'Invalid key-term source' });
      }

      const row = await insertLddKeyTerm({
        userId: ctx.userId,
        matterId: doc.matterId,
        documentId: input.documentId,
        versionId: input.versionId,
        termLabel: input.termLabel,
        expectedValue: input.expectedValue,
        sourceType: input.sourceType,
        sourceId,
        recordedBy: 'attorney',
        notes: input.notes ?? null,
      });

      await recordAuditEvent({
        userId: ctx.userId,
        matterId: doc.matterId,
        documentId: input.documentId,
        eventType: 'disposition',
        actor: 'attorney',
        summary: `Recorded LDD key term "${input.termLabel}" (${input.sourceType})`,
        targetType: 'ldd_key_term',
        targetId: row.id,
        action: 'record_ldd_key_term',
        scope: 'document',
        payload: { sourceType: input.sourceType, sourceId, versionId: input.versionId },
      });

      return row;
    }),

  // ============================================================
  // lddKeyTerm.getComparison — READ: the document's key terms vs its CURRENT draft text.
  // DEFAULT-SAFE: flags present/absent only; never edits or asserts the draft is wrong.
  // ============================================================
  getComparison: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<{ versionId: string | null } & LddComparisonResult> => {
      const doc = await getDocumentById(input.documentId, ctx.userId);
      if (!doc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }

      const emptyResult: LddComparisonResult = {
        terms: [],
        summary: { total: 0, present: 0, absent: 0, indeterminate: 0 },
      };

      // No draft yet -> nothing to compare against.
      if (doc.currentVersionId === null) {
        return { versionId: null, ...emptyResult };
      }

      const version = await getVersionById(doc.currentVersionId, ctx.userId);
      if (!version) {
        return { versionId: null, ...emptyResult };
      }

      const terms = await listLddKeyTermsForDocument(input.documentId, ctx.userId);
      const result = compareKeyTerms(
        version.content,
        terms.map((t) => ({ id: t.id, termLabel: t.termLabel, expectedValue: t.expectedValue })),
      );
      return { versionId: version.id, ...result };
    }),
});
