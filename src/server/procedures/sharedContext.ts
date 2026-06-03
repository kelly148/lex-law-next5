/**
 * Shared-context tRPC procedures — FOLD-L1-3 (Appendix C.6).
 *
 * sharedContext.get — the owner-scoped read that assembles the "everyone up to speed"
 *   package (thread + materials + matter-state) for the given toggled-on lanes on a matter
 *   (and optional focus document). Read-only substrate; lanes consume it elsewhere (L1-2
 *   injection at dispatch; the dashboard preview is L1-5). userId is always ctx.userId.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { buildSharedContextPackage } from '../sharedContext/index.js';

export const sharedContextRouter = router({
  get: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        documentId: z.string().uuid().optional(),
        lanes: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return buildSharedContextPackage({
        matterId: input.matterId,
        userId: ctx.userId,
        ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
        ...(input.lanes !== undefined ? { lanes: input.lanes } : {}),
      });
    }),
});
