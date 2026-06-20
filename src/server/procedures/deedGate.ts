/**
 * deedGate router — FOLD-DEED-1 Inc 1 foundation (the three-gate deed recordability gate).
 *
 * Owner-scoped read + write of a deed document's gate STATE (the affirmative-act checklist), plus the pure,
 * FAIL-CLOSED three-gate evaluation (Assembly → Legal-Review → Recordability). userId is ALWAYS ctx.userId,
 * never input. Every op except the ungated isEnabled probe is gated behind DEED_GATE_ENABLED (default OFF),
 * so the surface is DARK on prod.
 *
 * KB-MANDATORY / FAIL-CLOSED: the KB-sourced inputs (template coverage, vesting controlled-list, locality
 * verification) come ONLY from resolveDeedKbAvailability — never model memory. In this foundation NO KB is
 * seeded, so no deed ever reaches "recordable". The VA-primer KB seed + RON/e-recording are SEPARATE,
 * blocked/decision-gated increments.
 *
 * AUDIT: recording the gate state writes a Matter-Record event (audit_events) onto the deed's document —
 * the permanent record of the attorney's affirmative acts; the deed_gate row is the current operational state.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isDeedGateEnabled } from '../config/featureFlags.js';
import { getDeedGateState, upsertDeedGateState, countDeedPartyBindings } from '../db/queries/deedGate.js';
import { getDocumentById } from '../db/queries/documents.js';
import { getMatterById } from '../db/queries/matters.js';
import { insertAuditEvent } from '../db/queries/auditEvents.js';
import { resolveDeedKbAvailability } from '../deed/deedKb.js';
import {
  DEED_KB_PROVENANCE,
  VA_DEED_TYPES,
  VA_VESTING_OPTIONS,
  VA_EXEMPTIONS,
  VA_DEED_MUST_HAVES,
  VA_RECITAL_STRUCTURE,
  VA_ESCALATION_TRIGGERS,
  VA_STATUTORY_CITATIONS,
} from '../deed/deedKbVa.js';
import { VA_LOCALITIES } from '../deed/deedKbLocalitiesVa.js';
import { DeedGateStateSchema, evaluateDeedGate } from '../../shared/schemas/deedGate.js';

function assertEnabled(): void {
  if (!isDeedGateEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DEED_GATE_DISABLED' });
  }
}

/** Resolve the deed document (owned + actually a deed) or throw. */
async function requireDeedDocument(documentId: string, userId: string): Promise<{ matterId: string }> {
  const doc = await getDocumentById(documentId, userId);
  if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
  if (doc.documentType !== 'deed') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'DEED_GATE_NOT_A_DEED: the deed gate applies only to deed documents.' });
  }
  return { matterId: doc.matterId };
}

async function evaluateForDocument(documentId: string, matterId: string, userId: string, state: Parameters<typeof evaluateDeedGate>[0]['state']) {
  const parties = await countDeedPartyBindings(documentId, userId);
  const matter = await getMatterById(matterId, userId);
  // KB availability comes ONLY from the verified KB resolver (never model memory). The vesting selection is
  // validated against the seeded VA controlled-list; locality stays fail-closed (no per-locality KB seeded).
  const kb = resolveDeedKbAvailability({
    jurisdiction: matter?.jurisdiction ?? null,
    locality: state.recordingLocality, // the attorney-selected recording locality (deed gate state)
    deedType: 'deed',
    deedSubType: state.deedSubType,
    vestingSelection: state.vestingSelection,
  });
  return { evaluation: evaluateDeedGate({ state, kb, parties }), parties, kbSeeded: kb.localityVerified };
}

export const deedGateRouter = router({
  // Ungated probe so the client can decide whether to mount the deed-gate surface at all.
  isEnabled: protectedProcedure.query(() => ({ enabled: isDeedGateEnabled() })),

  // Read the deed's gate state + the fail-closed three-gate evaluation.
  get: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      const { matterId } = await requireDeedDocument(input.documentId, ctx.userId);
      const { state } = await getDeedGateState(input.documentId, ctx.userId);
      const { evaluation, parties, kbSeeded } = await evaluateForDocument(input.documentId, matterId, ctx.userId, state);
      return { state, evaluation, parties, kbSeeded };
    }),

  // Record the deed's gate state (the affirmative attorney acts). Writes a Matter-Record audit event.
  recordState: protectedProcedure
    .input(z.object({ documentId: z.string().uuid(), state: DeedGateStateSchema }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      const { matterId } = await requireDeedDocument(input.documentId, ctx.userId);

      // Lock integrity (item 1): the description can be LOCKED only after BOTH prongs are AFFIRMATIVELY
      // confirmed — matches source (a) + parcel scope (b) with the exception/reservation captured for a
      // partial/with-reservation conveyance — provenance + a plat/subdivision reference are present, and the
      // attorney affirmed side-by-side review (NOT OCR-only). A vacuous lock would let an unverified
      // description pass; every condition fails CLOSED on the unknown/null state.
      if (input.state.descriptionConfirmedAt) {
        const s = input.state;
        const exceptionOk = s.descriptionParcelScope === 'whole' || Boolean(s.descriptionExceptionText);
        if (
          s.descriptionSourceMatch !== true ||
          s.descriptionParcelScope === null ||
          !exceptionOk ||
          !s.descriptionProvenance ||
          s.descriptionNotOcrOnly !== true ||
          s.descriptionHasPlatOrSubdivisionRef !== true
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'DEED_DESCRIPTION_LOCK_REQUIRES_BOTH_PRONGS: lock the description only after affirming it matches the source of record AND describes the parcel(s) conveyed (with any exception/reservation captured), with provenance + a recorded plat/subdivision reference, reviewed side-by-side (not OCR-only).',
          });
        }
      }

      const resolved = await upsertDeedGateState({
        userId: ctx.userId,
        matterId,
        documentId: input.documentId,
        state: input.state,
        changedByUserId: ctx.userId,
      });
      await insertAuditEvent({
        userId: ctx.userId,
        matterId,
        documentId: input.documentId,
        eventType: 'disposition',
        actor: 'attorney',
        summary: 'Deed recordability gate state recorded',
        targetType: 'deed_gate',
        action: 'record_deed_gate',
        scope: 'document',
        payload: { state: resolved.state },
      });

      const { evaluation } = await evaluateForDocument(input.documentId, matterId, ctx.userId, resolved.state);
      return { state: resolved.state, evaluation };
    }),

  // The verified VA KB allowlist (Inc 2 — the composition-chokepoint reference). Read-only; the SOLE source of
  // VA deed legal content is the seeded KB (transcribed from the primer), never model memory. Surfaces the
  // deed-type controlled list, vesting controlled list, exemption table, deed-must-haves, recital structure,
  // escalation triggers, statutory citations, and the locality verified-status (all five UNverified — locality
  // recordability/e-recording specs + RON forms are NOT in the primer, so recordability stays fail-closed).
  referenceKb: protectedProcedure.query(() => {
    assertEnabled();
    return {
      provenance: DEED_KB_PROVENANCE,
      deedTypes: VA_DEED_TYPES,
      vestingOptions: VA_VESTING_OPTIONS,
      exemptions: VA_EXEMPTIONS,
      deedMustHaves: VA_DEED_MUST_HAVES,
      recitalStructure: VA_RECITAL_STRUCTURE,
      escalationTriggers: VA_ESCALATION_TRIGGERS,
      statutoryCitations: VA_STATUTORY_CITATIONS,
      // The five v1 localities with their VERIFIED per-locality specs (deedInstrumentRecordable, parcel-ID
      // format, on-deed first-page rules, e-recording vendors, fees, quirks, advisories, source cite).
      localities: VA_LOCALITIES,
    };
  }),
});
