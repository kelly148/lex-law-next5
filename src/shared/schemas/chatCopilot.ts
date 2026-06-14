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
