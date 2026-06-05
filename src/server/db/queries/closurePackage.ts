/**
 * closure_package_item query wrapper — FOLD-DRAFT-1 / package (Increment 1: data core).
 *
 * Ch 35.1 Zod Wall: the ONLY read path for closure_package_item; every row parses through
 * ClosurePackageItemRowSchema before returning. Owner scoping uses ownerScope() (FOLD-AUTH-1
 * chokepoint), never an inline eq(<table>.userId, ...) filter.
 *
 * DEFAULT-SAFE / ADVISORY: this is record + read only. The package is surfaced and (in a later
 * increment) checked for completeness; it never finalizes, sends, or locks anything. No prompt
 * injection / no auto-use in Increment 1.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, asc } from 'drizzle-orm';
import { db } from '../connection.js';
import { closurePackageItem } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  ClosurePackageItemRowSchema,
  type ClosurePackageItemRow,
  type ClosurePackageItemType,
  type ClosurePackageRequirement,
  type ClosurePackageItemStatus,
  type ClosurePackageRecordedBy,
} from '../../../shared/schemas/closurePackage.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseClosurePackageItemRow(raw: unknown, ctx: { userId: string }): ClosurePackageItemRow {
  try {
    return ClosurePackageItemRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'ClosurePackageItemRowSchema',
          tableName: 'closure_package_item',
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

export async function getClosurePackageItemById(id: string, userId: string): Promise<ClosurePackageItemRow | null> {
  const rows = await db
    .select()
    .from(closurePackageItem)
    .where(and(eq(closurePackageItem.id, id), ownerScope(closurePackageItem.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseClosurePackageItemRow(rows[0]!, { userId });
}

/** All closure-package items for a matter, ordered by package name then label. */
export async function listClosurePackageItemsForMatter(matterId: string, userId: string): Promise<ClosurePackageItemRow[]> {
  const rows = await db
    .select()
    .from(closurePackageItem)
    .where(and(ownerScope(closurePackageItem.userId, userId), eq(closurePackageItem.matterId, matterId)))
    .orderBy(asc(closurePackageItem.packageName), asc(closurePackageItem.label));
  return rows.map((r) => parseClosurePackageItemRow(r, { userId }));
}

/** All items belonging to one named package within a matter, ordered by label. */
export async function listClosurePackageItemsForPackage(
  matterId: string,
  packageName: string,
  userId: string,
): Promise<ClosurePackageItemRow[]> {
  const rows = await db
    .select()
    .from(closurePackageItem)
    .where(
      and(
        ownerScope(closurePackageItem.userId, userId),
        eq(closurePackageItem.matterId, matterId),
        eq(closurePackageItem.packageName, packageName),
      ),
    )
    .orderBy(asc(closurePackageItem.label));
  return rows.map((r) => parseClosurePackageItemRow(r, { userId }));
}

// ============================================================
// Write
// ============================================================

export async function insertClosurePackageItem(data: {
  id?: string;
  userId: string;
  matterId: string;
  packageName: string;
  itemType: ClosurePackageItemType;
  refId?: string | null;
  label: string;
  requirement: ClosurePackageRequirement;
  status: ClosurePackageItemStatus;
  recordedBy: ClosurePackageRecordedBy;
  notes?: string | null;
}): Promise<ClosurePackageItemRow> {
  const id = data.id ?? uuidv4();
  await db.insert(closurePackageItem).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    packageName: data.packageName,
    itemType: data.itemType,
    refId: data.refId ?? null,
    label: data.label,
    requirement: data.requirement,
    status: data.status,
    recordedBy: data.recordedBy,
    notes: data.notes ?? null,
  });
  const row = await getClosurePackageItemById(id, data.userId);
  if (!row) throw new Error(`insertClosurePackageItem: row not found after insert (id=${id})`);
  return row;
}
