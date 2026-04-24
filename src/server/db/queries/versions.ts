/**
 * Zod Wall query wrapper for the versions table (Ch 35.1 / Phase 3).
 *
 * Versions are immutable after insert (Ch 7). Only insertVersion and read
 * functions are provided — no update functions exist.
 */

import { eq, and, desc, max } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import { versions, type Version, type NewVersion } from '../schema.js';
import {
  VersionRowSchema,
  type VersionRow,
} from '../../../shared/schemas/matters.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { v4 as uuidv4 } from 'uuid';

function parseVersionRow(
  raw: Version,
  ctx: { userId: string },
): VersionRow {
  try {
    return VersionRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'VersionRowSchema',
          tableName: 'versions',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

export async function getVersionById(
  versionId: string,
  userId: string,
): Promise<VersionRow | null> {
  const rows = await db
    .select()
    .from(versions)
    .where(and(eq(versions.id, versionId), eq(versions.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseVersionRow(rows[0]!, { userId });
}

export async function listVersionsForDocument(
  documentId: string,
  userId: string,
): Promise<VersionRow[]> {
  const rows = await db
    .select()
    .from(versions)
    .where(and(eq(versions.documentId, documentId), eq(versions.userId, userId)))
    .orderBy(desc(versions.versionNumber));
  return rows.map((r) => parseVersionRow(r, { userId }));
}

export async function getLatestVersionForDocument(
  documentId: string,
  userId: string,
): Promise<VersionRow | null> {
  const rows = await db
    .select()
    .from(versions)
    .where(and(eq(versions.documentId, documentId), eq(versions.userId, userId)))
    .orderBy(desc(versions.versionNumber))
    .limit(1);
  if (rows.length === 0) return null;
  return parseVersionRow(rows[0]!, { userId });
}

export async function getNextVersionNumber(
  documentId: string,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ maxNum: max(versions.versionNumber) })
    .from(versions)
    .where(and(eq(versions.documentId, documentId), eq(versions.userId, userId)));
  const current = rows[0]?.maxNum ?? 0;
  return current + 1;
}

/**
 * Look up a version by its (documentId, versionNumber) pair.
 * Used by the export endpoint to resolve officialFinalVersionNumber and
 * officialSubstantiveVersionNumber to a concrete version row.
 * Passes through the Zod Wall (parseVersionRow) on every read.
 */
export async function getVersionByNumber(
  documentId: string,
  userId: string,
  versionNumber: number,
): Promise<VersionRow | null> {
  const rows = await db
    .select()
    .from(versions)
    .where(
      and(
        eq(versions.documentId, documentId),
        eq(versions.userId, userId),
        eq(versions.versionNumber, versionNumber),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return parseVersionRow(rows[0]!, { userId });
}

export async function insertVersion(
  data: Omit<NewVersion, 'id' | 'createdAt'>,
): Promise<VersionRow> {
  const id = uuidv4();
  await db
    .insert(versions)
    .values({ ...data, id });
  const row = await getVersionById(id, data.userId);
  if (!row)
    throw new Error(`insertVersion: row not found after insert (id=${id})`);
  return row;
}
