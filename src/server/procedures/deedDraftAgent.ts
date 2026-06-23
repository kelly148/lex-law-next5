/**
 * deedDraftAgent.ts — DEED-DRAFT-AGENT-1 Inc 1c: the wiring procedure.
 *
 * Takes a matter + attorney-provided gift facts, consolidates the OCR-B1 deed-ingest extraction across the
 * matter's materials (deedSourceFacts), DETERMINISTICALLY assembles a house-style Deed of Gift
 * (deedGiftAssembler — PURE, no LLM, no egress), and PERSISTS it as a standard documents/versions record so it
 * flows through the EXISTING review/finalize + house-style .docx export path (no bespoke export needed).
 *
 * Gated three ways, all fail-closed: (1) DEED_DRAFT_AGENT_ENABLED (default OFF) — the whole surface is dormant
 * when off; (2) matter OWNERSHIP (getMatterById is owner-scoped); (3) the conflicts-at-intake gate — the same
 * advance-to-drafting gate document.create enforces (resolvePostureDraftingGate when CONFLICT_GATE_ENABLED,
 * else the legacy undispositioned-blocker check). The FIRE §7 spine lives in the assembler: verbatim legal,
 * [[ ]] placeholders (never fabricated), exemption-safe granting verb + Deed-of-Gift face statement, attorney
 * decides. This procedure NEVER finalizes, records, or sends — it only creates a DRAFT (workflowState
 * 'drafting') the attorney reviews/edits.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isDeedDraftAgentEnabled, isConflictGateEnabled } from '../config/featureFlags.js';
import { getMatterById } from '../db/queries/matters.js';
import { listMaterialsForMatter } from '../db/queries/materials.js';
import { insertDocument, updateDocumentCurrentVersion } from '../db/queries/documents.js';
import { getNextVersionNumber, insertVersion } from '../db/queries/versions.js';
import { resolvePostureDraftingGate } from '../conflicts/postureGate.js';
import { hasUndispositionedBlocker } from '../db/queries/conflicts.js';
import { consolidateDeedSourceFacts, type DeedSourceFacts } from '../deed/deedSourceFacts.js';
import { assembleGiftDeed, type GiftDeedInput, type GiftDeedDraft } from '../deed/deedGiftAssembler.js';
import { buildGiftDrafterNotes } from '../deed/deedGiftNotes.js';

const partySchema = z.object({
  name: z.string().min(1).max(200),
  descriptor: z.string().max(200).optional(),
});

const createGiftDraftInput = z.object({
  matterId: z.string().uuid(),
  grantors: z.array(partySchema).max(20).default([]),
  grantees: z.array(partySchema).max(20).default([]),
  granteesAreMarriedCouple: z.boolean().optional(),
  vestingOverride: z.string().max(120).nullable().optional(),
  warranty: z.string().max(200).optional(),
  fileNumber: z.string().max(120).nullable().optional(),
  granteeAddress: z.string().max(400).nullable().optional(),
  locality: z.string().max(200).nullable().optional(),
  derivationReference: z.string().max(400).nullable().optional(),
  returnTo: z.string().max(200).nullable().optional(),
  title: z.string().min(1).max(256).optional(),
});

/** PURE: consolidate a matter's materials + assemble the gift draft. Exported for direct (no-DB) testing. */
export function buildGiftDraft(
  materials: readonly { id: string; textContent: string | null }[],
  gift: GiftDeedInput,
): { facts: DeedSourceFacts; draft: GiftDeedDraft } {
  const facts = consolidateDeedSourceFacts(materials.map((m) => ({ materialId: m.id, textContent: m.textContent })));
  const draft = assembleGiftDeed(facts, gift);
  return { facts, draft };
}

export const deedDraftAgentRouter = router({
  /** Ungated probe: whether the deed-draft agent is enabled (for the client to show/hide the entry point). */
  isEnabled: protectedProcedure.query(() => ({ enabled: isDeedDraftAgentEnabled() })),

  /**
   * Assemble a Deed of Gift draft from the matter's materials + attorney input, persisted as a draft document.
   * Fail-closed on the flag, ownership, and the conflicts-at-intake gate. Returns the new documentId (which
   * the existing document review/finalize/.docx-export surface then handles) plus the draft's resolution
   * status (placeholders + leads + notes) so the attorney sees exactly what remains to fill.
   */
  createGiftDraft: protectedProcedure.input(createGiftDraftInput).mutation(async ({ ctx, input }) => {
    if (!isDeedDraftAgentEnabled()) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DEED_DRAFT_AGENT_DISABLED: the deed-draft agent is not enabled.' });
    }

    const matter = await getMatterById(input.matterId, ctx.userId);
    if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
    if (matter.archivedAt !== null) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'MATTER_ARCHIVED' });

    // Advance-to-drafting conflicts gate — identical to document.create (the only retained gate). Fail-closed.
    if (isConflictGateEnabled()) {
      const gate = await resolvePostureDraftingGate(input.matterId, ctx.userId);
      if (!gate.allowed) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `CONFLICTS_NOT_CLEARED: this matter is not conflict-cleared for drafting (${gate.blockingReasons.join(', ')}). Run the conflicts check, add and confirm the client party, and disposition any blocker — or record an attested gate override — before advancing.`,
        });
      }
    } else if (await hasUndispositionedBlocker(input.matterId, ctx.userId)) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'CONFLICTS_BLOCKER_UNDISPOSITIONED: an undispositioned blocker-severity conflict must be cleared, screened, or declined before advancing this matter to drafting.',
      });
    }

    const materials = await listMaterialsForMatter(input.matterId, ctx.userId);
    const giftInput: GiftDeedInput = {
      grantors: input.grantors.map((p) => ({ name: p.name, descriptor: p.descriptor })),
      grantees: input.grantees.map((p) => ({ name: p.name, descriptor: p.descriptor })),
      granteesAreMarriedCouple: input.granteesAreMarriedCouple,
      vestingOverride: input.vestingOverride,
      warranty: input.warranty,
      fileNumber: input.fileNumber,
      granteeAddress: input.granteeAddress,
      locality: input.locality,
      derivationReference: input.derivationReference,
      returnTo: input.returnTo,
    };
    const { facts, draft } = buildGiftDraft(
      materials.map((m) => ({ id: m.id, textContent: m.textContent })),
      giftInput,
    );
    // Inc 2: the deterministic drafter's-notes (advisory + exemption verification + diligence), grounded on the
    // verified KB. Stored in the document NOTES field (NOT the version content) — "delete before recording", so
    // the recordable deed body and its B6 floor stay clean.
    const drafterNotes = buildGiftDrafterNotes(facts, giftInput, draft);

    const title = (input.title ?? '').trim() || 'Deed of Gift';
    const docNotes = [
      'Generated by DEED-DRAFT-AGENT-1 (deterministic). The attorney reviews/edits/approves; this draft is never auto-recorded, filed, or sent.',
      ...draft.notes,
      draft.factsResolved
        ? 'All facts resolved; the draft passes the B6 annotation floor (subject to the recordability gates + execution).'
        : `${draft.placeholders.length} unresolved [[ ]] placeholder(s) remain — fill them before this can record (the B6 gate blocks bracketed tokens).`,
      '',
      drafterNotes.rendered,
    ].join('\n');

    const doc = await insertDocument({
      userId: ctx.userId,
      matterId: input.matterId,
      title,
      documentType: 'deed',
      customTypeLabel: null,
      draftingMode: 'iterative',
      templateBindingStatus: 'bound',
      templateVersionId: null,
      templateSnapshot: null,
      variableMap: null,
      workflowState: 'drafting',
      currentVersionId: null,
      officialSubstantiveVersionNumber: null,
      officialFinalVersionNumber: null,
      completedAt: null,
      archivedAt: null,
      notes: docNotes,
    });

    const versionNumber = await getNextVersionNumber(doc.id, ctx.userId);
    const version = await insertVersion({
      userId: ctx.userId,
      documentId: doc.id,
      versionNumber,
      content: draft.text,
      generatedByJobId: null,
      iterationNumber: 1,
    });
    await updateDocumentCurrentVersion(doc.id, ctx.userId, version.id);

    return {
      documentId: doc.id,
      versionId: version.id,
      title,
      factsResolved: draft.factsResolved,
      placeholders: draft.placeholders,
      vesting: draft.vesting,
      warranty: draft.warranty,
      b6: draft.b6,
      notes: draft.notes,
      drafterNotes: drafterNotes.notes,
      warnings: [...facts.warnings, ...draft.warnings],
    };
  }),
});
