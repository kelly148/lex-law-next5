/**
 * ldd_key_term query wrapper — FOLD-DRAFT-1 / LDD (Increment 1: data core).
 *
 * Ch 35.1 Zod Wall: the ONLY read path for ldd_key_term; every row parses through
 * LddKeyTermRowSchema before returning. Owner scoping uses ownerScope() (FOLD-AUTH-1 chokepoint),
 * never an inline eq(<table>.userId, ...) filter.
 *
 * DEFAULT-SAFE: this is record + read only. The key-term dictionary is surfaced and (in a later
 * increment) compared against the draft to FLAG drift; it never edits the draft and never
 * auto-justifies an outbound legal assertion. No prompt injection / no auto-use in Increment 1.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, asc } from 'drizzle-orm';
import { db } from '../connection.js';
import { lddKeyTerm } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  LddKeyTermRowSchema,
  type LddKeyTermRow,
  type LddKeyTermSourceType,
  type LddKeyTermRecordedBy,
} from '../../../shared/schemas/lddKeyTerm.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseLddKeyTermRow(raw: unknown, ctx: { userId: string }): LddKeyTermRow {
  try {
    return LddKeyTermRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'LddKeyTermRowSchema',
          tableName: 'ldd_key_term',
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
// Reads (owner-scoped)
// ============================================================

export async function getLddKeyTermById(id: string, userId: string): Promise<LddKeyTermRow | null> {
  const rows = await db
    .select()
    .from(lddKeyTerm)
    .where(and(eq(lddKeyTerm.id, id), ownerScope(lddKeyTerm.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseLddKeyTermRow(rows[0]!, { userId });
}

/** All key-term dictionary rows for a version, ordered by term label. */
export async function listLddKeyTermsForVersion(versionId: string, userId: string): Promise<LddKeyTermRow[]> {
  const rows = await db
    .select()
    .from(lddKeyTerm)
    .where(and(ownerScope(lddKeyTerm.userId, userId), eq(lddKeyTerm.versionId, versionId)))
    .orderBy(asc(lddKeyTerm.termLabel));
  return rows.map((r) => parseLddKeyTermRow(r, { userId }));
}

/** All key-term dictionary rows for a document (across versions), ordered by term label. */
export async function listLddKeyTermsForDocument(documentId: string, userId: string): Promise<LddKeyTermRow[]> {
  const rows = await db
    .select()
    .from(lddKeyTerm)
    .where(and(ownerScope(lddKeyTerm.userId, userId), eq(lddKeyTerm.documentId, documentId)))
    .orderBy(asc(lddKeyTerm.termLabel));
  return rows.map((r) => parseLddKeyTermRow(r, { userId }));
}

// ============================================================
// Write
// ============================================================

export async function insertLddKeyTerm(data: {
  id?: string;
  userId: string;
  matterId: string;
  documentId: string;
  versionId: string;
  termLabel: string;
  expectedValue: string;
  sourceType: LddKeyTermSourceType;
  sourceId?: string | null;
  recordedBy: LddKeyTermRecordedBy;
  notes?: string | null;
}): Promise<LddKeyTermRow> {
  const id = data.id ?? uuidv4();
  await db.insert(lddKeyTerm).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    documentId: data.documentId,
    versionId: data.versionId,
    termLabel: data.termLabel,
    expectedValue: data.expectedValue,
    sourceType: data.sourceType,
    sourceId: data.sourceId ?? null,
    recordedBy: data.recordedBy,
    notes: data.notes ?? null,
  });
  const row = await getLddKeyTermById(id, data.userId);
  if (!row) throw new Error(`insertLddKeyTerm: row not found after insert (id=${id})`);
  return row;
}
