/**
 * FOLD-PM-2 — materialExtraction procedure behavioral tests (CRUD/upsert + owner-scope
 * isolation + flag gate). DB-free: the materials/matters query modules are vi.mocked and
 * the extraction store is injected. userId is always ctx.userId (Ch 35.2).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // owned by U1
const MATERIAL_1 = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; // owned by U1, in MATTER_A

vi.mock('../db/queries/materials.js', () => {
  const COMMITMENT = `COMMITMENT FOR TITLE INSURANCE\nSCHEDULE B\nCommitment No.: AC-2026-00417\nEffective Date: March 12, 2026\nProposed Insured: John Q. Buyer\nPolicy Amount: $450,000.00`;
  const materials = [
    { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', userId: '11111111-1111-1111-1111-111111111111', matterId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', textContent: COMMITMENT },
  ];
  return {
    getMaterialById: (id: string, userId: string) =>
      Promise.resolve(materials.find((m) => m.id === id && m.userId === userId) ?? null),
  };
});

vi.mock('../db/queries/matters.js', () => {
  const matters = [
    { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', userId: '11111111-1111-1111-1111-111111111111', title: 'Matter A' },
  ];
  return {
    getMatterById: (id: string, userId: string) =>
      Promise.resolve(matters.find((m) => m.id === id && m.userId === userId) ?? null),
  };
});

import { appRouter } from '../router.js';
import {
  setMaterialExtractionStore,
  type MaterialExtractionStore,
} from '../db/queries/materialExtractions.js';
import { createInMemoryMaterialExtractionStore } from './inMemoryMaterialExtractionStore.js';

const FLAG = 'DOCUMENT_EXTRACTION_ENABLED';

function caller(userId: string | undefined) {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });
}

let savedFlag: string | undefined;
beforeEach(() => {
  savedFlag = process.env[FLAG];
  process.env[FLAG] = 'true';
  setMaterialExtractionStore(createInMemoryMaterialExtractionStore());
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  setMaterialExtractionStore(null);
});

describe('FOLD-PM-2 — extract round-trip + upsert', () => {
  it('extract classifies + persists; getForMaterial + listForMatter read it back', async () => {
    const u1 = caller(U1);
    const r = await u1.materialExtraction.extract({ materialId: MATERIAL_1 });
    expect(r.documentType).toBe('title_commitment');
    expect(r.materialId).toBe(MATERIAL_1);
    expect(r.matterId).toBe(MATTER_A);
    expect(r.userId).toBe(U1);
    expect(r.fields.find((f) => f.key === 'commitmentNumber')?.value).toBe('AC-2026-00417');

    const got = await u1.materialExtraction.getForMaterial({ materialId: MATERIAL_1 });
    expect(got?.id).toBe(r.id);

    const list = await u1.materialExtraction.listForMatter({ matterId: MATTER_A });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(r.id);
  });

  it('re-extract overwrites in place (one row per material)', async () => {
    const u1 = caller(U1);
    const a = await u1.materialExtraction.extract({ materialId: MATERIAL_1 });
    const b = await u1.materialExtraction.extract({ materialId: MATERIAL_1 });
    expect(b.id).toBe(a.id); // same row, upserted
    const list = await u1.materialExtraction.listForMatter({ matterId: MATTER_A });
    expect(list).toHaveLength(1);
  });
});

describe('FOLD-PM-2 — owner-scope isolation (cross-owner = NOT_FOUND / empty)', () => {
  it('U2 cannot extract, read, or list U1 material/matter data', async () => {
    await caller(U1).materialExtraction.extract({ materialId: MATERIAL_1 }); // seed
    const u2 = caller(U2);
    // U2 cannot extract U1's material (getMaterialById owner-scoped -> null -> NOT_FOUND)
    await expect(u2.materialExtraction.extract({ materialId: MATERIAL_1 })).rejects.toThrow(/not found/i);
    // U2 cannot read U1's extraction (owner-scoped -> null)
    expect(await u2.materialExtraction.getForMaterial({ materialId: MATERIAL_1 })).toBeNull();
    // U2 cannot list U1's matter (matter not owned -> NOT_FOUND)
    await expect(u2.materialExtraction.listForMatter({ matterId: MATTER_A })).rejects.toThrow(/not found/i);
  });

  it('an unauthenticated caller is rejected (UNAUTHORIZED)', async () => {
    await expect(caller(undefined).materialExtraction.getForMaterial({ materialId: MATERIAL_1 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('FOLD-PM-2 — flag gate (default OFF, fail-closed, zero store I/O)', () => {
  it('with DOCUMENT_EXTRACTION_ENABLED OFF, every op refuses and never touches the store', async () => {
    delete process.env[FLAG];
    const throwingStore = new Proxy({} as MaterialExtractionStore, {
      get() {
        return () => {
          throw new Error('store must not be touched when the flag is OFF');
        };
      },
    });
    setMaterialExtractionStore(throwingStore);
    const u1 = caller(U1);
    await expect(u1.materialExtraction.extract({ materialId: MATERIAL_1 })).rejects.toThrow(/DOCUMENT_EXTRACTION_DISABLED/);
    await expect(u1.materialExtraction.getForMaterial({ materialId: MATERIAL_1 })).rejects.toThrow(/DOCUMENT_EXTRACTION_DISABLED/);
    await expect(u1.materialExtraction.listForMatter({ matterId: MATTER_A })).rejects.toThrow(/DOCUMENT_EXTRACTION_DISABLED/);
  });

  it('isEnabled reports the flag state (ungated)', async () => {
    delete process.env[FLAG];
    expect(await caller(U1).materialExtraction.isEnabled()).toEqual({ enabled: false });
    process.env[FLAG] = 'true';
    expect(await caller(U1).materialExtraction.isEnabled()).toEqual({ enabled: true });
  });
});
