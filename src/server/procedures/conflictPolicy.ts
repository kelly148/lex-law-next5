/**
 * conflictPolicy router — CONFLICT-TOGGLE-1 Inc 1 (firm-scoped conflicts posture policy).
 *
 * Owner-scoped read + append-only write of the firm's conflicts posture policy, plus the resolved effective
 * posture per engagement capacity (the pure, default-safe resolver). FIRM-scoped: firmOwnerUserId == ctx.userId
 * in single-tenant v1 (firm-shaped for a later multi-user firm). userId is ALWAYS ctx.userId, NEVER input.
 *
 * GATING: every op except the ungated isEnabled probe is gated behind CONFLICT_GATE_ENABLED (default OFF), so
 * the whole posture-admin surface is DARK on prod until the conflict gate is activated. DORMANT (Inc 1):
 * setting a policy persists firm intent but NOTHING reads the effective posture to change a gate transition
 * yet — that wiring is a later, separately accept-gated increment. So this is behavior-preserving.
 *
 * AUDIT: the firm_conflict_policy table is APPEND-ONLY — each setPolicy INSERTs a new row (changedByUserId +
 * reasonText + createdAt), so the row history IS the tamper-evident settings-audit (disposition item 7). The
 * per-matter Matter-Record fan-out (also item 7) lands with the wiring increment, where affected matters exist.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import {
  getFirmConflictPolicy,
  setFirmConflictPolicy,
  listFirmConflictPolicyHistory,
} from '../db/queries/conflictPolicy.js';
import {
  ConflictPolicySchema,
  isPolicyRelaxation,
  resolveEffectivePosture,
} from '../../shared/schemas/conflictPolicy.js';
import { isConflictGateEnabled, isConflictGateForceOn } from '../config/featureFlags.js';

function assertEnabled(): void {
  if (!isConflictGateEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'CONFLICT_GATE_DISABLED' });
  }
}

/** Resolved effective DEFAULT posture per capacity, for the admin surface to display. */
function effectiveByCapacity(policy: Parameters<typeof resolveEffectivePosture>[0]['policy'], forceOn: boolean) {
  return {
    law_firm: resolveEffectivePosture({ policy, capacity: 'law_firm', forceOn }).posture,
    title_settlement_agent: resolveEffectivePosture({ policy, capacity: 'title_settlement_agent', forceOn }).posture,
  };
}

export const conflictPolicyRouter = router({
  // Ungated probe so the client can decide whether to mount the posture-admin surface at all.
  isEnabled: protectedProcedure.query(() => ({ enabled: isConflictGateEnabled() })),

  // Read the firm's current policy + the resolved effective posture per capacity + the force-on floor.
  get: protectedProcedure.query(async ({ ctx }) => {
    assertEnabled();
    const resolved = await getFirmConflictPolicy(ctx.userId); // v1: firmOwnerUserId = ctx.userId
    const forceOn = isConflictGateForceOn();
    return {
      policy: resolved.policy,
      source: resolved.source,
      forceOn,
      effectiveByCapacity: effectiveByCapacity(resolved.policy, forceOn),
    };
  }),

  // Append a new firm policy version. A RELAXATION (transactional ENFORCED → ADVISORY) requires a typed
  // reason (disposition item 7). force-on does not block persistence — it only overrides at resolution.
  setPolicy: protectedProcedure
    .input(
      z.object({
        policy: ConflictPolicySchema,
        reasonText: z.string().trim().min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      const current = await getFirmConflictPolicy(ctx.userId);
      if (isPolicyRelaxation(current.policy, input.policy) && !input.reasonText) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'CONFLICT_POLICY_REASON_REQUIRED: relaxing the conflicts posture requires a typed reason.',
        });
      }
      const resolved = await setFirmConflictPolicy({
        firmOwnerUserId: ctx.userId,
        changedByUserId: ctx.userId,
        policy: input.policy,
        reasonText: input.reasonText ?? null,
      });
      const forceOn = isConflictGateForceOn();
      return {
        policy: resolved.policy,
        source: resolved.source,
        forceOn,
        effectiveByCapacity: effectiveByCapacity(resolved.policy, forceOn),
      };
    }),

  // The append-only history (newest first) — the immutable settings-audit surface.
  history: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ ctx, input }) => {
      assertEnabled();
      const rows = await listFirmConflictPolicyHistory(ctx.userId, input?.limit ?? 100);
      return { entries: rows };
    }),
});
