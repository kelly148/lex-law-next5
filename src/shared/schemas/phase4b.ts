/**
 * Phase 4b Zod Wall schemas (Ch 35.1 / R6)
 *
 * These schemas are the SOLE parse path for Phase 4b table rows.
 * All reads from information_requests, information_request_items,
 * document_outlines, feedback, feedback_evaluations,
 * feedback_manual_selections, and review_sessions must pass through
 * the corresponding schema before returning to callers.
 *
 * JSON columns are parsed strictly — unknown keys are stripped.
 */
import { z } from 'zod';

// ============================================================
// Shared sub-schemas for JSON columns
// ============================================================

/** A single section in a document outline (Ch 4.11) */
export const OutlineSectionSchema = z.object({
  title: z.string(),
  description: z.string(),
  orderIndex: z.number().int().nonnegative(),
});
export type OutlineSection = z.infer<typeof OutlineSectionSchema>;

/** A single suggestion from a reviewer (Ch 4.7) */
export const FeedbackSuggestionSchema = z.object({
  suggestionId: z.string(),
  title: z.string(),
  body: z.string(),
  severity: z.string().optional(),
});
export type FeedbackSuggestion = z.infer<typeof FeedbackSuggestionSchema>;

/** A single evaluator disposition (Ch 4.7) */
export const EvaluatorDispositionSchema = z.object({
  suggestionId: z.string(),
  disposition: z.enum(['adopt', 'reject', 'neutral']),
  synthesisBody: z.string().optional(),
});
export type EvaluatorDisposition = z.infer<typeof EvaluatorDispositionSchema>;

/**
 * A single selection in a review session (Ch 4.8)
 *
 * MR-4 §3.3 alias normalization: accepts both legacy { feedbackId } and
 * canonical { suggestionId } shapes on input, normalizing to { suggestionId }
 * at the Zod parse layer. All downstream code and all writes use the canonical
 * shape. No DB migration required (JSON column, no DB-level key constraint).
 *
 * .uuid() is retained on the canonical field because feedbackParser.ts stamps
 * every suggestion with crypto.randomUUID(), which always produces RFC 4122 v4
 * UUIDs (verified: crypto.randomUUID() → '51f6112f-9118-43cd-bc7c-e90c2878ed40').
 */
export const SessionSelectionSchema = z
  .object({
    // Canonical field — RFC 4122 UUID stamped by feedbackParser.
    suggestionId: z.string().uuid().optional(),
    // Legacy alias — accepted for backward-compatibility with any persisted rows
    // written before MR-4. Normalized to suggestionId at parse time.
    feedbackId: z.string().uuid().optional(),
    note: z.string().nullable(),
  })
  .transform((raw) => ({
    // Prefer canonical suggestionId; fall back to legacy feedbackId alias.
    suggestionId: (raw.suggestionId ?? raw.feedbackId) as string,
    note: raw.note,
  }))
  .refine((v) => typeof v.suggestionId === 'string' && v.suggestionId.length > 0, {
    message: 'SessionSelection must include either suggestionId or feedbackId',
  });
export type SessionSelection = z.infer<typeof SessionSelectionSchema>;

// ============================================================
// information_requests (Ch 4.10)
// ============================================================

export const InformationRequestRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  status: z.enum(['draft', 'exported', 'receiving_answers', 'complete']),
  archivedAt: z.date().nullable(),
  activeMatterKey: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type InformationRequestRow = z.infer<typeof InformationRequestRowSchema>;

// ============================================================
// information_request_items (Ch 4.10)
// ============================================================

export const InformationRequestItemRowSchema = z.object({
  id: z.string().uuid(),
  informationRequestId: z.string().uuid(),
  category: z.string(),
  questionText: z.string(),
  answerText: z.string().nullable(),
  orderIndex: z.number().int().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type InformationRequestItemRow = z.infer<typeof InformationRequestItemRowSchema>;

// ============================================================
// document_outlines (Ch 4.11)
// ============================================================

export const DocumentOutlineRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  documentId: z.string().uuid(),
  status: z.enum(['draft', 'approved', 'skipped']),
  sections: z.array(OutlineSectionSchema),
  generatedByJobId: z.string().uuid().nullable(),
  approvedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type DocumentOutlineRow = z.infer<typeof DocumentOutlineRowSchema>;

// ============================================================
// feedback (Ch 4.7)
// ============================================================

export const FeedbackRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  iterationNumber: z.number().int().nonnegative(),
  reviewSessionId: z.string().uuid().nullable(),
  jobId: z.string().uuid(),
  reviewerRole: z.string(),
  reviewerModel: z.string(),
  reviewerTitle: z.string(),
  suggestions: z.array(FeedbackSuggestionSchema),
  createdAt: z.date(),
});
export type FeedbackRow = z.infer<typeof FeedbackRowSchema>;

// ============================================================
// feedback_evaluations (Ch 4.7)
// ============================================================

export const FeedbackEvaluationRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  documentId: z.string().uuid(),
  iterationNumber: z.number().int().nonnegative(),
  jobId: z.string().uuid(),
  dispositions: z.array(EvaluatorDispositionSchema),
  createdAt: z.date(),
});
export type FeedbackEvaluationRow = z.infer<typeof FeedbackEvaluationRowSchema>;

// ============================================================
// feedback_manual_selections (Ch 4.7, R5)
// ============================================================

export const FeedbackManualSelectionRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  documentId: z.string().uuid(),
  iterationNumber: z.number().int().nonnegative(),
  reviewSessionId: z.string().uuid(),
  suggestionId: z.string(),
  attorneyNote: z.string().nullable(),
  createdAt: z.date(),
});
export type FeedbackManualSelectionRow = z.infer<typeof FeedbackManualSelectionRowSchema>;

// ============================================================
// review_sessions (Ch 4.8)
// ============================================================

export const ReviewSessionRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  documentId: z.string().uuid(),
  iterationNumber: z.number().int().nonnegative(),
  state: z.enum(['active', 'regenerated', 'abandoned']),
  selections: z.array(SessionSelectionSchema),
  selectedReviewers: z.array(z.string()),
  globalInstructions: z.string(),
  lastAutosavedAt: z.date().nullable(),
  // activeSessionKey is a GENERATED column — present on reads, never written (D.1.2, R10)
  activeSessionKey: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ReviewSessionRow = z.infer<typeof ReviewSessionRowSchema>;
