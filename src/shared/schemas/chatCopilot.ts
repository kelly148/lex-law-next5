/**
 * Zod Wall (Ch 35.1) for CHAT-COPILOT-1 — chat_conversations / chat_messages / chat_summaries.
 *
 * Every read of these three tables MUST pass through these schemas (parsed in
 * src/server/db/queries/chatCopilot.ts before any business logic sees a row).
 *
 * STORE-BY-REFERENCE is enforced by CONSTRUCTION: there is deliberately NO field here (or column in
 * schema.ts / migration 0033) for the compiled master body, the raw assembled context, full source
 * chunks, or NPI field values (wire / payoff / account / routing / SSN / TIN / ID images). A message
 * persists only the attorney turn text + model response, reference-only citations (sourceId + locator),
 * posture/audit metadata, and hashes. The Drizzle enum literal arrays live alongside the Zod enums and
 * are imported by schema.ts (kept in sync, mirroring reviewerLaneState / gateOverride).
 */

import { z } from 'zod';
// CHAT-COPILOT-2 A2: chat attachments reuse the materials extraction-status vocabulary (single source).
import { ExtractionStatusSchema } from './matters.js';

// ── Enum vocabularies (shared by schema.ts + the Zod Wall) ──────────────────────────────────────────

/**
 * Retention class for a conversation. The DEFAULT is 'active_matter_plus_5y' (active matter + 5 yrs
 * post-closure). The concrete period/handling per class is config (chatCopilotConfig.ts), not hardcoded
 * here — these are the class LABELS the column records. Legal hold is an orthogonal boolean, not a class.
 */
export const CHAT_CONVERSATION_RETENTION_CLASS_VALUES = [
  'active_matter_plus_5y',
  'matter_lifetime',
  'short_30d',
] as const;
export const ChatConversationRetentionClassSchema = z.enum(CHAT_CONVERSATION_RETENTION_CLASS_VALUES);
export type ChatConversationRetentionClass = (typeof CHAT_CONVERSATION_RETENTION_CLASS_VALUES)[number];

/** A turn is the attorney's message ('attorney') or the model's response ('assistant'). */
export const CHAT_MESSAGE_ROLE_VALUES = ['attorney', 'assistant'] as const;
export const ChatMessageRoleSchema = z.enum(CHAT_MESSAGE_ROLE_VALUES);
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLE_VALUES)[number];

// ── CHAT-COPILOT-2 Increment A: egress control plane vocabularies ─────────────────────────────────────

/**
 * holdFlag (CHAT-COPILOT-2 G2) — a per-conversation external-egress hold. `none` = no hold; `no_panel` =
 * the (Increment B) review panel must not run for this conversation; `no_external` = NOTHING from this
 * conversation may reach an external provider — it blocks BOTH the primary model call AND grounding
 * egress (an NDA / own-confidentiality conversation). Default 'none'.
 */
export const CHAT_HOLD_FLAG_VALUES = ['none', 'no_panel', 'no_external'] as const;
export const ChatHoldFlagSchema = z.enum(CHAT_HOLD_FLAG_VALUES);
export type ChatHoldFlag = (typeof CHAT_HOLD_FLAG_VALUES)[number];

/** The kind of copilot egress an event records (G1). The primary chat send, the grounded-context send, or
 *  the (Increment B) review-panel send — each independently gated + logged through the single broker. */
export const CHAT_EGRESS_KIND_VALUES = ['chat_primary', 'chat_grounding', 'chat_panel'] as const;
export const ChatEgressKindSchema = z.enum(CHAT_EGRESS_KIND_VALUES);
export type ChatEgressKind = (typeof CHAT_EGRESS_KIND_VALUES)[number];

/** The gate decision (G3): a send is allowed or BLOCKED — blocked sends are logged too (incident evidence). */
export const CHAT_EGRESS_DECISION_VALUES = ['allowed', 'blocked'] as const;
export const ChatEgressDecisionSchema = z.enum(CHAT_EGRESS_DECISION_VALUES);
export type ChatEgressDecision = (typeof CHAT_EGRESS_DECISION_VALUES)[number];

/** What authorized the send (G3): the config allowlist (Increment A) or a panel confirm (Increment B). */
export const CHAT_EGRESS_AUTH_BASIS_VALUES = ['config_allowlist', 'panel_confirm'] as const;
export const ChatEgressAuthBasisSchema = z.enum(CHAT_EGRESS_AUTH_BASIS_VALUES);
export type ChatEgressAuthBasis = (typeof CHAT_EGRESS_AUTH_BASIS_VALUES)[number];

/** Dispatch lifecycle of an egress event (G3). `blocked` = never dispatched (gate refused); `pending` =
 *  allowed + in flight; then success/failed/timeout/cancelled once the provider call resolves. */
export const CHAT_EGRESS_STATUS_VALUES = [
  'pending',
  'success',
  'failed',
  'blocked',
  'timeout',
  'cancelled',
] as const;
export const ChatEgressStatusSchema = z.enum(CHAT_EGRESS_STATUS_VALUES);
export type ChatEgressStatus = (typeof CHAT_EGRESS_STATUS_VALUES)[number];

// ── Embedded JSON shapes ────────────────────────────────────────────────────────────────────────────

/**
 * The capacity binding captured for a conversation (at start) and for each turn (at turn time). The
 * freeze-on-capacity-divergence key (Inc 2) and the capacity-bound key for summaries. `electionMarker`
 * is the ISO timestamp of the affirmative election (null = unelected); `titleSignal` is the resolved
 * title/settlement signal in the matter's practice area.
 */
export const CapacitySnapshotSchema = z.object({
  engagementCapacity: z.string().nullable(),
  electionMarker: z.string().nullable(),
  titleSignal: z.boolean(),
});
export type CapacitySnapshot = z.infer<typeof CapacitySnapshotSchema>;

/** A reference-ONLY citation: the sourceId the model was given + an optional locator. NEVER chunk text. */
export const ChatCitationSchema = z.object({
  sourceId: z.string(),
  locator: z.string().nullable().optional(),
});
export type ChatCitation = z.infer<typeof ChatCitationSchema>;

/** Structured posture metadata carried by a summary (never just prose) — so a summary is never compressed
 *  across a master/non-master boundary and a law-firm-capacity summary is never fed into a title turn. */
export const ChatSummaryPostureSchema = z.object({
  masterApplied: z.boolean(),
  masterSource: z.string().nullable(),
  engagementCapacity: z.string().nullable(),
  electionMarker: z.string().nullable(),
  titleSignal: z.boolean(),
});
export type ChatSummaryPosture = z.infer<typeof ChatSummaryPostureSchema>;

// ── Row schemas ─────────────────────────────────────────────────────────────────────────────────────

export const ChatConversationRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  // Immutable binding: a conversation belongs to exactly one matter, forever.
  matterId: z.string().uuid(),
  // Immutable / explicitly-versioned document binding (nullable — a conversation need not be doc-bound).
  documentId: z.string().uuid().nullable(),
  documentVersionId: z.string().uuid().nullable(),
  title: z.string().max(256).nullable(),
  capacitySnapshot: CapacitySnapshotSchema,
  retentionClass: ChatConversationRetentionClassSchema,
  legalHold: z.boolean(),
  legalHoldReason: z.string().nullable(),
  doNotPersist: z.boolean(),
  excludeFromGrounding: z.boolean(),
  // CHAT-COPILOT-2 G2 external-egress hold. Default 'none' so pre-A2 rows / in-memory fixtures (which
  // predate the column) read as no-hold; the DB column also defaults 'none'.
  holdFlag: ChatHoldFlagSchema.default('none'),
  frozenAt: z.date().nullable(),
  freezeReason: z.string().nullable(),
  closedAt: z.date().nullable(),
  exportedAt: z.date().nullable(),
  exportRef: z.string().nullable(),
  deletedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ChatConversationRow = z.infer<typeof ChatConversationRowSchema>;

export const ChatMessageRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  conversationId: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  role: ChatMessageRoleSchema,
  // content: the attorney turn text or the model response. NULL on a do-not-persist tombstone.
  content: z.string().nullable(),
  contentHash: z.string().nullable(),
  // masterApplied / masterSource: AUDIT-ONLY. The live per-turn gate (Inc 2) NEVER trusts these.
  masterApplied: z.boolean(),
  masterSource: z.string().nullable(),
  capacitySnapshot: CapacitySnapshotSchema.nullable(),
  draftingGateDecisionId: z.string().nullable(),
  citations: z.array(ChatCitationSchema).nullable(),
  modelProvider: z.string().nullable(),
  modelId: z.string().nullable(),
  doNotPersist: z.boolean(),
  excludeFromGrounding: z.boolean(),
  createdAt: z.date(),
});
export type ChatMessageRow = z.infer<typeof ChatMessageRowSchema>;

export const ChatSummaryRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  conversationId: z.string().uuid(),
  capacitySnapshot: CapacitySnapshotSchema,
  posture: ChatSummaryPostureSchema,
  coversFromSeq: z.number().int().nonnegative(),
  coversToSeq: z.number().int().nonnegative(),
  summaryText: z.string(),
  createdAt: z.date(),
});
export type ChatSummaryRow = z.infer<typeof ChatSummaryRowSchema>;

/**
 * chat_egress_events (CHAT-COPILOT-2 G3) — the append-only, immutable audit record of EVERY copilot
 * egress decision: the GLBA/incident-detection evidence. CONTAINS NO NPI, NO full prompts, NO raw
 * provider payloads — only metadata + a salted/keyed hash over the MINIMIZED payload (inputBundleHash).
 * Blocked sends are logged too (decision='blocked' + blockReason). Outlives the matter.
 *
 * `status`/`failureReason`/`completedAt`/token counts are filled in by a single completion update after
 * dispatch; the decision + payload hash + metadata are never mutated once written.
 */
export const ChatEgressEventRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  conversationId: z.string().uuid().nullable(),
  messageId: z.string().uuid().nullable(),
  // The deterministic id of the drafting/posture gate decision at egress time (provenance back-link).
  gateDecisionId: z.string().nullable(),
  kind: ChatEgressKindSchema,
  decision: ChatEgressDecisionSchema,
  blockReason: z.string().nullable(),
  // A snapshot id/hash of the allowlist policy at decision time (which providers were permitted).
  allowlistVersion: z.string().nullable(),
  authorizationBasis: ChatEgressAuthBasisSchema,
  provider: z.string(),
  model: z.string(),
  // Minimization: was NPI minimization applied + which categories were included vs withheld (no values).
  minimizationApplied: z.boolean(),
  minimizationProfile: z.string().nullable(),
  npiCategoriesIncluded: z.array(z.string()).nullable(),
  npiCategoriesWithheld: z.array(z.string()).nullable(),
  // Hold: was a hold honored + which attachment ids were excluded by it (ids only, never content).
  holdHonored: z.boolean(),
  holdExcludedAttachmentIds: z.array(z.string()).nullable(),
  // Salted/keyed hash over the actual serialized, minimized, hold-filtered payload (Q1: hash-at-gate).
  inputBundleHash: z.string().nullable(),
  attachmentIds: z.array(z.string()).nullable(),
  region: z.string().nullable(),
  correlationId: z.string(),
  requestId: z.string().nullable(),
  status: ChatEgressStatusSchema,
  failureReason: z.string().nullable(),
  // Aggregate supervision fields (Q7): queryable volume without opening the payload.
  includedAttachmentCount: z.number().int().nonnegative(),
  npiWithheldCount: z.number().int().nonnegative(),
  createdAt: z.date(),
  completedAt: z.date().nullable(),
});
export type ChatEgressEventRow = z.infer<typeof ChatEgressEventRowSchema>;

// ── CHAT-COPILOT-2 A2: ephemeral chat attachments (G5 OCR quality + Q3/Q5) ────────────────────────────

/**
 * G5 title-document OCR-quality warnings. The "dangerous-middle" fields (legal_description +
 * recording_parcel_instrument_identifier) are NEVER authoritative context without an attorney verify
 * affordance + a source-image spot-check. graphical_document flags plats/surveys (extraction incomplete
 * by nature). visual_review_required is the umbrella "an attorney must look at the image" flag.
 */
export const CHAT_ATTACHMENT_WARNING_VALUES = [
  'legal_description',
  'recording_parcel_instrument_identifier',
  'graphical_document',
  'handwriting_or_seal',
  'skew_or_rotation',
  'low_confidence',
  'visual_review_required',
] as const;
export const ChatAttachmentWarningSchema = z.enum(CHAT_ATTACHMENT_WARNING_VALUES);
export type ChatAttachmentWarning = (typeof CHAT_ATTACHMENT_WARNING_VALUES)[number];

/** Structured OCR-quality metadata for an attachment. NO NPI: only confidences + warning labels + the
 *  TYPES of dangerous-middle fields detected (never the field values). */
export const AttachmentOcrQualitySchema = z.object({
  meanConfidence: z.number().nullable(),
  pageCount: z.number().int().nonnegative().nullable(),
  perPageConfidence: z.array(z.number()).nullable(),
  warnings: z.array(ChatAttachmentWarningSchema),
  // Labels (e.g. 'parcel_id', 'instrument_number', 'book_page') of dangerous-middle fields detected —
  // NEVER the values themselves.
  dangerousMiddleFieldTypes: z.array(z.string()),
  visualReviewRequired: z.boolean(),
});
export type AttachmentOcrQuality = z.infer<typeof AttachmentOcrQualitySchema>;

/** How an attachment was attributed to a party at save-to-matter (Q3 role-based intra-matter exclusion). */
export const CHAT_ATTACHMENT_ATTRIBUTION_VALUES = ['explicit', 'inferred'] as const;
export const ChatAttachmentAttributionSchema = z.enum(CHAT_ATTACHMENT_ATTRIBUTION_VALUES);
export type ChatAttachmentAttribution = (typeof CHAT_ATTACHMENT_ATTRIBUTION_VALUES)[number];

/**
 * A chat attachment: EPHEMERAL by default (purged at conversation end; immediately on do-not-persist),
 * store-BY-REFERENCE (extracted text + metadata, NOT raw file bytes), conversation-scoped (selected for
 * this turn, NOT globally available unless saved/pinned). `pinned` = provenance-pinned (survives purge);
 * `savedMaterialId` is set when promoted to a matter_material. `textContent` follows the honesty floor
 * (NULL on low-confidence/failed — never silently enters context). `holdFlag` is a per-attachment hold.
 */
export const ChatAttachmentRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  conversationId: z.string().uuid(),
  filename: z.string().max(512).nullable(),
  mimeType: z.string().max(128).nullable(),
  fileSize: z.number().int().nonnegative().nullable(),
  storageKey: z.string().max(512).nullable(),
  // contentHash: SHA-256 of the uploaded bytes — cross-matter duplicate detection (Q3). NOT NPI.
  contentHash: z.string().max(64).nullable(),
  textContent: z.string().nullable(),
  extractionStatus: ExtractionStatusSchema,
  extractionError: z.string().nullable(),
  ocrQuality: AttachmentOcrQualitySchema.nullable(),
  holdFlag: ChatHoldFlagSchema.default('none'),
  // Q5: the attorney accepted the low-confidence/warning RISK for this attachment ("accepted risk",
  // NOT "the text is correct"). Travels into context visibly; never propagates as verified.
  acceptedWithWarning: z.boolean(),
  // Provenance-pinned (Q6 seam): a pinned attachment SURVIVES the conversation-end purge.
  pinned: z.boolean(),
  // Set when promoted to a matter_material (save-to-matter is the retention act).
  savedMaterialId: z.string().uuid().nullable(),
  seq: z.number().int().nonnegative(),
  deletedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ChatAttachmentRow = z.infer<typeof ChatAttachmentRowSchema>;

/** Optional party attribution captured at save-to-matter (Q3) — which matter party a document belongs to,
 *  so role-based intra-matter exclusion (buyer-vs-seller financials, insured-vs-lender) is enforceable. */
export const ChatAttachmentPartyRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  attachmentId: z.string().uuid(),
  partyId: z.string().uuid().nullable(),
  partyRole: z.string().max(64).nullable(),
  attribution: ChatAttachmentAttributionSchema,
  createdAt: z.date(),
});
export type ChatAttachmentPartyRow = z.infer<typeof ChatAttachmentPartyRowSchema>;

// ── CHAT-COPILOT-2 Increment B: multi-model review panel (chat_review_runs / _raw_outputs / _items) ────

/**
 * Run-level lifecycle. `prepared` = the attorney panel-confirmed the post-minimization/post-hold bundle
 * and reviewer set, persisted, NOT yet dispatched; `running` = reviewer lanes in flight; `complete` = all
 * lanes terminal and the dispositioner resolved (or explicitly skipped); `failed` = run-level abort.
 */
export const CHAT_REVIEW_RUN_STATUS_VALUES = ['prepared', 'running', 'complete', 'failed'] as const;
export const ChatReviewRunStatusSchema = z.enum(CHAT_REVIEW_RUN_STATUS_VALUES);
export type ChatReviewRunStatus = (typeof CHAT_REVIEW_RUN_STATUS_VALUES)[number];

/**
 * The PRIMARY (Claude) dispositioner lane status. `skipped` = zero reviewers succeeded, so there was
 * nothing to disposition; `failed` = the dispositioner errored / was off-allowlist — the raw reviewer
 * suggestions are shown explicitly marked "not yet synthesized", never as vetted.
 */
export const CHAT_REVIEW_DISPOSITIONER_STATUS_VALUES = ['pending', 'success', 'failed', 'skipped'] as const;
export const ChatReviewDispositionerStatusSchema = z.enum(CHAT_REVIEW_DISPOSITIONER_STATUS_VALUES);
export type ChatReviewDispositionerStatus = (typeof CHAT_REVIEW_DISPOSITIONER_STATUS_VALUES)[number];

/** Per-reviewer-lane dispatch status (mirrors the egress lifecycle for one panel reviewer send). */
export const CHAT_REVIEW_LANE_STATUS_VALUES = ['pending', 'success', 'failed', 'blocked', 'timeout'] as const;
export const ChatReviewLaneStatusSchema = z.enum(CHAT_REVIEW_LANE_STATUS_VALUES);
export type ChatReviewLaneStatus = (typeof CHAT_REVIEW_LANE_STATUS_VALUES)[number];

/** The PRIMARY's disposition of ONE reviewer suggestion. Advisory — nothing auto-applies. */
export const CHAT_REVIEW_DISPOSITION_VALUES = ['adopt', 'reject', 'modify_and_adopt'] as const;
export const ChatReviewDispositionSchema = z.enum(CHAT_REVIEW_DISPOSITION_VALUES);
export type ChatReviewDisposition = (typeof CHAT_REVIEW_DISPOSITION_VALUES)[number];

/**
 * Whether a reviewer-cited source is present in the panel bundle. `in_bundle` = cited a source that WAS
 * transmitted; `unverified` = cited a source NOT in the bundle — FLAGGED "unverified against bundle", NOT
 * auto-rejected (a reviewer may correctly cite a real authority outside the bundle).
 */
export const CHAT_REVIEW_CITATION_STATUS_VALUES = ['in_bundle', 'unverified'] as const;
export const ChatReviewCitationStatusSchema = z.enum(CHAT_REVIEW_CITATION_STATUS_VALUES);
export type ChatReviewCitationStatus = (typeof CHAT_REVIEW_CITATION_STATUS_VALUES)[number];

/** The attorney's FINAL per-suggestion decision (the backstop; nothing auto-applies). `pending` until set. */
export const CHAT_REVIEW_ATTORNEY_DECISION_VALUES = ['pending', 'accept', 'override'] as const;
export const ChatReviewAttorneyDecisionSchema = z.enum(CHAT_REVIEW_ATTORNEY_DECISION_VALUES);
export type ChatReviewAttorneyDecision = (typeof CHAT_REVIEW_ATTORNEY_DECISION_VALUES)[number];

/**
 * chat_review_runs — one on-demand panel review of a chat work product. Owner + matter scoped. Records
 * the panel-confirmed reviewer set + the provenance hashes (the work product reviewed + the minimized,
 * hold-filtered bundle that actually transmitted). Work-product (purges WITH the matter).
 */
export const ChatReviewRunRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  conversationId: z.string().uuid(),
  // The assistant message (chat work product) under review; nullable if reviewing free-standing text.
  messageId: z.string().uuid().nullable(),
  // Hash of the chat work product under review (stable provenance of WHAT was reviewed).
  workProductHash: z.string(),
  // Hash of the minimized, hold-filtered bundle that actually transmits (the post-filter reality).
  bundleHash: z.string(),
  // The attorney-selected reviewer model keys for this run (e.g. ['gpt','gemini']); NEVER 'claude'.
  reviewerModels: z.array(z.string()),
  status: ChatReviewRunStatusSchema,
  dispositionerStatus: ChatReviewDispositionerStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ChatReviewRunRow = z.infer<typeof ChatReviewRunRowSchema>;

/**
 * chat_review_raw_outputs — the VERBATIM raw reviewer output, stored BY-REFERENCE and DISTINCT from the
 * itemized suggestions (synthesis fidelity: persisted or it didn't happen). One row per reviewer lane.
 * Owner + matter scoped; work-product (purges WITH the matter).
 */
export const ChatReviewRawOutputRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  runId: z.string().uuid(),
  reviewerModel: z.string(),
  // The verbatim raw model output for this lane. NULL when the lane failed/blocked (no output produced).
  rawText: z.string().nullable(),
  laneStatus: ChatReviewLaneStatusSchema,
  laneFailureReason: z.string().nullable(),
  // The chat_egress_events id for this lane's send (audit back-link — every lane is its own logged egress).
  egressEventId: z.string().uuid().nullable(),
  createdAt: z.date(),
});
export type ChatReviewRawOutputRow = z.infer<typeof ChatReviewRawOutputRowSchema>;

/**
 * chat_review_items — ONE itemized reviewer suggestion and its PRIMARY disposition. 1:1 traceability:
 * every reviewer suggestion maps to exactly one item (no silent merge/drop), each carries a suggestion
 * hash and a by-reference link to the verbatim raw output. Owner + matter scoped; work-product.
 */
export const ChatReviewItemRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  runId: z.string().uuid(),
  reviewerModel: z.string(),
  // By-reference link to the verbatim raw reviewer output this suggestion was itemized from.
  rawOutputRef: z.string().uuid().nullable(),
  // Hash of the reviewer suggestion text — the 1:1 traceability key.
  suggestionHash: z.string(),
  suggestion: z.string(),
  // The PRIMARY (Claude) disposition + reasoning. NULL until dispositioned (degraded: "not yet synthesized").
  primaryDisposition: ChatReviewDispositionSchema.nullable(),
  primaryReasoning: z.string().nullable(),
  // Whether the suggestion's cited source is present in the bundle (flag-not-reject).
  citationStatus: ChatReviewCitationStatusSchema.nullable(),
  // The attorney's FINAL decision (the backstop). Nothing auto-applies.
  attorneyDecision: ChatReviewAttorneyDecisionSchema,
  attorneyOverrideReason: z.string().nullable(),
  laneStatus: ChatReviewLaneStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ChatReviewItemRow = z.infer<typeof ChatReviewItemRowSchema>;
