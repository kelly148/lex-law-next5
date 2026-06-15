/**
 * In-memory MaterialExtractionStore for FOLD-PM-2 tests (NO .test suffix — vitest does
 * not collect this file). Backed by an array; every read filters by userId, mirroring
 * ownerScope(), so cross-owner reads return null/empty without a database.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  MaterialExtractionStore,
  SaveExtractionArgs,
} from '../db/queries/materialExtractions.js';
import type { MaterialExtractionRow } from '../../shared/schemas/documentExtraction.js';

export function createInMemoryMaterialExtractionStore(
  now: () => Date = () => new Date('2026-06-14T12:00:00.000Z'),
): MaterialExtractionStore {
  const rows: MaterialExtractionRow[] = [];

  return {
    getForMaterial(materialId: string, userId: string): Promise<MaterialExtractionRow | null> {
      const r = rows.find((x) => x.materialId === materialId && x.userId === userId);
      return Promise.resolve(r ? { ...r } : null);
    },
    listForMatter(matterId: string, userId: string): Promise<MaterialExtractionRow[]> {
      return Promise.resolve(
        rows.filter((x) => x.matterId === matterId && x.userId === userId).map((x) => ({ ...x })),
      );
    },
    upsert(args: SaveExtractionArgs): Promise<MaterialExtractionRow> {
      const { result } = args;
      const existing = rows.find((x) => x.materialId === args.materialId && x.userId === args.userId);
      if (existing) {
        existing.documentType = result.documentType;
        existing.typeConfidence = result.typeConfidence;
        existing.overallConfidence = result.overallConfidence;
        existing.lowConfidence = result.lowConfidence;
        existing.fields = result.fields;
        existing.warnings = result.warnings;
        existing.updatedAt = now();
        return Promise.resolve({ ...existing });
      }
      const r: MaterialExtractionRow = {
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
        createdAt: now(),
        updatedAt: now(),
      };
      rows.push(r);
      return Promise.resolve({ ...r });
    },
  };
}
