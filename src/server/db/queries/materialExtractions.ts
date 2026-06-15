/**
 * material_extraction query layer (Zod Wall + ownerScope) — FOLD-PM-2.
 *
 * The SOLE read/write path for material_extraction (one latest document-type
 * structured extraction per material). Every read parses through the Zod Wall
 * (MaterialExtractionRowSchema); every owner filter goes through ownerScope() (the
 * FOLD-AUTH chokepoint — never an inline owner-column equality, banned by the CI
 * ratchet for new files). userId/matterId/materialId are immutable bindings.
 *
 * TEST SEAM (repo convention): setMaterialExtractionStore(...) injects an in-memory
 * store so CRUD + owner-isolation behavior runs WITHOUT a DB. Default is Drizzle.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../connection.js';
import { materialExtraction, type NewMaterialExtraction } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  MaterialExtractionRowSchema,
  type MaterialExtractionRow,
  type DocumentExtractionResult,
} from '../../../shared/schemas/documentExtraction.js';

const parse = (r: unknown): MaterialExtractionRow => MaterialExtractionRowSchema.parse(r);

export interface SaveExtractionArgs {
  userId: string;
  matterId: string;
  materialId: string;
  result: DocumentExtractionResult;
}

export interface MaterialExtractionStore {
  getForMaterial(materialId: string, userId: string): Promise<MaterialExtractionRow | null>;
  listForMatter(matterId: string, userId: string): Promise<MaterialExtractionRow[]>;
  upsert(args: SaveExtractionArgs): Promise<MaterialExtractionRow>;
}

const drizzleStore: MaterialExtractionStore = {
  async getForMaterial(materialId, userId) {
    const rows = await db
      .select()
      .from(materialExtraction)
      .where(and(eq(materialExtraction.materialId, materialId), ownerScope(materialExtraction.userId, userId)))
      .limit(1);
    return rows[0] ? parse(rows[0]) : null;
  },

  async listForMatter(matterId, userId) {
    const rows = await db
      .select()
      .from(materialExtraction)
      .where(and(eq(materialExtraction.matterId, matterId), ownerScope(materialExtraction.userId, userId)))
      .orderBy(desc(materialExtraction.updatedAt));
    return rows.map(parse);
  },

  async upsert(args) {
    const existing = await this.getForMaterial(args.materialId, args.userId);
    const { result } = args;
    if (existing) {
      await db
        .update(materialExtraction)
        .set({
          documentType: result.documentType,
          typeConfidence: result.typeConfidence,
          overallConfidence: result.overallConfidence,
          lowConfidence: result.lowConfidence,
          fields: result.fields,
          warnings: result.warnings,
        })
        .where(and(eq(materialExtraction.id, existing.id), ownerScope(materialExtraction.userId, args.userId)));
      const updated = await this.getForMaterial(args.materialId, args.userId);
      if (!updated) throw new Error('material_extraction vanished after update');
      return updated;
    }
    const row: NewMaterialExtraction = {
      id: uuidv4(),
      userId: args.userId,
      matterId: args.matterId,
      materialId: args.materialId,
      documentType: result.documentType,
      typeConfidence: result.typeConfidence,
      overallConfidence: result.overallConfidence,
      lowConfidence: result.lowConfidence,
      fields: result.fields,
      warnings: result.warnings,
    };
    await db.insert(materialExtraction).values(row);
    const created = await this.getForMaterial(args.materialId, args.userId);
    if (!created) throw new Error('material_extraction insert did not materialize');
    return created;
  },
};

let _store: MaterialExtractionStore | null = null;
/** Test seam: inject an in-memory store (pass null to restore the real Drizzle store). */
export function setMaterialExtractionStore(store: MaterialExtractionStore | null): void {
  _store = store;
}
function store(): MaterialExtractionStore {
  return _store ?? drizzleStore;
}

export async function saveExtraction(args: SaveExtractionArgs): Promise<MaterialExtractionRow> {
  return store().upsert(args);
}

export async function getExtractionForMaterial(
  materialId: string,
  userId: string,
): Promise<MaterialExtractionRow | null> {
  return store().getForMaterial(materialId, userId);
}

export async function listExtractionsForMatter(
  matterId: string,
  userId: string,
): Promise<MaterialExtractionRow[]> {
  return store().listForMatter(matterId, userId);
}
