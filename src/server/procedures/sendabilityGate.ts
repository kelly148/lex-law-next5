/**
 * Export-safety gate tRPC procedures — FOLD-SEND-1 (Increment 2: read-only evaluation).
 *
 * `getGate` assembles the deterministic context (owner-scoped) and runs the PURE engine against the
 * firm-default rule levels, returning the block/warn/pass verdict. READ-ONLY: it does not enforce,
 * does not write, and does not call any LLM. Enforcement at the export boundary + shadow-mode
 * logging + the override flow are Inc 3; `enforced` echoes the SENDABILITY_GATE_ENABLED flag so the
 * UI can label whether the gate is live or advisory-only.
 *
 * userId is always ctx.userId (Ch 35.2).
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { assembleSendabilityContext } from '../send/sendabilityContext.js';
import { evaluateSendability, type RuleLevelLookup } from '../send/sendabilityEngine.js';
import { listFirmSendabilityRules } from '../db/queries/sendability.js';
import { isSendabilityGateEnabled } from '../config/featureFlags.js';

export const sendabilityGateRouter = router({
  getGate: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { context } = await assembleSendabilityContext(input.documentId, ctx.userId);
      if (!context) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }
      const rules = await listFirmSendabilityRules(ctx.userId);
      const ruleLevels: RuleLevelLookup[] = rules.map((r) => ({ category: r.category, documentType: r.documentType, level: r.level }));
      const evaluation = evaluateSendability(context, ruleLevels);
      return {
        verdict: evaluation.verdict,
        blocks: evaluation.blocks,
        warnings: evaluation.warnings,
        degraded: evaluation.degraded,
        inScope: context.inScope,
        enforced: isSendabilityGateEnabled(), // false => advisory/shadow only (v1 default)
      };
    }),
});
