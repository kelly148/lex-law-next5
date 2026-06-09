/**
 * CONFLICT-GATE-OVERRIDE-1 — attested per-matter, per-precondition gate-override tRPC surface.
 *
 * - getGate: the override-aware drafting-gate status for a matter (blocking preconditions + active
 *   overrides) for the block-point UI + the persistent "gate overridden" banner.
 * - record: attest an override of a precondition that is CURRENTLY blocking the matter (snapshots the
 *   precondition state; writes the append-only gate_override row + its immutable audit ledger entry).
 *
 * The gate DEFAULT stays fail-closed: this router NEVER disables the gate. It records an explicit attorney
 * act the gate consults, and re-arms automatically on a material change. userId is always ctx.userId
 * (Ch 35.2); ownership is verified through getMatterById.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getMatterById } from '../db/queries/matters.js';
import { evaluateAllClearanceReasons } from '../db/queries/conflicts.js';
import {
  computePreconditionSnapshot,
  recordGateOverrideAttestation,
  resolveDraftingGate,
} from '../db/queries/gateOverride.js';
import { blockingPreconditionsForReasons } from '../conflicts/gateOverride.js';
import { isConflictGateEnabled } from '../config/featureFlags.js';
import {
  GATE_OVERRIDE_PRECONDITION_VALUES,
  GATE_OVERRIDE_REASON_CODE_VALUES,
} from '../../shared/schemas/gateOverride.js';

async function assertOwnsMatter(matterId: string, userId: string): Promise<void> {
  const m = await getMatterById(matterId, userId);
  if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
}

export const gateOverrideRouter = router({
  // Read-only gate status for the matter: whether the gate is enforced, the raw clearance state, which
  // preconditions are currently blocking, and the active (snapshot-current) overrides for the banner.
  getGate: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOwnsMatter(input.matterId, ctx.userId);
      const gate = await resolveDraftingGate(input.matterId, ctx.userId);
      return {
        enforced: isConflictGateEnabled(), // false => the gate is advisory/inert; overrides are moot
        state: gate.clearance.state,
        allowed: gate.allowed,
        blockingPreconditions: gate.blockingPreconditions,
        blockingReasons: gate.blockingReasons,
        activeOverrides: gate.activeOverrides.map((o) => ({
          id: o.id,
          precondition: o.precondition,
          reasonCode: o.reasonCode,
          reasonText: o.reasonText,
          createdAt: o.createdAt,
        })),
      };
    }),

  // Attest an override of a CURRENTLY-blocking precondition. Snapshots the precondition state so the
  // override re-arms on a material change. Append-only + audited; the gate default is never disabled.
  record: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        precondition: z.enum(GATE_OVERRIDE_PRECONDITION_VALUES),
        reasonCode: z.enum(GATE_OVERRIDE_REASON_CODE_VALUES),
        reasonText: z.string().max(4000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOwnsMatter(input.matterId, ctx.userId);

      // No empty reason: the four named quick-picks are self-describing; 'other' demands free text.
      const reasonText = (input.reasonText ?? '').trim();
      if (input.reasonCode === 'other' && reasonText.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A one-line reason is required when the reason is "Other".',
        });
      }

      // The precondition must CURRENTLY be blocking this matter (don't override a satisfied precondition).
      // Mirrors sendability's "the category must currently be a BLOCK". evaluateAllClearanceReasons reports
      // ALL currently-failing preconditions (not just the short-circuited first), so the attorney may attest
      // an override of EITHER blocking precondition independently — an override of one never masks another.
      const clearance = await evaluateAllClearanceReasons(input.matterId, ctx.userId);
      const blocking = blockingPreconditionsForReasons(clearance.reasons);
      if (clearance.state === 'CLEARED' || !blocking.includes(input.precondition)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `The ${input.precondition} precondition is not currently blocking this matter; there is nothing to override.`,
        });
      }

      const { snapshot, snapshotHash } = await computePreconditionSnapshot(
        input.matterId,
        ctx.userId,
        input.precondition,
      );
      const row = await recordGateOverrideAttestation({
        userId: ctx.userId,
        matterId: input.matterId,
        precondition: input.precondition,
        snapshot,
        snapshotHash,
        reasonCode: input.reasonCode,
        reasonText: reasonText.length > 0 ? reasonText : null,
      });
      return { id: row.id, precondition: row.precondition, reasonCode: row.reasonCode, createdAt: row.createdAt };
    }),
});
