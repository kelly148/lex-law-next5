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
import {
  buildEngagementLetter,
  ENGAGEMENT_LETTER_DOC_TYPE,
  type EngagementLetterInput,
  type EngagementLetterDraft,
} from '../deed/deedEngagementLetter.js';

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

// ── Inc 3: companion engagement letter ──────────────────────────────────────────────

const engagementLetterFields = z
  .object({
    date: z.string().max(120).nullable().optional(),
    clientNames: z.array(z.string().min(1).max(200)).max(20).optional(),
    clientAddress: z.string().max(600).nullable().optional(),
    salutation: z.string().max(200).nullable().optional(),
    propertyAddress: z.string().max(400).nullable().optional(),
    reAction: z.string().max(300).nullable().optional(),
    recordingCounty: z.string().max(200).nullable().optional(),
    feeAmount: z.string().max(60).nullable().optional(),
    recipientNames: z.array(z.string().min(1).max(200)).max(20).optional(),
    recipientPronoun: z.object({ subject: z.string().max(20), possessive: z.string().max(20) }).nullable().optional(),
    signatoryNames: z.array(z.string().min(1).max(200)).max(20).optional(),
    signingParties: z.string().max(120).nullable().optional(),
    includeDueOnSale: z.boolean().optional(),
    includeBasisStepUp: z.boolean().optional(),
    firmRecording: z.boolean().optional(),
  })
  .default({});

type RawLetterFields = z.infer<typeof engagementLetterFields>;

const createEngagementLetterInput = createGiftDraftInput.extend({ letter: engagementLetterFields });

/**
 * PURE: resolve the attorney's raw letter fields into a complete EngagementLetterInput, applying the deed-aware
 * defaults — the represented client(s) default to the deed grantor(s) (the donor is the firm's client in a
 * gift); the non-client recipient(s) (separate-rep trigger) default to the grantee(s) NOT in the client set;
 * the resulting title-holders for the vesting sentence are the grantee(s). Exported for direct testing.
 */
export function resolveEngagementLetterInput(gift: GiftDeedInput, raw: RawLetterFields): EngagementLetterInput {
  const grantorNames = gift.grantors.map((g) => g.name.trim()).filter((n) => n.length > 0);
  const granteeNames = gift.grantees.map((g) => g.name.trim()).filter((n) => n.length > 0);
  const clientNames = raw.clientNames && raw.clientNames.length > 0 ? raw.clientNames.map((n) => n.trim()) : grantorNames;
  const clientSet = new Set(clientNames.map((n) => n.toLowerCase()));
  const recipientNames =
    raw.recipientNames !== undefined ? raw.recipientNames.map((n) => n.trim()) : granteeNames.filter((n) => !clientSet.has(n.toLowerCase()));
  const recordingCounty = raw.recordingCounty !== undefined ? raw.recordingCounty : gift.locality;

  return {
    clientNames,
    granteeNames,
    recipientNames,
    ...(raw.date !== undefined ? { date: raw.date } : {}),
    ...(raw.clientAddress !== undefined ? { clientAddress: raw.clientAddress } : {}),
    ...(raw.salutation !== undefined ? { salutation: raw.salutation } : {}),
    ...(raw.propertyAddress !== undefined ? { propertyAddress: raw.propertyAddress } : {}),
    ...(raw.reAction !== undefined ? { reAction: raw.reAction } : {}),
    ...(recordingCounty !== undefined ? { recordingCounty } : {}),
    ...(raw.feeAmount !== undefined ? { feeAmount: raw.feeAmount } : {}),
    ...(raw.recipientPronoun !== undefined ? { recipientPronoun: raw.recipientPronoun } : {}),
    ...(raw.signatoryNames !== undefined ? { signatoryNames: raw.signatoryNames.map((n) => n.trim()) } : {}),
    ...(raw.signingParties !== undefined ? { signingParties: raw.signingParties } : {}),
    ...(raw.includeDueOnSale !== undefined ? { includeDueOnSale: raw.includeDueOnSale } : {}),
    ...(raw.includeBasisStepUp !== undefined ? { includeBasisStepUp: raw.includeBasisStepUp } : {}),
    ...(raw.firmRecording !== undefined ? { firmRecording: raw.firmRecording } : {}),
  };
}

/** PURE: re-derive the companion deed (so deed type / vesting / exemption are identical to createGiftDraft) and
 *  assemble the engagement letter from it. Exported for direct (no-DB) testing. */
export function buildEngagementLetterDraft(
  materials: readonly { id: string; textContent: string | null }[],
  gift: GiftDeedInput,
  letter: EngagementLetterInput,
): { facts: DeedSourceFacts; deed: GiftDeedDraft; letter: EngagementLetterDraft } {
  const { facts, draft } = buildGiftDraft(materials, gift);
  const letterDraft = buildEngagementLetter(facts, draft, letter);
  return { facts, deed: draft, letter: letterDraft };
}

/** Shared fail-closed gate for the deed-draft agent's write procedures: flag, matter ownership (+ not
 *  archived), and the conflicts-at-intake gate — identical to document.create. Throws; returns the matter. */
async function assertDeedDraftingAllowed(userId: string, matterId: string): Promise<void> {
  if (!isDeedDraftAgentEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DEED_DRAFT_AGENT_DISABLED: the deed-draft agent is not enabled.' });
  }
  const matter = await getMatterById(matterId, userId);
  if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
  if (matter.archivedAt !== null) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'MATTER_ARCHIVED' });

  // Advance-to-drafting conflicts gate — identical to document.create (the only retained gate). Fail-closed.
  if (isConflictGateEnabled()) {
    const gate = await resolvePostureDraftingGate(matterId, userId);
    if (!gate.allowed) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `CONFLICTS_NOT_CLEARED: this matter is not conflict-cleared for drafting (${gate.blockingReasons.join(', ')}). Run the conflicts check, add and confirm the client party, and disposition any blocker — or record an attested gate override — before advancing.`,
      });
    }
  } else if (await hasUndispositionedBlocker(matterId, userId)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'CONFLICTS_BLOCKER_UNDISPOSITIONED: an undispositioned blocker-severity conflict must be cleared, screened, or declined before advancing this matter to drafting.',
    });
  }
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
    await assertDeedDraftingAllowed(ctx.userId, input.matterId);

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

  /**
   * Assemble a COMPANION Mason engagement letter for the matter, persisted as a draft document. Same three
   * fail-closed gates as createGiftDraft (flag, ownership, conflicts-at-intake). Deterministic TEMPLATE-FILL
   * (deedEngagementLetter): the verbatim disclaimer/representation spine is emitted from constants; [[ ]] slots
   * are the only fill points; the fee is NEVER invented. The deed type / vesting / exemption are re-derived
   * from the SAME companion gift draft (buildEngagementLetterDraft -> buildGiftDraft), so the letter and the
   * deed cannot disagree. Persists documentType 'engagement_letter' (which the export routes to the Bien-Aime
   * formatter), workflowState 'drafting' — NEVER finalizes, records, or sends.
   */
  createEngagementLetter: protectedProcedure.input(createEngagementLetterInput).mutation(async ({ ctx, input }) => {
    await assertDeedDraftingAllowed(ctx.userId, input.matterId);

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
    const letterInput = resolveEngagementLetterInput(giftInput, input.letter);
    const { letter } = buildEngagementLetterDraft(
      materials.map((m) => ({ id: m.id, textContent: m.textContent })),
      giftInput,
      letterInput,
    );

    const title = (input.title ?? '').trim() || `Engagement Letter — ${letter.crossLink.deedType}`;
    const docNotes = [
      'Generated by DEED-DRAFT-AGENT-1 Inc 3 (deterministic template-fill). The attorney reviews/edits/signs; this letter is a DRAFT and is never auto-sent.',
      ...letter.notes,
      letter.spine.intact
        ? 'Protected spine intact and all spine slots resolved.'
        : `${letter.placeholders.length} unresolved [[ ]] placeholder(s) remain (including ${letter.spine.unresolvedFields.length} in the protected spine) — fill them before sending.`,
    ].join('\n');

    const doc = await insertDocument({
      userId: ctx.userId,
      matterId: input.matterId,
      title,
      documentType: ENGAGEMENT_LETTER_DOC_TYPE,
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
      content: letter.text,
      generatedByJobId: null,
      iterationNumber: 1,
    });
    await updateDocumentCurrentVersion(doc.id, ctx.userId, version.id);

    return {
      documentId: doc.id,
      versionId: version.id,
      title,
      spineIntact: letter.spine.intact,
      separateRepIncluded: letter.separateRepIncluded,
      conditionals: letter.conditionals,
      crossLink: letter.crossLink,
      placeholders: letter.placeholders,
      spine: letter.spine,
      notes: letter.notes,
      warnings: letter.warnings,
    };
  }),
});
