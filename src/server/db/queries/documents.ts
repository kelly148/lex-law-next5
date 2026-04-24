/**
 * Zod Wall query wrapper for the documents table (Ch 35.1 / Phase 3).
 *
 * This is the SOLE read path for the documents table.
 * All reads pass through DocumentRowSchema.parse() before returning to callers.
 * Raw Drizzle results are never consumed directly by business logic.
 */

import { eq, and, isNull, desc, ne } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import { documents, type Document, type NewDocument } from '../schema.js';
import {
  DocumentRowSchema,
  type DocumentRow,
} from '../../../shared/schemas/matters.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// Internal parse helper — Zod Wall enforcement
// ============================================================

function parseDocumentRow(
  raw: Document,
  ctx: { userId: string },
): DocumentRow {
  try {
    return DocumentRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'DocumentRowSchema',
          tableName: 'documents',
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
// Read functions
// ============================================================

export async function getDocumentById(
  documentId: string,
  userId: string,
): Promise<DocumentRow | null> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseDocumentRow(rows[0]!, { userId });
}

export async function listDocumentsForMatter(
  matterId: string,
  userId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<DocumentRow[]> {
  const conditions = [
    eq(documents.matterId, matterId),
    eq(documents.userId, userId),
  ];
  if (!opts.includeArchived) {
    conditions.push(isNull(documents.archivedAt));
  }
  const rows = await db
    .select()
    .from(documents)
    .where(and(...conditions))
    .orderBy(desc(documents.createdAt));
  return rows.map((r) => parseDocumentRow(r, { userId }));
}

/**
 * Count non-archived, non-complete documents in a matter.
 * Used by matter phase auto-transition (Ch 5.3).
 */
export async function countNonCompleteDocuments(
  matterId: string,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.matterId, matterId),
        eq(documents.userId, userId),
        isNull(documents.archivedAt),
        ne(documents.workflowState, 'complete'),
      ),
    );
  return rows.length;
}

/**
 * Count all non-archived documents in a matter.
 * Used by matter phase auto-transition (Ch 5.3).
 */
export async function countActiveDocuments(
  matterId: string,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.matterId, matterId),
        eq(documents.userId, userId),
        isNull(documents.archivedAt),
      ),
    );
  return rows.length;
}

// ============================================================
// Write functions
// ============================================================

export async function insertDocument(
  data: Omit<NewDocument, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<DocumentRow> {
  const id = uuidv4();
  await db
    .insert(documents)
    .values({ ...data, id });
  const row = await getDocumentById(id, data.userId);
  if (!row)
    throw new Error(
      `insertDocument: row not found after insert (id=${id})`,
    );
  return row;
}

export async function updateDocumentWorkflowState(
  documentId: string,
  userId: string,
  workflowState: DocumentRow['workflowState'],
  extra: {
    completedAt?: Date | null;
    officialSubstantiveVersionNumber?: number | null;
    officialFinalVersionNumber?: number | null;
  } = {},
): Promise<DocumentRow | null> {
  await db
    .update(documents)
    .set({ workflowState, ...extra })
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
  return getDocumentById(documentId, userId);
}

export async function updateDocumentCurrentVersion(
  documentId: string,
  userId: string,
  currentVersionId: string,
): Promise<DocumentRow | null> {
  await db
    .update(documents)
    .set({ currentVersionId })
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
  return getDocumentById(documentId, userId);
}

export async function updateDocumentNotes(
  documentId: string,
  userId: string,
  notes: string | null,
): Promise<DocumentRow | null> {
  await db
    .update(documents)
    .set({ notes })
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
  return getDocumentById(documentId, userId);
}

export async function updateDocumentVariableMap(
  documentId: string,
  userId: string,
  variableMap: Record<string, unknown> | null,
): Promise<DocumentRow | null> {
  await db
    .update(documents)
    .set({ variableMap })
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
  return getDocumentById(documentId, userId);
}

export async function detachDocumentFromTemplate(
  documentId: string,
  userId: string,
  templateSnapshot: Record<string, unknown>,
): Promise<DocumentRow | null> {
  await db
    .update(documents)
    .set({
      templateBindingStatus: 'detached',
      templateSnapshot,
    })
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
  return getDocumentById(documentId, userId);
}

export async function archiveDocument(
  documentId: string,
  userId: string,
): Promise<DocumentRow | null> {
  await db
    .update(documents)
    .set({ archivedAt: new Date() })
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
  return getDocumentById(documentId, userId);
}

export async function unarchiveDocument(
  documentId: string,
  userId: string,
): Promise<DocumentRow | null> {
  await db
    .update(documents)
    .set({ archivedAt: null })
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
  return getDocumentById(documentId, userId);
}

export async function updateDocumentTitle(
  documentId: string,
  userId: string,
  title: string,
): Promise<DocumentRow | null> {
  await db
    .update(documents)
    .set({ title })
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
  return getDocumentById(documentId, userId);
}
