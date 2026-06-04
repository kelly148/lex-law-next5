/**
 * provision_provenance query wrapper — FOLD-DRAFT-1 (Increment 1: data core).
 *
 * Ch 35.1 Zod Wall: the ONLY read path for provision_provenance; every row parses through
 * ProvisionProvenanceRowSchema before returning. Owner scoping uses ownerScope() (FOLD-AUTH-1
 * chokepoint), never an inline eq(<table>.userId, ...) filter.
 *
 * DEFAULT-SAFE: this is record + read only. Provenance is surfaced, never used to auto-justify
 * outbound legal assertions. No prompt injection / no auto-use in Increment 1.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, asc } from 'drizzle-orm';
import { db } from '../connection.js';
import { provisionProvenance } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  ProvisionProvenanceRowSchema,
  type ProvisionProvenanceRow,
  type ProvisionOriginType,
  type ProvisionRecordedBy,
} from '../../../shared/schemas/provisionProvenance.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseProvisionProvenanceRow(raw: unknown, ctx: { userId: string }): ProvisionProvenanceRow {
  try {
    return ProvisionProvenanceRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'ProvisionProvenanceRowSchema',
          tableName: 'provision_provenance',
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

export async function getProvisionProvenanceById(
  id: string,
  userId: string,
): Promise<ProvisionProvenanceRow | null> {
  const rows = await db
    .select()
    .from(provisionProvenance)
    .where(and(eq(provisionProvenance.id, id), ownerScope(provisionProvenance.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseProvisionProvenanceRow(rows[0]!, { userId });
}

/** All provision-provenance rows for a version, ordered by the section order index. */
export async function listProvisionProvenanceForVersion(
  versionId: string,
  userId: string,
): Promise<ProvisionProvenanceRow[]> {
  const rows = await db
    .select()
    .from(provisionProvenance)
    .where(and(ownerScope(provisionProvenance.userId, userId), eq(provisionProvenance.versionId, versionId)))
    .orderBy(asc(provisionProvenance.orderIndex));
  return rows.map((r) => parseProvisionProvenanceRow(r, { userId }));
}

/** All provision-provenance rows for a document (across versions), ordered by section order index. */
export async function listProvisionProvenanceForDocument(
  documentId: string,
  userId: string,
): Promise<ProvisionProvenanceRow[]> {
  const rows = await db
    .select()
    .from(provisionProvenance)
    .where(and(ownerScope(provisionProvenance.userId, userId), eq(provisionProvenance.documentId, documentId)))
    .orderBy(asc(provisionProvenance.orderIndex));
  return rows.map((r) => parseProvisionProvenanceRow(r, { userId }));
}

// ============================================================
// Write
// ============================================================

export async function insertProvisionProvenance(data: {
  id?: string;
  userId: string;
  matterId: string;
  documentId: string;
  versionId: string;
  orderIndex: number;
  sectionTitle: string;
  originType: ProvisionOriginType;
  originId?: string | null;
  originLabel?: string | null;
  recordedBy: ProvisionRecordedBy;
  notes?: string | null;
}): Promise<ProvisionProvenanceRow> {
  const id = data.id ?? uuidv4();
  await db.insert(provisionProvenance).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    documentId: data.documentId,
    versionId: data.versionId,
    orderIndex: data.orderIndex,
    sectionTitle: data.sectionTitle,
    originType: data.originType,
    originId: data.originId ?? null,
    originLabel: data.originLabel ?? null,
    recordedBy: data.recordedBy,
    notes: data.notes ?? null,
  });
  const row = await getProvisionProvenanceById(id, data.userId);
  if (!row) throw new Error(`insertProvisionProvenance: row not found after insert (id=${id})`);
  return row;
}
