/**
 * Zod Wall query wrapper for the documents table (Ch 35.1 / Phase 3).
 *
 * This is the SOLE read path for the documents table.
 * All reads pass through DocumentRowSchema.parse() before returning to callers.
 * Raw Drizzle results are never consumed directly by business logic.
 */

import { eq, and, isNull, desc, ne, inArray } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import { documents, type Document, type NewDocument } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
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
  // W3c — deed provenance. Any documentType==='deed' persisted here is AGENT-assembled: the generic LLM path
  // is blocked from minting deeds (enforceNotDeedLike), so the deterministic deed agent is the only live
  // producer of a 'deed' row. Stamp it so the LIVE-9 export scanner distinguishes a sanctioned agent deed from
  // a legacy/pasted one. A caller-supplied provenance wins; otherwise derive from documentType (null for
  // non-deeds — nullable + back-compat).
  const provenance = data.provenance ?? (data.documentType === 'deed' ? 'agent_assembled' : null);
  await db
    .insert(documents)
    .values({ ...data, id, provenance });
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

/**
 * FOLD-KB-1 (Fork A): set the durable "drew on unverified KB" provenance flag on a document.
 * Owner-scoped via ownerScope() (the new-code chokepoint). One-way latch — only ever set
 * TRUE; it survives drafting/versioning (the flag lives on the document). FOLD-SEND-1 reads it.
 */
export async function setDrewOnUnverifiedKb(
  documentId: string,
  userId: string,
  executor: Pick<typeof db, 'update'> = db,
): Promise<void> {
  await executor
    .update(documents)
    .set({ drewOnUnverifiedKb: true })
    .where(and(eq(documents.id, documentId), ownerScope(documents.userId, userId)));
}

/**
 * NOTIFY-STALE-1 (Fix B) — of the given matterIds, which have AT LEAST ONE document row (active OR archived).
 * Owner-scoped. Used to flag a stale "ready" notification whose matter is empty (its announced document was
 * deleted out-of-band). Counts archived docs too, so an archived-but-present document is NOT treated as gone.
 */
export async function mattersWithDocuments(
  userId: string,
  matterIds: readonly string[],
): Promise<Set<string>> {
  if (matterIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ matterId: documents.matterId })
    .from(documents)
    .where(and(inArray(documents.matterId, [...matterIds]), ownerScope(documents.userId, userId)))
    .groupBy(documents.matterId);
  return new Set(rows.map((r) => r.matterId));
}
