/**
 * Version tRPC procedures — Ch 21.3 (Phase 3)
 *
 *   version.list    — list versions for a document
 *   version.get     — get a single version
 *   version.compare — READ-ONLY diff of two versions of the SAME document (REVIEW-LOOP-UX-1 / R3)
 *
 * Versions are immutable after creation (Ch 7). No update or delete procedures.
 * Version creation is a side effect of draft generation (Phase 4a).
 * userId is always drawn from ctx.userId (Ch 35.2).
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import {
  getVersionById,
  listVersionsForDocument,
} from '../db/queries/versions.js';
import { getDocumentById } from '../db/queries/documents.js';
import { listLddKeyTermsForVersion } from '../db/queries/lddKeyTerm.js';
import { compareKeyTerms } from '../draft/lddCompare.js';
import {
  compareKeyTermDictionaries,
  type LddVersionCompareResult,
} from '../draft/lddVersionCompare.js';

export const versionRouter = router({
  list: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return listVersionsForDocument(input.documentId, ctx.userId);
    }),

  get: protectedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const version = await getVersionById(input.versionId, ctx.userId);
      if (!version) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' });
      }
      return version;
    }),

  // ============================================================
  // version.compare — READ-ONLY: diff two versions of the SAME document (R3 compare view).
  //
  // Owner-scoping mirrors lddKeyTerm.getComparison: the document is fetched with getDocumentById(
  // ..., ctx.userId) (FOLD-AUTH owner check), then each version with getVersionById(..., ctx.userId)
  // — a row owned by another user resolves to null and 404s. Both versions are additionally pinned
  // to THIS document (no cross-document/cross-matter compare). Reuses the already-built LDD primitives:
  // listLddKeyTermsForVersion() for each version's curated key-term dictionary,
  // compareKeyTermDictionaries() to report what changed between them, and compareKeyTerms() to flag
  // each version's content drift against its own dictionary. DEFAULT-SAFE: surfaces a diff for the
  // attorney to review; never edits a draft, never asserts a version is wrong.
  // ============================================================
  compare: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        versionAId: z.string().uuid(),
        versionBId: z.string().uuid(),
      }),
    )
    .query(
      async ({
        ctx,
        input,
      }): Promise<{
        versionA: { id: string; versionNumber: number };
        versionB: { id: string; versionNumber: number };
        dictionaryDiff: LddVersionCompareResult;
        contentCheckA: ReturnType<typeof compareKeyTerms>;
        contentCheckB: ReturnType<typeof compareKeyTerms>;
      }> => {
        const doc = await getDocumentById(input.documentId, ctx.userId);
        if (!doc) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
        }

        const [versionA, versionB] = await Promise.all([
          getVersionById(input.versionAId, ctx.userId),
          getVersionById(input.versionBId, ctx.userId),
        ]);
        if (!versionA || versionA.documentId !== input.documentId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Version A not found for this document' });
        }
        if (!versionB || versionB.documentId !== input.documentId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Version B not found for this document' });
        }

        const [termsA, termsB] = await Promise.all([
          listLddKeyTermsForVersion(versionA.id, ctx.userId),
          listLddKeyTermsForVersion(versionB.id, ctx.userId),
        ]);

        const dictionaryDiff = compareKeyTermDictionaries(termsA, termsB);
        // Reuse the single-draft compare engine to flag each version's content drift against its own
        // recorded key-term values — so the attorney sees how present/absent status moved A -> B.
        const contentCheckA = compareKeyTerms(
          versionA.content,
          termsA.map((t) => ({ id: t.id, termLabel: t.termLabel, expectedValue: t.expectedValue })),
        );
        const contentCheckB = compareKeyTerms(
          versionB.content,
          termsB.map((t) => ({ id: t.id, termLabel: t.termLabel, expectedValue: t.expectedValue })),
        );

        return {
          versionA: { id: versionA.id, versionNumber: versionA.versionNumber },
          versionB: { id: versionB.id, versionNumber: versionB.versionNumber },
          dictionaryDiff,
          contentCheckA,
          contentCheckB,
        };
      },
    ),
});
