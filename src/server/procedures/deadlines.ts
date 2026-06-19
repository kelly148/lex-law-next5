/**
 * Deadline / tickler tRPC procedures — FOLD-PM-1 Increment 3.
 *
 * Read + lifecycle surface for the deadline engine. EVERYTHING except `isEnabled` is gated behind
 * DEADLINE_ENGINE_ENABLED (default OFF) so the engine is fully dormant until the operator flips it
 * (Pattern-16 + attorney-verified seeds). userId is always ctx.userId (Ch 35.2); matter ownership is
 * verified via getMatterById; by-id ops are owner-scoped in the query layer.
 *
 * The list reads perform the DETERMINISTIC ON-LOAD refresh (rolling-12-month tickler materialization)
 * and the expiry sweep (active -> expired_unresolved + open_item projection) — no background job in v1.
 *
 * NO autonomous/egress action: surfaces + records only. The attorney is the decision-maker.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isDeadlineEngineEnabled, isNotificationsEnabled } from '../config/featureFlags.js';
import { getMatterById } from '../db/queries/matters.js';
import { systemClock } from '../deadline/clock.js';
import { scanAndEmitDeadlineAlerts } from '../notifications/deadlineAlerts.js';
import {
  createMatterDeadline, confirmMatterDeadline, batchConfirmMatterDeadlines, overrideMatterDeadline,
  satisfyMatterDeadline, waiveMatterDeadline, proposeRecompute, confirmRecompute,
  acknowledgeTickler, snoozeTickler, getMatterDeadlineById, listDeadlinesForMatter, listDeadlinesForOwner,
  listTicklersForDeadline, refreshTicklersForMatter, sweepExpiredForMatter, coverageForMatter,
  integrityCheckForOwner, effectiveDueDate,
} from '../db/queries/deadlines.js';
import type { ConstraintInputs } from '../deadline/computeDeadline.js';

function assertEnabled(): void {
  if (!isDeadlineEngineEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DEADLINE_ENGINE_DISABLED' });
  }
}
async function assertOwnsMatter(matterId: string, userId: string): Promise<void> {
  const m = await getMatterById(matterId, userId);
  if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const FAMILY = z.enum(['exchange_1031', 'contract_contingency', 'closing_recording', 'trust_funding', 'corporate_filing']);
const ANCHOR_SOURCE = z.enum(['attorney_entered', 'document_linked']);
const CAP_INPUTS = z
  .object({
    return_due_date_cap: z
      .object({
        entityType: z.enum(['partnership', 's_corp', 'individual', 'c_corp']),
        fiscalYearEnd: z.string().regex(/^\d{2}-\d{2}$/),
        taxYear: z.number().int(),
        extensionFiled: z.boolean(),
        filedDate: DATE.nullable().optional(),
      })
      .optional(),
  })
  .optional();

export const deadlineRouter = router({
  // Ungated: lets the UI render the "engine off" coverage state without tripping the gate.
  isEnabled: protectedProcedure.query(() => ({ enabled: isDeadlineEngineEnabled() })),

  // ── Reads (do the deterministic on-load refresh + expiry sweep) ──
  listForMatter: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      await assertOwnsMatter(input.matterId, ctx.userId);
      await refreshTicklersForMatter(input.matterId, ctx.userId, systemClock);
      await sweepExpiredForMatter(input.matterId, ctx.userId, systemClock);
      const deadlines = await listDeadlinesForMatter(input.matterId, ctx.userId);
      const coverage = await coverageForMatter(input.matterId, ctx.userId);
      return { deadlines, coverage };
    }),

  getDeadline: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      const deadline = await getMatterDeadlineById(input.id, ctx.userId);
      if (!deadline) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deadline not found' });
      const ticklers = await listTicklersForDeadline(input.id, ctx.userId);
      return { deadline, ticklers };
    }),

  // Minimal cross-matter next-N-days list (NOT the full PM-4 portfolio view).
  upcoming: protectedProcedure
    .input(z.object({ withinDays: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      const today = systemClock.today();
      const horizonEnd = new Date(Date.parse(today + 'T00:00:00Z') + input.withinDays * 86400000)
        .toISOString().slice(0, 10);
      const all = await listDeadlinesForOwner(ctx.userId);
      return all
        .filter((d) => d.status === 'pending_confirm' || d.status === 'active' || d.status === 'expired_unresolved')
        .map((d) => ({ deadline: d, effectiveDueDate: effectiveDueDate(d) }))
        .filter((x) => x.effectiveDueDate != null && x.effectiveDueDate <= horizonEnd)
        .sort((a, b) => (a.effectiveDueDate! < b.effectiveDueDate! ? -1 : 1));
    }),

  coverage: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      await assertOwnsMatter(input.matterId, ctx.userId);
      return coverageForMatter(input.matterId, ctx.userId);
    }),

  integrity: protectedProcedure
    .input(z.object({ withinDays: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      return integrityCheckForOwner(ctx.userId, input.withinDays, systemClock);
    }),

  // ── Lifecycle mutations ──
  create: protectedProcedure
    .input(z.object({
      matterId: z.string().uuid(),
      ruleRevisionId: z.string().uuid().nullable(),
      family: FAMILY,
      description: z.string().min(1).max(512),
      anchorType: z.string().min(1).max(64),
      anchorDate: DATE,
      anchorSource: ANCHOR_SOURCE,
      anchorBasis: z.string().max(4000).nullable().optional(),
      anchorDocumentId: z.string().uuid().nullable().optional(),
      jurisdiction: z.string().max(16).nullable().optional(),
      constraintInputs: CAP_INPUTS,
      manualDueDate: DATE.nullable().optional(),
      leadTimeDefaults: z.array(z.number().int().nonnegative()).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      await assertOwnsMatter(input.matterId, ctx.userId);
      return createMatterDeadline({ ...input, constraintInputs: input.constraintInputs as ConstraintInputs | undefined }, ctx.userId, systemClock);
    }),

  confirm: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => { assertEnabled(); return confirmMatterDeadline(input.id, ctx.userId); }),

  batchConfirm: protectedProcedure
    .input(z.object({ matterId: z.string().uuid(), ids: z.array(z.string().uuid()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      await assertOwnsMatter(input.matterId, ctx.userId);
      return batchConfirmMatterDeadlines(input.matterId, input.ids, ctx.userId);
    }),

  override: protectedProcedure
    .input(z.object({ id: z.string().uuid(), overrideDate: DATE, reason: z.string().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => { assertEnabled(); return overrideMatterDeadline(input.id, ctx.userId, input.overrideDate, input.reason, systemClock); }),

  satisfy: protectedProcedure
    .input(z.object({ id: z.string().uuid(), basis: z.string().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => { assertEnabled(); return satisfyMatterDeadline(input.id, ctx.userId, input.basis); }),

  waive: protectedProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => { assertEnabled(); return waiveMatterDeadline(input.id, ctx.userId, input.reason); }),

  // Recompute: propose (read-only diff) then confirm (never silent).
  proposeRecompute: protectedProcedure
    .input(z.object({ id: z.string().uuid(), newAnchorDate: DATE, constraintInputs: CAP_INPUTS }))
    .query(async ({ ctx, input }) => { assertEnabled(); return proposeRecompute(input.id, ctx.userId, input.newAnchorDate, input.constraintInputs as ConstraintInputs | undefined); }),

  confirmRecompute: protectedProcedure
    .input(z.object({ id: z.string().uuid(), newAnchorDate: DATE, constraintInputs: CAP_INPUTS }))
    .mutation(async ({ ctx, input }) => { assertEnabled(); return confirmRecompute(input.id, ctx.userId, input.newAnchorDate, systemClock, input.constraintInputs as ConstraintInputs | undefined); }),

  // Tickler ack / snooze.
  acknowledgeTickler: protectedProcedure
    .input(z.object({ ticklerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => { assertEnabled(); return acknowledgeTickler(input.ticklerId, ctx.userId); }),

  snoozeTickler: protectedProcedure
    .input(z.object({ ticklerId: z.string().uuid(), snoozedUntil: DATE, reason: z.string().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => { assertEnabled(); return snoozeTickler(input.ticklerId, ctx.userId, input.snoozedUntil, input.reason); }),

  // NOTIFY-SUITE-1 N2: scan the owner's approaching deadlines and surface each (at most once, via the
  // tickler.notifiedAt cursor) as an in-app 'deadline' notification — which the existing notification bell +
  // the per-matter "deadline approaching" badge read. Gated on BOTH the deadline engine AND notifications:
  // if notifications are OFF there is nowhere to surface, so it is a no-op (emitted: 0). Informational only;
  // never auto-acts. The client calls this on load / a low-frequency interval.
  scanAlerts: protectedProcedure.mutation(async ({ ctx }) => {
    assertEnabled();
    if (!isNotificationsEnabled()) return { emitted: 0, notificationsEnabled: false };
    const emitted = await scanAndEmitDeadlineAlerts(ctx.userId, systemClock);
    return { emitted, notificationsEnabled: true };
  }),
});
