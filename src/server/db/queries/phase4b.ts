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
import { eq, and, isNull, desc, asc } from 'drizzle-orm';
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
  type InformationRequest,
  type InformationRequestItem,
  type DocumentOutline,
  type Feedback,
  type FeedbackEvaluation,
  type FeedbackManualSelection,
  type ReviewSession,
} from '../schema.js';
import {
  InformationRequestRowSchema,
  InformationRequestItemRowSchema,
  DocumentOutlineRowSchema,
  FeedbackRowSchema,
  FeedbackEvaluationRowSchema,
  FeedbackManualSelectionRowSchema,
  ReviewSessionRowSchema,
  type InformationRequestRow,
  type InformationRequestItemRow,
  type DocumentOutlineRow,
  type FeedbackRow,
  type FeedbackEvaluationRow,
  type FeedbackManualSelectionRow,
  type ReviewSessionRow,
} from '../../../shared/schemas/phase4b.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
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
