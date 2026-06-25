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
import { VA_VESTING_OPTIONS } from '../deed/deedKbVa.js';
import { documentEgressSend, DocumentEgressBlockedError } from '../egress/documentEgress.js';
import { EVALUATOR_MODEL } from '../llm/config.js';
import { assembleSellerSideDeed, type SellerSideDeedInput, type SellerSideDeedDraft } from '../deed/deedSellerSideAssembler.js';
import {
  assembleTodDeed,
  type DeedTodInput,
  type DeedTodResult,
  type TodPrimaryBeneficiaryInput,
} from '../deed/deedTodAssembler.js';
import {
  assembleConfirmationDeed,
  type DeedConfirmationInput,
  type DeedConfirmationResult,
} from '../deed/deedConfirmationAssembler.js';
import {
  assembleDeedIntoLlc,
  type DeedIntoLlcInput,
  type DeedIntoLlcResult,
} from '../deed/deedIntoLlcAssembler.js';
import {
  assembleOutOfLlcDeed,
  type DeedOutOfLlcInput,
  type DeedOutOfLlcResult,
} from '../deed/deedOutOfLlcAssembler.js';
import {
  assembleIntoTrustDeed,
  type DeedIntoTrustInput,
  type DeedIntoTrustResult,
} from '../deed/deedIntoTrustAssembler.js';
import { buildGiftDrafterNotes } from '../deed/deedGiftNotes.js';
import { buildCategoryDrafterNotes } from '../deed/deedCategoryNotes.js';
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

// QD generate input is a deedType-DISCRIMINATED UNION (gift | seller-side), defined AFTER both category input
// schemas (createGiftDraftInput + createSellerSideDraftInput) so each member can carry its own fields without
// bleeding across categories. See `quickDeedGenerateInput` below the seller-side schema.

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

/** The registry key for the Deed of Gift (the first built Quick Deed dispatch). */
export const QUICK_DEED_GIFT_TYPE = 'deed_of_gift';
/** The registry key for the Seller-Side conveyance (the first non-gift Quick Deed dispatch). */
export const QUICK_DEED_SELLER_TYPE = 'seller_side';

/** The SINGLE source of truth for which registry keys Quick Deed can GENERATE today. The selector's
 *  enabled set (listDeedTypes.quickDeedGenerates) AND the generate dispatch guard both read this set, so
 *  they cannot drift as more categories are wired (add the key here AND a dispatch branch in quickDeed.generate
 *  + a quickDeedGenerateInput union member; the selector enables automatically). Today: gift + seller-side. */
export const WIRED_QUICK_DEED_TYPES: ReadonlySet<string> = new Set([QUICK_DEED_GIFT_TYPE, QUICK_DEED_SELLER_TYPE]);

/** Whether Quick Deed can generate the given deed-type key today (selector + dispatch share this predicate). */
export function isQuickDeedTypeWired(deedType: string): boolean {
  return WIRED_QUICK_DEED_TYPES.has(deedType);
}

// ── E4: seller-side category wiring (mirrors the gift path; extraction already covered) ──────────────────────

const sellerPartySchema = z.object({
  name: z.string().min(1).max(200),
  descriptor: z.string().max(200).optional(),
  formerlyOfRecord: z.string().max(200).optional(),
  variants: z.array(z.string().min(1).max(200)).max(10).optional(),
  capacity: z.string().max(200).optional(),
});

/** Quick Deed / matter-scoped seller-side input. The doc-derived fields (legalDescription, county, taxId,
 *  assessedValue, granteeAddress) are OPTIONAL — defaulted from the extracted facts when omitted, attorney-
 *  override-able (Quick Deed Layer 1 convention). The rest are attorney-provided (the document cannot supply
 *  the new transaction's warranty/consideration/parties/venue/vesting recital). */
const createSellerSideDraftInput = z.object({
  matterId: z.string().uuid(),
  warrantyType: z.string().max(200).optional(),
  fileNumber: z.string().max(120).default(''),
  titleInsurer: z.string().max(200).default(''),
  considerationFigs: z.string().max(120).default(''),
  amountWords: z.string().max(300).default(''),
  grantors: z.array(sellerPartySchema).max(20).default([]),
  grantorDescriptor: z.string().max(200).optional(),
  grantees: z.array(sellerPartySchema).max(20).default([]),
  granteeDescriptor: z.string().max(200).optional(),
  tenancy: z.string().max(300).default(''),
  vestingRecital: z.string().max(8000).default(''),
  venue: z.string().max(200).default(''),
  returnTo: z.string().max(400).default(''),
  sellerType: z.enum(['individual', 'estate']).optional(),
  powerOfSale: z.boolean().optional(),
  // doc-derived (default from extracted facts when omitted) — attorney-override-able
  legalDescription: z.string().max(20000).nullable().optional(),
  county: z.string().max(200).nullable().optional(),
  localityType: z.enum(['county', 'city']).optional(),
  localityName: z.string().max(200).nullable().optional(),
  taxId: z.string().max(120).nullable().optional(),
  assessedValue: z.string().max(120).nullable().optional(),
  granteeAddress: z.string().max(400).nullable().optional(),
  title: z.string().min(1).max(256).optional(),
});

type CreateSellerSideDraftInput = z.infer<typeof createSellerSideDraftInput>;

/** The seller-side portion of a Quick Deed generate, NESTED under `sellerSide` so it never collides with the
 *  gift fields and `deedType` stays a free `z.string()` — the friendly QUICK_DEED_TYPE_NOT_WIRED guard must still
 *  handle ANY deedType string (registered-but-unwired AND unrecognized). The shared party + grantee-address
 *  fields come from the TOP level (reused across categories); only the seller-only facts live here. */
const quickDeedSellerSideInput = createSellerSideDraftInput.omit({
  matterId: true,
  grantors: true,
  grantees: true,
  granteeAddress: true,
});

/** QD generate input — the gift fields at the top level (the original v1 shape, unchanged) + a free-string
 *  deedType (so the dispatch guard, not zod, produces the friendly unwired/unrecognized message) + the nested
 *  seller-side payload (defaulted; present only for a seller-side generate). Add a nested payload per category as
 *  it is wired, in lockstep with WIRED_QUICK_DEED_TYPES + the quickDeed.generate dispatch branch. */
const quickDeedGenerateInput = createGiftDraftInput.extend({
  deedType: z.string().min(1).max(64),
  sellerSide: quickDeedSellerSideInput.default({}),
});

/** First non-empty trimmed value among the candidates (the doc-derived-fact default chain), else ''. */
function firstNonEmpty(...vals: (string | null | undefined)[]): string {
  for (const v of vals) {
    const t = (v ?? '').trim();
    if (t.length > 0) return t;
  }
  return '';
}

/** PURE: map the validated seller-side input + extracted facts onto SellerSideDeedInput. The doc-derived fields
 *  (legal, locality, tax id, assessed value, grantee-address-defaults-to-situs) fall back to the consolidated
 *  facts; the verbatim legal is taken from facts ONLY when not WITHHELD (honesty floor). Exported for testing. */
export function toSellerSideInput(input: CreateSellerSideDraftInput, facts: DeedSourceFacts): SellerSideDeedInput {
  const factLegal = facts.legalDescription.withheld ? '' : (facts.legalDescription.value ?? '');
  const out: SellerSideDeedInput = {
    warrantyType: input.warrantyType,
    fileNumber: firstNonEmpty(input.fileNumber),
    granteeAddress: firstNonEmpty(input.granteeAddress, facts.propertyAddress.value),
    titleInsurer: firstNonEmpty(input.titleInsurer),
    taxId: firstNonEmpty(input.taxId, facts.parcelId.value),
    considerationFigs: firstNonEmpty(input.considerationFigs),
    amountWords: firstNonEmpty(input.amountWords),
    assessedValue: firstNonEmpty(input.assessedValue, facts.assessedValue.value),
    grantors: input.grantors.map((p) => ({
      name: p.name,
      descriptor: p.descriptor,
      formerlyOfRecord: p.formerlyOfRecord,
      variants: p.variants,
      capacity: p.capacity,
    })),
    grantorDescriptor: input.grantorDescriptor,
    grantees: input.grantees.map((p) => ({ name: p.name, descriptor: p.descriptor })),
    granteeDescriptor: input.granteeDescriptor,
    tenancy: firstNonEmpty(input.tenancy),
    county: firstNonEmpty(input.county, input.localityName, facts.propertyLocality.value),
    legalDescription: firstNonEmpty(input.legalDescription, factLegal),
    vestingRecital: firstNonEmpty(input.vestingRecital),
    venue: firstNonEmpty(input.venue),
    returnTo: firstNonEmpty(input.returnTo),
    sellerType: input.sellerType,
    powerOfSale: input.powerOfSale,
  };
  // localityType / localityName are exact-optional ('county'|'city' / string with no explicit undefined) — set
  // them ONLY when supplied (the city override), so the default county path is unchanged.
  if (input.localityType !== undefined) out.localityType = input.localityType;
  const localityName = (input.localityName ?? '').trim();
  if (localityName.length > 0) out.localityName = localityName;
  return out;
}

/** PURE: consolidate a matter's materials + assemble the seller-side draft. Exported for direct (no-DB) testing. */
export function buildSellerSideDraft(
  materials: readonly { id: string; textContent: string | null }[],
  input: CreateSellerSideDraftInput,
): { facts: DeedSourceFacts; draft: SellerSideDeedDraft } {
  const facts = consolidateDeedSourceFacts(materials.map((m) => ({ materialId: m.id, textContent: m.textContent })));
  const draft = assembleSellerSideDeed(toSellerSideInput(input, facts));
  return { facts, draft };
}

/** PURE: the seller-side document `notes` body (delete-before-recording header + the assembler's reconciliation
 *  notes + a recordability-floor status line + the rendered deed). `categoryNotesRendered` (E7) — the
 *  deterministic, KB-grounded category drafter's-notes page, prepended into the SAME free-text notes field (NOT
 *  the version content) so the B6 annotation floor on the recordable deed body stays clean. Exported for testing. */
export function buildSellerSideDocNotes(
  draft: SellerSideDeedDraft,
  extraNotes: readonly string[] = [],
  categoryNotesRendered = '',
): string {
  return [
    'Generated by DEED-DRAFT-AGENT-1 (deterministic). The attorney reviews/edits/approves; this draft is never auto-recorded, filed, or sent.',
    ...extraNotes,
    ...draft.notes,
    draft.recordableFloorOk
      ? 'Emitted; passes the B6 + format recordability floor (subject to the C1/C2 reconciliation gates + execution).'
      : `Recordability floor flagged: ${[...draft.b6.failures, ...draft.format.failures].join('; ') || '(none)'}.`,
    ...(categoryNotesRendered ? ['', categoryNotesRendered] : []),
    '',
    draft.text,
  ].join('\n');
}

// ── E4-rest: TOD (C5) category wiring (gift-shaped; no new extractor) ─────────────────────────────────────────

const todTransferorSchema = z.object({
  name: z.string().min(1).max(200),
  capacity: z.string().max(200).default(''),
});

const todPrimaryBeneficiariesSchema = z.object({
  persons: z.array(z.string().min(1).max(200)).max(20),
  vesting: z.string().max(200),
  relationship: z.string().max(200).nullable().optional(),
});

const todPrimaryBeneficiarySchema = z.object({
  person: z.string().max(200).optional(),
  relationship: z.string().max(200).optional(),
  designation: z.string().max(300).optional(),
  trust: z.string().max(300).optional(),
  vesting: z.string().max(200),
  commonlyKnownAs: z.string().max(400).optional(),
});

/** Quick Deed / matter-scoped TOD input. The doc-derived fields (legalDescription, taxId, taxMapReference,
 *  propertyAddress, assessedValue) are OPTIONAL — defaulted from the extracted facts when omitted, attorney-
 *  override-able (Quick Deed Layer 1 convention). The rest are attorney-provided (the document cannot supply the
 *  transferor capacity / beneficiary designation / notary layout / dates of THIS instrument). */
const createTodDraftInput = z.object({
  matterId: z.string().uuid(),
  preparer: z.string().max(300).default(''),
  returnTo: z.string().max(400).default(''),
  deedDatePhrase: z.string().max(200).default(''),
  transferor: todTransferorSchema,
  signatoryName: z.string().max(200).optional(),
  granteeNamedInPremise: z.boolean().optional(),
  granteePremiseName: z.string().max(400).optional(),
  primaryBeneficiaries: todPrimaryBeneficiariesSchema.optional(),
  primaryBeneficiary: todPrimaryBeneficiarySchema.optional(),
  legalDescriptionPreamble: z.string().max(2000).optional(),
  condoSubjectTo: z.string().max(8000).nullable().optional(),
  derivationOfTitle: z.string().max(2000).optional(),
  beingRecital: z.string().max(2000).optional(),
  preparedWithoutTitleExam: z.boolean().optional(),
  notaryCountyBlank: z.boolean().optional(),
  notaryCity: z.string().max(200).optional(),
  acknowledgmentMonthYear: z.string().max(200).default(''),
  revocationBlock: z.string().max(20000).optional(),
  // doc-derived (default from extracted facts when omitted) — attorney-override-able
  taxId: z.string().max(120).nullable().optional(),
  propertyAddress: z.string().max(400).nullable().optional(),
  taxMapReference: z.string().max(200).nullable().optional(),
  legalDescription: z.string().max(20000).nullable().optional(),
  assessedValue: z.string().max(120).nullable().optional(),
  title: z.string().min(1).max(256).optional(),
});

type CreateTodDraftInput = z.infer<typeof createTodDraftInput>;

/** PURE: map the validated TOD input + extracted facts onto DeedTodInput. The doc-derived fields default from
 *  the consolidated facts (verbatim legal taken ONLY when not WITHHELD — honesty floor); the optional union /
 *  notary-layout fields are assigned CONDITIONALLY (exactOptionalPropertyTypes) so an omitted field is absent,
 *  never an explicit `undefined`. Exported for direct (no-DB) testing. */
export function toTodInput(input: CreateTodDraftInput, facts: DeedSourceFacts): DeedTodInput {
  const factLegal = facts.legalDescription.withheld ? '' : (facts.legalDescription.value ?? '');
  const parcel = facts.parcelId.value ?? '';
  const out: DeedTodInput = {
    preparer: firstNonEmpty(input.preparer),
    returnTo: firstNonEmpty(input.returnTo),
    taxId: firstNonEmpty(input.taxId, parcel),
    deedDatePhrase: firstNonEmpty(input.deedDatePhrase),
    transferor: { name: input.transferor.name, capacity: firstNonEmpty(input.transferor.capacity) },
    propertyAddress: firstNonEmpty(input.propertyAddress, facts.propertyAddress.value),
    taxMapReference: firstNonEmpty(input.taxMapReference, parcel),
    legalDescription: firstNonEmpty(input.legalDescription, factLegal),
    acknowledgmentMonthYear: firstNonEmpty(input.acknowledgmentMonthYear),
  };
  if (input.signatoryName !== undefined) out.signatoryName = input.signatoryName;
  if (input.granteeNamedInPremise !== undefined) out.granteeNamedInPremise = input.granteeNamedInPremise;
  if (input.granteePremiseName !== undefined) out.granteePremiseName = input.granteePremiseName;
  if (input.primaryBeneficiaries !== undefined) {
    out.primaryBeneficiaries = {
      persons: input.primaryBeneficiaries.persons,
      vesting: input.primaryBeneficiaries.vesting,
      relationship: input.primaryBeneficiaries.relationship ?? null,
    };
  }
  if (input.primaryBeneficiary !== undefined) {
    const b = input.primaryBeneficiary;
    const pb: TodPrimaryBeneficiaryInput = { vesting: b.vesting };
    if (b.person !== undefined) pb.person = b.person;
    if (b.relationship !== undefined) pb.relationship = b.relationship;
    if (b.designation !== undefined) pb.designation = b.designation;
    if (b.trust !== undefined) pb.trust = b.trust;
    if (b.commonlyKnownAs !== undefined) pb.commonlyKnownAs = b.commonlyKnownAs;
    out.primaryBeneficiary = pb;
  }
  if (input.legalDescriptionPreamble !== undefined) out.legalDescriptionPreamble = input.legalDescriptionPreamble;
  if (input.condoSubjectTo !== undefined) out.condoSubjectTo = input.condoSubjectTo;
  if (input.derivationOfTitle !== undefined) out.derivationOfTitle = input.derivationOfTitle;
  if (input.beingRecital !== undefined) out.beingRecital = input.beingRecital;
  if (input.assessedValue !== undefined || facts.assessedValue.value) {
    const av = firstNonEmpty(input.assessedValue, facts.assessedValue.value);
    if (av !== '') out.assessedValue = av;
  }
  if (input.preparedWithoutTitleExam !== undefined) out.preparedWithoutTitleExam = input.preparedWithoutTitleExam;
  if (input.notaryCountyBlank !== undefined) out.notaryCountyBlank = input.notaryCountyBlank;
  if (input.notaryCity !== undefined) out.notaryCity = input.notaryCity;
  if (input.revocationBlock !== undefined) out.revocationBlock = input.revocationBlock;
  return out;
}

/** PURE: consolidate a matter's materials + assemble the TOD draft. Exported for direct (no-DB) testing. */
export function buildTodDraft(
  materials: readonly { id: string; textContent: string | null }[],
  input: CreateTodDraftInput,
): { facts: DeedSourceFacts; draft: DeedTodResult } {
  const facts = consolidateDeedSourceFacts(materials.map((m) => ({ materialId: m.id, textContent: m.textContent })));
  const draft = assembleTodDeed(toTodInput(input, facts));
  return { facts, draft };
}

/** PURE: the TOD document `notes` body (delete-before-recording header + the assembler advisories + a status
 *  line + the rendered deed). Called only on an OK result (we never persist a WITHHELD void deed). Exported for
 *  testing. */
export function buildTodDocNotes(draft: DeedTodResult, categoryNotesRendered = ''): string {
  return [
    'Generated by DEED-DRAFT-AGENT-1 (deterministic). The attorney reviews/edits/approves; this draft is never auto-recorded, filed, or sent.',
    ...draft.advisories,
    'Revocable Transfer on Death Deed — unexecuted, death-effective (no consideration, no warranty). Subject to execution + recordation before the transferor’s death.',
    ...(categoryNotesRendered ? ['', categoryNotesRendered] : []),
    '',
    draft.deed ? draft.deed.fullText : '',
  ].join('\n');
}

// ── E4-rest: Confirmation (C1) category wiring (no new extractor; locality via shared renderLocality) ──────────

const confirmationChainSurvivorshipSchema = z.object({
  tookTitleAs: z.string().max(300),
  coOwners: z.array(z.string().min(1).max(200)).max(10),
  vestingDeedDate: z.string().max(120),
  vestingDeedRecorded: z.string().max(120),
  vestingInstrumentNumber: z.string().max(120),
  recordsCounty: z.string().max(200),
});

const confirmationDecedentSchema = z.object({
  name: z.string().max(200),
  aka: z.string().max(200).optional(),
  dateOfDeath: z.string().max(120),
});

const confirmationChainTestateSchema = z.object({
  originalGrantors: z.string().max(400),
  originalDeedDate: z.string().max(120),
  originalDeedRecorded: z.string().max(120),
  originalDeedBookPage: z.string().max(200),
  originalGrantees: z.string().max(400),
  originalGranteesTenancy: z.string().max(300),
});

const confirmationFirstDecedentSchema = z.object({
  name: z.string().max(200),
  dateOfDeath: z.string().max(120),
  survivor: z.string().max(200),
});

const confirmationTestatorSchema = z.object({
  name: z.string().max(200),
  diedTestateDate: z.string().max(120),
  willDate: z.string().max(120),
  probateCourt: z.string().max(300),
  fiduciaryNumber: z.string().max(120),
  possessivePronoun: z.string().max(40),
  subjectPronoun: z.string().max(40),
});

const confirmationDeviseSchema = z.object({
  article: z.string().max(120),
  devisee: z.string().max(200),
  deviseeStatus: z.string().max(200),
  deviseePossessive: z.string().max(40),
  deviseeObject: z.string().max(40),
});

/** Quick Deed / matter-scoped Deed-of-Confirmation input. The doc-derived fields (legalDescription, taxId/taxMap,
 *  assessedValue, granteeReturnAddress->situs, locality) default from the extracted facts; the archetype + the
 *  chain-of-title facts are attorney-supplied (the assembler NEVER fabricates a chain link). */
const createConfirmationDraftInput = z.object({
  matterId: z.string().uuid(),
  archetype: z.enum(['C1-a-survivorship', 'C1-b-testate-devise']),
  exemptionCode: z.string().max(120).default('58.1-810(1)'),
  exemptionParenthetical: z.string().max(400).optional(),
  preparer: z.string().max(300).default(''),
  preparedNote: z.string().max(600).default(''),
  consideration: z.string().max(200).default(''),
  grantingDatePhrase: z.string().max(200).default(''),
  partyName: z.string().max(200).default(''),
  partyOfFirstPart: z.string().max(200).optional(),
  partyOfSecondPart: z.string().max(200).optional(),
  grantorGranteeSame: z.boolean().optional(),
  vesting: z.string().max(200).default('sole owner'),
  grantingVerb: z.string().max(200).default(''),
  warranty: z.string().max(300).default(''),
  subjectTo: z.string().max(8000).default(''),
  // C1-a survivorship
  chainSurvivorship: confirmationChainSurvivorshipSchema.optional(),
  decedent: confirmationDecedentSchema.optional(),
  beingRecitalPriorInstrument: z.string().max(200).optional(),
  survivorName: z.string().max(200).optional(),
  // C1-b testate-devise
  chainTestate: confirmationChainTestateSchema.optional(),
  firstDecedent: confirmationFirstDecedentSchema.optional(),
  testator: confirmationTestatorSchema.optional(),
  devise: confirmationDeviseSchema.optional(),
  taxMapStreetLine: z.string().max(400).optional(),
  beingRecitalBookPage: z.string().max(200).optional(),
  // doc-derived (default from extracted facts when omitted) — attorney-override-able
  taxId: z.string().max(120).nullable().optional(),
  taxMap: z.string().max(120).nullable().optional(),
  assessedValue: z.string().max(120).nullable().optional(),
  granteeReturnAddress: z.string().max(400).nullable().optional(),
  legalDescription: z.string().max(20000).nullable().optional(),
  locality: z.string().max(200).nullable().optional(),
  localityType: z.enum(['county', 'city']).optional(),
  title: z.string().min(1).max(256).optional(),
});

type CreateConfirmationDraftInput = z.infer<typeof createConfirmationDraftInput>;

/** PURE: map the validated Confirmation input + extracted facts onto DeedConfirmationInput. Defaults the
 *  doc-derived fields from the consolidated facts (verbatim legal only when not WITHHELD); the archetype-specific
 *  tax id vs tax map defaults the parcel id into whichever the archetype renders (Exemplar-A taxId / Exemplar-B
 *  taxMap). Optional + chain fields are assigned CONDITIONALLY (exactOptionalPropertyTypes). Exported for testing. */
export function toConfirmationInput(input: CreateConfirmationDraftInput, facts: DeedSourceFacts): DeedConfirmationInput {
  const factLegal = facts.legalDescription.withheld ? '' : (facts.legalDescription.value ?? '');
  const parcel = facts.parcelId.value ?? '';
  const out: DeedConfirmationInput = {
    archetype: input.archetype,
    exemptionCode: firstNonEmpty(input.exemptionCode),
    preparer: firstNonEmpty(input.preparer),
    preparedNote: firstNonEmpty(input.preparedNote),
    granteeReturnAddress: firstNonEmpty(input.granteeReturnAddress, facts.propertyAddress.value),
    assessedValue: firstNonEmpty(input.assessedValue, facts.assessedValue.value),
    consideration: firstNonEmpty(input.consideration),
    grantingDatePhrase: firstNonEmpty(input.grantingDatePhrase),
    partyName: firstNonEmpty(input.partyName),
    vesting: firstNonEmpty(input.vesting),
    grantingVerb: firstNonEmpty(input.grantingVerb),
    warranty: firstNonEmpty(input.warranty),
    locality: firstNonEmpty(input.locality, facts.propertyLocality.value),
    legalDescription: firstNonEmpty(input.legalDescription, factLegal),
    subjectTo: firstNonEmpty(input.subjectTo),
  };
  // Exemplar-A renders Tax ID; Exemplar-B renders Tax Map — default the parcel into the archetype-appropriate one.
  const taxId = firstNonEmpty(input.taxId, input.archetype === 'C1-a-survivorship' ? parcel : '');
  if (taxId !== '') out.taxId = taxId;
  const taxMap = firstNonEmpty(input.taxMap, input.archetype === 'C1-b-testate-devise' ? parcel : '');
  if (taxMap !== '') out.taxMap = taxMap;
  if (input.exemptionParenthetical !== undefined) out.exemptionParenthetical = input.exemptionParenthetical;
  if (input.partyOfFirstPart !== undefined) out.partyOfFirstPart = input.partyOfFirstPart;
  if (input.partyOfSecondPart !== undefined) out.partyOfSecondPart = input.partyOfSecondPart;
  if (input.grantorGranteeSame !== undefined) out.grantorGranteeSame = input.grantorGranteeSame;
  if (input.localityType !== undefined) out.localityType = input.localityType;
  // C1-a survivorship chain (each link carried verbatim; the assembler fails closed on any blank).
  if (input.chainSurvivorship !== undefined) {
    out.chainSurvivorship = {
      tookTitleAs: input.chainSurvivorship.tookTitleAs,
      coOwners: input.chainSurvivorship.coOwners,
      vestingDeedDate: input.chainSurvivorship.vestingDeedDate,
      vestingDeedRecorded: input.chainSurvivorship.vestingDeedRecorded,
      vestingInstrumentNumber: input.chainSurvivorship.vestingInstrumentNumber,
      recordsCounty: input.chainSurvivorship.recordsCounty,
    };
  }
  if (input.decedent !== undefined) {
    const dec: DeedConfirmationInput['decedent'] = { name: input.decedent.name, dateOfDeath: input.decedent.dateOfDeath };
    if (input.decedent.aka !== undefined) dec!.aka = input.decedent.aka;
    out.decedent = dec;
  }
  if (input.beingRecitalPriorInstrument !== undefined) out.beingRecitalPriorInstrument = input.beingRecitalPriorInstrument;
  if (input.survivorName !== undefined) out.survivorName = input.survivorName;
  // C1-b testate-devise chain.
  if (input.chainTestate !== undefined) out.chainTestate = { ...input.chainTestate };
  if (input.firstDecedent !== undefined) out.firstDecedent = { ...input.firstDecedent };
  if (input.testator !== undefined) out.testator = { ...input.testator };
  if (input.devise !== undefined) out.devise = { ...input.devise };
  if (input.taxMapStreetLine !== undefined) out.taxMapStreetLine = input.taxMapStreetLine;
  if (input.beingRecitalBookPage !== undefined) out.beingRecitalBookPage = input.beingRecitalBookPage;
  return out;
}

/** PURE: consolidate a matter's materials + assemble the Confirmation draft. Exported for direct (no-DB) testing. */
export function buildConfirmationDraft(
  materials: readonly { id: string; textContent: string | null }[],
  input: CreateConfirmationDraftInput,
): { facts: DeedSourceFacts; draft: DeedConfirmationResult } {
  const facts = consolidateDeedSourceFacts(materials.map((m) => ({ materialId: m.id, textContent: m.textContent })));
  const draft = assembleConfirmationDeed(toConfirmationInput(input, facts));
  return { facts, draft };
}

/** PURE: the Confirmation document `notes` body. Called only on an OK result (we never persist a WITHHELD void
 *  deed). Exported for testing. */
export function buildConfirmationDocNotes(draft: DeedConfirmationResult, categoryNotesRendered = ''): string {
  return [
    'Generated by DEED-DRAFT-AGENT-1 (deterministic). The attorney reviews/edits/approves; this draft is never auto-recorded, filed, or sent.',
    ...draft.advisories,
    'Deed of Confirmation — confirms (places of record) title already vested by operation of law; it does not transfer. The chain-of-title recitals are attorney-load-bearing; verify each link before recordation.',
    ...(categoryNotesRendered ? ['', categoryNotesRendered] : []),
    '',
    draft.deed ? draft.deed.fullText : '',
  ].join('\n');
}

// ── E5: LLC category wiring (Tier-3) — Deed INTO an LLC (C3) + Deed OUT OF an LLC (C4) ────────────────────────
//
// Two matter-scoped procedures wrapping the already-built deterministic assemblers. The doc-derived fields
// (legalDescription, taxId, assessedValue, granteeAddress/Return, propertyJurisdiction/locality) default from the
// consolidated facts; the LLC entity name + member set default from the NEW llc_authority facts (E5 extractor).
// The attorney supplies the new-transaction facts (consideration, instrument date / execution month+year,
// grantor cardinality / marital status, notary jurisdiction, return-to block, file number, preparer, derivation,
// subject-to). Both assemblers return {status:'OK'|'WITHHELD', deed?} (NOT seller-side's failedClosed). Quick-Deed
// enablement is a SEPARATE later pass (WIRED_QUICK_DEED_TYPES is intentionally NOT touched here).

const intoLlcGrantorSchema = z.object({
  name: z.string().min(1).max(200),
  maritalStatus: z.string().max(120).default('unmarried'),
});

/** Quick-Deed/matter-scoped Deed-INTO-LLC input. The doc-derived fields (legalDescription, taxId,
 *  assessedValue, granteeAddressReturn, propertyJurisdiction) are OPTIONAL — defaulted from the extracted facts
 *  (and the LLC facts) when omitted, attorney-override-able. The rest are attorney-provided (the document cannot
 *  supply THIS transaction's consideration / instrument date / cardinality / notary / derivation / subject-to). */
const createIntoLlcDraftInput = z.object({
  matterId: z.string().uuid(),
  preparedBy: z.string().max(300).default(''),
  titleSearch: z.string().max(300).default('Prepared without benefit of title search'),
  consideration: z.string().max(120).default('$0.00'),
  instrumentDatePhrase: z.string().max(200).default(''),
  grantors: z.array(intoLlcGrantorSchema).max(20).default([]),
  grantorCardinality: z.enum(['single', 'married_couple']).default('single'),
  granteeLlc: z.string().max(300).nullable().optional(),
  derivationOfTitle: z.string().max(2000).default(''),
  subjectTo: z.string().max(8000).default(''),
  notaryJurisdiction: z.object({ commonwealth: z.string().max(200), locality: z.string().max(200) }),
  sourceGrantingBodyOverride: z.string().max(2000).optional(),
  overrideMarkedAuthoritative: z.boolean().optional(),
  grantingVerbOverride: z.string().max(600).optional(),
  // doc-derived (default from extracted facts when omitted) — attorney-override-able
  taxId: z.string().max(120).nullable().optional(),
  granteeAddressReturn: z.string().max(400).nullable().optional(),
  assessedValue: z.string().max(120).nullable().optional(),
  propertyJurisdiction: z.string().max(200).nullable().optional(),
  legalDescription: z.string().max(20000).nullable().optional(),
  title: z.string().min(1).max(256).optional(),
});

type CreateIntoLlcDraftInput = z.infer<typeof createIntoLlcDraftInput>;

const outOfLlcMemberSchema = z.object({
  name: z.string().min(1).max(200),
  signatureTitle: z.string().max(120).optional(),
});

const outOfLlcReturnToSchema = z.object({
  company: z.string().max(200),
  line1: z.string().max(200),
  line2: z.string().max(200).optional(),
  cityStateZip: z.string().max(200),
  phone: z.string().max(120),
});

/** Quick-Deed/matter-scoped Deed-OUT-OF-LLC input. The doc-derived fields (legalDescription, taxId,
 *  assessedValue, granteeAddress) default from the extracted facts; the LLC entity name + member set default
 *  from the LLC facts. The rest are attorney-provided (file number, execution month/year, locality, notary
 *  locality, derivation instrument number, return-to block, consideration). */
const createOutOfLlcDraftInput = z.object({
  matterId: z.string().uuid(),
  grantorLlc: z.string().max(300).nullable().optional(),
  members: z.array(outOfLlcMemberSchema).max(20).default([]),
  fileNumber: z.string().max(120).default(''),
  consideration: z.string().max(120).default('0.00'),
  executionMonth: z.string().max(60).default(''),
  executionYear: z.string().max(20).default(''),
  localityType: z.string().max(40).default('County'),
  localityName: z.string().max(200).nullable().optional(),
  derivationInstrumentNumber: z.string().max(120).default(''),
  notaryLocality: z.string().max(200).default(''),
  returnTo: outOfLlcReturnToSchema,
  exemptionCiteRaw: z.string().max(200).optional(),
  warrantyToken: z.string().max(300).optional(),
  // doc-derived (default from extracted facts when omitted) — attorney-override-able
  taxId: z.string().max(120).nullable().optional(),
  granteeAddress: z.string().max(400).nullable().optional(),
  assessedValue: z.string().max(120).nullable().optional(),
  legalDescription: z.string().max(20000).nullable().optional(),
  title: z.string().min(1).max(256).optional(),
});

type CreateOutOfLlcDraftInput = z.infer<typeof createOutOfLlcDraftInput>;

/** The required Virginia LLC designator the into-LLC grantee string must end with. */
const VA_LLC_DESIGNATOR = ', a Virginia Limited Liability Company';

/** Append the Virginia LLC designator to a bare LLC legal name IFF it is not already present (case-insensitive).
 *  An empty name stays empty (so the assembler's INVALID_LLC_DESIGNATOR fail-closed still fires). */
function withVaLlcDesignator(bare: string): string {
  const t = bare.trim();
  if (t === '') return '';
  if (/,\s*a Virginia Limited Liability Company\s*$/i.test(t)) return t;
  return `${t}${VA_LLC_DESIGNATOR}`;
}

/** PURE: map the validated Deed-INTO-LLC input + extracted facts onto DeedIntoLlcInput. The doc-derived fields
 *  default from the consolidated facts (verbatim legal only when not WITHHELD — honesty floor); the grantee LLC
 *  defaults from the llcLegalName fact (with the VA designator appended); optionals use the exact-optional idiom.
 *  Exported for direct (no-DB) testing. */
export function toIntoLlcInput(input: CreateIntoLlcDraftInput, facts: DeedSourceFacts): DeedIntoLlcInput {
  const factLegal = facts.legalDescription.withheld ? '' : (facts.legalDescription.value ?? '');
  const factLlcName = facts.llcLegalName.withheld ? '' : (facts.llcLegalName.value ?? '');
  const granteeLlcBare = firstNonEmpty(input.granteeLlc, factLlcName);
  const out: DeedIntoLlcInput = {
    preparedBy: firstNonEmpty(input.preparedBy),
    titleSearch: firstNonEmpty(input.titleSearch),
    taxId: firstNonEmpty(input.taxId, facts.parcelId.value),
    granteeAddressReturn: firstNonEmpty(input.granteeAddressReturn, facts.propertyAddress.value),
    assessedValue: firstNonEmpty(input.assessedValue, facts.assessedValue.value),
    consideration: firstNonEmpty(input.consideration),
    instrumentDatePhrase: firstNonEmpty(input.instrumentDatePhrase),
    grantors: (input.grantors ?? []).map((g) => ({ name: g.name, maritalStatus: g.maritalStatus })),
    grantorCardinality: input.grantorCardinality,
    granteeLlc: withVaLlcDesignator(granteeLlcBare),
    propertyJurisdiction: firstNonEmpty(input.propertyJurisdiction, facts.propertyLocality.value),
    legalDescription: firstNonEmpty(input.legalDescription, factLegal),
    derivationOfTitle: firstNonEmpty(input.derivationOfTitle),
    subjectTo: firstNonEmpty(input.subjectTo),
    notaryJurisdiction: {
      commonwealth: input.notaryJurisdiction.commonwealth,
      locality: input.notaryJurisdiction.locality,
    },
  };
  if (input.sourceGrantingBodyOverride !== undefined) out.sourceGrantingBodyOverride = input.sourceGrantingBodyOverride;
  if (input.overrideMarkedAuthoritative !== undefined) out.overrideMarkedAuthoritative = input.overrideMarkedAuthoritative;
  if (input.grantingVerbOverride !== undefined) out.grantingVerbOverride = input.grantingVerbOverride;
  return out;
}

/** PURE: map the validated Deed-OUT-OF-LLC input + extracted facts onto DeedOutOfLlcInput. The doc-derived fields
 *  default from the consolidated facts; the grantor LLC (BARE) defaults from the llcLegalName fact and the members
 *  from the llcMembers fact (each a bare individual name, signatureTitle defaulting to "Member"). Optionals use
 *  the exact-optional idiom. Exported for direct (no-DB) testing. */
export function toOutOfLlcInput(input: CreateOutOfLlcDraftInput, facts: DeedSourceFacts): DeedOutOfLlcInput {
  const factLegal = facts.legalDescription.withheld ? '' : (facts.legalDescription.value ?? '');
  const factLlcName = facts.llcLegalName.withheld ? '' : (facts.llcLegalName.value ?? '');
  const factMembers = facts.llcMembers.withheld ? [] : facts.llcMembers.values;
  // Members: the attorney-supplied set wins; else the extracted member set (bare names, default "Member" title).
  const suppliedMembers = input.members ?? [];
  const members =
    suppliedMembers.length > 0
      ? suppliedMembers.map((m) => {
          const out: DeedOutOfLlcInput['members'][number] = { name: m.name };
          if (m.signatureTitle !== undefined) out.signatureTitle = m.signatureTitle;
          return out;
        })
      : factMembers.map((n) => ({ name: n }));
  const out: DeedOutOfLlcInput = {
    grantorLlc: firstNonEmpty(input.grantorLlc, factLlcName),
    members,
    fileNumber: firstNonEmpty(input.fileNumber),
    granteeAddress: firstNonEmpty(input.granteeAddress, facts.propertyAddress.value),
    taxId: firstNonEmpty(input.taxId, facts.parcelId.value),
    assessedValue: firstNonEmpty(input.assessedValue, facts.assessedValue.value),
    consideration: firstNonEmpty(input.consideration),
    executionMonth: firstNonEmpty(input.executionMonth),
    executionYear: firstNonEmpty(input.executionYear),
    localityType: firstNonEmpty(input.localityType),
    localityName: firstNonEmpty(input.localityName, facts.propertyLocality.value),
    legalDescription: firstNonEmpty(input.legalDescription, factLegal),
    derivationInstrumentNumber: firstNonEmpty(input.derivationInstrumentNumber),
    notaryLocality: firstNonEmpty(input.notaryLocality),
    returnTo: {
      company: input.returnTo.company,
      line1: input.returnTo.line1,
      cityStateZip: input.returnTo.cityStateZip,
      phone: input.returnTo.phone,
    },
  };
  if (input.returnTo.line2 !== undefined) out.returnTo.line2 = input.returnTo.line2;
  if (input.exemptionCiteRaw !== undefined) out.exemptionCiteRaw = input.exemptionCiteRaw;
  if (input.warrantyToken !== undefined) out.warrantyToken = input.warrantyToken;
  return out;
}

/** PURE: consolidate a matter's materials + assemble the into-LLC draft. Exported for direct (no-DB) testing. */
export function buildIntoLlcDraft(
  materials: readonly { id: string; textContent: string | null }[],
  input: CreateIntoLlcDraftInput,
): { facts: DeedSourceFacts; draft: DeedIntoLlcResult } {
  const facts = consolidateDeedSourceFacts(materials.map((m) => ({ materialId: m.id, textContent: m.textContent })));
  const draft = assembleDeedIntoLlc(toIntoLlcInput(input, facts));
  return { facts, draft };
}

/** PURE: consolidate a matter's materials + assemble the out-of-LLC draft. Exported for direct (no-DB) testing. */
export function buildOutOfLlcDraft(
  materials: readonly { id: string; textContent: string | null }[],
  input: CreateOutOfLlcDraftInput,
): { facts: DeedSourceFacts; draft: DeedOutOfLlcResult } {
  const facts = consolidateDeedSourceFacts(materials.map((m) => ({ materialId: m.id, textContent: m.textContent })));
  const draft = assembleOutOfLlcDeed(toOutOfLlcInput(input, facts));
  return { facts, draft };
}

/** PURE: the into-LLC document `notes` body. Called only on an OK result (we never persist a WITHHELD void deed).
 *  Exported for testing. */
export function buildIntoLlcDocNotes(draft: DeedIntoLlcResult, categoryNotesRendered = ''): string {
  return [
    'Generated by DEED-DRAFT-AGENT-1 (deterministic). The attorney reviews/edits/approves; this draft is never auto-recorded, filed, or sent.',
    ...draft.advisories,
    'Deed INTO an LLC — QUITCLAIM, no warranty; exempt under § 58.1-811(A)(10) (Virginia LLC). The grantee LLC designator + the verbatim legal are load-bearing; confirm before recordation.',
    ...(categoryNotesRendered ? ['', categoryNotesRendered] : []),
    '',
    draft.deed ? draft.deed.fullText : '',
  ].join('\n');
}

/** PURE: the out-of-LLC document `notes` body. Called only on an OK result (we never persist a WITHHELD void
 *  deed). Exported for testing. */
export function buildOutOfLlcDocNotes(draft: DeedOutOfLlcResult, categoryNotesRendered = ''): string {
  return [
    'Generated by DEED-DRAFT-AGENT-1 (deterministic). The attorney reviews/edits/approves; this draft is never auto-recorded, filed, or sent.',
    ...draft.advisories,
    'Deed OUT OF an LLC — Special Warranty; exempt under § 58.1-811(A)(11) (Virginia LLC). The member signature set + the verbatim legal are load-bearing; confirm before recordation.',
    ...(categoryNotesRendered ? ['', categoryNotesRendered] : []),
    '',
    draft.deed ? draft.deed.fullText : '',
  ].join('\n');
}

// ── E6: Into-Trust category wiring (Tier-3) — Deed INTO a revocable living trust (C2) ─────────────────────────
//
// One matter-scoped procedure wrapping the already-built deterministic into-trust assembler. The doc-derived
// fields (legalDescription, taxId, assessedValue, granteeReturnAddress->situs, jurisdictionSitus->locality) default
// from the consolidated facts; the NEW certificate_of_trust facts (E6 extractor) surface the trust legal name /
// trustee names / trust date as available LEADS — but the load-bearing `trusteesRecital` is ATTORNEY-SUPPLIED
// VERBATIM (never auto-fabricated from the extracted parts; the assembler keys the GRANTEES party block off it).
// The attorney supplies the exemplar / exemption basis / marital status / heldAs / trust structure / TBE-note
// selector / granting verb / instrument date / notary jurisdiction / preparer / derivation / being recital. The
// assembler returns {status:'OK'|'WITHHELD', deed?} (NOT seller-side's failedClosed). NO Quick-Deed enablement
// (WIRED_QUICK_DEED_TYPES intentionally NOT touched). There is only INTO-trust (no out-of-trust assembler exists).

const intoTrustPreparerSchema = z.object({
  name: z.string().max(200).default(''),
  vsb: z.string().max(60).default(''),
  firm: z.string().max(200).default(''),
});

const intoTrustGrantorSchema = z.object({
  full: z.string().min(1).max(200),
});

const intoTrustInstrumentDateSchema = z.object({
  day: z.string().max(60),
  month: z.string().max(60),
  year: z.string().max(20),
});

const intoTrustNotaryJurisdictionSchema = z.object({
  type: z.enum(['CITY', 'COUNTY']),
  name: z.string().max(200),
});

const intoTrustBeingRecitalSchema = z.object({
  priorConveyance: z.string().max(4000),
  divorceOrder: z.string().max(2000),
  msa: z.string().max(2000),
});

const intoTrustReturnBlockSchema = z.object({
  lines: z.array(z.string().max(400)).max(20),
});

/** Quick-Deed/matter-scoped Deed-INTO-TRUST input. The doc-derived fields (legalDescription, taxId, assessedValue,
 *  granteeReturnAddress, jurisdictionSitus) are OPTIONAL — defaulted from the extracted facts when omitted,
 *  attorney-override-able. The `trusteesRecital` is REQUIRED + attorney-supplied (load-bearing VERBATIM; never
 *  defaulted from the extracted trust facts). The exemplar / exemption basis / marital status / heldAs / trust
 *  structure / TBE-note selector / granting verb / instrument date / notary jurisdiction are attorney-provided
 *  (the document cannot supply THIS transaction's variant or recital choices). */
const createIntoTrustDraftInput = z.object({
  matterId: z.string().uuid(),
  exemplar: z.enum(['A', 'B', 'C']),
  exemptionBasis: z.array(z.string().max(60)).max(4).default([]),
  titleSearchPerformed: z.boolean().default(false),
  preparer: intoTrustPreparerSchema,
  consideration: z.string().max(120).optional(),
  fileNumber: z.string().max(120).optional(),
  instrumentDate: intoTrustInstrumentDateSchema,
  grantors: z.array(intoTrustGrantorSchema).max(20).default([]),
  grantorMaritalStatus: z.string().max(200).default(''),
  heldAs: z.string().max(200).default(''),
  trustStructure: z.string().max(120).default(''),
  trusteesRecital: z.string().max(4000).default(''),
  granteeObjectPlurality: z.enum(['GRANTEE', 'GRANTEES']).optional(),
  grantingVerb: z.string().max(200).default(''),
  lceIdentificationFootnote: z.boolean().optional(),
  derivation: z.string().max(2000).optional(),
  beingRecital: intoTrustBeingRecitalSchema.optional(),
  tbeImmunityNote: z.string().max(60).nullable().default(null),
  notaryJurisdiction: intoTrustNotaryJurisdictionSchema,
  returnBlock: intoTrustReturnBlockSchema.optional(),
  notaryBlockRaw: z.string().max(8000).optional(),
  trusteePowersClauseRaw: z.string().max(8000).optional(),
  // doc-derived (default from extracted facts when omitted) — attorney-override-able
  taxId: z.string().max(120).nullable().optional(),
  granteeReturnAddress: z.string().max(400).nullable().optional(),
  assessedValue: z.string().max(120).nullable().optional(),
  jurisdictionSitus: z.string().max(200).nullable().optional(),
  legalDescription: z.string().max(20000).nullable().optional(),
  title: z.string().min(1).max(256).optional(),
});

type CreateIntoTrustDraftInput = z.infer<typeof createIntoTrustDraftInput>;

/** PURE: map the validated Deed-INTO-TRUST input + extracted facts onto DeedIntoTrustInput. The doc-derived fields
 *  default from the consolidated facts (verbatim legal only when not WITHHELD — honesty floor); the load-bearing
 *  `trusteesRecital` is taken AS-SUPPLIED by the attorney (never defaulted from the extracted trust facts — those
 *  are leads only). The `tbeImmunityNote` maps null/'Exemplar-A'/'Exemplar-C' straight through (the assembler
 *  validates the closed selector set). Optionals use the exact-optional idiom (an omitted field is absent, never an
 *  explicit `undefined`). Exported for direct (no-DB) testing. */
export function toIntoTrustInput(input: CreateIntoTrustDraftInput, facts: DeedSourceFacts): DeedIntoTrustInput {
  const factLegal = facts.legalDescription.withheld ? '' : (facts.legalDescription.value ?? '');
  const out: DeedIntoTrustInput = {
    exemplar: input.exemplar,
    exemptionBasis: input.exemptionBasis,
    titleSearchPerformed: input.titleSearchPerformed,
    preparer: { name: input.preparer.name, vsb: input.preparer.vsb, firm: input.preparer.firm },
    taxId: firstNonEmpty(input.taxId, facts.parcelId.value),
    granteeReturnAddress: firstNonEmpty(input.granteeReturnAddress, facts.propertyAddress.value),
    assessedValue: firstNonEmpty(input.assessedValue, facts.assessedValue.value),
    instrumentDate: {
      day: input.instrumentDate.day,
      month: input.instrumentDate.month,
      year: input.instrumentDate.year,
    },
    grantors: (input.grantors ?? []).map((g) => ({ full: g.full })),
    grantorMaritalStatus: input.grantorMaritalStatus,
    heldAs: input.heldAs,
    trustStructure: input.trustStructure,
    // LOAD-BEARING VERBATIM — attorney-supplied; never auto-fabricated from the extracted trust facts.
    trusteesRecital: input.trusteesRecital,
    grantingVerb: input.grantingVerb,
    jurisdictionSitus: firstNonEmpty(input.jurisdictionSitus, facts.propertyLocality.value),
    legalDescription: firstNonEmpty(input.legalDescription, factLegal),
    tbeImmunityNote: input.tbeImmunityNote,
    notaryJurisdiction: { type: input.notaryJurisdiction.type, name: input.notaryJurisdiction.name },
  };
  if (input.consideration !== undefined) out.consideration = input.consideration;
  if (input.fileNumber !== undefined) out.fileNumber = input.fileNumber;
  if (input.granteeObjectPlurality !== undefined) out.granteeObjectPlurality = input.granteeObjectPlurality;
  if (input.lceIdentificationFootnote !== undefined) out.lceIdentificationFootnote = input.lceIdentificationFootnote;
  if (input.derivation !== undefined) out.derivation = input.derivation;
  if (input.beingRecital !== undefined) {
    out.beingRecital = {
      priorConveyance: input.beingRecital.priorConveyance,
      divorceOrder: input.beingRecital.divorceOrder,
      msa: input.beingRecital.msa,
    };
  }
  if (input.returnBlock !== undefined) out.returnBlock = { lines: input.returnBlock.lines };
  if (input.notaryBlockRaw !== undefined) out.notaryBlockRaw = input.notaryBlockRaw;
  if (input.trusteePowersClauseRaw !== undefined) out.trusteePowersClauseRaw = input.trusteePowersClauseRaw;
  return out;
}

/** PURE: consolidate a matter's materials + assemble the into-trust draft. Exported for direct (no-DB) testing. */
export function buildIntoTrustDraft(
  materials: readonly { id: string; textContent: string | null }[],
  input: CreateIntoTrustDraftInput,
): { facts: DeedSourceFacts; draft: DeedIntoTrustResult } {
  const facts = consolidateDeedSourceFacts(materials.map((m) => ({ materialId: m.id, textContent: m.textContent })));
  const draft = assembleIntoTrustDeed(toIntoTrustInput(input, facts));
  return { facts, draft };
}

/** PURE: the into-trust document `notes` body. Called only on an OK result (we never persist a WITHHELD void deed).
 *  Exported for testing. */
export function buildIntoTrustDocNotes(draft: DeedIntoTrustResult, categoryNotesRendered = ''): string {
  return [
    'Generated by DEED-DRAFT-AGENT-1 (deterministic). The attorney reviews/edits/approves; this draft is never auto-recorded, filed, or sent.',
    ...draft.advisories,
    'Deed INTO a revocable living trust — the trustees recital + the verbatim legal are load-bearing and attorney-supplied; the §55.1-136(C) TBE-immunity note (married/TBE) and the canonical trustee-powers block are house-style. Confirm before recordation.',
    ...(categoryNotesRendered ? ['', categoryNotesRendered] : []),
    '',
    draft.deed ? draft.deed.fullText : '',
  ].join('\n');
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
   * E4 — assemble a Seller-Side conveyance draft from the matter's materials + attorney input, persisted as a
   * draft document. Mirrors createGiftDraft: fail-closed on the flag + ownership; the doc-derived facts
   * (legal / locality / tax-id / assessed-value / grantee-address) default from extraction (attorney-override-
   * able). The seller-side assembler CAN fail closed (truncated legal, name-bleed, the B2 estate scope) — on a
   * fail-closed result we do NOT persist a void deed: we return the failure reasons for the attorney to fix +
   * retry. Never finalizes, records, or sends. (Quick-Deed generate enablement for this category is a separate
   * increment; this is the matter-scoped capability, the gift sibling.)
   */
  createSellerSideDraft: protectedProcedure.input(createSellerSideDraftInput).mutation(async ({ ctx, input }) => {
    await assertDeedDraftingAllowed(ctx.userId, input.matterId);

    const materials = await listMaterialsForMatter(input.matterId, ctx.userId);
    const { facts, draft } = buildSellerSideDraft(
      materials.map((m) => ({ id: m.id, textContent: m.textContent })),
      input,
    );

    if (draft.failedClosed) {
      // Fail-closed (truncated legal / name bleed / B2 estate scope): do NOT persist a void deed; surface why.
      return {
        failedClosed: true,
        failures: draft.failures,
        documentId: null as string | null,
        versionId: null as string | null,
        title: null as string | null,
        recordableFloorOk: false,
        notes: draft.notes,
        warnings: [...facts.warnings, ...draft.warnings],
      };
    }

    const title = (input.title ?? '').trim() || 'Seller-Side Deed';
    // E7: the deterministic, KB-grounded category drafter's notes (exemption/tax + the category-agnostic
    // fact-driven notes + one structural note), in the document NOTES field only (never the version content).
    const categoryNotes = buildCategoryDrafterNotes('seller_side', facts);
    const docNotes = buildSellerSideDocNotes(draft, [], categoryNotes.rendered);

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
      failedClosed: false,
      failures: [] as string[],
      documentId: doc.id as string | null,
      versionId: version.id as string | null,
      title: title as string | null,
      recordableFloorOk: draft.recordableFloorOk,
      notes: draft.notes,
      warnings: [...facts.warnings, ...draft.warnings],
    };
  }),

  /**
   * E4-rest — assemble a Revocable Transfer on Death Deed (C5) draft from the matter's materials + attorney
   * input, persisted as a draft document. Mirrors createSellerSideDraft, but the TOD assembler returns the
   * {status:'OK'|'WITHHELD', deed?} shape (NOT seller-side's failedClosed/text) — so we branch on
   * status==='WITHHELD' and persist deed.fullText on OK. The doc-derived facts (legal / tax-id / tax-map /
   * property-address / assessed-value) default from extraction (attorney-override-able); the transferor,
   * beneficiary designation, notary layout, and dates are attorney-supplied. On a WITHHELD result we do NOT
   * persist a void deed: we return the fail-closed flags for the attorney to fix + retry. Never finalizes,
   * records, or sends.
   */
  createTodDraft: protectedProcedure.input(createTodDraftInput).mutation(async ({ ctx, input }) => {
    await assertDeedDraftingAllowed(ctx.userId, input.matterId);

    const materials = await listMaterialsForMatter(input.matterId, ctx.userId);
    const { facts, draft } = buildTodDraft(
      materials.map((m) => ({ id: m.id, textContent: m.textContent })),
      input,
    );

    if (draft.status === 'WITHHELD' || !draft.deed) {
      // Fail-closed (truncated legal / malformed ZIP / no beneficiary / garbled revocation block): no void deed.
      return {
        withheld: true,
        flags: draft.flags,
        advisories: draft.advisories,
        documentId: null as string | null,
        versionId: null as string | null,
        title: null as string | null,
        warnings: [...facts.warnings],
      };
    }

    const title = (input.title ?? '').trim() || 'Revocable Transfer on Death Deed';
    const categoryNotes = buildCategoryDrafterNotes('deed_tod', facts);
    const docNotes = buildTodDocNotes(draft, categoryNotes.rendered);

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
      content: draft.deed.fullText,
      generatedByJobId: null,
      iterationNumber: 1,
    });
    await updateDocumentCurrentVersion(doc.id, ctx.userId, version.id);

    return {
      withheld: false,
      flags: draft.flags,
      advisories: draft.advisories,
      documentId: doc.id as string | null,
      versionId: version.id as string | null,
      title: title as string | null,
      warnings: [...facts.warnings],
    };
  }),

  /**
   * E4-rest — assemble a Deed of Confirmation (C1) draft from the matter's materials + attorney input, persisted
   * as a draft document. Mirrors createTodDraft (same {status:'OK'|'WITHHELD', deed?} branch). A confirmation
   * CONFIRMS title already vested by operation of law — the assembler is a deterministic formatter of the
   * attorney-supplied chain-of-title facts and fails closed on a parties mismatch, a wrong exemption, a truncated
   * legal, or any blank/fabricable chain link. The doc-derived facts (legal / tax-id-or-map / assessed-value /
   * grantee-return-address / locality) default from extraction; the archetype + chain-of-title are attorney-
   * supplied. Never finalizes, records, or sends.
   */
  createConfirmationDraft: protectedProcedure.input(createConfirmationDraftInput).mutation(async ({ ctx, input }) => {
    await assertDeedDraftingAllowed(ctx.userId, input.matterId);

    const materials = await listMaterialsForMatter(input.matterId, ctx.userId);
    const { facts, draft } = buildConfirmationDraft(
      materials.map((m) => ({ id: m.id, textContent: m.textContent })),
      input,
    );

    if (draft.status === 'WITHHELD' || !draft.deed) {
      // Fail-closed (parties mismatch / wrong exemption / truncated legal / incomplete or fabricable chain): no
      // void deed; surface the flags so the attorney can complete the chain + retry.
      return {
        withheld: true,
        flags: draft.flags,
        advisories: draft.advisories,
        documentId: null as string | null,
        versionId: null as string | null,
        title: null as string | null,
        warnings: [...facts.warnings],
      };
    }

    const title = (input.title ?? '').trim() || 'Deed of Confirmation';
    const categoryNotes = buildCategoryDrafterNotes('deed_of_confirmation', facts);
    const docNotes = buildConfirmationDocNotes(draft, categoryNotes.rendered);

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
      content: draft.deed.fullText,
      generatedByJobId: null,
      iterationNumber: 1,
    });
    await updateDocumentCurrentVersion(doc.id, ctx.userId, version.id);

    return {
      withheld: false,
      flags: draft.flags,
      advisories: draft.advisories,
      documentId: doc.id as string | null,
      versionId: version.id as string | null,
      title: title as string | null,
      warnings: [...facts.warnings],
    };
  }),

  /**
   * E5 — assemble a Deed INTO an LLC (C3) draft from the matter's materials + attorney input, persisted as a
   * draft document. Mirrors createTodDraft/createConfirmationDraft (same {status:'OK'|'WITHHELD', deed?} branch).
   * QUITCLAIM, no warranty; § 58.1-811(A)(10) Virginia-LLC exemption. The doc-derived facts (legal / tax-id /
   * assessed-value / grantee-return-address / property-jurisdiction) default from extraction; the grantee LLC
   * defaults from the extracted llc_authority legal name (with the ", a Virginia Limited Liability Company"
   * designator appended); the consideration / instrument date / grantor cardinality+marital status / notary /
   * derivation / subject-to are attorney-supplied. Fails closed (no void deed) on a truncated legal, a warranty
   * bleed, a missing/non-VA LLC designator, or an authoritative cardinality typo. Never finalizes, records, sends.
   */
  createIntoLlcDraft: protectedProcedure.input(createIntoLlcDraftInput).mutation(async ({ ctx, input }) => {
    await assertDeedDraftingAllowed(ctx.userId, input.matterId);

    const materials = await listMaterialsForMatter(input.matterId, ctx.userId);
    const { facts, draft } = buildIntoLlcDraft(
      materials.map((m) => ({ id: m.id, textContent: m.textContent })),
      input,
    );

    if (draft.status === 'WITHHELD' || !draft.deed) {
      // Fail-closed (truncated legal / warranty bleed / invalid LLC designator / cardinality typo): no void deed.
      return {
        withheld: true,
        flags: draft.flags,
        advisories: draft.advisories,
        documentId: null as string | null,
        versionId: null as string | null,
        title: null as string | null,
        warnings: [...facts.warnings],
      };
    }

    const title = (input.title ?? '').trim() || 'Deed Into an LLC';
    const categoryNotes = buildCategoryDrafterNotes('deed_into_llc', facts);
    const docNotes = buildIntoLlcDocNotes(draft, categoryNotes.rendered);

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
      content: draft.deed.fullText,
      generatedByJobId: null,
      iterationNumber: 1,
    });
    await updateDocumentCurrentVersion(doc.id, ctx.userId, version.id);

    return {
      withheld: false,
      flags: draft.flags,
      advisories: draft.advisories,
      documentId: doc.id as string | null,
      versionId: version.id as string | null,
      title: title as string | null,
      warnings: [...facts.warnings],
    };
  }),

  /**
   * E5 — assemble a Deed OUT OF an LLC (C4) draft from the matter's materials + attorney input, persisted as a
   * draft document. Mirrors createIntoLlcDraft (same {status:'OK'|'WITHHELD', deed?} branch). Special Warranty;
   * § 58.1-811(A)(11) Virginia-LLC exemption; LLC-by-members signature block. The doc-derived facts (legal /
   * tax-id / assessed-value / grantee-address / locality) default from extraction; the grantor LLC + member set
   * default from the extracted llc_authority facts (bare names); the file number / execution month+year / notary
   * locality / derivation instrument number / return-to block / consideration are attorney-supplied. Fails closed
   * (no void deed) on a party-name label/bridge bleed, a truncated legal, a warranty mismatch, or a missing
   * LLC/member set. Never finalizes, records, or sends.
   */
  createOutOfLlcDraft: protectedProcedure.input(createOutOfLlcDraftInput).mutation(async ({ ctx, input }) => {
    await assertDeedDraftingAllowed(ctx.userId, input.matterId);

    const materials = await listMaterialsForMatter(input.matterId, ctx.userId);
    const { facts, draft } = buildOutOfLlcDraft(
      materials.map((m) => ({ id: m.id, textContent: m.textContent })),
      input,
    );

    if (draft.status === 'WITHHELD' || !draft.deed) {
      // Fail-closed (name bleed / truncated legal / warranty mismatch / missing LLC or members): no void deed.
      return {
        withheld: true,
        flags: draft.flags,
        advisories: draft.advisories,
        documentId: null as string | null,
        versionId: null as string | null,
        title: null as string | null,
        warnings: [...facts.warnings],
      };
    }

    const title = (input.title ?? '').trim() || 'Deed Out of an LLC';
    const categoryNotes = buildCategoryDrafterNotes('deed_out_of_llc', facts);
    const docNotes = buildOutOfLlcDocNotes(draft, categoryNotes.rendered);

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
      content: draft.deed.fullText,
      generatedByJobId: null,
      iterationNumber: 1,
    });
    await updateDocumentCurrentVersion(doc.id, ctx.userId, version.id);

    return {
      withheld: false,
      flags: draft.flags,
      advisories: draft.advisories,
      documentId: doc.id as string | null,
      versionId: version.id as string | null,
      title: title as string | null,
      warnings: [...facts.warnings],
    };
  }),

  /**
   * E6 — assemble a Deed INTO a revocable living trust (C2) draft from the matter's materials + attorney input,
   * persisted as a draft document. Mirrors createIntoLlcDraft/createOutOfLlcDraft (same {status:'OK'|'WITHHELD',
   * deed?} branch). The doc-derived facts (legal / tax-id / assessed-value / grantee-return-address / situs) default
   * from extraction; the NEW certificate_of_trust facts surface the trust legal name / trustee names / trust date
   * as LEADS — but the load-bearing `trusteesRecital` is ATTORNEY-SUPPLIED VERBATIM (never auto-fabricated). The
   * exemplar / exemption basis / marital status / heldAs / trust structure / TBE-note selector / granting verb /
   * instrument date / notary jurisdiction / preparer / derivation / being recital are attorney-supplied. Fails
   * closed (no void deed) on a truncated legal, a missing trustees recital, an unverified/mismatched exemption
   * basis, a garbled trustee-powers clause, or a mis-placed §55.1-136(C) note. Never finalizes, records, or sends.
   */
  createIntoTrustDraft: protectedProcedure.input(createIntoTrustDraftInput).mutation(async ({ ctx, input }) => {
    await assertDeedDraftingAllowed(ctx.userId, input.matterId);

    const materials = await listMaterialsForMatter(input.matterId, ctx.userId);
    const { facts, draft } = buildIntoTrustDraft(
      materials.map((m) => ({ id: m.id, textContent: m.textContent })),
      input,
    );

    if (draft.status === 'WITHHELD' || !draft.deed) {
      // Fail-closed (truncated legal / missing trustees recital / exemption mismatch / garbled powers / mis-placed
      // TBE note): do NOT persist a void deed; surface the flags for the attorney to fix + retry.
      return {
        withheld: true,
        flags: draft.flags,
        advisories: draft.advisories,
        documentId: null as string | null,
        versionId: null as string | null,
        title: null as string | null,
        warnings: [...facts.warnings],
      };
    }

    const title = (input.title ?? '').trim() || 'Deed Into Trust';
    // The married-couple/TBE context (for the §55.1-136(C) immunity clause in the structural note) is signaled by
    // a TBE-immunity-note selector being set, or a "married" marital status. Conservative either way.
    const marriedCouple = input.tbeImmunityNote !== null || /married/i.test(input.grantorMaritalStatus ?? '');
    const categoryNotes = buildCategoryDrafterNotes('deed_into_trust', facts, { marriedCouple });
    const docNotes = buildIntoTrustDocNotes(draft, categoryNotes.rendered);

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
      content: draft.deed.fullText,
      generatedByJobId: null,
      iterationNumber: 1,
    });
    await updateDocumentCurrentVersion(doc.id, ctx.userId, version.id);

    return {
      withheld: false,
      flags: draft.flags,
      advisories: draft.advisories,
      documentId: doc.id as string | null,
      versionId: version.id as string | null,
      title: title as string | null,
      warnings: [...facts.warnings],
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

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// DEED-DRAFT-AGENT-1 QUICK DEED LAYER 2 (E3) — AI FREE-ASSOCIATE INTAKE (the ONE LLM step on this track).
//
// The attorney free-associates the deal in one text box; a SINGLE model step PARSES → PROPOSES only the
// irreducible intake fields (grantees, married-couple flag, an explicit vesting override, and any explicit
// file-number / derivation / locality overrides the attorney stated). The deterministic assembler still does
// ALL generation later, in a separate attorney-confirmed step — this procedure PROPOSES ONLY: it returns the
// parsed structured intent for the attorney to confirm; it NEVER calls quickDeed.generate, never auto-records,
// never sends, and NEVER authors a legal/property description (that stays EXTRACTION-ONLY, never model-authored).
//
// The LLM call runs through the EXISTING egress control plane (documentEgressSend) — NO new egress path, audit
// table, provider-allowlist var, or env var. enforceProviderAllowlist stays TRUE (fail-closed): the allowlist
// (GROUNDED_CHAT_PROVIDERS) ships INERT in prod, so the parse is inert until the operator populates it after
// confirming no-train/ZDR/DPA terms. Fail-closed on ambiguity: a low-confidence / ambiguous / schema-invalid
// model output returns a needs-clarification result — it NEVER default-fills a contested donee or vesting.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The set of valid VA vesting keys (deedKbVa) a proposed vestingOverride must match — the SAME controlled list
 *  the gift assembler validates against, so a proposed override and the later deterministic generate cannot drift. */
const VA_VESTING_KEYS: ReadonlySet<string> = new Set(VA_VESTING_OPTIONS.map((o) => o.key));

/**
 * The structured-output schema the model MUST emit for a propose-intake parse. Carries ONLY the irreducible
 * intake fields that map 1:1 onto GiftDeedInput — and CARRIES NO legal-description / property-description field
 * (the verbatim legal stays EXTRACTION-ONLY via extractDeedIngest/consolidateDeedSourceFacts; never model-
 * authored). `confident` + `clarifyingQuestions` let the model fail closed: when it is unsure which "Jordan" or
 * what tenancy was meant, it sets confident=false and asks rather than guessing. This schema is passed to the
 * provider as the structured-output contract AND re-validated below (a provider that ignores it cannot smuggle
 * extra fields past validateProposeIntakeOutput, which strips to exactly these keys).
 */
export const ProposeIntakeOutputSchema = z
  .object({
    grantees: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          relationship: z.string().max(200).optional(),
        }),
      )
      .max(20)
      .default([]),
    granteesAreMarriedCouple: z.boolean().optional(),
    /** A VA_VESTING_OPTIONS key the attorney explicitly stated; validated against deedKbVa below. */
    vestingOverride: z.string().max(120).nullable().optional(),
    /** Explicit attorney-stated overrides only (never invented). */
    fileNumber: z.string().max(120).nullable().optional(),
    derivationReference: z.string().max(400).nullable().optional(),
    locality: z.string().max(200).nullable().optional(),
    /** The model's own confidence gate — false ⇒ fail closed to needs_clarification. */
    confident: z.boolean().default(true),
    /** Questions the model wants answered before the attorney should rely on the parse. */
    clarifyingQuestions: z.array(z.string().min(1).max(400)).max(20).default([]),
  })
  .strict();

/** The attorney-confirmable proposal — the irreducible intake fields, mapping 1:1 onto GiftDeedInput. NO
 *  legal/property-description field (model never authors the legal). */
export interface ProposeIntakeProposal {
  grantees: { name: string; relationship?: string }[];
  granteesAreMarriedCouple?: boolean;
  vestingOverride?: string | null;
  overrides: {
    fileNumber?: string | null;
    derivationReference?: string | null;
    locality?: string | null;
  };
}

export type ProposeIntakeResult =
  | { status: 'proposed'; proposal: ProposeIntakeProposal }
  | { status: 'needs_clarification'; questions: string[] };

/** The advisory system prompt: extract ONLY the irreducible deed-intake fields the attorney stated; NEVER author
 *  a legal/property description; if anything is ambiguous, ASK (set confident=false + clarifyingQuestions) rather
 *  than guess. PROPOSE-ONLY — this never drafts, records, or sends. */
export function buildProposeIntakeSystemPrompt(): string {
  return [
    'You are a deed-intake PARSER for a Virginia attorney. The attorney has free-associated the facts of a',
    'gift-deed deal in one text box. Extract ONLY the irreducible intake fields the attorney EXPLICITLY stated:',
    '  - grantees: the donee(s) — each a { name, relationship } where relationship is the donee\'s relationship',
    '    to the grantor (e.g. "the Grantor\'s daughter") ONLY if the attorney stated it.',
    '  - granteesAreMarriedCouple: true ONLY if the attorney said the grantees are a married couple.',
    '  - vestingOverride: a vesting/tenancy KEY the attorney explicitly chose, one of exactly:',
    `    ${[...VA_VESTING_KEYS].join(', ')}. Omit it unless the attorney stated the tenancy.`,
    '  - fileNumber / derivationReference / locality: ONLY if the attorney explicitly stated each.',
    '',
    'HARD RULES:',
    '  - Do NOT author, paraphrase, infer, or emit any legal description or property description. There is NO',
    '    field for it; the verbatim legal is taken from the uploaded documents only, never from you.',
    '  - Do NOT invent, default, or guess ANY field. A field you are unsure about must be OMITTED, not filled.',
    '  - If anything load-bearing is ambiguous (which person is meant, what tenancy, who the donees are), set',
    '    confident=false and put a specific question in clarifyingQuestions. NEVER guess a contested donee or',
    '    tenancy — ask instead.',
    '  - You only PROPOSE the parse for the attorney to confirm. You never draft, record, file, or send anything.',
    'Return ONLY the structured object.',
  ].join('\n');
}

/** PURE: validate + normalize the model\'s structured output into a propose-intake RESULT. Fail-closed:
 *  schema-invalid, the model\'s own confident=false, a present-but-invalid vestingOverride (not a
 *  VA_VESTING_OPTIONS key), or NO grantees all collapse to a needs_clarification result (NEVER a partial/
 *  default-filled proposal). Exported for direct (no-LLM) testing. */
export function validateProposeIntakeOutput(raw: unknown): ProposeIntakeResult {
  const parsed = ProposeIntakeOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'needs_clarification',
      questions: ['The intake could not be parsed into the required fields. Please restate the donees and tenancy.'],
    };
  }
  const out = parsed.data;
  const questions: string[] = [...out.clarifyingQuestions];

  // The model's own low-confidence gate fails closed.
  let needsClarification = out.confident === false;

  // A vestingOverride, IF present, must be a valid VA_VESTING_OPTIONS key — never passed through otherwise.
  const vesting = (out.vestingOverride ?? '').trim();
  if (vesting !== '' && !VA_VESTING_KEYS.has(vesting)) {
    needsClarification = true;
    questions.push(
      `The stated tenancy "${vesting}" is not a recognized Virginia vesting option (${[...VA_VESTING_KEYS].join(', ')}). Which did you mean?`,
    );
  }

  // A gift deed must have at least one donee; a parse with none is ambiguous, not a default.
  const grantees = out.grantees.map((g) => {
    const r = (g.relationship ?? '').trim();
    return r === '' ? { name: g.name.trim() } : { name: g.name.trim(), relationship: r };
  });
  if (grantees.length === 0) {
    needsClarification = true;
    questions.push('Who are the donee(s) (the grantee(s)) of this gift deed?');
  }

  if (needsClarification) {
    return {
      status: 'needs_clarification',
      questions: questions.length > 0 ? questions : ['The intake is ambiguous; please clarify the donees and tenancy.'],
    };
  }

  const proposal: ProposeIntakeProposal = {
    grantees,
    overrides: {},
  };
  if (out.granteesAreMarriedCouple !== undefined) proposal.granteesAreMarriedCouple = out.granteesAreMarriedCouple;
  if (vesting !== '') proposal.vestingOverride = vesting;
  const fileNumber = (out.fileNumber ?? '').trim();
  if (fileNumber !== '') proposal.overrides.fileNumber = fileNumber;
  const derivation = (out.derivationReference ?? '').trim();
  if (derivation !== '') proposal.overrides.derivationReference = derivation;
  const locality = (out.locality ?? '').trim();
  if (locality !== '') proposal.overrides.locality = locality;

  return { status: 'proposed', proposal };
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
   * Quick Deed Layer 1 (E1b) — READ-ONLY pre-fill source for the Quick Deed form. Reads the matter's uploaded
   * materials, consolidates the OCR-B1 facts, and returns the document-derived values the attorney would
   * otherwise re-type — each ATTORNEY-OVERRIDE-ABLE in the form. Flag-gated (fail-closed); ownership-scoped via
   * listMaterialsForMatter(ctx.userId). NEVER mutates and NEVER auto-uses anything beyond pre-populating the
   * form fields the attorney confirms. The derivation reference is surfaced only as a CANDIDATE (a deed body
   * never carries its own recording stamp), never pre-filled into the value. Mirrors the generate path's read +
   * consolidate so the pre-filled values match what generation will resolve.
   */
  previewFacts: protectedProcedure.input(z.object({ matterId: z.string().min(1) })).query(async ({ ctx, input }) => {
    if (!isDeedDraftAgentEnabled()) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'DEED_DRAFT_AGENT_DISABLED: the deed-draft agent is not enabled.' });
    }
    const materials = await listMaterialsForMatter(input.matterId, ctx.userId);
    const facts = consolidateDeedSourceFacts(materials.map((m) => ({ materialId: m.id, textContent: m.textContent })));
    const candidate = facts.derivationCandidates.value ?? (facts.derivationCandidates.values.join(', ') || null);
    return {
      hasMaterials: materials.length > 0,
      // Pre-fillable form fields (attorney-override-able): the recording locality and the grantee's address
      // (defaulted to the property situs per the operator rule). null = the packet did not supply it.
      locality: facts.propertyLocality.value,
      granteeAddress: facts.propertyAddress.value,
      // Surfaced as a CANDIDATE only (a hint beneath the field) — never auto-filled into the derivation value.
      derivationCandidate: candidate,
      // Resolution transparency so the UI can show "read from your uploads" for what the packet supplies.
      resolved: {
        legalDescription: !facts.legalDescription.withheld && facts.legalDescription.value !== null,
        parcelId: facts.parcelId.value !== null,
        assessedValue: facts.assessedValue.value !== null,
        locality: facts.propertyLocality.value !== null,
        propertyAddress: facts.propertyAddress.value !== null,
      },
      warnings: facts.warnings,
    };
  }),

  /**
   * Quick Deed Layer 2 (E3) — AI FREE-ASSOCIATE INTAKE. The attorney free-associates the deal in one text box;
   * a SINGLE model step PARSES → PROPOSES only the irreducible intake fields for the attorney to confirm. This
   * is the ONE LLM call on the deed track, and it runs through the EXISTING egress control plane
   * (documentEgressSend, surface 'intake', subject type 'matter') — NO new egress path / audit table / env var.
   * enforceProviderAllowlist stays TRUE (fail-closed; the allowlist ships inert in prod, so the parse is inert
   * until the operator populates GROUNDED_CHAT_PROVIDERS). PROPOSE-ONLY: returns the parsed proposal; NEVER
   * calls quickDeed.generate / buildGiftDraft, never persists, never records, never sends, and never authors a
   * legal/property description (the verbatim legal stays EXTRACTION-ONLY). Fail-closed on ambiguity: a
   * low-confidence / ambiguous / schema-invalid model output → { status:'needs_clarification', questions } — it
   * NEVER default-fills a contested donee or vesting. A DocumentEgressBlockedError (hold / uncertain hold /
   * provider not allowlisted) degrades to a clean blocked result, never a partial proposal.
   */
  proposeIntake: protectedProcedure
    .input(z.object({ matterId: z.string().uuid(), freeText: z.string().min(1).max(8000) }))
    .mutation(async ({ ctx, input }) => {
      // Flag + ownership (+ not-archived) gate — fail-closed. Quick Deed bypasses the conflicts-at-intake gate
      // (this is a parse, not a draft; nothing is persisted). Mirrors quickDeed.previewFacts / generate posture.
      await assertDeedDraftingAllowed(ctx.userId, input.matterId, { bypassConflicts: true });

      const systemPrompt = buildProposeIntakeSystemPrompt();
      const userPrompt = input.freeText;

      try {
        // Explicit 300s timeout (do not inherit a shorter default), matching the sendability classifier.
        const signal = AbortSignal.timeout(300_000);
        const llmResult = await documentEgressSend({
          subject: {
            type: 'matter',
            subjectId: input.matterId,
            matterId: input.matterId,
            userId: ctx.userId,
          },
          surface: 'intake',
          modelString: EVALUATOR_MODEL,
          llmParams: {
            systemPrompt,
            userPrompt,
            temperature: 0.1,
            maxTokens: 2048,
            structuredOutputSchema: ProposeIntakeOutputSchema,
            signal,
          },
          // Store-by-reference: the audit row hashes this, never the attorney's free text.
          serializedPayload: `${systemPrompt}\n\n${userPrompt}`,
          // Fail-closed provider allowlist (default) — the parse is inert in prod until the operator populates
          // GROUNDED_CHAT_PROVIDERS after confirming no-train/ZDR/DPA terms. Do NOT bypass.
          enforceProviderAllowlist: true,
        });
        // Validate + normalize against the proposal contract + the VA_VESTING_OPTIONS check. Fail-closed on
        // ambiguity / low confidence / invalid vesting / no donees → needs_clarification (never a partial proposal).
        return validateProposeIntakeOutput(llmResult.content);
      } catch (err) {
        if (err instanceof DocumentEgressBlockedError) {
          // The egress gate refused the send (a no_external hold, an uncertain hold check, or a provider not on
          // the allowlist). Return a clean blocked result — NEVER a partial/guessed proposal.
          return { status: 'blocked' as const, reason: err.blockReason };
        }
        throw err;
      }
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
    const materialRows = materials.map((m) => ({ id: m.id, textContent: m.textContent }));
    // The conflicts-bypass stamp (spec §5c) is written IFF the gate actually bypassed (single source of truth),
    // threaded into EVERY category's doc notes (schema-free, the existing free-text notes field).
    const conflictsNotes = conflictsBypassed ? [QUICK_DEED_NO_CONFLICTS_NOTE] : [];

    // ── Seller-Side dispatch (the first non-gift category; reuses the matter-scoped seller-side core) ──
    if (input.deedType === QUICK_DEED_SELLER_TYPE) {
      // Reconstitute the matter-scoped seller-side input from the nested payload + the shared top-level
      // party/grantee-address fields. The gift-shaped party rows ({name, descriptor}) are assignable to the
      // seller party shape (the seller-only formerlyOfRecord/variants/capacity are optional).
      const sellerInput: CreateSellerSideDraftInput = {
        ...input.sellerSide,
        matterId: input.matterId,
        grantors: input.grantors,
        grantees: input.grantees,
        granteeAddress: input.granteeAddress,
      };
      const { facts, draft } = buildSellerSideDraft(materialRows, sellerInput);
      if (draft.failedClosed) {
        // Fail-closed (truncated legal / name bleed / B2 estate scope): do NOT persist a void deed.
        return {
          documentId: null,
          matterId: input.matterId,
          versionId: null,
          title: null,
          conflictsBypassed,
          conflictsChecked: !conflictsBypassed,
          failedClosed: true,
          failures: draft.failures,
          factsResolved: null,
          placeholders: [] as string[],
          vesting: null,
          warranty: null,
          b6: null,
          recordableFloorOk: false,
          drafterNotes: [] as never[],
          notes: draft.notes,
          warnings: [...facts.warnings, ...draft.warnings],
        };
      }
      const sellerTitle = (input.title ?? '').trim() || 'Seller-Side Deed';
      const sellerDocNotes = buildSellerSideDocNotes(draft, conflictsNotes);
      const sellerDoc = await insertDocument({
        userId: ctx.userId,
        matterId: input.matterId,
        title: sellerTitle,
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
        notes: sellerDocNotes,
      });
      const sellerVersionNumber = await getNextVersionNumber(sellerDoc.id, ctx.userId);
      const sellerVersion = await insertVersion({
        userId: ctx.userId,
        documentId: sellerDoc.id,
        versionNumber: sellerVersionNumber,
        content: draft.text,
        generatedByJobId: null,
        iterationNumber: 1,
      });
      await updateDocumentCurrentVersion(sellerDoc.id, ctx.userId, sellerVersion.id);
      return {
        documentId: sellerDoc.id,
        matterId: input.matterId,
        versionId: sellerVersion.id,
        title: sellerTitle,
        conflictsBypassed,
        conflictsChecked: !conflictsBypassed,
        failedClosed: false,
        failures: [] as string[],
        factsResolved: null,
        placeholders: [] as string[],
        vesting: null,
        warranty: null,
        b6: null,
        recordableFloorOk: draft.recordableFloorOk,
        drafterNotes: [] as never[],
        notes: draft.notes,
        warnings: [...facts.warnings, ...draft.warnings],
      };
    }

    // ── Gift dispatch (default; input.deedType === QUICK_DEED_GIFT_TYPE) — the original v1 core, unchanged ──
    const giftInput = toGiftDeedInput(input);
    const { facts, draft } = buildGiftDraft(materialRows, giftInput);
    const drafterNotes = buildGiftDrafterNotes(facts, giftInput, draft);

    const title = (input.title ?? '').trim() || 'Deed of Gift';
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
      failedClosed: false,
      failures: [] as string[],
      factsResolved: draft.factsResolved,
      placeholders: draft.placeholders,
      vesting: draft.vesting,
      warranty: draft.warranty,
      b6: draft.b6,
      recordableFloorOk: null,
      drafterNotes: drafterNotes.notes,
      notes: draft.notes,
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
