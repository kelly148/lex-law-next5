/**
 * MATERIALS-DROPZONE-1 Increment B — OCR pure-logic + honesty-invariant tests.
 *
 * These pin the parts that tsc/eslint can't and that don't require running tesseract/pdfium WASM
 * (those run live in UAT): the confidence-floor classifier, the scanned-PDF detector, and — the
 * load-bearing guarantee — that a low-confidence / in-flight OCR result is EXCLUDED from the
 * assessment context, so garbled or empty OCR can never be fed to an assessment as real content.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { classifyOcr, OCR_CONFIDENCE_FLOOR } from '../intake/ocrExtract.js';
import { pdfNeedsOcr } from '../intake/ocrPipeline.js';
import { buildAnalysisMaterialsBlock } from '../intake/analysisContext.js';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const NEW_OCR_STATUSES = ['processing', 'low_confidence'];

describe('MATERIALS-DROPZONE-1 Inc B — classifyOcr confidence floor', () => {
  it('empty/whitespace OCR output → low_confidence with no stored text', () => {
    const r = classifyOcr('   \n  ', 95);
    expect(r.extractionStatus).toBe('low_confidence');
    expect(r.textContent).toBeNull();
  });

  it('below the confidence floor → low_confidence with text WITHHELD (null) at the data layer', () => {
    const r = classifyOcr('s0me smudg3d text', OCR_CONFIDENCE_FLOOR - 1);
    expect(r.extractionStatus).toBe('low_confidence');
    expect(r.textContent).toBeNull(); // never persisted -> cannot leak to any consumer
    expect(r.extractionError).toMatch(/below the/i);
  });

  it('at/above the floor with real text → extracted (trimmed)', () => {
    const r = classifyOcr('  clean legible text  ', OCR_CONFIDENCE_FLOOR);
    expect(r.extractionStatus).toBe('extracted');
    expect(r.textContent).toBe('clean legible text');
    expect(r.extractionError).toBeNull();
  });
});

describe('MATERIALS-DROPZONE-1 Inc B — pdfNeedsOcr (scanned-PDF detection)', () => {
  it('a digital extraction that returned empty text (partial) → needs OCR', () => {
    expect(pdfNeedsOcr('partial')).toBe(true);
  });

  it('real text (extracted) or a parse error (failed) → no OCR', () => {
    expect(pdfNeedsOcr('extracted')).toBe(false);
    expect(pdfNeedsOcr('failed')).toBe(false);
  });
});

describe('MATERIALS-DROPZONE-1 Inc B — honesty invariant: assessment excludes untrustworthy OCR', () => {
  it('the STATUS gate (not just empty text) excludes every untrustworthy status even when it carries text', () => {
    // Each non-trustworthy row is given NON-EMPTY text on purpose: this proves the assessment
    // filters on extractionStatus, so a future regression that leaves text on a low_confidence row
    // (or a denylist-style refactor) is still caught.
    const block = buildAnalysisMaterialsBlock([
      { filename: 'good.png', textContent: 'TRUSTWORTHY-OCR-TEXT', extractionStatus: 'extracted' },
      { filename: 'blurry.png', textContent: 'g4rbl3d-low-conf', extractionStatus: 'low_confidence' },
      { filename: 'pending.png', textContent: 'partial-ocr-so-far', extractionStatus: 'processing' },
      { filename: 'broke.png', textContent: 'junk-from-failed', extractionStatus: 'failed' },
      { filename: 'other.bin', textContent: 'unsupported-bytes', extractionStatus: 'not_supported' },
    ]);
    expect(block.includedCount).toBe(1);
    expect(block.block).toContain('TRUSTWORTHY-OCR-TEXT');
    for (const leaked of ['g4rbl3d-low-conf', 'partial-ocr-so-far', 'junk-from-failed', 'unsupported-bytes']) {
      expect(block.block).not.toContain(leaked);
    }
  });
});

describe('MATERIALS-DROPZONE-1 Inc B — migration 0024 is additive + enums in lockstep', () => {
  const mig = read('src/server/db/migrations/0024_materials_dropzone_1_ocr_status.sql');
  const runner = read('scripts/apply-prod-migrations.mjs');
  const serverSchema = read('src/server/db/schema.ts');
  const sharedSchema = read('src/shared/schemas/matters.ts');

  it('0024 ALTERs matter_materials.extractionStatus with all six values, no destructive DDL', () => {
    expect(mig).toMatch(/ALTER TABLE\s+`?matter_materials`?/i);
    expect(mig).toMatch(/MODIFY COLUMN\s+`?extractionStatus`?/i);
    for (const v of ['extracted', 'partial', 'failed', 'not_supported', 'processing', 'low_confidence']) {
      expect(mig).toContain(`'${v}'`);
    }
    const stripped = mig.replace(/--.*$/gm, '');
    expect(stripped).not.toMatch(/\b(DROP|TRUNCATE|RENAME)\b/i);
    expect(stripped).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('0024 is on the pre-deploy additive allowlist', () => {
    expect(runner).toContain("'0024_materials_dropzone_1_ocr_status.sql'");
  });

  it('both EXTRACTION_STATUS_VALUES constants carry the new OCR statuses (lockstep)', () => {
    for (const v of NEW_OCR_STATUSES) {
      expect(serverSchema).toContain(`'${v}'`);
      expect(sharedSchema).toContain(`'${v}'`);
    }
  });
});
