/**
 * Version tRPC procedures — Ch 21.3 (Phase 3)
 *
 *   version.list   — list versions for a document
 *   version.get    — get a single version
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
});
