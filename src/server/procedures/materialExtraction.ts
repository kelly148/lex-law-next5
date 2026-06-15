/**
 * materialExtraction router — FOLD-PM-2 (document-type structured extraction).
 *
 * Runs the PURE no-egress document-type parsers over a material's already-extracted
 * text and persists one latest extraction per material. Owner+matter scoped; gated
 * behind DOCUMENT_EXTRACTION_ENABLED (default OFF, refuses with PRECONDITION_FAILED
 * when OFF). userId is ALWAYS ctx.userId (Ch 35.2); a material/extraction is reachable
 * only by its owner (getMaterialById / owner-scoped queries return null cross-owner).
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isDocumentExtractionEnabled } from '../config/featureFlags.js';
import { getMaterialById } from '../db/queries/materials.js';
import { getMatterById } from '../db/queries/matters.js';
import {
  saveExtraction,
  getExtractionForMaterial,
  listExtractionsForMatter,
} from '../db/queries/materialExtractions.js';
import { extractStructuredDocument } from '../intake/documentTypeParsers.js';

function assertEnabled(): void {
  if (!isDocumentExtractionEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DOCUMENT_EXTRACTION_DISABLED' });
  }
}

async function assertOwnsMatter(matterId: string, userId: string): Promise<void> {
  const m = await getMatterById(matterId, userId);
  if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
}

export const materialExtractionRouter = router({
  isEnabled: protectedProcedure.query(() => ({ enabled: isDocumentExtractionEnabled() })),

  /** Re-run extraction for one material (owner-scoped) and persist the latest result. */
  extract: protectedProcedure
    .input(z.object({ materialId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      const material = await getMaterialById(input.materialId, ctx.userId);
      if (!material) throw new TRPCError({ code: 'NOT_FOUND', message: 'Material not found' });
      const result = extractStructuredDocument(material.textContent ?? '');
      return saveExtraction({
        userId: ctx.userId,
        matterId: material.matterId,
        materialId: input.materialId,
        result,
      });
    }),

  getForMaterial: protectedProcedure
    .input(z.object({ materialId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      // Owner-scoped: returns null cross-owner (no existence leak).
      return getExtractionForMaterial(input.materialId, ctx.userId);
    }),

  listForMatter: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      await assertOwnsMatter(input.matterId, ctx.userId);
      return listExtractionsForMatter(input.matterId, ctx.userId);
    }),
});
