/**
 * Matter-State tRPC procedures — FOLD-L1-1 (read surface) + FOLD-L1-5 (explicit acts +
 * dashboard).
 *
 * matterState.get        — owner-scoped read of the Matter-State Engine (summary/full/
 *                          model_context modes). (L1-1)
 * matterState.dashboard  — the inspectable dashboard read: full state + the model-context-
 *                          packet preview. (L1-5)
 *
 * The FIVE EXPLICIT ACTS (L1-5) — deliberate, confirmable commitments, NEVER inferred from
 * conversation. Each is a distinct mutation with explicit parameters:
 *   matterState.tierSource       — (2) tier a source (explicit attorney designation)
 *   matterState.dispositionItem  — (3) disposition an open item (resolve | withdraw)
 *   matterState.recordSend       — (4) send / withhold (explicit, fail-visibly audited)
 *   (1) lock a decision  -> reviewSession.lockDecision (pre-existing explicit act)
 *   (5) matter identity  -> matter.get (always-visible anchor; a read, not a mutation)
 *
 * userId is always ctx.userId (Ch 35.2) — never from input.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getMatterState } from '../matterState/index.js';
import { formatMatterStateBlock } from '../matterState/injection.js';
import { MATTER_STATE_MODES } from '../../shared/schemas/matterState.js';
import { getMatterById } from '../db/queries/matters.js';
import { insertSourceAuthority } from '../db/queries/sourceAuthority.js';
import { getOpenItemById, resolveOpenItem, withdrawOpenItem } from '../db/queries/openItems.js';
import { insertAuditEvent } from '../db/queries/auditEvents.js';

const SUBJECT_TYPE = z.enum(['material', 'document', 'version']);
const AUTHORITY_ORIGIN = z.enum([
  'operative',
  'counterparty',
  'firm',
  'client',
  'model_derived',
  'reference',
]);
const LIFECYCLE = z.enum(['current_draft', 'operative', 'superseded']);

async function assertMatterOwned(matterId: string, userId: string) {
  const matter = await getMatterById(matterId, userId);
  if (!matter) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
  }
  return matter;
}

export const matterStateRouter = router({
  // ── L1-1: read surface ────────────────────────────────────────────────────
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

  // ── L1-5: inspectable dashboard ───────────────────────────────────────────
  dashboard: protectedProcedure
    .input(z.object({ matterId: z.string().uuid(), documentId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const docOpt = input.documentId !== undefined ? { documentId: input.documentId } : {};
      const full = await getMatterState({
        matterId: input.matterId,
        userId: ctx.userId,
        mode: 'full',
        ...docOpt,
      });
      const modelContext = await getMatterState({
        matterId: input.matterId,
        userId: ctx.userId,
        mode: 'model_context',
        ...docOpt,
      });
      if (full.mode !== 'full' || modelContext.mode !== 'model_context') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected matter-state mode' });
      }
      return {
        full,
        modelContext,
        modelContextPacket: formatMatterStateBlock(modelContext),
      };
    }),

  // ── L1-5 act (2): tier a source (explicit attorney designation) ───────────
  tierSource: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        subjectType: SUBJECT_TYPE,
        subjectId: z.string().uuid(),
        documentId: z.string().uuid().nullable().optional(),
        authorityOrigin: AUTHORITY_ORIGIN,
        lifecycle: LIFECYCLE,
        label: z.string().max(256).nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMatterOwned(input.matterId, ctx.userId);
      const row = await insertSourceAuthority({
        userId: ctx.userId,
        matterId: input.matterId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        authorityOrigin: input.authorityOrigin,
        lifecycle: input.lifecycle,
        // Explicit attorney act — designationSource is 'attorney', never inferred.
        designationSource: 'attorney',
        documentId: input.documentId ?? null,
        label: input.label ?? null,
        notes: input.notes ?? null,
      });
      return row;
    }),

  // ── L1-5 act (3): disposition an open item (resolve | withdraw) ────────────
  dispositionItem: protectedProcedure
    .input(
      z.object({
        openItemId: z.string().uuid(),
        action: z.enum(['resolve', 'withdraw']),
        rationale: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await getOpenItemById(input.openItemId, ctx.userId);
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Open item not found' });
      }
      const args = {
        id: item.id,
        userId: ctx.userId,
        matterId: item.matterId,
        documentId: item.documentId,
        rationale: input.rationale ?? null,
      };
      return input.action === 'resolve' ? resolveOpenItem(args) : withdrawOpenItem(args);
    }),

  // ── L1-5 act (4): send / withhold (explicit, fail-visibly audited) ─────────
  recordSend: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        documentId: z.string().uuid().nullable().optional(),
        decision: z.enum(['sent', 'withheld']),
        summary: z.string().min(1),
        rationale: z.string().nullable().optional(),
        versionId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMatterOwned(input.matterId, ctx.userId);
      // Fail-visibly: an explicit send/withhold commitment must be auditable or refused.
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
