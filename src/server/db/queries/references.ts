/**
 * Zod Wall query wrapper for the document_references table (Ch 35.1 / Phase 3).
 *
 * Document references are the ONLY mechanism by which one document's content
 * appears in another's LLM context (decision #36 / Ch 20.2 Tier 2).
 */

import { eq, and } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import {
  documentReferences,
  type DocumentReference,
  type NewDocumentReference,
} from '../schema.js';
import {
  DocumentReferenceRowSchema,
  type DocumentReferenceRow,
} from '../../../shared/schemas/matters.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { v4 as uuidv4 } from 'uuid';

function parseReferenceRow(
  raw: DocumentReference,
  ctx: { userId: string },
): DocumentReferenceRow {
  try {
    return DocumentReferenceRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'DocumentReferenceRowSchema',
          tableName: 'document_references',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

export async function getReferenceById(
  referenceId: string,
  userId: string,
): Promise<DocumentReferenceRow | null> {
  const rows = await db
    .select()
    .from(documentReferences)
    .where(
      and(
        eq(documentReferences.id, referenceId),
        eq(documentReferences.userId, userId),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return parseReferenceRow(rows[0]!, { userId });
}

export async function listReferencesForDocument(
  sourceDocumentId: string,
  userId: string,
): Promise<DocumentReferenceRow[]> {
  const rows = await db
    .select()
    .from(documentReferences)
    .where(
      and(
        eq(documentReferences.sourceDocumentId, sourceDocumentId),
        eq(documentReferences.userId, userId),
      ),
    );
  return rows.map((r) => parseReferenceRow(r, { userId }));
}

export async function listInboundReferences(
  referencedDocumentId: string,
  userId: string,
): Promise<DocumentReferenceRow[]> {
  const rows = await db
    .select()
    .from(documentReferences)
    .where(
      and(
        eq(documentReferences.referencedDocumentId, referencedDocumentId),
        eq(documentReferences.userId, userId),
      ),
    );
  return rows.map((r) => parseReferenceRow(r, { userId }));
}

export async function insertReference(
  data: Omit<NewDocumentReference, 'id' | 'createdAt'>,
): Promise<DocumentReferenceRow> {
  const id = uuidv4();
  await db
    .insert(documentReferences)
    .values({ ...data, id });
  const row = await getReferenceById(id, data.userId);
  if (!row)
    throw new Error(`insertReference: row not found after insert (id=${id})`);
  return row;
}

export async function deleteReference(
  referenceId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(documentReferences)
    .where(
      and(
        eq(documentReferences.id, referenceId),
        eq(documentReferences.userId, userId),
      ),
    );
}

export async function acknowledgeStaleReferences(
  sourceDocumentId: string,
  userId: string,
): Promise<void> {
  await db
    .update(documentReferences)
    .set({ stalenessAcknowledgedAt: new Date() })
    .where(
      and(
        eq(documentReferences.sourceDocumentId, sourceDocumentId),
        eq(documentReferences.userId, userId),
      ),
    );
}

/**
 * Detect stale references: references where the sibling's currentVersionId
 * has changed since the reference was created.
 * Used by document.finalize staleness gate (Ch 21.4 / decision #4).
 */
export async function detectStaleReferences(
  sourceDocumentId: string,
  userId: string,
  siblingCurrentVersions: Record<string, string>,
): Promise<DocumentReferenceRow[]> {
  const refs = await listReferencesForDocument(sourceDocumentId, userId);
  return refs.filter((ref) => {
    const currentVersion = siblingCurrentVersions[ref.referencedDocumentId];
    if (!currentVersion) return false; // sibling not found or archived
    return (
      currentVersion !== ref.referencedVersionId &&
      ref.stalenessAcknowledgedAt === null
    );
  });
}
