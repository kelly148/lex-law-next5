/**
 * R2-PRE-JURIS-1 — matters.jurisdiction wiring (source-analysis test).
 *
 * Prerequisite for the Whereas R2 #3 readiness strip: an additive, nullable governing-jurisdiction
 * field on matters, settable via matter.create / matter.updateMetadata and read through the Zod
 * Wall. Backend-only (no UI — the VA/MD chip + inline editor land in R2 #3). No test DB is
 * available, so this verifies the wiring by source analysis (the repo's established pattern; cf.
 * mr_uat_progress_1.test.ts).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('R2-PRE-JURIS-1: matters.jurisdiction wiring', () => {
  it('migration 0019 adds the column additively (ADD COLUMN IF NOT EXISTS, nullable)', () => {
    const mig = read('src/server/db/migrations/0019_r2_pre_juris_1_matter_jurisdiction.sql');
    expect(mig).toMatch(/ALTER TABLE\s+`matters`/);
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS\s+`jurisdiction`/);
    expect(mig).toMatch(/VARCHAR\(16\)\s+NULL/i);
  });

  it('schema.ts declares the matters.jurisdiction column', () => {
    const schema = read('src/server/db/schema.ts');
    expect(schema).toContain("jurisdiction: varchar('jurisdiction', { length: 16 })");
  });

  it('MatterRowSchema carries jurisdiction (additive: nullable + optional for legacy rows)', () => {
    const s = read('src/shared/schemas/matters.ts');
    expect(s).toContain('jurisdiction: z.string().max(16).nullable().optional()');
  });

  it('matter.create accepts and persists jurisdiction', () => {
    const proc = read('src/server/procedures/matters.ts');
    const createBlock = proc.slice(proc.indexOf('create: protectedProcedure'), proc.indexOf('get: protectedProcedure'));
    expect(createBlock).toContain('jurisdiction: z.string().max(16).nullable().optional()');
    expect(createBlock).toContain('jurisdiction: input.jurisdiction ?? null');
  });

  it('matter.updateMetadata accepts, persists, and audits jurisdiction', () => {
    const proc = read('src/server/procedures/matters.ts');
    const updBlock = proc.slice(proc.indexOf('updateMetadata: protectedProcedure'));
    expect(updBlock).toContain('jurisdiction: z.string().max(16).nullable().optional()');
    expect(updBlock).toContain('if (input.jurisdiction !== undefined) updates.jurisdiction = input.jurisdiction');
    expect(updBlock).toContain('changedFields.jurisdiction');
  });

  it('updateMatterMetadata query accepts jurisdiction in its data type', () => {
    const q = read('src/server/db/queries/matters.ts');
    expect(q).toContain('jurisdiction?: string | null');
  });
});
