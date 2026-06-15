/**
 * matterDeliverable router — FOLD-PM-4 (ongoing matters + to-do list).
 *
 * Owner+matter-scoped CRUD over matter_deliverable plus a cross-matter portfolio
 * read. Mirrors the deadlines router conventions: protectedProcedure everywhere;
 * an assertEnabled() flag gate (MATTER_DELIVERABLE_ENABLED, default OFF) on every
 * op except the ungated isEnabled probe; matter ownership verified via the
 * owner-scoped getMatterById before any matter-scoped write; userId is ALWAYS
 * ctx.userId, NEVER read from input (Ch 35.2).
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isMatterDeliverableEnabled } from '../config/featureFlags.js';
import { getMatterById, listMatters } from '../db/queries/matters.js';
import {
  createDeliverable,
  listDeliverablesForMatter,
  listDeliverablesForOwner,
  updateDeliverable,
  completeDeliverable,
} from '../db/queries/matterDeliverables.js';
import { MATTER_DELIVERABLE_STATUS_VALUES } from '../../shared/schemas/matterDeliverables.js';

const DUE_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const TITLE = z.string().min(1).max(256);
const NOTES = z.string().max(8000);

function assertEnabled(): void {
  if (!isMatterDeliverableEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'MATTER_DELIVERABLE_DISABLED' });
  }
}

async function assertOwnsMatter(matterId: string, userId: string): Promise<void> {
  const m = await getMatterById(matterId, userId);
  if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
}

export const matterDeliverableRouter = router({
  // Ungated probe so the client can decide whether to mount the surface.
  isEnabled: protectedProcedure.query(() => ({ enabled: isMatterDeliverableEnabled() })),

  // ── Reads ──────────────────────────────────────────────────────────────
  listForMatter: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      await assertOwnsMatter(input.matterId, ctx.userId);
      return listDeliverablesForMatter(input.matterId, ctx.userId);
    }),

  /**
   * Portfolio: the user's (non-archived) matters, each with its deliverables and
   * open/done counts. Cross-matter, driven entirely off ctx.userId — no matterId
   * input. One owner-scoped matters read + one owner-scoped deliverables read,
   * grouped in memory (deliverables on archived matters are simply not surfaced).
   */
  portfolio: protectedProcedure.query(async ({ ctx }) => {
    assertEnabled();
    const [matters, deliverables] = await Promise.all([
      listMatters(ctx.userId),
      listDeliverablesForOwner(ctx.userId),
    ]);
    const byMatter = new Map<string, typeof deliverables>();
    for (const d of deliverables) {
      const list = byMatter.get(d.matterId);
      if (list) list.push(d);
      else byMatter.set(d.matterId, [d]);
    }
    return matters.map((m) => {
      const ds = byMatter.get(m.id) ?? [];
      const openCount = ds.filter((d) => d.status === 'open').length;
      return {
        matterId: m.id,
        title: m.title,
        clientName: m.clientName,
        practiceArea: m.practiceArea,
        phase: m.phase,
        openCount,
        doneCount: ds.length - openCount,
        deliverables: ds,
      };
    });
  }),

  // ── Lifecycle mutations ──────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        title: TITLE,
        dueDate: DUE_DATE.nullable().optional(),
        notes: NOTES.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      await assertOwnsMatter(input.matterId, ctx.userId);
      const args: Parameters<typeof createDeliverable>[0] = {
        userId: ctx.userId,
        matterId: input.matterId,
        title: input.title,
      };
      if (input.dueDate !== undefined) args.dueDate = input.dueDate;
      if (input.notes !== undefined) args.notes = input.notes;
      return createDeliverable(args);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: TITLE.optional(),
        status: z.enum(MATTER_DELIVERABLE_STATUS_VALUES).optional(),
        dueDate: DUE_DATE.nullable().optional(),
        notes: NOTES.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      const patch: Parameters<typeof updateDeliverable>[2] = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.status !== undefined) patch.status = input.status;
      if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
      if (input.notes !== undefined) patch.notes = input.notes;
      // Owner-scoped: returns null if the deliverable doesn't exist OR isn't owned.
      const updated = await updateDeliverable(input.id, ctx.userId, patch);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deliverable not found' });
      return updated;
    }),

  complete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      const done = await completeDeliverable(input.id, ctx.userId);
      if (!done) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deliverable not found' });
      return done;
    }),
});
