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
