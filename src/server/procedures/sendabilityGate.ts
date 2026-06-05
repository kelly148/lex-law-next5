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
import { evaluateSendability, type RuleLevelLookup, type SendabilityEvaluation } from '../send/sendabilityEngine.js';
import { isTypedConfirmationValid, EXPORT_OVERRIDE_CONFIRM_PHRASE } from '../send/exportGate.js';
import { computeContentHash } from '../send/contentHash.js';
import { listFirmSendabilityRules, insertSendabilityOverride } from '../db/queries/sendability.js';
import { getDocumentById } from '../db/queries/documents.js';
import { getVersionById } from '../db/queries/versions.js';
import { recordAuditEvent } from '../db/queries/auditEvents.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';
import { isSendabilityGateEnabled } from '../config/featureFlags.js';
import { SENDABILITY_CHECK_CATEGORY_VALUES, SENDABILITY_OVERRIDE_REASON_VALUES } from '../../shared/schemas/sendability.js';

async function evaluateForDocument(documentId: string, userId: string): Promise<SendabilityEvaluation | null> {
  const { context } = await assembleSendabilityContext(documentId, userId);
  if (!context) return null;
  const rules = await listFirmSendabilityRules(userId);
  const ruleLevels: RuleLevelLookup[] = rules.map((r) => ({ category: r.category, documentType: r.documentType, level: r.level }));
  return evaluateSendability(context, ruleLevels);
}

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

  // ============================================================
  // recordOverride — POST mutation (NEVER the export GET). An explicit attorney override of a block,
  // append-only, bound to documentId + versionId + content-hash, snapshotting the block payload, with
  // a structured reason-code (+ free text) and a typed confirmation for wrong_matter_id. Owner-checked
  // + audited. A new version/content change invalidates the override (the hash no longer matches).
  // ============================================================
  recordOverride: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        versionId: z.string().uuid(),
        category: z.enum(SENDABILITY_CHECK_CATEGORY_VALUES),
        reasonCode: z.enum(SENDABILITY_OVERRIDE_REASON_VALUES),
        reasonText: z.string().max(4000).nullable().optional(),
        typedConfirmation: z.string().max(256).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await getDocumentById(input.documentId, ctx.userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });

      // Typed confirmation (wrong_matter_id requires the exact phrase).
      if (!isTypedConfirmationValid(input.category, input.typedConfirmation)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `This override requires typed confirmation — enter "${EXPORT_OVERRIDE_CONFIRM_PHRASE}".`,
        });
      }

      // The version being overridden must be owned + belong to this document; hash binds the override.
      const version = await getVersionById(input.versionId, ctx.userId);
      if (!version || version.documentId !== input.documentId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found for this document' });
      }
      const contentHash = computeContentHash(version.content);

      // The category must currently be a BLOCK (don't override a non-existent block); snapshot it.
      const evaluation = await evaluateForDocument(input.documentId, ctx.userId);
      const block = evaluation?.blocks.find((b) => b.category === input.category) ?? null;
      if (!block) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That category is not currently blocking this document; nothing to override.' });
      }

      const row = await insertSendabilityOverride({
        userId: ctx.userId,
        matterId: doc.matterId,
        documentId: input.documentId,
        versionId: input.versionId,
        contentHash,
        category: input.category,
        blockPayload: block,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText ?? null,
      });

      await recordAuditEvent({
        userId: ctx.userId,
        matterId: doc.matterId,
        documentId: input.documentId,
        versionId: input.versionId,
        eventType: 'disposition',
        actor: 'attorney',
        summary: `Recorded export-safety override for "${input.category}" (${input.reasonCode})`,
        targetType: 'sendability_override',
        targetId: row.id,
        action: 'record_sendability_override',
        scope: 'document',
        payload: { category: input.category, reasonCode: input.reasonCode, contentHash },
      });

      void emitTelemetry(
        'sendability_override_recorded',
        { category: input.category, reasonCode: input.reasonCode },
        { userId: ctx.userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      return row;
    }),
});
