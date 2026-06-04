/**
 * Phase 4b Zod Wall query wrappers (Ch 35.1 / R6)
 *
 * This is the SOLE read path for Phase 4b tables:
 *   information_requests, information_request_items, document_outlines,
 *   feedback, feedback_evaluations, feedback_manual_selections, review_sessions.
 *
 * All rows pass through the corresponding Zod schema before returning.
 * JSON columns are parsed strictly.
 */
import { eq, and, isNull, desc, asc, inArray } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import {
  informationRequests,
  informationRequestItems,
  documentOutlines,
  feedback,
  feedbackEvaluations,
  feedbackManualSelections,
  reviewSessions,
  lockedDecisions,
  adoptLedger,
  type InformationRequest,
  type InformationRequestItem,
  type DocumentOutline,
  type Feedback,
  type FeedbackEvaluation,
  type FeedbackManualSelection,
  type ReviewSession,
  type LockedDecision,
  type AdoptLedger,
} from '../schema.js';
import { type ConfirmationMode } from '../../../shared/schemas/orchestration.js';
import {
  InformationRequestRowSchema,
  InformationRequestItemRowSchema,
  DocumentOutlineRowSchema,
  FeedbackRowSchema,
  FeedbackEvaluationRowSchema,
  FeedbackManualSelectionRowSchema,
  ReviewSessionRowSchema,
  LockedDecisionRowSchema,
  AdoptLedgerRowSchema,
  type InformationRequestRow,
  type InformationRequestItemRow,
  type DocumentOutlineRow,
  type FeedbackRow,
  type FeedbackEvaluationRow,
  type FeedbackManualSelectionRow,
  type ReviewSessionRow,
  type LockedDecisionRow,
  type AdoptLedgerRow,
} from '../../../shared/schemas/phase4b.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ownerScope } from '../ownerScope.js';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// Parse helpers
// ============================================================

function parseInformationRequestRow(
  raw: InformationRequest,
  ctx: { userId: string },
): InformationRequestRow {
  try {
    return InformationRequestRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'InformationRequestRowSchema',
          tableName: 'information_requests',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

function parseInformationRequestItemRow(
  raw: InformationRequestItem,
  ctx: { userId: string },
): InformationRequestItemRow {
  try {
    return InformationRequestItemRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'InformationRequestItemRowSchema',
          tableName: 'information_request_items',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

function parseDocumentOutlineRow(
  raw: DocumentOutline,
  ctx: { userId: string },
): DocumentOutlineRow {
  try {
    return DocumentOutlineRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'DocumentOutlineRowSchema',
          tableName: 'document_outlines',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

function parseFeedbackRow(
  raw: Feedback,
  ctx: { userId: string },
): FeedbackRow {
  try {
    return FeedbackRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'FeedbackRowSchema',
          tableName: 'feedback',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

function parseFeedbackEvaluationRow(
  raw: FeedbackEvaluation,
  ctx: { userId: string },
): FeedbackEvaluationRow {
  try {
    return FeedbackEvaluationRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'FeedbackEvaluationRowSchema',
          tableName: 'feedback_evaluations',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

function parseFeedbackManualSelectionRow(
  raw: FeedbackManualSelection,
  ctx: { userId: string },
): FeedbackManualSelectionRow {
  try {
    return FeedbackManualSelectionRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'FeedbackManualSelectionRowSchema',
          tableName: 'feedback_manual_selections',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

function parseReviewSessionRow(
  raw: ReviewSession,
  ctx: { userId: string },
): ReviewSessionRow {
  try {
    return ReviewSessionRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'ReviewSessionRowSchema',
          tableName: 'review_sessions',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

// ============================================================
// information_requests queries
// ============================================================

export async function getActiveInformationRequestForMatter(
  matterId: string,
  userId: string,
): Promise<InformationRequestRow | null> {
  const rows = await db
    .select()
    .from(informationRequests)
    .where(
      and(
        eq(informationRequests.matterId, matterId),
        eq(informationRequests.userId, userId),
        isNull(informationRequests.archivedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return parseInformationRequestRow(rows[0]!, { userId });
}

export async function getInformationRequestById(
  id: string,
  userId: string,
): Promise<InformationRequestRow | null> {
  const rows = await db
    .select()
    .from(informationRequests)
    .where(
      and(eq(informationRequests.id, id), eq(informationRequests.userId, userId)),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return parseInformationRequestRow(rows[0]!, { userId });
}

export async function listInformationRequestsForMatter(
  matterId: string,
  userId: string,
): Promise<InformationRequestRow[]> {
  const rows = await db
    .select()
    .from(informationRequests)
    .where(
      and(
        eq(informationRequests.matterId, matterId),
        eq(informationRequests.userId, userId),
      ),
    )
    .orderBy(desc(informationRequests.createdAt));
  return rows.map((r) => parseInformationRequestRow(r, { userId }));
}

export async function insertInformationRequest(data: {
  id?: string;
  userId: string;
  matterId: string;
  status?: 'draft' | 'exported' | 'receiving_answers' | 'complete';
}): Promise<string> {
  const id = data.id ?? uuidv4();
  await db.insert(informationRequests).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    status: data.status ?? 'draft',
  });
  return id;
}

export async function updateInformationRequestStatus(
  id: string,
  userId: string,
  status: 'draft' | 'exported' | 'receiving_answers' | 'complete',
): Promise<void> {
  await db
    .update(informationRequests)
    .set({ status })
    .where(
      and(eq(informationRequests.id, id), eq(informationRequests.userId, userId)),
    );
}

export async function archiveInformationRequest(
  id: string,
  userId: string,
): Promise<void> {
  await db
    .update(informationRequests)
    .set({ archivedAt: new Date() })
    .where(
      and(eq(informationRequests.id, id), eq(informationRequests.userId, userId)),
    );
}

// ============================================================
// information_request_items queries
// ============================================================

export async function listItemsForInformationRequest(
  informationRequestId: string,
  userId: string,
): Promise<InformationRequestItemRow[]> {
  const rows = await db
    .select()
    .from(informationRequestItems)
    .where(eq(informationRequestItems.informationRequestId, informationRequestId))
    .orderBy(asc(informationRequestItems.orderIndex));
  return rows.map((r) => parseInformationRequestItemRow(r, { userId }));
}

export async function getInformationRequestItemById(
  id: string,
  userId: string,
): Promise<InformationRequestItemRow | null> {
  const rows = await db
    .select()
    .from(informationRequestItems)
    .where(eq(informationRequestItems.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  return parseInformationRequestItemRow(rows[0]!, { userId });
}

export async function insertInformationRequestItem(data: {
  id?: string;
  informationRequestId: string;
  category: string;
  questionText: string;
  orderIndex: number;
}): Promise<string> {
  const id = data.id ?? uuidv4();
  await db.insert(informationRequestItems).values({
    id,
    informationRequestId: data.informationRequestId,
    category: data.category,
    questionText: data.questionText,
    answerText: null,
    orderIndex: data.orderIndex,
  });
  return id;
}

export async function updateInformationRequestItem(
  id: string,
  updates: Partial<{
    category: string;
    questionText: string;
    answerText: string | null;
    orderIndex: number;
  }>,
): Promise<void> {
  await db
    .update(informationRequestItems)
    .set(updates)
    .where(eq(informationRequestItems.id, id));
}

export async function deleteInformationRequestItem(id: string): Promise<void> {
  await db
    .delete(informationRequestItems)
    .where(eq(informationRequestItems.id, id));
}

// ============================================================
// document_outlines queries
// ============================================================

export async function getOutlineForDocument(
  documentId: string,
  userId: string,
): Promise<DocumentOutlineRow | null> {
  const rows = await db
    .select()
    .from(documentOutlines)
    .where(
      and(
        eq(documentOutlines.documentId, documentId),
        eq(documentOutlines.userId, userId),
      ),
    )
    .orderBy(desc(documentOutlines.createdAt))
    .limit(1);
  if (rows.length === 0) return null;
  return parseDocumentOutlineRow(rows[0]!, { userId });
}

export async function getOutlineById(
  id: string,
  userId: string,
): Promise<DocumentOutlineRow | null> {
  const rows = await db
    .select()
    .from(documentOutlines)
    .where(
      and(eq(documentOutlines.id, id), eq(documentOutlines.userId, userId)),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return parseDocumentOutlineRow(rows[0]!, { userId });
}

export async function insertDocumentOutline(data: {
  id?: string;
  userId: string;
  documentId: string;
  generatedByJobId?: string;
}): Promise<string> {
  const id = data.id ?? uuidv4();
  await db.insert(documentOutlines).values({
    id,
    userId: data.userId,
    documentId: data.documentId,
    status: 'draft',
    sections: [],
    generatedByJobId: data.generatedByJobId ?? null,
  });
  return id;
}

export async function updateDocumentOutline(
  id: string,
  userId: string,
  updates: Partial<{
    status: 'draft' | 'approved' | 'skipped';
    sections: unknown;
    approvedAt: Date | null;
  }>,
): Promise<void> {
  await db
    .update(documentOutlines)
    .set(updates)
    .where(
      and(eq(documentOutlines.id, id), eq(documentOutlines.userId, userId)),
    );
}

// ============================================================
// feedback queries
// ============================================================

export async function getFeedbackById(
  id: string,
  userId: string,
): Promise<FeedbackRow | null> {
  const rows = await db
    .select()
    .from(feedback)
    .where(and(eq(feedback.id, id), eq(feedback.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseFeedbackRow(rows[0]!, { userId });
}

export async function listFeedbackForSession(
  reviewSessionId: string,
  userId: string,
): Promise<FeedbackRow[]> {
  const rows = await db
    .select()
    .from(feedback)
    .where(
      and(
        eq(feedback.reviewSessionId, reviewSessionId),
        eq(feedback.userId, userId),
      ),
    )
    .orderBy(asc(feedback.createdAt));
  return rows.map((r) => parseFeedbackRow(r, { userId }));
}

/**
 * listFeedbackForDocument — MR-2 §S2a
 *
 * Returns all feedback rows for a document, ordered by iterationNumber ASC
 * then createdAt ASC, excluding rows whose associated review session is in
 * 'abandoned' state (operator decision: exclude-where-feasible).
 *
 * Rows with a NULL reviewSessionId (orphaned feedback) are included because
 * they cannot be attributed to an abandoned session.
 *
 * Ownership: feedback.userId === userId (enforced in WHERE clause).
 */
export async function listFeedbackForDocument(
  documentId: string,
  userId: string,
): Promise<FeedbackRow[]> {
  // Left-join review_sessions to read session state alongside each feedback row.
  // Post-filter excludes rows from abandoned sessions.
  // The result set is bounded by (documentId, userId) so post-filtering is safe.
  const rows = await db
    .select({
      id: feedback.id,
      userId: feedback.userId,
      documentId: feedback.documentId,
      versionId: feedback.versionId,
      iterationNumber: feedback.iterationNumber,
      reviewSessionId: feedback.reviewSessionId,
      jobId: feedback.jobId,
      reviewerRole: feedback.reviewerRole,
      reviewerModel: feedback.reviewerModel,
      reviewerTitle: feedback.reviewerTitle,
      suggestions: feedback.suggestions,
      createdAt: feedback.createdAt,
      sessionState: reviewSessions.state,
    })
    .from(feedback)
    .leftJoin(
      reviewSessions,
      and(
        eq(feedback.reviewSessionId, reviewSessions.id),
        eq(reviewSessions.userId, userId),
      ),
    )
    .where(
      and(
        eq(feedback.documentId, documentId),
        eq(feedback.userId, userId),
      ),
    )
    .orderBy(asc(feedback.iterationNumber), asc(feedback.createdAt));

  // Post-filter: exclude rows whose session is 'abandoned'.
  // Rows with sessionState === null (no matching session) are included.
  return rows
    .filter((r) => r.sessionState !== 'abandoned')
    .map((r) => parseFeedbackRow(
      {
        id: r.id,
        userId: r.userId,
        documentId: r.documentId,
        versionId: r.versionId,
        iterationNumber: r.iterationNumber,
        reviewSessionId: r.reviewSessionId,
        jobId: r.jobId,
        reviewerRole: r.reviewerRole,
        reviewerModel: r.reviewerModel,
        reviewerTitle: r.reviewerTitle,
        suggestions: r.suggestions,
        createdAt: r.createdAt,
      } as Feedback,
      { userId },
    ));
}

export async function insertFeedback(data: {
  id?: string;
  userId: string;
  documentId: string;
  versionId: string;
  iterationNumber: number;
  reviewSessionId?: string;
  jobId: string;
  reviewerRole: string;
  reviewerModel: string;
  reviewerTitle: string;
  suggestions: unknown;
}): Promise<string> {
  const id = data.id ?? uuidv4();
  await db.insert(feedback).values({
    id,
    userId: data.userId,
    documentId: data.documentId,
    versionId: data.versionId,
    iterationNumber: data.iterationNumber,
    reviewSessionId: data.reviewSessionId ?? null,
    jobId: data.jobId,
    reviewerRole: data.reviewerRole,
    reviewerModel: data.reviewerModel,
    reviewerTitle: data.reviewerTitle,
    suggestions: data.suggestions,
  });
  return id;
}

// ============================================================
// feedback_evaluations queries
// ============================================================

export async function getEvaluationForIteration(
  documentId: string,
  iterationNumber: number,
  userId: string,
): Promise<FeedbackEvaluationRow | null> {
  const rows = await db
    .select()
    .from(feedbackEvaluations)
    .where(
      and(
        eq(feedbackEvaluations.documentId, documentId),
        eq(feedbackEvaluations.iterationNumber, iterationNumber),
        eq(feedbackEvaluations.userId, userId),
      ),
    )
    .orderBy(desc(feedbackEvaluations.createdAt))
    .limit(1);
  if (rows.length === 0) return null;
  return parseFeedbackEvaluationRow(rows[0]!, { userId });
}

export async function insertFeedbackEvaluation(data: {
  id?: string;
  userId: string;
  documentId: string;
  iterationNumber: number;
  jobId: string;
  dispositions: unknown;
}): Promise<string> {
  const id = data.id ?? uuidv4();
  await db.insert(feedbackEvaluations).values({
    id,
    userId: data.userId,
    documentId: data.documentId,
    iterationNumber: data.iterationNumber,
    jobId: data.jobId,
    dispositions: data.dispositions,
  });
  return id;
}

// ============================================================
// feedback_manual_selections queries
// ============================================================

export async function listManualSelectionsForSession(
  reviewSessionId: string,
  userId: string,
): Promise<FeedbackManualSelectionRow[]> {
  const rows = await db
    .select()
    .from(feedbackManualSelections)
    .where(
      and(
        eq(feedbackManualSelections.reviewSessionId, reviewSessionId),
        eq(feedbackManualSelections.userId, userId),
      ),
    )
    .orderBy(asc(feedbackManualSelections.createdAt));
  return rows.map((r) => parseFeedbackManualSelectionRow(r, { userId }));
}

export async function listManualSelectionsForDocument(
  documentId: string,
  userId: string,
): Promise<FeedbackManualSelectionRow[]> {
  const rows = await db
    .select()
    .from(feedbackManualSelections)
    .where(
      and(
        eq(feedbackManualSelections.documentId, documentId),
        eq(feedbackManualSelections.userId, userId),
      ),
    )
    .orderBy(asc(feedbackManualSelections.iterationNumber), asc(feedbackManualSelections.createdAt));
  return rows.map((r) => parseFeedbackManualSelectionRow(r, { userId }));
}

export async function insertManualSelection(data: {
  id?: string;
  userId: string;
  documentId: string;
  iterationNumber: number;
  reviewSessionId: string;
  suggestionId: string;
  attorneyNote?: string | null;
}): Promise<string> {
  const id = data.id ?? uuidv4();
  await db.insert(feedbackManualSelections).values({
    id,
    userId: data.userId,
    documentId: data.documentId,
    iterationNumber: data.iterationNumber,
    reviewSessionId: data.reviewSessionId,
    suggestionId: data.suggestionId,
    attorneyNote: data.attorneyNote ?? null,
  });
  return id;
}

export async function deleteManualSelection(
  reviewSessionId: string,
  suggestionId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(feedbackManualSelections)
    .where(
      and(
        eq(feedbackManualSelections.reviewSessionId, reviewSessionId),
        eq(feedbackManualSelections.suggestionId, suggestionId),
        eq(feedbackManualSelections.userId, userId),
      ),
    );
}

// ============================================================
// review_sessions queries
// ============================================================

export async function getActiveReviewSessionForDocument(
  documentId: string,
  userId: string,
): Promise<ReviewSessionRow | null> {
  const rows = await db
    .select()
    .from(reviewSessions)
    .where(
      and(
        eq(reviewSessions.documentId, documentId),
        eq(reviewSessions.userId, userId),
        eq(reviewSessions.state, 'active'),
      ),
    )
    .orderBy(desc(reviewSessions.iterationNumber))
    .limit(1);
  if (rows.length === 0) return null;
  return parseReviewSessionRow(rows[0]!, { userId });
}

export async function getReviewSessionById(
  id: string,
  userId: string,
): Promise<ReviewSessionRow | null> {
  const rows = await db
    .select()
    .from(reviewSessions)
    .where(
      and(eq(reviewSessions.id, id), eq(reviewSessions.userId, userId)),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return parseReviewSessionRow(rows[0]!, { userId });
}

export async function listReviewSessionsForDocument(
  documentId: string,
  userId: string,
): Promise<ReviewSessionRow[]> {
  const rows = await db
    .select()
    .from(reviewSessions)
    .where(
      and(
        eq(reviewSessions.documentId, documentId),
        eq(reviewSessions.userId, userId),
      ),
    )
    .orderBy(desc(reviewSessions.iterationNumber));
  return rows.map((r) => parseReviewSessionRow(r, { userId }));
}

export async function insertReviewSession(data: {
  id?: string;
  userId: string;
  documentId: string;
  iterationNumber: number;
  selectedReviewers: string[];
  globalInstructions?: string;
}): Promise<string> {
  const id = data.id ?? uuidv4();
  await db.insert(reviewSessions).values({
    id,
    userId: data.userId,
    documentId: data.documentId,
    iterationNumber: data.iterationNumber,
    state: 'active',
    selections: [],
    selectedReviewers: data.selectedReviewers,
    globalInstructions: data.globalInstructions ?? '',
  });
  return id;
}

export async function updateReviewSessionState(
  id: string,
  userId: string,
  state: 'active' | 'regenerated' | 'abandoned',
): Promise<void> {
  await db
    .update(reviewSessions)
    .set({ state })
    .where(
      and(eq(reviewSessions.id, id), eq(reviewSessions.userId, userId)),
    );
}

export async function updateReviewSessionSelections(
  id: string,
  userId: string,
  selections: unknown,
): Promise<void> {
  await db
    .update(reviewSessions)
    .set({ selections, lastAutosavedAt: new Date() })
    .where(
      and(eq(reviewSessions.id, id), eq(reviewSessions.userId, userId)),
    );
}

export async function updateReviewSessionGlobalInstructions(
  id: string,
  userId: string,
  globalInstructions: string,
): Promise<void> {
  await db
    .update(reviewSessions)
    .set({ globalInstructions, lastAutosavedAt: new Date() })
    .where(
      and(eq(reviewSessions.id, id), eq(reviewSessions.userId, userId)),
    );
}

export async function getNextIterationNumberForDocument(
  documentId: string,
): Promise<number> {
  const rows = await db
    .select({ iterationNumber: reviewSessions.iterationNumber })
    .from(reviewSessions)
    .where(eq(reviewSessions.documentId, documentId))
    .orderBy(desc(reviewSessions.iterationNumber))
    .limit(1);
  if (rows.length === 0) return 1;
  return (rows[0]!.iterationNumber) + 1;
}

// ============================================================
// locked_decisions queries (MR-CAL-6B)
// ============================================================

function parseLockedDecisionRow(
  raw: LockedDecision,
  ctx: { userId: string },
): LockedDecisionRow {
  try {
    return LockedDecisionRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'LockedDecisionRowSchema',
          tableName: 'locked_decisions',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

export async function insertLockedDecision(data: {
  id?: string;
  userId: string;
  documentId: string;
  matterId: string;
  origin: 'declined' | 'adopted';
  summary: string;
  rationale?: string | null;
  sourceSuggestionId?: string | null;
  sourceIterationNumber?: number | null;
  reviewSessionId?: string | null;
}): Promise<string> {
  const id = data.id ?? uuidv4();
  await db.insert(lockedDecisions).values({
    id,
    userId: data.userId,
    documentId: data.documentId,
    matterId: data.matterId,
    scope: 'document',
    origin: data.origin,
    summary: data.summary,
    rationale: data.rationale ?? null,
    sourceSuggestionId: data.sourceSuggestionId ?? null,
    sourceIterationNumber: data.sourceIterationNumber ?? null,
    reviewSessionId: data.reviewSessionId ?? null,
    status: 'active',
  });
  return id;
}

export async function getLockedDecisionById(
  id: string,
  userId: string,
): Promise<LockedDecisionRow | null> {
  const rows = await db
    .select()
    .from(lockedDecisions)
    .where(and(eq(lockedDecisions.id, id), eq(lockedDecisions.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseLockedDecisionRow(rows[0]!, { userId });
}

/** All locked decisions for a document (any status), newest first. */
export async function listLockedDecisionsForDocument(
  documentId: string,
  userId: string,
): Promise<LockedDecisionRow[]> {
  const rows = await db
    .select()
    .from(lockedDecisions)
    .where(
      and(
        eq(lockedDecisions.documentId, documentId),
        eq(lockedDecisions.userId, userId),
      ),
    )
    .orderBy(desc(lockedDecisions.createdAt));
  return rows.map((r) => parseLockedDecisionRow(r, { userId }));
}

/**
 * Active locked decisions for a document — the read path for reviewer-prompt
 * injection. Ordered oldest-first (asc createdAt) for stable prompt ordering.
 */
export async function listActiveLockedDecisionsForDocument(
  documentId: string,
  userId: string,
): Promise<LockedDecisionRow[]> {
  const rows = await db
    .select()
    .from(lockedDecisions)
    .where(
      and(
        eq(lockedDecisions.documentId, documentId),
        eq(lockedDecisions.userId, userId),
        eq(lockedDecisions.status, 'active'),
      ),
    )
    .orderBy(asc(lockedDecisions.createdAt));
  return rows.map((r) => parseLockedDecisionRow(r, { userId }));
}

/**
 * FOLD-L1-1: all locked decisions for a MATTER (any status), newest first. Uses the
 * denormalized matterId + ownerScope() (the matter-state engine aggregates at matter
 * level; the per-row matterId is asserted against the owning matter by the engine's
 * integrity invariant).
 */
export async function listLockedDecisionsForMatter(
  matterId: string,
  userId: string,
): Promise<LockedDecisionRow[]> {
  const rows = await db
    .select()
    .from(lockedDecisions)
    .where(
      and(ownerScope(lockedDecisions.userId, userId), eq(lockedDecisions.matterId, matterId)),
    )
    .orderBy(desc(lockedDecisions.createdAt));
  return rows.map((r) => parseLockedDecisionRow(r, { userId }));
}

/** Unlock (status -> 'unlocked'; row preserved for audit). */
export async function unlockLockedDecision(
  id: string,
  userId: string,
): Promise<void> {
  await db
    .update(lockedDecisions)
    .set({ status: 'unlocked' })
    .where(and(eq(lockedDecisions.id, id), eq(lockedDecisions.userId, userId)));
}

/** Edit a locked decision's summary/rationale (attorney can modify). */
export async function updateLockedDecision(
  id: string,
  userId: string,
  fields: { summary?: string; rationale?: string | null },
): Promise<void> {
  const set: { summary?: string; rationale?: string | null } = {};
  if (fields.summary !== undefined) set.summary = fields.summary;
  if (fields.rationale !== undefined) set.rationale = fields.rationale;
  if (Object.keys(set).length === 0) return;
  await db
    .update(lockedDecisions)
    .set(set)
    .where(and(eq(lockedDecisions.id, id), eq(lockedDecisions.userId, userId)));
}

// ============================================================
// adopt_ledger queries (MR-CAL-7B)
// ============================================================

function parseAdoptLedgerRow(
  raw: AdoptLedger,
  ctx: { userId: string },
): AdoptLedgerRow {
  try {
    return AdoptLedgerRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'AdoptLedgerRowSchema',
          tableName: 'adopt_ledger',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

export async function insertAdoptLedgerEntry(data: {
  id?: string;
  userId: string;
  documentId: string;
  matterId: string;
  sourceSuggestionId: string;
  sourceReviewerRole: string;
  sourceIterationNumber: number;
  reviewSessionId: string;
  disposition: 'adopted_verbatim' | 'adopted_modified';
  originalText: string;
  adoptedText: string;
  adoptedIntoVersionId: string;
  status?: 'active' | 'superseded' | 'resolved' | 'unresolved';
  // FOLD-ORCH-1 Inc3: the per-item CONFIRMATION MODE (never flattened to "adopted"). ADDITIVE
  // optional — existing callers omit it (=> NULL, unchanged behavior); orchestration adoption
  // (Inc3) passes the precise mode (bulk-acknowledged-convergent / individually_* / synthesis).
  confirmationMode?: ConfirmationMode | null;
}): Promise<string> {
  const id = data.id ?? uuidv4();
  await db.insert(adoptLedger).values({
    id,
    userId: data.userId,
    documentId: data.documentId,
    matterId: data.matterId,
    sourceSuggestionId: data.sourceSuggestionId,
    sourceReviewerRole: data.sourceReviewerRole,
    sourceIterationNumber: data.sourceIterationNumber,
    reviewSessionId: data.reviewSessionId,
    disposition: data.disposition,
    originalText: data.originalText,
    adoptedText: data.adoptedText,
    adoptedIntoVersionId: data.adoptedIntoVersionId,
    status: data.status ?? 'unresolved',
    statusSource: 'auto',
    confirmationMode: data.confirmationMode ?? null,
  });
  return id;
}

export async function getAdoptLedgerEntryById(
  id: string,
  userId: string,
): Promise<AdoptLedgerRow | null> {
  const rows = await db
    .select()
    .from(adoptLedger)
    .where(and(eq(adoptLedger.id, id), eq(adoptLedger.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseAdoptLedgerRow(rows[0]!, { userId });
}

/** All ledger entries for a document (any status), newest first (UI). */
export async function listAdoptLedgerForDocument(
  documentId: string,
  userId: string,
): Promise<AdoptLedgerRow[]> {
  const rows = await db
    .select()
    .from(adoptLedger)
    .where(
      and(
        eq(adoptLedger.documentId, documentId),
        eq(adoptLedger.userId, userId),
      ),
    )
    .orderBy(desc(adoptLedger.createdAt));
  return rows.map((r) => parseAdoptLedgerRow(r, { userId }));
}

/**
 * FOLD-L1-1: all adopt-ledger entries for a MATTER (any status), newest first. Uses the
 * denormalized matterId + ownerScope() (matter-level aggregation for the matter-state
 * engine; the integrity invariant asserts each row's matterId against the owning matter).
 */
export async function listAdoptLedgerForMatter(
  matterId: string,
  userId: string,
): Promise<AdoptLedgerRow[]> {
  const rows = await db
    .select()
    .from(adoptLedger)
    .where(and(ownerScope(adoptLedger.userId, userId), eq(adoptLedger.matterId, matterId)))
    .orderBy(desc(adoptLedger.createdAt));
  return rows.map((r) => parseAdoptLedgerRow(r, { userId }));
}

/**
 * Ledger entries to carry into a reviewer prompt: status in (active, unresolved),
 * oldest-first for stable prompt ordering. The read path for prompt injection.
 */
export async function listAdoptLedgerForPrompt(
  documentId: string,
  userId: string,
): Promise<AdoptLedgerRow[]> {
  const rows = await db
    .select()
    .from(adoptLedger)
    .where(
      and(
        eq(adoptLedger.documentId, documentId),
        eq(adoptLedger.userId, userId),
        inArray(adoptLedger.status, ['active', 'unresolved']),
      ),
    )
    .orderBy(asc(adoptLedger.createdAt));
  return rows.map((r) => parseAdoptLedgerRow(r, { userId }));
}

/**
 * On regeneration commit: mark the consumed unresolved entries as carried into
 * the produced version (producedVersionId set, status -> 'active'), then run the
 * ADVISORY survival heuristic against the new content. Auto-detection only ever
 * sets statusSource='auto' rows; it NEVER touches statusSource='attorney' rows,
 * and never deletes/hides. Returns counts for telemetry.
 */
export async function applyRegenerationToAdoptLedger(params: {
  documentId: string;
  userId: string;
  producedVersionId: string;
  newContent: string;
}): Promise<{ carried: number; superseded: number }> {
  const { documentId, userId, producedVersionId, newContent } = params;
  // Consider all auto-status entries for this document that are active/unresolved.
  const rows = await db
    .select()
    .from(adoptLedger)
    .where(
      and(
        eq(adoptLedger.documentId, documentId),
        eq(adoptLedger.userId, userId),
        eq(adoptLedger.statusSource, 'auto'),
        inArray(adoptLedger.status, ['active', 'unresolved']),
      ),
    );
  let carried = 0;
  let superseded = 0;
  for (const r of rows) {
    const parsed = parseAdoptLedgerRow(r, { userId });
    const present = survivalHeuristicPresent(parsed.adoptedText, newContent);
    const nextStatus: 'active' | 'superseded' = present ? 'active' : 'superseded';
    if (nextStatus === 'active') carried++;
    else superseded++;
    await db
      .update(adoptLedger)
      .set({
        producedVersionId,
        status: nextStatus,
        // statusSource stays 'auto'
      })
      .where(and(eq(adoptLedger.id, parsed.id), eq(adoptLedger.userId, userId)));
  }
  return { carried, superseded };
}

/** Attorney override of a ledger entry's status (statusSource -> 'attorney'). */
export async function updateAdoptLedgerStatus(
  id: string,
  userId: string,
  status: 'active' | 'superseded' | 'resolved' | 'unresolved',
): Promise<void> {
  await db
    .update(adoptLedger)
    .set({ status, statusSource: 'attorney' })
    .where(and(eq(adoptLedger.id, id), eq(adoptLedger.userId, userId)));
}

// --- adopt_ledger survival heuristic (ADVISORY; MR-CAL-7B) -------------------
// Exact-match survival detection against an LLM drafter that paraphrases is
// inherently unreliable; this heuristic is conservative and ADVISORY only
// (status it sets is overridable by the attorney). It normalizes whitespace/case
// and treats an adopted snippet as "present" if a substantial normalized token
// run overlaps the new content. Kept deliberately simple + transparent.

function normalizeForSurvival(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function survivalHeuristicPresent(adoptedText: string, content: string): boolean {
  const a = normalizeForSurvival(adoptedText);
  if (a.length === 0) return true; // nothing to find -> don't flag as lost
  // Normalize content here too so the function is correct whether the caller passes
  // raw or already-normalized content (normalizeForSurvival is idempotent).
  const c = normalizeForSurvival(content);
  // Direct containment of a reasonably long adopted snippet.
  if (a.length <= 200 && c.includes(a)) return true;
  // Token-overlap fallback for longer/paraphrased text: how many of the adopted
  // text's distinctive tokens appear in the new content.
  const tokens = a.split(' ').filter((t) => t.length >= 5);
  if (tokens.length === 0) {
    return c.includes(a);
  }
  const hits = tokens.filter((t) => c.includes(t)).length;
  return hits / tokens.length >= 0.6;
}
