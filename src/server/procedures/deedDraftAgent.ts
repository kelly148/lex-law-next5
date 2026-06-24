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
import { getMatterById, insertMatter } from '../db/queries/matters.js';
import { listMaterialsForMatter } from '../db/queries/materials.js';
import { getDeedType, listAvailableDeedTypes } from '../deed/deedTypeRegistry.js';
import { insertDocument, updateDocumentCurrentVersion, updateDocumentNotes, getDocumentById } from '../db/queries/documents.js';
import { getNextVersionNumber, insertVersion, getLatestVersionForDocument } from '../db/queries/versions.js';
import { resolvePostureDraftingGate } from '../conflicts/postureGate.js';
import { hasUndispositionedBlocker } from '../db/queries/conflicts.js';
import { getFirmConflictPolicy, setFirmConflictPolicy } from '../db/queries/conflictPolicy.js';
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

// Inc 4 — the refine-loop input: an existing deed-agent document + the attorney's REVISED gift input (same gift
// fields; the attorney's adopt/dismiss-per-note decisions are expressed as revised inputs — e.g. adopting the
// warranty note = setting `warranty:'Special Warranty'`). One mutation call = one new version (attorney-initiated;
// the agent never auto-iterates or auto-adopts).
const regenerateDeedDraftInput = createGiftDraftInput.extend({
  documentId: z.string().uuid(),
});

// QD-1 — Quick Deed generate input: the auto-created owning matterId + the selected deed-type registry key +
// the SAME structured gift fields as createGiftDraft (minus matterId, which the Quick Deed surface supplies from
// quickDeed.create). v1 dispatches ONLY `deed_of_gift`; any other registered key is rejected (not yet wired).
const quickDeedGenerateInput = createGiftDraftInput.extend({
  deedType: z.string().min(1).max(64),
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

/** PURE: map the validated tRPC gift input shape onto the GiftDeedInput the assembler/notes consume. Shared by
 *  createGiftDraft and regenerateDeedDraft so a regeneration is byte-identical to a first draft for the same
 *  fields. Exported for direct (no-DB) testing. */
export function toGiftDeedInput(input: {
  grantors: { name: string; descriptor?: string | undefined }[];
  grantees: { name: string; descriptor?: string | undefined }[];
  granteesAreMarriedCouple?: boolean | undefined;
  vestingOverride?: string | null | undefined;
  warranty?: string | undefined;
  fileNumber?: string | null | undefined;
  granteeAddress?: string | null | undefined;
  locality?: string | null | undefined;
  derivationReference?: string | null | undefined;
  returnTo?: string | null | undefined;
}): GiftDeedInput {
  return {
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
}

/** PURE: the document `notes` text body (the "delete before recording" page + the assembler's reconciliation
 *  notes), built identically on first draft and on every regeneration so the re-spotted notes always reflect the
 *  current (revised) input. Exported for direct (no-DB) testing.
 *
 *  `extraNotes` (QD-1) — additional non-blocking record notes prepended into the SAME free-text notes field
 *  (NO new column/enum). The matter-scoped createGiftDraft / regenerateDeedDraft pass nothing, so their notes
 *  body is byte-for-byte unchanged; Quick Deed passes the "No conflicts check performed (Quick Deed mode)."
 *  stamp here when it bypasses the conflicts gate (spec §5c). */
export function buildDeedDocNotes(draft: GiftDeedDraft, rendered: string, extraNotes: readonly string[] = []): string {
  return [
    'Generated by DEED-DRAFT-AGENT-1 (deterministic). The attorney reviews/edits/approves; this draft is never auto-recorded, filed, or sent.',
    ...extraNotes,
    ...draft.notes,
    draft.factsResolved
      ? 'All facts resolved; the draft passes the B6 annotation floor (subject to the recordability gates + execution).'
      : `${draft.placeholders.length} unresolved [[ ]] placeholder(s) remain — fill them before this can record (the B6 gate blocks bracketed tokens).`,
    '',
    rendered,
  ].join('\n');
}

/** The QD-1 record stamp written into the document `notes` (free-text) when Quick Deed bypasses the
 *  conflicts-at-intake gate, so the audit trail is HONEST about the absence (spec §5c). A plain string —
 *  no new column/enum. */
export const QUICK_DEED_NO_CONFLICTS_NOTE = 'No conflicts check performed (Quick Deed mode).';

/** The registry key for the Deed of Gift (the only built Quick Deed dispatch in v1). */
export const QUICK_DEED_GIFT_TYPE = 'deed_of_gift';

/** The SINGLE source of truth for which registry keys Quick Deed can GENERATE today. The selector's
 *  enabled set (listDeedTypes.quickDeedGenerates) AND the generate dispatch guard both read this set, so
 *  they cannot drift as more categories are wired (add the key here and both update together). v1 = gift only. */
export const WIRED_QUICK_DEED_TYPES: ReadonlySet<string> = new Set([QUICK_DEED_GIFT_TYPE]);

/** Whether Quick Deed can generate the given deed-type key today (selector + dispatch share this predicate). */
export function isQuickDeedTypeWired(deedType: string): boolean {
  return WIRED_QUICK_DEED_TYPES.has(deedType);
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
 *  archived), and the conflicts-at-intake gate — identical to document.create. Throws on any failure;
 *  returns `{ conflictsBypassed }` — the SINGLE source of truth for "was the conflicts gate skipped".
 *
 *  `bypassConflicts` (QD-1 seam) — when true, the flag + ownership + not-archived checks STILL run
 *  (always fail-closed), but the conflicts-at-intake gate is SKIPPED. This is the Quick Deed path's
 *  default-OFF conflicts posture (spec §5): the auto-created lightweight record never has a confirmed
 *  client party, so enforcing the gate would hard-block every Quick Deed. The matter-scoped procedures
 *  (createGiftDraft / regenerateDeedDraft / createEngagementLetter) NEVER pass this and IGNORE the
 *  return — their conflicts enforcement is byte-for-byte unchanged. QD-2 wires the caller's
 *  `bypassConflicts` to a firm-level toggle (quickDeed.generate reads firmPolicy.deedConflictsEnforced);
 *  because quickDeed.generate writes the "no conflicts check" stamp IFF this returns `conflictsBypassed`,
 *  the skip and the stamp can never drift.
 *
 *  `forceAffirmativeConflicts` (QD-2 — HONEST-ON seam) — when true, the AFFIRMATIVE posture gate
 *  (resolvePostureDraftingGate) runs UNCONDITIONALLY, regardless of isConflictGateEnabled(). Without this,
 *  withdrawing the bypass while the GLOBAL conflict gate is OFF (the prod default) would fall through to the
 *  WEAK legacy hasUndispositionedBlocker check, which a fresh check-less Quick Deed auto-matter passes
 *  VACUOUSLY — so an "enforced" Quick Deed would silently GENERATE with no real clearance and no stamp,
 *  contradicting the Settings promise. With it forced, an "enforced" Quick Deed runs the real fail-closed
 *  gate and the check-less auto-matter is BLOCKED with CONFLICTS_NOT_CLEARED (honest). The matter-scoped
 *  procedures pass NEITHER seam (both undefined) → their `if (isConflictGateEnabled())` behavior is
 *  byte-for-byte unchanged. */
async function assertDeedDraftingAllowed(
  userId: string,
  matterId: string,
  opts: { bypassConflicts?: boolean; forceAffirmativeConflicts?: boolean } = {},
): Promise<{ conflictsBypassed: boolean }> {
  if (!isDeedDraftAgentEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DEED_DRAFT_AGENT_DISABLED: the deed-draft agent is not enabled.' });
  }
  const matter = await getMatterById(matterId, userId);
  if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
  if (matter.archivedAt !== null) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'MATTER_ARCHIVED' });

  // QD-1 conflicts BYPASS seam: Quick Deed mode skips the conflicts-at-intake gate by default (spec §5).
  if (opts.bypassConflicts) return { conflictsBypassed: true };

  // Advance-to-drafting conflicts gate — identical to document.create (the only retained gate). Fail-closed.
  // QD-2 HONEST-ON: forceAffirmativeConflicts makes the affirmative posture gate run regardless of the global
  // flag, so an "enforced" Quick Deed can never fall through to the vacuous legacy-blocker path. Existing
  // callers pass forceAffirmativeConflicts=undefined → this reads exactly `if (isConflictGateEnabled())`.
  if (opts.forceAffirmativeConflicts || isConflictGateEnabled()) {
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
  return { conflictsBypassed: false };
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
    const giftInput = toGiftDeedInput(input);
    const { facts, draft } = buildGiftDraft(
      materials.map((m) => ({ id: m.id, textContent: m.textContent })),
      giftInput,
    );
    // Inc 2: the deterministic drafter's-notes (advisory + exemption verification + diligence), grounded on the
    // verified KB. Stored in the document NOTES field (NOT the version content) — "delete before recording", so
    // the recordable deed body and its B6 floor stay clean.
    const drafterNotes = buildGiftDrafterNotes(facts, giftInput, draft);

    const title = (input.title ?? '').trim() || 'Deed of Gift';
    const docNotes = buildDeedDocNotes(draft, drafterNotes.rendered);

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
   * Inc 4 — the attorney-driven REFINE LOOP. Re-runs the deterministic gift assembler + issue-spotter against an
   * EXISTING deed document with the attorney's REVISED gift input (their adopt/dismiss-per-note decisions,
   * expressed as revised fields), and records the result as a NEW VERSION on the SAME document — so the version
   * history IS the refine-loop provenance (spec §2b). Each call = one new version (attorney-initiated; the agent
   * NEVER auto-iterates or auto-adopts). Reuses the existing version path (getNextVersionNumber + insertVersion +
   * updateDocumentCurrentVersion) and updates the document's `notes` field with the freshly re-spotted notes
   * (updateDocumentNotes — additive, no schema change). Re-runs the SAME three fail-closed gates (flag, ownership,
   * conflicts-at-intake) and additionally verifies the target is an owned 'deed' document in this matter that is
   * STILL IN DRAFTING (so a regenerate can never repoint currentVersionId off an accepted/finalizing/complete or
   * archived official version). The verbatim legal survives every regeneration (the assembler guarantees it).
   * NEVER finalizes, records, or sends — it only adds a new draft version the attorney reviews/edits.
   */
  regenerateDeedDraft: protectedProcedure.input(regenerateDeedDraftInput).mutation(async ({ ctx, input }) => {
    await assertDeedDraftingAllowed(ctx.userId, input.matterId);

    // The target document must exist, be owned (getDocumentById is owner-scoped), live in THIS matter, be a
    // 'deed' document, and still be IN DRAFTING — fail-closed, never operate on a foreign / wrong-type document
    // or repoint the current version off an accepted/official/archived state.
    const existing = await getDocumentById(input.documentId, ctx.userId);
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
    if (existing.matterId !== input.matterId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'DOCUMENT_MATTER_MISMATCH: the document does not belong to this matter.' });
    }
    if (existing.documentType !== 'deed') {
      // The deed-draft agent persists deeds with documentType 'deed'; there is no cheaper deed-agent-only
      // provenance latch on the row, so the invariant is the honest one: any OWNED 'deed' document in this
      // matter that is still in drafting (NOT specifically "agent-authored"). Owner+matter-scoped + drafting-only
      // (below) keep the blast radius low.
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'NOT_A_DEED_DOCUMENT: regenerate applies only to a deed document.' });
    }
    if (existing.archivedAt !== null) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DOCUMENT_ARCHIVED' });
    // DRAFTING-ONLY gate: 'substantively_accepted' / 'finalizing' / 'complete' / 'archived' all REJECT — a
    // regenerate must never add a version (and repoint currentVersionId) onto a document past the drafting phase.
    if (existing.workflowState !== 'drafting') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DOCUMENT_NOT_DRAFTING: regenerate applies only to a document still in drafting.' });
    }

    const materials = await listMaterialsForMatter(input.matterId, ctx.userId);
    const giftInput = toGiftDeedInput(input);
    const { facts, draft } = buildGiftDraft(
      materials.map((m) => ({ id: m.id, textContent: m.textContent })),
      giftInput,
    );
    // Re-spot the issue-spotting notes against the REVISED input (e.g. a now-Special warranty re-spots note 3b).
    const drafterNotes = buildGiftDrafterNotes(facts, giftInput, draft);
    const docNotes = buildDeedDocNotes(draft, drafterNotes.rendered);

    // Add a NEW VERSION to the EXISTING document — a normal new version (incrementing versionNumber AND
    // iterationNumber), so the version history records each refine-loop iteration as provenance. LOCKSTEP
    // ASSUMPTION: for a deed-agent document in drafting, createGiftDraft seeds iterationNumber=1 at versionNumber
    // 1 and every regenerate increments BOTH together, so max(versionNumber) === max(iterationNumber). The
    // versions table exposes no MAX(iterationNumber) read, so we derive the next iteration from the latest
    // version (ordered by versionNumber DESC); the lockstep keeps the two in sync for this write path.
    const latest = await getLatestVersionForDocument(input.documentId, ctx.userId);
    const versionNumber = await getNextVersionNumber(input.documentId, ctx.userId);
    const iterationNumber = (latest?.iterationNumber ?? 0) + 1;
    const version = await insertVersion({
      userId: ctx.userId,
      documentId: input.documentId,
      versionNumber,
      content: draft.text,
      generatedByJobId: null,
      iterationNumber,
    });
    await updateDocumentCurrentVersion(input.documentId, ctx.userId, version.id);
    // Refresh the document notes so the "delete before recording" page reflects the re-spotted notes.
    await updateDocumentNotes(input.documentId, ctx.userId, docNotes);

    return {
      documentId: input.documentId,
      versionId: version.id,
      versionNumber,
      iterationNumber,
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

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// DEED-DRAFT-AGENT-1 QUICK DEED (QD-1) — the deed-type-agnostic fast-lane SURFACE backend.
//
// A top-level, single-screen "duck in and make a deed" path (spec docs/deed/DEED_QUICK_MODE_spec.md). It
// AUTO-CREATES a lightweight owning matter behind the screen (so the document persists through the standard
// documents/versions path — retention/audit preserved; spec §4) and BYPASSES the conflicts-at-intake gate by
// default (spec §5). It REUSES the existing gift draft core verbatim — same assembler, same verbatim-legal /
// [[ ]]-placeholder / never-send guardrails (spec §6). v1 generates ONLY the Deed of Gift; the selector lists
// the whole registry (other categories disabled, "wiring pending") so they enable here as they ship — with NO
// surface rework. Schema-free: auto-matter via the existing insertMatter + a title; conflicts default-off via
// the assertDeedDraftingAllowed bypass seam; the "no conflicts check performed" stamp lives in the existing
// free-text document notes field. No new column/table/enum/migration.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════

/** PURE: today's date as YYYY-MM-DD in the SERVER's local time (used in the auto-created matter title). */
function quickDeedDateStamp(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const quickDeedRouter = router({
  /** The available deed types for the surface's type selector — the WHOLE registry so the UI can show the
   *  unbuilt categories as disabled, plus the per-entry status so the selector knows which to enable. Flag-
   *  gated (fail-closed) so the catalog is dark when the agent is off. v1 generation supports only gift.
   *  (Flag exposure for the nav/page is deedDraftAgent.isEnabled — Quick Deed has no separate probe.) */
  listDeedTypes: protectedProcedure.query(() => {
    if (!isDeedDraftAgentEnabled()) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DEED_DRAFT_AGENT_DISABLED: the deed-draft agent is not enabled.' });
    }
    // The Quick Deed v1 dispatch wires ONLY gift; every other registered key lists but does not generate.
    // `quickDeedGenerates` reads the SAME WIRED_QUICK_DEED_TYPES set the generate guard uses (no drift).
    return listAvailableDeedTypes().map((t) => ({
      key: t.key,
      title: t.title,
      category: t.category,
      status: t.status,
      // Quick-Deed generate-wiring status (distinct from the assembler's registry `status`).
      quickDeedGenerates: isQuickDeedTypeWired(t.key),
    }));
  }),

  /**
   * Start a Quick Deed: AUTO-CREATE the lightweight owning matter (title "Quick Deed — YYYY-MM-DD") so the
   * existing matterId-keyed MaterialsDrawer can attach the vesting deed / tax record uploads (spec §3.1/§3.3)
   * and the document persists through the standard path. Flag-gated (fail-closed). Returns { matterId }. NO
   * conflicts gate is run here — the auto-matter is the Quick Deed default-OFF record (spec §5); a client
   * party is intentionally not auto-created/confirmed. Schema-free: just insertMatter + a title.
   */
  create: protectedProcedure.mutation(async ({ ctx }) => {
    if (!isDeedDraftAgentEnabled()) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DEED_DRAFT_AGENT_DISABLED: the deed-draft agent is not enabled.' });
    }
    const matter = await insertMatter({
      userId: ctx.userId,
      title: `Quick Deed — ${quickDeedDateStamp(new Date())}`,
    });
    return { matterId: matter.id };
  }),

  /**
   * Generate the deed for a Quick Deed matter. Flag + ownership (+ not-archived) are enforced fail-closed; the
   * conflicts-at-intake gate is BYPASSED (Quick Deed default-OFF, spec §5 — the bypass seam is
   * assertDeedDraftingAllowed({ bypassConflicts: true })). v1 dispatches ONLY the Deed of Gift; any other
   * registered registry key is rejected with QUICK_DEED_TYPE_NOT_WIRED. Reuses the EXACT gift core
   * (toGiftDeedInput + buildGiftDraft + buildGiftDrafterNotes + the insertDocument→version→current chain) so the
   * verbatim-legal / [[ ]]-placeholder / never-send guardrails are inherited unchanged. Stamps the non-blocking
   * "No conflicts check performed (Quick Deed mode)." note into the existing free-text document notes field.
   */
  generate: protectedProcedure.input(quickDeedGenerateInput).mutation(async ({ ctx, input }) => {
    // QD-2 conflicts posture: the firm-level toggle drives `bypassConflicts`. Read the firm policy via the
    // QUERY LAYER directly (getFirmConflictPolicy) — NOT the gated conflictPolicy router — because Quick Deed's
    // DEFAULT state is conflict-gate-OFF, so this read MUST work even when isConflictGateEnabled() is false.
    // The read is fail-closed-SAFE by construction (no row / malformed → DEFAULT_CONFLICT_POLICY, where
    // deedConflictsEnforced defaults to false = QD-1's bypass-and-stamp behavior). When the firm has turned
    // the toggle ON, the bypass is withdrawn and the real conflicts-at-intake gate runs.
    //
    // LOCKSTEP (unchanged from QD-1): assertDeedDraftingAllowed RETURNS whether it actually bypassed; the stamp
    // and the return field are both driven from that ONE value, so "skipped" and "stamped" can never drift.
    const firmPolicy = (await getFirmConflictPolicy(ctx.userId)).policy;
    const quickDeedConflictsEnforced = firmPolicy.deedConflictsEnforced;
    // Pass BOTH seams from the one firm toggle: OFF → bypass the gate + stamp (QD-1); ON → withdraw the bypass
    // AND force the affirmative posture gate to run REGARDLESS of isConflictGateEnabled() — so an "enforced"
    // Quick Deed can never silently fall through to the vacuous legacy-blocker check on the check-less
    // auto-matter (it is honestly BLOCKED with CONFLICTS_NOT_CLEARED, no unstamped deed).
    const { conflictsBypassed } = await assertDeedDraftingAllowed(ctx.userId, input.matterId, {
      bypassConflicts: !quickDeedConflictsEnforced,
      forceAffirmativeConflicts: quickDeedConflictsEnforced,
    });

    // Deed-type dispatch gate: the surface lists the whole registry, but v1 generation wires ONLY gift. The
    // wired set is shared with the selector (isQuickDeedTypeWired), so the two cannot drift.
    if (!isQuickDeedTypeWired(input.deedType)) {
      const known = getDeedType(input.deedType);
      const detail = known
        ? `${input.deedType} is registered but not yet wired for Quick Deed generation.`
        : `${input.deedType} is not a recognized deed type.`;
      throw new TRPCError({ code: 'BAD_REQUEST', message: `QUICK_DEED_TYPE_NOT_WIRED: ${detail}` });
    }

    const materials = await listMaterialsForMatter(input.matterId, ctx.userId);
    const giftInput = toGiftDeedInput(input);
    const { facts, draft } = buildGiftDraft(
      materials.map((m) => ({ id: m.id, textContent: m.textContent })),
      giftInput,
    );
    const drafterNotes = buildGiftDrafterNotes(facts, giftInput, draft);

    const title = (input.title ?? '').trim() || 'Deed of Gift';
    // The conflicts-bypass stamp (spec §5c) is written IFF the gate actually bypassed (single source of truth),
    // prepended into the SAME free-text notes field — schema-free.
    const conflictsNotes = conflictsBypassed ? [QUICK_DEED_NO_CONFLICTS_NOTE] : [];
    const docNotes = buildDeedDocNotes(draft, drafterNotes.rendered, conflictsNotes);

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
      matterId: input.matterId,
      versionId: version.id,
      title,
      // Sourced from the ACTUAL gate outcome (not the intent const): reports what really happened.
      conflictsBypassed,
      conflictsChecked: !conflictsBypassed,
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

  // ── QD-2: the firm-level "enforce conflicts for Quick Deed" admin toggle ──────────────────────────────────
  //
  // A deed-SPECIFIC, UNGATED-by-the-conflict-gate read/write of the deedConflictsEnforced firm field. CRITICAL
  // NUANCE: the existing conflictPolicy router gates every op behind isConflictGateEnabled(), but Quick Deed's
  // DEFAULT state is conflict-gate-OFF — so this toggle MUST be settable/readable EVEN WHEN that global gate is
  // off. We therefore add this deed-specific path here, gated ONLY on isDeedDraftAgentEnabled() (flag-dark) +
  // the firm/owner scope, reusing getFirmConflictPolicy / setFirmConflictPolicy under the hood. We do NOT relax
  // the conflictPolicy router's own gating — its posture-admin surface stays dark on prod independently.
  //
  // SAFEGUARD (a): firm-level, NOT per-user — the write goes through setFirmConflictPolicy keyed by the firm
  // owner (firmOwnerUserId = ctx.userId in single-tenant v1), the same firm scope the posture policy uses.

  /** Read the firm's current Quick-Deed conflicts-enforcement setting. Flag-gated (fail-closed); works
   *  regardless of isConflictGateEnabled() (reads the firm policy directly via the query layer, which is
   *  fail-closed-safe: no/malformed row → default, where deedConflictsEnforced defaults to false). */
  getConflictsSetting: protectedProcedure.query(async ({ ctx }) => {
    if (!isDeedDraftAgentEnabled()) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DEED_DRAFT_AGENT_DISABLED: the deed-draft agent is not enabled.' });
    }
    const { policy } = await getFirmConflictPolicy(ctx.userId); // v1: firmOwnerUserId = ctx.userId (firm scope)
    return { enforced: policy.deedConflictsEnforced };
  }),

  /**
   * Set the firm's Quick-Deed conflicts-enforcement toggle. Flag-gated (fail-closed); works regardless of
   * isConflictGateEnabled(). Reads the CURRENT firm policy (so we preserve transactionalPosture / schemaVersion
   * and only flip the deed field), then appends a new firm_conflict_policy version through setFirmConflictPolicy
   * — the SAME append-only audit path the posture admin uses (changedByUserId + createdAt history). When
   * `enforced` is true, every subsequent quickDeed.generate withdraws the conflicts bypass (the real gate runs +
   * no "no conflicts check" stamp); when false, QD-1's default-OFF bypass-and-stamp behavior. Firm-scoped
   * (safeguard a) — keyed by the firm owner, never per-user.
   */
  setConflictsEnforced: protectedProcedure
    .input(z.object({ enforced: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (!isDeedDraftAgentEnabled()) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DEED_DRAFT_AGENT_DISABLED: the deed-draft agent is not enabled.' });
      }
      const current = (await getFirmConflictPolicy(ctx.userId)).policy;
      const resolved = await setFirmConflictPolicy({
        firmOwnerUserId: ctx.userId,
        changedByUserId: ctx.userId,
        // Preserve every other policy field; flip ONLY the deed toggle.
        policy: { ...current, deedConflictsEnforced: input.enforced },
        reasonText: `Quick Deed conflicts enforcement set to ${input.enforced ? 'ON' : 'OFF'}`,
      });
      return { enforced: resolved.policy.deedConflictsEnforced };
    }),
});
