/**
 * Zod Wall query wrapper for the matter_materials table (Ch 35.1 / Phase 3).
 *
 * This is the SOLE read path for the matter_materials table.
 * All reads pass through MatterMaterialRowSchema.parse() before returning.
 */

import { eq, and, isNull, desc } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import {
  matterMaterials,
  type MatterMaterial,
  type NewMatterMaterial,
} from '../schema.js';
import {
  MatterMaterialRowSchema,
  type MatterMaterialRow,
} from '../../../shared/schemas/matters.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { v4 as uuidv4 } from 'uuid';

function parseMaterialRow(
  raw: MatterMaterial,
  ctx: { userId: string },
): MatterMaterialRow {
  try {
    return MatterMaterialRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'MatterMaterialRowSchema',
          tableName: 'matter_materials',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

export async function getMaterialById(
  materialId: string,
  userId: string,
): Promise<MatterMaterialRow | null> {
  const rows = await db
    .select()
    .from(matterMaterials)
    .where(
      and(eq(matterMaterials.id, materialId), eq(matterMaterials.userId, userId)),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return parseMaterialRow(rows[0]!, { userId });
}

export async function listMaterialsForMatter(
  matterId: string,
  userId: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<MatterMaterialRow[]> {
  const conditions = [
    eq(matterMaterials.matterId, matterId),
    eq(matterMaterials.userId, userId),
  ];
  if (!opts.includeDeleted) {
    conditions.push(isNull(matterMaterials.deletedAt));
  }
  const rows = await db
    .select()
    .from(matterMaterials)
    .where(and(...conditions))
    .orderBy(desc(matterMaterials.createdAt));
  return rows.map((r) => parseMaterialRow(r, { userId }));
}

export async function listPinnedMaterials(
  matterId: string,
  userId: string,
): Promise<MatterMaterialRow[]> {
  const rows = await db
    .select()
    .from(matterMaterials)
    .where(
      and(
        eq(matterMaterials.matterId, matterId),
        eq(matterMaterials.userId, userId),
        isNull(matterMaterials.deletedAt),
        eq(matterMaterials.pinned, true),
      ),
    )
    .orderBy(desc(matterMaterials.createdAt));
  return rows.map((r) => parseMaterialRow(r, { userId }));
}

export async function insertMaterial(
  data: Omit<NewMatterMaterial, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<MatterMaterialRow> {
  const id = uuidv4();
  await db
    .insert(matterMaterials)
    .values({ ...data, id });
  const row = await getMaterialById(id, data.userId);
  if (!row)
    throw new Error(`insertMaterial: row not found after insert (id=${id})`);
  return row;
}

export async function updateMaterialMetadata(
  materialId: string,
  userId: string,
  data: {
    tags?: string[];
    description?: string | null;
    filename?: string;
  },
): Promise<MatterMaterialRow | null> {
  await db
    .update(matterMaterials)
    .set(data)
    .where(
      and(
        eq(matterMaterials.id, materialId),
        eq(matterMaterials.userId, userId),
      ),
    );
  return getMaterialById(materialId, userId);
}

export async function setPinnedStatus(
  materialId: string,
  userId: string,
  pinned: boolean,
): Promise<MatterMaterialRow | null> {
  await db
    .update(matterMaterials)
    .set({ pinned })
    .where(
      and(
        eq(matterMaterials.id, materialId),
        eq(matterMaterials.userId, userId),
      ),
    );
  return getMaterialById(materialId, userId);
}

export async function softDeleteMaterial(
  materialId: string,
  userId: string,
): Promise<MatterMaterialRow | null> {
  await db
    .update(matterMaterials)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(matterMaterials.id, materialId),
        eq(matterMaterials.userId, userId),
      ),
    );
  return getMaterialById(materialId, userId);
}

export async function undeleteMaterial(
  materialId: string,
  userId: string,
): Promise<MatterMaterialRow | null> {
  await db
    .update(matterMaterials)
    .set({ deletedAt: null })
    .where(
      and(
        eq(matterMaterials.id, materialId),
        eq(matterMaterials.userId, userId),
      ),
    );
  return getMaterialById(materialId, userId);
}

export async function hardDeleteMaterial(
  materialId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(matterMaterials)
    .where(
      and(
        eq(matterMaterials.id, materialId),
        eq(matterMaterials.userId, userId),
      ),
    );
}

export async function updateMaterialTextContent(
  materialId: string,
  userId: string,
  textContent: string,
  extractionStatus: 'extracted' | 'partial' | 'failed' | 'not_supported',
  extractionError?: string | null,
): Promise<MatterMaterialRow | null> {
  await db
    .update(matterMaterials)
    .set({ textContent, extractionStatus, extractionError: extractionError ?? null })
    .where(
      and(
        eq(matterMaterials.id, materialId),
        eq(matterMaterials.userId, userId),
      ),
    );
  return getMaterialById(materialId, userId);
}
