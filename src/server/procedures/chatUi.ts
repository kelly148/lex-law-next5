/**
 * CHAT-UI-1 — conversation-surface feature flag + posture-provenance audit ledger API (W0 + W2).
 *
 * The ENTIRE CHAT-UI-1 surface is gated behind CHAT_UI_1_ENABLED (default OFF). `isEnabled` is
 * ungated so the client can decide whether to mount the surface; everything else is gated behind
 * assertEnabled() so the provenance API is fully dormant when the flag is off.
 *
 * Provenance (W2, PROVENANCE-LEDGER-1): record an attorney confirm to the durable, tamper-evident
 * per-matter ledger; read it chronologically; export a portable bundle with the chain verdict.
 * userId is ALWAYS ctx.userId (Ch 35.2): the server stamps the authenticated actor and never trusts
 * a client-supplied actor or userId; reads are owner-scoped in the query layer.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isChatUi1Enabled } from '../config/featureFlags.js';
import { ProvenanceEntryInputSchema } from '../../shared/schemas/postureProvenance.js';
import type { Posture } from '../../shared/posture/postureCoherence.js';
import {
  recordPostureProvenance,
  listPostureProvenanceForMatter,
  exportPostureProvenanceForMatter,
} from '../db/queries/postureProvenance.js';

function assertEnabled(): void {
  if (!isChatUi1Enabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'CHAT_UI_1_DISABLED' });
  }
}

export const chatUiRouter = router({
  // Ungated read of the flag so the client can decide whether to mount the surface.
  isEnabled: protectedProcedure.query(() => ({ enabled: isChatUi1Enabled() })),

  // ── Posture-provenance audit ledger (W2) — all gated behind CHAT_UI_1_ENABLED ──

  recordProvenance: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        documentId: z.string().uuid().nullable().optional(),
        entry: ProvenanceEntryInputSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      const e = input.entry;
      // Best-effort write: the audit record never breaks the operation it records. The server stamps
      // the authenticated actor (Ch 35.2); the resolved columns derive from nextTriple in the query
      // layer, so a client-supplied actor/resolvedRecipient is not trusted for the stored record.
      await recordPostureProvenance(
        {
          act: e.act,
          eventClass: e.eventClass,
          subject: e.subject,
          actor: ctx.userId,
          sliderPosition: e.sliderPosition,
          triggerSource: e.triggerSource,
          at: e.at,
          priorTriple: e.priorTriple as Posture | null,
          nextTriple: e.nextTriple as Posture | null,
          resolvedRecipient: e.resolvedRecipient,
          acknowledged: e.acknowledged,
        },
        { userId: ctx.userId, matterId: input.matterId, documentId: input.documentId ?? null },
      );
      return { ok: true };
    }),

  listProvenance: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      return listPostureProvenanceForMatter(input.matterId, ctx.userId);
    }),

  exportProvenance: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      return exportPostureProvenanceForMatter(input.matterId, ctx.userId);
    }),
});
