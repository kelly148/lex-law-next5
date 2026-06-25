/**
 * expressReviewLoop.ts — EXPRESS-AUTO-REVIEW-LOOP-1 E6: the flag-gated tRPC procedure that RUNS the loop.
 *
 * This is the LIVE wiring of the Express auto-review loop. It mirrors the deed procedures' fail-closed gating:
 *   1. FLAG GATE  — refuse with PRECONDITION_FAILED when !isAutoReviewLoopEnabled() (default OFF; the whole
 *      surface is dormant on prod). The ungated isEnabled probe lets the client decide whether to show it.
 *   2. OWNERSHIP  — getMatterById + getDocumentById are owner-scoped (ctx.userId); a document must belong to
 *      the matter; the latest version supplies the v1 draft the loop reviews.
 *   3. RUN        — build the EGRESS-BACKED ports (the reviewer dispatch through the EXISTING broker, surface
 *      'reviewer', enforceProviderAllowlist TRUE; the deterministic apply-edits regenerate, NO egress) and call
 *      runExpressLoop (E6-widened to async).
 *   4. FAIL-CLOSED — a DocumentEgressBlockedError (a held / sealed / no-external / conflicts / uncertain matter)
 *      thrown by the broker propagates out of the loop; we catch it HERE and return { status:'blocked', reason }
 *      — NEVER a partial candidate, NEVER an auto-adopt. A regenerate anchor-drift likewise fails the run
 *      cleanly. Everything else returns the NON-FINAL candidate + the ledger summary + the escalations.
 *
 * NEVER finalizes / records / sends; the candidate is NON-FINAL (E5 labels isFinal:false). NO schema migration:
 * the ledger is returned in the response, never persisted (durable ledger persistence is the DEFERRED E4b).
 * NO new EgressSurface / EgressSubject / env var.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isAutoReviewLoopEnabled } from '../config/featureFlags.js';
import { getMatterById } from '../db/queries/matters.js';
import { getDocumentById } from '../db/queries/documents.js';
import { getLatestVersionForDocument } from '../db/queries/versions.js';
import { DocumentEgressBlockedError } from '../egress/documentEgress.js';
import { resolveReviewerModel, PRIMARY_DRAFTER_MODEL } from '../llm/config.js';
import type { EgressSubject } from '../../shared/schemas/egress.js';
import type { DocumentType } from '../express/protectedSpans.js';
import { runExpressLoop, type ExpressLoopResult } from '../express/reviewLoop.js';
import { makeReviewPort, makeRegeneratePort, RegenerateAnchorError } from '../express/expressPorts.js';

/**
 * The document types E6 will run the loop for. ONLY 'deed' has a real protected-span recognizer set today (E1);
 * for any other type buildProtectedSpans returns [] — which would leave the locus gate with NO protected spans
 * and risk over-adoption. FAIL-CLOSED: E6 refuses to run for a type without a recognizer set. (As POA/will/etc.
 * earn their recognizer sets in E8, add them here.)
 */
const SUPPORTED_DOCUMENT_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>(['deed']);

/** Map a document row's free-string documentType to the E1 DocumentType, or null when unsupported. */
function toSupportedDocumentType(raw: string): DocumentType | null {
  const t = raw.trim().toLowerCase();
  return SUPPORTED_DOCUMENT_TYPES.has(t as DocumentType) ? (t as DocumentType) : null;
}

/** The blocked outcome — a fail-closed halt (a held/sealed/no-external/conflicts/uncertain matter). */
interface BlockedResult {
  status: 'blocked';
  reason: string;
}

/** The completed outcome — the NON-FINAL candidate + ledger summary + escalations. Never final/sent/recorded. */
interface CompletedResult {
  status: 'completed';
  isFinal: false;
  candidate: string;
  rounds: number;
  converged: boolean;
  hitCap: boolean;
  /** Per-round summaries (round-cap adherence + convergence audit). */
  roundSummaries: ExpressLoopResult['roundSummaries'];
  /** The cumulative adopted set (audit of what auto-applied). */
  adopted: ExpressLoopResult['adopted'];
  /** The risk-ranked escalations — the attorney's triage view (every escalation across all rounds). */
  escalations: Array<{
    id: string;
    round: number;
    riskScore: number;
    riskBucket: 'high' | 'medium' | 'low';
    immutabilityForced: boolean;
    beforeText: string;
    afterText: string;
    offsetStart: number;
    offsetEnd: number;
    reason: string;
  }>;
  /** The full per-decision ledger (recording order) — returned, NEVER persisted (E4b is deferred). */
  ledger: Array<{
    id: string;
    round: number;
    route: 'auto_adopt' | 'escalate';
    riskScore: number;
    riskBucket: 'high' | 'medium' | 'low';
    immutabilityForced: boolean;
    beforeText: string;
    afterText: string;
    offsetStart: number;
    offsetEnd: number;
  }>;
  /** The cumulative v1->candidate redline (total drift at a glance). */
  redline: ExpressLoopResult['redline'];
}

export const expressReviewLoopRouter = router({
  /** Ungated probe: whether the Express auto-review loop is enabled (so the client can show/hide the entry). */
  isEnabled: protectedProcedure.query(() => ({ enabled: isAutoReviewLoopEnabled() })),

  /**
   * Run the bounded anti-drift auto-review loop on a matter's document (its latest version). Flag-gated +
   * ownership-gated + fail-closed. Returns { status:'blocked' } on a held/sealed/no-external/conflicts matter
   * (the broker refused), else the NON-FINAL candidate + ledger summary + escalations. NEVER finalizes/sends.
   */
  run: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        documentId: z.string().uuid(),
        /** The reviewer model key (e.g. 'gpt' | 'gemini' | 'grok'); resolved server-side. Optional — defaults
         *  to the configured primary model when omitted/unknown. */
        reviewerKey: z.string().min(1).max(32).optional(),
        /** The requested round budget. Clamped to [1, HARD_CAP_ROUNDS=3] by the loop; a larger value ignored. */
        maxRounds: z.number().int().min(1).max(3).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<BlockedResult | CompletedResult> => {
      // 1) FLAG GATE — fail-closed; the whole surface is dormant when off.
      if (!isAutoReviewLoopEnabled()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AUTO_REVIEW_LOOP_DISABLED: the Express auto-review loop is not enabled.',
        });
      }

      // 2) OWNERSHIP — matter + document (owner-scoped), document belongs to the matter, latest version is v1.
      const matter = await getMatterById(input.matterId, ctx.userId);
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });

      const doc = await getDocumentById(input.documentId, ctx.userId);
      if (!doc || doc.matterId !== input.matterId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found in this matter' });
      }

      const documentType = toSupportedDocumentType(doc.documentType);
      if (documentType === null) {
        // FAIL-CLOSED: no protected-span recognizer set for this type -> refuse rather than risk over-adoption.
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `EXPRESS_UNSUPPORTED_DOCUMENT_TYPE: the auto-review loop only supports document types with a protected-span recognizer set (got "${doc.documentType}").`,
        });
      }

      const version = await getLatestVersionForDocument(input.documentId, ctx.userId);
      if (!version || version.content.trim().length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No reviewable document version' });
      }
      const originalText = version.content;

      // 3) BUILD the egress-backed ports. The reviewer dispatch goes through the EXISTING broker with the
      //    document SUBJECT (carries matter/document/version scope + userId — the broker resolves the
      //    matter/global hold from it). enforceProviderAllowlist is TRUE inside makeReviewPort.
      const subject: EgressSubject = {
        type: 'document',
        subjectId: version.id,
        matterId: input.matterId,
        userId: ctx.userId,
        documentId: input.documentId,
        documentVersionId: version.id,
      };
      const modelString =
        (input.reviewerKey ? resolveReviewerModel(input.reviewerKey) : undefined) ?? PRIMARY_DRAFTER_MODEL;

      const reviewPort = makeReviewPort({ subject, modelString });
      const regeneratePort = makeRegeneratePort();

      // 4) RUN + FAIL-CLOSED. A DocumentEgressBlockedError (hold/sealed/no-external/conflicts/uncertain) thrown
      //    by the broker propagates out of the awaited reviewPort -> we catch it HERE and return blocked. The
      //    deterministic regenerate anchor-drift fails the run cleanly too. NEVER a partial/auto-adopted result.
      let result: ExpressLoopResult;
      try {
        result = await runExpressLoop({
          documentType,
          originalText,
          // The deterministic apply-edits regenerate rebuilds from the ORIGINAL TEXT (so the adopted offsets
          // resolve against it) — anti-drift: the prior candidate is never the regenerate input.
          originalMaterials: originalText,
          reviewPort,
          regeneratePort,
          ...(input.maxRounds !== undefined ? { maxRounds: input.maxRounds } : {}),
        });
      } catch (err) {
        if (err instanceof DocumentEgressBlockedError) {
          // FAIL-CLOSED HALT — a held/sealed/no-external/conflicts/uncertain matter. Clean blocked outcome,
          // NO candidate, NO adopt. (The broker already recorded the blocked egress_events row.)
          return { status: 'blocked', reason: err.blockReason };
        }
        if (err instanceof RegenerateAnchorError) {
          // A deterministic-regenerate anchor drift — refuse rather than emit a possibly-corrupt candidate.
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `EXPRESS_REGENERATE_FAILED: ${err.message}`,
          });
        }
        throw err;
      }

      // The loop succeeded — return the NON-FINAL candidate + ledger summary + escalations. Nothing here
      // finalizes, persists-as-final, records, or sends; and the ledger is RETURNED, never persisted (E4b).
      const entries = result.ledger.entries();
      return {
        status: 'completed',
        isFinal: false,
        candidate: result.candidate,
        rounds: result.rounds,
        converged: result.converged,
        hitCap: result.hitCap,
        roundSummaries: result.roundSummaries,
        adopted: result.adopted,
        escalations: result.escalations.map((e) => ({
          id: e.id,
          round: e.round,
          riskScore: e.riskScore,
          riskBucket: e.riskBucket,
          immutabilityForced: e.immutabilityForced,
          beforeText: e.beforeText,
          afterText: e.afterText,
          offsetStart: e.offsetStart,
          offsetEnd: e.offsetEnd,
          reason: e.locus.reason,
        })),
        ledger: entries.map((e) => ({
          id: e.id,
          round: e.round,
          route: e.route,
          riskScore: e.riskScore,
          riskBucket: e.riskBucket,
          immutabilityForced: e.immutabilityForced,
          beforeText: e.beforeText,
          afterText: e.afterText,
          offsetStart: e.offsetStart,
          offsetEnd: e.offsetEnd,
        })),
        redline: result.redline,
      };
    }),
});
