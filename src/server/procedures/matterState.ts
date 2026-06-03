/**
 * Matter-State tRPC procedures — FOLD-L1-1 (Layer-1 Matter-State Engine).
 *
 * matterState.get — the single owner-scoped READ surface over the Matter-State Engine.
 *   Modes (operator disposition item 1):
 *     summary       — header + counts + safe-to-send + operative document.
 *     full          — every composed row (raises the integrity-invariant stake).
 *     model_context — the curated package FOLD-L1-2 will consume (NOT raw full state).
 *
 * READ-ONLY in L1-1: the attorney decision MUTATIONS (set source tier, open/resolve
 * open item, record disposition) are deferred to the five explicit acts + UI (FOLD-L1-5);
 * their transactional fail-visibly mechanism already exists at the query layer. userId is
 * always ctx.userId (Ch 35.2) — never from input.
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { getMatterState } from '../matterState/index.js';
import { MATTER_STATE_MODES } from '../../shared/schemas/matterState.js';

export const matterStateRouter = router({
  get: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        mode: z.enum(MATTER_STATE_MODES).optional(),
        documentId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getMatterState({
        matterId: input.matterId,
        userId: ctx.userId,
        mode: input.mode ?? 'summary',
        ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
      });
    }),
});
