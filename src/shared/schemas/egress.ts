/**
 * EGRESS-CONTROL-PLANE-1 — shared contract for the surface-agnostic external-model egress control plane.
 *
 * The control boundary is external-egress-of-client-content vs. no-external-egress — NOT chat vs. document
 * (triad disposition, 2026-06-16). Surface (chat/document/...) is a FIELD on the audit row, not a gate on
 * whether the row exists. Every external send of client/matter content gets ONE durable, pre-dispatch,
 * hold-aware allow/block decision row in `egress_events`; a scoped `egress_hold` expresses no_external at
 * conversation / matter / global scope (precedence global > matter > conversation).
 *
 * RETENTION (load-bearing): a row stores a content HASH/REFERENCE only (inputBundleHash) + metadata +
 * the document/version scope — NEVER the draft text. The ledger must not become a second unprotected
 * repository of privileged content.
 */
import { z } from 'zod';

// ── Surface — which product surface produced the egress (the surface-agnostic discriminator). Chat
//    surfaces are listed for the unified ledger/queries; the increment-1 pilot is 'sendability'; the
//    remaining document surfaces onboard in later increments. ──
export const EGRESS_SURFACE_VALUES = [
  'chat_copilot',
  'chat_grounding',
  'chat_panel',
  'sendability',
  'reviewer',
  'drafter',
  'evaluator',
  'outline',
  'intake',
  'information_request',
] as const;
export const EgressSurfaceSchema = z.enum(EGRESS_SURFACE_VALUES);
export type EgressSurface = (typeof EGRESS_SURFACE_VALUES)[number];

// ── egressSubject — the polymorphic subject of one external send. NO synthetic conversationId for a
//    document send: the document linkage rides documentId/documentVersionId; conversationId stays null. ──
export const EGRESS_SUBJECT_TYPE_VALUES = ['conversation', 'document', 'document_job', 'matter'] as const;
export const EgressSubjectTypeSchema = z.enum(EGRESS_SUBJECT_TYPE_VALUES);
export type EgressSubjectType = (typeof EGRESS_SUBJECT_TYPE_VALUES)[number];

export const EgressSubjectSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('conversation'),
    subjectId: z.string(),
    matterId: z.string().uuid(),
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('document'),
    subjectId: z.string(),
    matterId: z.string().uuid(),
    userId: z.string().uuid(),
    documentId: z.string().uuid(),
    documentVersionId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('document_job'),
    subjectId: z.string(),
    matterId: z.string().uuid(),
    userId: z.string().uuid(),
    documentId: z.string().uuid(),
    documentVersionId: z.string().uuid(),
    jobId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('matter'),
    subjectId: z.string(),
    matterId: z.string().uuid(),
    userId: z.string().uuid(),
  }),
]);
export type EgressSubject = z.infer<typeof EgressSubjectSchema>;

// ── Hold scope + flag. holdFlag reuses the chat vocabulary so the gate logic ('no_external' blocks) is
//    identical across surfaces; scope is the new axis the conversation-only hold could not express. ──
export const EGRESS_HOLD_SCOPE_VALUES = ['conversation', 'matter', 'global'] as const;
export const EgressHoldScopeSchema = z.enum(EGRESS_HOLD_SCOPE_VALUES);
export type EgressHoldScope = (typeof EGRESS_HOLD_SCOPE_VALUES)[number];

export const EGRESS_HOLD_FLAG_VALUES = ['none', 'no_panel', 'no_external'] as const;
export const EgressHoldFlagSchema = z.enum(EGRESS_HOLD_FLAG_VALUES);
export type EgressHoldFlag = (typeof EGRESS_HOLD_FLAG_VALUES)[number];

/** Precedence order for the scoped-hold evaluator: a higher-scope hold binds over a lower one. */
export const EGRESS_HOLD_SCOPE_PRECEDENCE: readonly EgressHoldScope[] = ['global', 'matter', 'conversation'] as const;

// ── Decision + outcome status (reuse the chat vocabulary). ──
export const EGRESS_DECISION_VALUES = ['allowed', 'blocked'] as const;
export const EgressDecisionSchema = z.enum(EGRESS_DECISION_VALUES);
export type EgressDecision = (typeof EGRESS_DECISION_VALUES)[number];

export const EGRESS_STATUS_VALUES = ['pending', 'success', 'blocked', 'failed', 'timeout', 'cancelled'] as const;
export const EgressStatusSchema = z.enum(EGRESS_STATUS_VALUES);
export type EgressStatus = (typeof EGRESS_STATUS_VALUES)[number];

// ── egress_events — the generalized, surface-agnostic audit ledger row (Zod Wall). Store-by-reference:
//    inputBundleHash is a salted/keyed hash over the minimized payload, NEVER the draft text. ──
export const EgressEventRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  surface: EgressSurfaceSchema,
  subjectType: EgressSubjectTypeSchema,
  // Polymorphic subject scope (nullable per type). A document send leaves conversationId NULL.
  conversationId: z.string().uuid().nullable(),
  documentId: z.string().uuid().nullable(),
  documentVersionId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),
  // The hold SCOPE that supplied the binding decision (provenance of why a send was blocked/allowed).
  holdScope: EgressHoldScopeSchema.nullable(),
  decision: EgressDecisionSchema,
  blockReason: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  // Policy version: a stable fingerprint of the allowlist policy at decision time.
  policyVersion: z.string().nullable(),
  // Content HASH/reference — NEVER the draft text (privilege/GLBA: store-by-reference).
  inputBundleHash: z.string().nullable(),
  correlationId: z.string(),
  status: EgressStatusSchema,
  failureReason: z.string().nullable(),
  createdAt: z.date(),
  completedAt: z.date().nullable(),
});
export type EgressEventRow = z.infer<typeof EgressEventRowSchema>;

// ── egress_hold — a scoped external-egress hold (Zod Wall). subjectId = conversationId | matterId; NULL
//    for scope='global'. matterId set for conversation/matter scope (purges with the matter); NULL for a
//    firm-level global hold (retained across matter purge). Release is audit-preserving (active + releasedAt). ──
export const EgressHoldRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  scope: EgressHoldScopeSchema,
  subjectId: z.string().nullable(),
  matterId: z.string().uuid().nullable(),
  holdFlag: EgressHoldFlagSchema,
  reason: z.string().nullable(),
  active: z.boolean(),
  createdByUserId: z.string().uuid(),
  createdAt: z.date(),
  releasedAt: z.date().nullable(),
});
export type EgressHoldRow = z.infer<typeof EgressHoldRowSchema>;
