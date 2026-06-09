/**
 * document_party query wrapper — DOC-CLIENT-TARGET-1.
 *
 * Ch 35.1 Zod Wall. Owner-scoped via ownerScope() (never inline eq(<table>.userId,...)). Binds a
 * document instance to a matter party in a declared ROLE; roleKey is REJECTED at write if the document
 * type does not declare it (typo + nonsense protection without a DB enum). The document's TYPE is read
 * from the document itself (single source of truth) — a caller cannot bind a role the type does not
 * declare. `partyHasFinalizedBinding` is the block-delete guard the party soft-delete consumes.
 *
 * Reads the `documents` table directly (documentType / workflowState) rather than importing the
 * documents query module, to keep this module free of queries-layer cross-imports (matter_parties'
 * soft-delete imports THIS module for the guard).
 *
 * Governing record: _brand/DOC-CLIENT-TARGET-1_consolidated_disposition_2026-06-09.md §3 (LOCKED).
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, asc, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../connection.js';
import { documentParty, documents } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { DocumentPartyRowSchema, type DocumentPartyRow } from '../../../shared/schemas/documentParty.js';
import { isRoleKeyDeclared } from '../../../shared/docTypes/docTypeConfig.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

/** Document workflow states in which a bound party may NOT be removed (block-delete). */
const FINALIZED_WORKFLOW_STATES = ['finalizing', 'complete'] as const;

function parseRow(raw: unknown, ctx: { userId: string }): DocumentPartyRow {
  try {
    return DocumentPartyRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'DocumentPartyRowSchema',
          tableName: 'document_party',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

export async function getDocumentPartyById(id: string, userId: string): Promise<DocumentPartyRow | null> {
  const rows = await db
    .select()
    .from(documentParty)
    .where(and(eq(documentParty.id, id), ownerScope(documentParty.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseRow(rows[0]!, { userId });
}

/**
 * Bind a matter party to a document in a role. The roleKey is validated against the document type's
 * DECLARED roles (read from the document itself) — a role the type does not declare is REJECTED
 * (BAD_REQUEST 'ROLE_KEY_NOT_DECLARED'). An unregistered/custom document type declares no roles, so a
 * bind on it is rejected (an unknown type cannot silently accept arbitrary bindings). createdBy
 * defaults to the acting attorney.
 */
export async function bindDocumentParty(data: {
  id?: string;
  userId: string;
  matterId: string;
  documentId: string;
  partyId: string;
  roleKey: string;
  sortOrder?: number;
  createdBy?: string;
}): Promise<DocumentPartyRow> {
  const docRows = await db
    .select({ documentType: documents.documentType })
    .from(documents)
    .where(and(ownerScope(documents.userId, data.userId), eq(documents.id, data.documentId)))
    .limit(1);
  const doc = docRows[0];
  if (!doc) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
  }
  if (!isRoleKeyDeclared(doc.documentType, data.roleKey)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `ROLE_KEY_NOT_DECLARED: role '${data.roleKey}' is not declared by document type '${doc.documentType}'.`,
    });
  }
  const id = data.id ?? uuidv4();
  await db.insert(documentParty).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    documentId: data.documentId,
    partyId: data.partyId,
    roleKey: data.roleKey,
    sortOrder: data.sortOrder ?? 0,
    createdBy: data.createdBy ?? data.userId,
  });
  const row = await getDocumentPartyById(id, data.userId);
  if (!row) throw new Error(`bindDocumentParty: row not found after insert (id=${id})`);
  return row;
}

/** The party bindings for a document, in sortOrder (grantor ordering on a deed, etc.). */
export async function listDocumentParties(documentId: string, userId: string): Promise<DocumentPartyRow[]> {
  const rows = await db
    .select()
    .from(documentParty)
    .where(and(ownerScope(documentParty.userId, userId), eq(documentParty.documentId, documentId)))
    .orderBy(asc(documentParty.sortOrder));
  return rows.map((r) => parseRow(r, { userId }));
}

/** Every document binding for a party — the block-delete read (which documents is this party bound to). */
export async function listDocumentsForParty(partyId: string, userId: string): Promise<DocumentPartyRow[]> {
  const rows = await db
    .select()
    .from(documentParty)
    .where(and(ownerScope(documentParty.userId, userId), eq(documentParty.partyId, partyId)));
  return rows.map((r) => parseRow(r, { userId }));
}

/**
 * The BLOCK-DELETE guard (disposition §3 / §10c): is this party bound to any FINALIZED document
 * (workflowState finalizing/complete)? If so it must never be hard-deleted out from under that
 * instrument. The party soft-delete consumes this. There is no DB foreign key from a document to a
 * party, so "bound to a finalized document" is an APP-LAYER fact, enforced here.
 */
export async function partyHasFinalizedBinding(partyId: string, userId: string): Promise<boolean> {
  const bindings = await db
    .select({ documentId: documentParty.documentId })
    .from(documentParty)
    .where(and(ownerScope(documentParty.userId, userId), eq(documentParty.partyId, partyId)));
  if (bindings.length === 0) return false;
  const docIds = [...new Set(bindings.map((b) => b.documentId))];
  const docs = await db
    .select({ workflowState: documents.workflowState })
    .from(documents)
    .where(and(ownerScope(documents.userId, userId), inArray(documents.id, docIds)));
  return docs.some((d) => (FINALIZED_WORKFLOW_STATES as readonly string[]).includes(d.workflowState));
}

/** Remove a single binding (a binding CORRECTION — e.g. principal change rebinds; this is not a party
 *  delete). The bound PARTY is never hard-deleted by this; only the document<->party association row is. */
export async function unbindDocumentParty(id: string, userId: string): Promise<void> {
  await db
    .delete(documentParty)
    .where(and(eq(documentParty.id, id), ownerScope(documentParty.userId, userId)));
}
