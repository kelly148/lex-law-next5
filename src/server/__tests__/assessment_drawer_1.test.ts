/**
 * ASSESSMENT-DRAWER-1 — buildAnalysisMaterialsBlock unit tests.
 *
 * The fix wires the matter's extraction-complete material TEXT into the analysis context (the generator
 * previously read title + parties only). These pin the pure budgeting/truncation/filtering so a budget cap
 * is never mistaken for "no information provided", and only completed, non-empty, own-matter materials are
 * included. The procedure wiring (listMaterialsForMatter -> buildAnalysisMaterialsBlock -> userPrompt) runs
 * live (no test DB), per the established pattern.
 */
import { describe, it, expect } from 'vitest';
import { buildAnalysisMaterialsBlock } from '../intake/analysisContext.js';

// Real EXTRACTION_STATUS_VALUES = extracted|partial|failed|not_supported (NOT 'completed').
const mat = (over: Partial<{ filename: string | null; textContent: string | null; extractionStatus: string }>) => ({
  filename: 'intake.docx', textContent: 'hello world', extractionStatus: 'extracted', ...over,
});

describe('ASSESSMENT-DRAWER-1 — buildAnalysisMaterialsBlock', () => {
  it('returns an empty block when there is no usable material text', () => {
    expect(buildAnalysisMaterialsBlock([])).toEqual({ block: '', includedCount: 0, truncatedCount: 0, omittedCount: 0 });
    // not_supported (e.g. PDFs today) / failed / empty text are excluded; only extracted|partial w/ text count
    const r = buildAnalysisMaterialsBlock([
      mat({ extractionStatus: 'not_supported', textContent: null }), // PDF today, pre-MATERIALS-EXTRACTION-1
      mat({ extractionStatus: 'failed' }),
      mat({ textContent: '   ' }),
      mat({ textContent: null }),
    ]);
    expect(r.includedCount).toBe(0);
    expect(r.block).toBe('');
  });

  it('includes extracted (and partial) materials with text and tells the model to base the assessment on them', () => {
    const r = buildAnalysisMaterialsBlock([
      mat({ filename: 'Brown trust.docx', textContent: 'TRUST CONTENT' }),
      mat({ filename: 'partial.docx', textContent: 'SOME TEXT', extractionStatus: 'partial' }),
    ]);
    expect(r.includedCount).toBe(2);
    expect(r.block).toContain('Source materials');
    expect(r.block).toContain('base the assessment on these');
    expect(r.block).toContain('Brown trust.docx');
    expect(r.block).toContain('TRUST CONTENT');
    expect(r.block).toContain('SOME TEXT'); // partial counts
  });

  it('labels paste-text entries (null filename) and trims content', () => {
    const r = buildAnalysisMaterialsBlock([mat({ filename: null, textContent: '  pasted notes  ' })]);
    expect(r.block).toContain('pasted text');
    expect(r.block).toContain('pasted notes');
  });

  it('truncates the overflowing material and omits the rest, with explicit notes (never silent)', () => {
    const big = 'X'.repeat(100);
    const r = buildAnalysisMaterialsBlock(
      [mat({ filename: 'big.pdf', textContent: big }), mat({ filename: 'next.pdf', textContent: 'should be omitted' })],
      40,
    );
    expect(r.includedCount).toBe(1);
    expect(r.truncatedCount).toBe(1);
    expect(r.omittedCount).toBe(1);
    expect(r.block).toContain('truncated to fit');
    expect(r.block).toContain('truncated to fit the context budget');
    expect(r.block).toContain('omitted for length');
    expect(r.block).not.toContain('should be omitted');
  });

  it('includes multiple materials in order when they fit the budget', () => {
    const r = buildAnalysisMaterialsBlock([mat({ filename: 'a.pdf', textContent: 'AAA' }), mat({ filename: 'b.pdf', textContent: 'BBB' })], 1000);
    expect(r.includedCount).toBe(2);
    expect(r.truncatedCount).toBe(0);
    expect(r.omittedCount).toBe(0);
    expect(r.block.indexOf('a.pdf')).toBeLessThan(r.block.indexOf('b.pdf'));
  });
});
