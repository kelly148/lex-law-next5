/**
 * deedSignoff router — D3-SIGNOFF (source-anchored deed sign-off), A.1 Inc 4.
 *
 * The attorney's sign-off surface: a read that shows the extracted-source-vs-assembled-draft comparison, and a
 * mutation that records the sign-off (with the dual-prong attestation + the high-friction override). Owner-scoped
 * everywhere (userId is ALWAYS ctx.userId). Flag-gated on D3_SIGNOFF_MODE (default OFF). NC-1: the mutation never
 * composes or corrects text — it records statuses + hashes + the attorney's attestation. NC-D3-3: a hard-block
 * (legal/parcel MISMATCH) is NON-overridable; an absent/withheld source value needs the high-friction override.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getD3SignoffMode } from '../config/featureFlags.js';
import { getDocumentById } from '../db/queries/documents.js';
import { getLatestVersionForDocument } from '../db/queries/versions.js';
import { listMaterialsForMatter } from '../db/queries/materials.js';
import { consolidateDeedSourceFacts } from '../deed/deedSourceFacts.js';
import { extractAssembledDeedFields, observeD3Comparison } from '../deed/d3Observe.js';
import { hashDeedContent, hashSourceFacts, evaluateSignoffDecision, D3_COMPARATOR_VERSION, D3_FORK_PROVENANCE } from '../deed/d3Signoff.js';
import { insertDeedSignoff, getValidDeedSignoffForVersion } from '../db/queries/deedSignoff.js';
import { insertAuditEvent } from '../db/queries/auditEvents.js';

function assertEnabled(): 'observe' | 'enforce' {
  const mode = getD3SignoffMode();
  if (mode === 'off') throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'D3_SIGNOFF_DISABLED' });
  return mode;
}

/** Load an owned deed document + its latest version + the live source-anchored comparison. */
async function loadDeedContext(userId: string, documentId: string) {
  const doc = await getDocumentById(documentId, userId);
  if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'DOCUMENT_NOT_FOUND' });
  if (doc.documentType !== 'deed') throw new TRPCError({ code: 'BAD_REQUEST', message: 'NOT_A_DEED' });
  const version = await getLatestVersionForDocument(documentId, userId);
  if (!version) throw new TRPCError({ code: 'NOT_FOUND', message: 'VERSION_NOT_FOUND' });

  const materials = await listMaterialsForMatter(doc.matterId, userId);
  const sourceFacts = consolidateDeedSourceFacts(materials.map((m) => ({ materialId: m.id, textContent: m.textContent })));
  const draft = extractAssembledDeedFields(version.content);
  const parcelExpected = Boolean(sourceFacts.parcelId.value) || /Tax I\.D\.|GPIN|Tax Map No\./i.test(version.content);
  const observe = observeD3Comparison({
    deedText: version.content,
    category: doc.customTypeLabel ?? 'deed',
    source: {
      legalDescription: { value: sourceFacts.legalDescription.value, withheld: sourceFacts.legalDescription.withheld, flags: sourceFacts.legalDescription.flags },
      parcelId: { value: sourceFacts.parcelId.value, withheld: sourceFacts.parcelId.withheld },
      currentOwners: { values: sourceFacts.granteeOfRecord.values, withheld: sourceFacts.granteeOfRecord.withheld },
    },
    parcelExpected,
  });
  return { doc, version, sourceFacts, draft, observe };
}

function sourceMaterialIds(sourceFacts: {
  legalDescription: { sourceMaterialId: string | null };
  parcelId: { sourceMaterialId: string | null };
  granteeOfRecord: { sourceMaterialId: string | null };
}): string[] {
  const ids = [
    sourceFacts.legalDescription.sourceMaterialId,
    sourceFacts.parcelId.sourceMaterialId,
    sourceFacts.granteeOfRecord.sourceMaterialId,
  ].filter((x): x is string => typeof x === 'string' && x !== '');
  return [...new Set(ids)];
}

export const deedSignoffRouter = router({
  // Ungated probe so the client can decide whether to mount the panel.
  isEnabled: protectedProcedure.query(() => ({ mode: getD3SignoffMode() })),

  // The comparison the attorney reviews: extracted source text/facts (NC-D3-1 honest labeling) vs the assembled
  // draft, per field, with status. Display values are returned for HUMAN comparison; the record stores hashes.
  getComparison: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ ctx, input }) => {
      assertEnabled();
      const { version, sourceFacts, draft, observe } = await loadDeedContext(ctx.userId, input.documentId);
      const contentHash = hashDeedContent(version.content);
      const existing = await getValidDeedSignoffForVersion(ctx.userId, version.id, contentHash);
      const fields = observe.result.fields.map((f) => {
        if (f.field === 'legal_description') {
          return { field: f.field, status: f.status, sourceValue: sourceFacts.legalDescription.value, draftValue: draft.legalDescription, provenanceClass: f.provenanceClass };
        }
        if (f.field === 'parcel_id') {
          return { field: f.field, status: f.status, sourceValue: sourceFacts.parcelId.value, draftValue: draft.parcelId, provenanceClass: f.provenanceClass };
        }
        return { field: f.field, status: f.status, sourceValue: null, draftValue: null, provenanceClass: f.provenanceClass };
      });
      return {
        documentVersionId: version.id,
        tier: observe.result.tier,
        alreadySignedOff: existing !== null,
        partiesCompared: observe.partiesCompared,
        extractionNotes: observe.extractionNotes,
        comparatorVersion: observe.result.comparatorVersion,
        // NC-D3-1: this is the EXTRACTED source, not "the source document".
        sourceLabel: 'extracted source text / facts',
        fields,
      };
    }),

  // Record the sign-off. NC-D3-3: hard-block -> refuse; overridable -> require the high-friction override.
  // NC-D3-1: the dual-prong attestation (vs-original + not-OCR-only) is required in every case.
  record: protectedProcedure
    .input(
      z.object({
        documentId: z.string(),
        documentVersionId: z.string(),
        attestations: z.object({ attorneyAttestedVsOriginal: z.boolean(), notOcrOnly: z.boolean() }),
        override: z.object({ reasonCode: z.string().min(1), reasonText: z.string().nullable() }).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const mode = assertEnabled();
      const { doc, version, sourceFacts, observe } = await loadDeedContext(ctx.userId, input.documentId);
      // Sign off on the CURRENT version only (a stale version means the deed changed under the attorney).
      if (version.id !== input.documentVersionId) {
        throw new TRPCError({ code: 'CONFLICT', message: 'D3_VERSION_STALE' });
      }

      const tier = observe.result.tier;
      // PURE decision (NC-D3-1 dual-prong + NC-D3-3 three-tier). hard-block -> refuse; missing attestation ->
      // refuse; overridable without override -> refuse; else pass/overridden.
      const decision = evaluateSignoffDecision({
        tier,
        attorneyAttestedVsOriginal: input.attestations.attorneyAttestedVsOriginal,
        notOcrOnly: input.attestations.notOcrOnly,
        hasOverride: Boolean(input.override),
      });
      if (!decision.ok) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: decision.code });
      }
      const verdict = decision.verdict;
      const overrideRecord =
        verdict === 'overridden' && input.override
          ? { reasonCode: input.override.reasonCode, reasonText: input.override.reasonText }
          : null;

      const comparatorPassed = tier === 'pass';
      const assembledContentHash = hashDeedContent(version.content);
      const sourceFactsHash = hashSourceFacts({
        legal: sourceFacts.legalDescription.value,
        parcel: sourceFacts.parcelId.value,
        owners: sourceFacts.granteeOfRecord.values,
      });
      const attestations = {
        comparatorPassed,
        attorneyAttestedVsOriginal: input.attestations.attorneyAttestedVsOriginal,
        notOcrOnly: input.attestations.notOcrOnly,
      };
      const comparison = {
        fields: observe.result.fields, // hashes + statuses (NC-1: no text)
        sourceMaterialIds: sourceMaterialIds(sourceFacts),
        snapshotHash: hashDeedContent(JSON.stringify(observe.result.fields)),
      };

      const signoffId = await insertDeedSignoff({
        userId: ctx.userId,
        matterId: doc.matterId,
        documentId: doc.id,
        documentVersionId: version.id,
        gateMode: mode,
        verdict,
        comparatorPassed,
        comparatorVersion: D3_COMPARATOR_VERSION,
        assembledContentHash,
        sourceFactsHash,
        forkProvenance: D3_FORK_PROVENANCE,
        attestations,
        comparison,
        override: overrideRecord,
        attorneyUserId: ctx.userId,
      });

      // Fork C: mirror the sign-off as an attorney disposition in the append-only audit stream.
      await insertAuditEvent({
        userId: ctx.userId,
        matterId: doc.matterId,
        documentId: doc.id,
        versionId: version.id,
        eventType: 'disposition',
        actor: 'attorney',
        summary: `D3 source-extracted-facts sign-off (${verdict})`,
        targetType: 'deed_signoff',
        targetId: signoffId,
        action: verdict,
        rationale: overrideRecord?.reasonText ?? null,
        payload: { tier, comparatorVersion: D3_COMPARATOR_VERSION, gateMode: mode },
      });

      return { signoffId, verdict };
    }),
});
