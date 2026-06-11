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
import { getMatterById } from '../db/queries/matters.js';
import { listSourceAuthorityForMatter, setSourceAuthorityTier } from '../db/queries/sourceAuthority.js';
import { insertLockedDecision, unlockLockedDecision } from '../db/queries/phase4b.js';
import { insertAuditEvent } from '../db/queries/auditEvents.js';

const AUTHORITY_ORIGIN = z.enum(['operative', 'counterparty', 'firm', 'client', 'model_derived', 'reference']);
const LIFECYCLE = z.enum(['current_draft', 'operative', 'superseded']);

function assertEnabled(): void {
  if (!isChatUi1Enabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'CHAT_UI_1_DISABLED' });
  }
}

async function assertMatterOwned(matterId: string, userId: string): Promise<void> {
  const matter = await getMatterById(matterId, userId);
  if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
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

  // ── Backend-act wiring (BA) — the gated hard-stop acts execute their real backend mutation ──
  // BA-0: read the matter's source-authority rows so the surface can bind a real source subject.
  listSources: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      await assertMatterOwned(input.matterId, ctx.userId);
      return listSourceAuthorityForMatter(input.matterId, ctx.userId);
    }),

  // BA-1: the 'tier_source' hard-stop act -> the AUDITED re-tier. Operator decision (2026-06-11):
  // setSourceAuthorityTier UPDATEs the existing row in place AND writes a transactional audit_events
  // 'set_tier' disposition in ONE transaction (fail-visibly). The caller (ChatDeliverable) invokes
  // this ONLY inside `if (outcome.confirmed)` — the hard-stop floor has already cleared.
  setSourceTier: protectedProcedure
    .input(
      z.object({
        sourceId: z.string().uuid(),
        matterId: z.string().uuid(),
        documentId: z.string().uuid().nullable().optional(),
        authorityOrigin: AUTHORITY_ORIGIN,
        lifecycle: LIFECYCLE,
        rationale: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      await assertMatterOwned(input.matterId, ctx.userId);
      return setSourceAuthorityTier({
        id: input.sourceId,
        userId: ctx.userId,
        matterId: input.matterId,
        documentId: input.documentId ?? null,
        authorityOrigin: input.authorityOrigin,
        lifecycle: input.lifecycle,
        rationale: input.rationale ?? null,
      });
    }),

  // BA-2: the 'lock' hard-stop act -> a no-suggestion deliverable lock. INSERT a locked_decisions row
  // (sourceSuggestionId NULL — schema + unique index allow it) on the bound document. origin reuses
  // 'adopted' (locking = adopting the current state) per the operator decision (no enum migration).
  // Returns the row id so a W3 hard-stop undo can unlock it. Inside if(outcome.confirmed) only.
  lockDeliverable: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        documentId: z.string().uuid(),
        summary: z.string().min(1),
        rationale: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      await assertMatterOwned(input.matterId, ctx.userId);
      const lockedDecisionId = await insertLockedDecision({
        userId: ctx.userId,
        documentId: input.documentId,
        matterId: input.matterId,
        origin: 'adopted',
        summary: input.summary,
        rationale: input.rationale ?? null,
        sourceSuggestionId: null,
      });
      return { lockedDecisionId };
    }),

  // BA-2 reversal: undo a deliverable lock (soft status -> 'unlocked'; row preserved for audit).
  unlockDeliverable: protectedProcedure
    .input(z.object({ matterId: z.string().uuid(), lockedDecisionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      await assertMatterOwned(input.matterId, ctx.userId);
      await unlockLockedDecision(input.lockedDecisionId, ctx.userId);
      return { ok: true };
    }),

  // BA-3: the 'send' hard-stop act -> an INTERNAL sendability disposition (sent | withheld), audited.
  // This writes ONE append-only audit_events disposition row — NO export, NO .docx, NO transmission,
  // NO outbound. Mirrors matterState.recordSend; the product is not client-facing until FOLD-L0-1.
  recordSend: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        documentId: z.string().uuid().nullable().optional(),
        versionId: z.string().uuid().nullable().optional(),
        decision: z.enum(['sent', 'withheld']),
        summary: z.string().min(1),
        rationale: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      await assertMatterOwned(input.matterId, ctx.userId);
      const eventId = await insertAuditEvent({
        userId: ctx.userId,
        matterId: input.matterId,
        documentId: input.documentId ?? null,
        eventType: input.decision,
        actor: 'attorney',
        summary: input.summary,
        action: input.decision,
        rationale: input.rationale ?? null,
        versionId: input.versionId ?? null,
        scope: input.documentId ? 'document' : 'matter',
      });
      return { eventId, decision: input.decision };
    }),
});
