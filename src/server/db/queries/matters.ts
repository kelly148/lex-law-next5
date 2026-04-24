/**
 * Zod Wall query wrapper for the matters table (Ch 35.1 / Phase 3).
 *
 * This is the SOLE read path for the matters table.
 * All reads pass through MatterRowSchema.parse() before returning to callers.
 * Raw Drizzle results are never consumed directly by business logic.
 */

import { eq, and, isNull, desc } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import { matters, type Matter, type NewMatter } from '../schema.js';
import { MatterRowSchema, type MatterRow } from '../../../shared/schemas/matters.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// Internal parse helper — Zod Wall enforcement
// ============================================================

function parseMatterRow(
  raw: Matter,
  ctx: { userId: string },
): MatterRow {
  try {
    return MatterRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'MatterRowSchema',
          tableName: 'matters',
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

export async function getMatterById(
  matterId: string,
  userId: string,
): Promise<MatterRow | null> {
  const rows = await db
    .select()
    .from(matters)
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseMatterRow(rows[0]!, { userId });
}

export async function listMatters(
  userId: string,
  opts: {
    includeArchived?: boolean;
    phase?: 'intake' | 'drafting' | 'complete';
  } = {},
): Promise<MatterRow[]> {
  const conditions = [eq(matters.userId, userId)];
  if (!opts.includeArchived) {
    conditions.push(isNull(matters.archivedAt));
  }
  if (opts.phase) {
    conditions.push(eq(matters.phase, opts.phase));
  }
  const rows = await db
    .select()
    .from(matters)
    .where(and(...conditions))
    .orderBy(desc(matters.updatedAt));
  return rows.map((r) => parseMatterRow(r, { userId }));
}

// ============================================================
// Write functions
// ============================================================

export async function insertMatter(
  data: Omit<NewMatter, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<MatterRow> {
  const id = uuidv4();
  await db
    .insert(matters)
    .values({ ...data, id });
  const row = await getMatterById(id, data.userId);
  if (!row) throw new Error(`insertMatter: row not found after insert (id=${id})`);
  return row;
}

export async function updateMatterPhase(
  matterId: string,
  userId: string,
  phase: 'intake' | 'drafting' | 'complete',
  completedAt?: Date | null,
): Promise<MatterRow | null> {
  await db
    .update(matters)
    .set({
      phase,
      completedAt: completedAt ?? null,
    })
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)));
  return getMatterById(matterId, userId);
}

export async function archiveMatter(
  matterId: string,
  userId: string,
): Promise<MatterRow | null> {
  await db
    .update(matters)
    .set({ archivedAt: new Date() })
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)));
  return getMatterById(matterId, userId);
}

export async function unarchiveMatter(
  matterId: string,
  userId: string,
): Promise<MatterRow | null> {
  await db
    .update(matters)
    .set({ archivedAt: null })
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)));
  return getMatterById(matterId, userId);
}

export async function updateMatterMetadata(
  matterId: string,
  userId: string,
  data: { title?: string; clientName?: string | null; practiceArea?: string | null },
): Promise<MatterRow | null> {
  await db
    .update(matters)
    .set(data)
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)));
  return getMatterById(matterId, userId);
}

export async function deleteMatter(
  matterId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(matters)
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)));
}

// ============================================================
// Phase auto-transition helpers (Ch 5.3)
// ============================================================

/**
 * Get matters that have at least one archived document and are not archived themselves.
 * Used by the phase auto-transition to detect complete → drafting reversion.
 */
export async function getMatterForPhaseCheck(
  matterId: string,
  userId: string,
): Promise<{ phase: string; archivedAt: Date | null } | null> {
  const rows = await db
    .select({ phase: matters.phase, archivedAt: matters.archivedAt })
    .from(matters)
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0]!;
}

/**
 * Check if a matter is archived.
 */
export async function isMatterArchived(
  matterId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ archivedAt: matters.archivedAt })
    .from(matters)
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)))
    .limit(1);
  if (rows.length === 0) return false;
  return rows[0]!.archivedAt !== null;
}
