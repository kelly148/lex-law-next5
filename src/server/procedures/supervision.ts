/**
 * supervision router — SUPERVISION-VIEW-1 (read-only egress supervision).
 *
 * A READ-ONLY owner-scoped surface over the chat_egress_events audit log for the GLBA
 * vendor-oversight (recurring-review) duty. Every op (except the ungated isEnabled
 * probe) is gated behind SUPERVISION_VIEW_ENABLED (default OFF) and refuses with
 * PRECONDITION_FAILED when OFF. There is NO mutation here — the router exposes only
 * queries; the egress log stays append-only-by-construction. userId is ALWAYS
 * ctx.userId (Ch 35.2); a supervisor sees ONLY their own egress events.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isSupervisionViewEnabled } from '../config/featureFlags.js';
import { querySupervision, type SupervisionFilter } from '../db/queries/supervisionEgress.js';
import {
  CHAT_EGRESS_KIND_VALUES,
  CHAT_EGRESS_DECISION_VALUES,
} from '../../shared/schemas/chatCopilot.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

function assertEnabled(): void {
  if (!isSupervisionViewEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'SUPERVISION_VIEW_DISABLED' });
  }
}

export const supervisionRouter = router({
  // Ungated probe so the client can decide whether to mount the surface.
  isEnabled: protectedProcedure.query(() => ({ enabled: isSupervisionViewEnabled() })),

  /**
   * Owner-scoped, paginated, read-only egress supervision query + aggregates.
   * Filterable by provider / matter / date-range / kind / allowed-or-blocked.
   */
  query: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid().optional(),
        provider: z.string().min(1).max(64).optional(),
        kind: z.enum(CHAT_EGRESS_KIND_VALUES).optional(),
        decision: z.enum(CHAT_EGRESS_DECISION_VALUES).optional(),
        sinceDate: DATE.optional(),
        untilDate: DATE.optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertEnabled();
      const filter: SupervisionFilter = {};
      if (input.matterId !== undefined) filter.matterId = input.matterId;
      if (input.provider !== undefined) filter.provider = input.provider;
      if (input.kind !== undefined) filter.kind = input.kind;
      if (input.decision !== undefined) filter.decision = input.decision;
      // Date-range is inclusive: [since 00:00:00, until 23:59:59.999] UTC.
      if (input.sinceDate !== undefined) filter.sinceCreatedAt = new Date(`${input.sinceDate}T00:00:00.000Z`);
      if (input.untilDate !== undefined) filter.untilCreatedAt = new Date(`${input.untilDate}T23:59:59.999Z`);
      return querySupervision(ctx.userId, filter, { limit: input.limit, offset: input.offset });
    }),
});
