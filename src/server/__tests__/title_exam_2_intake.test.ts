/**
 * TITLE-EXAM-1 (T2) — abstract intake: NC-10 coverage-guaranteed chunker + completeness guard, and
 * NC-9 OCR honesty. All pure; no DB, no provider.
 */

import { describe, it, expect } from 'vitest';
import { chunkWithCoverage } from '../titleExam/coverageChunker.js';
import { assessIntakeCompleteness } from '../titleExam/intakeCompleteness.js';
import {
  applyOcrHonesty,
  applyOcrHonestyAll,
  toFindingOcrBasis,
  TITLE_EXAM_OCR_CONFIDENCE_FLOOR,
  TITLE_EXAM_CRITICAL_FIELDS,
} from '../titleExam/ocrHonesty.js';

describe('T2 — NC-10 coverage-guaranteed chunker (never silently truncates)', () => {
  it('covers EVERY character with contiguous, non-overlapping chunks', () => {
    const text = 'x'.repeat(100_005);
    const cov = chunkWithCoverage(text, 40_000);
    expect(cov.totalChars).toBe(100_005);
    expect(cov.coveredChars).toBe(100_005); // nothing dropped
    expect(cov.complete).toBe(true);
    expect(cov.droppedRanges).toEqual([]);
    // contiguity: each chunk starts where the previous ended; concatenation reproduces the input
    let cursor = 0;
    for (const c of cov.chunks) {
      expect(c.charStart).toBe(cursor);
      cursor = c.charEnd;
    }
    expect(cursor).toBe(text.length);
    expect(cov.chunks.map((c) => c.text).join('')).toBe(text);
  });

  it('an empty abstract is trivially complete with zero chunks', () => {
    const cov = chunkWithCoverage('');
    expect(cov.complete).toBe(true);
    expect(cov.chunks).toHaveLength(0);
  });
});

describe('T2 — NC-10 completeness guard (a truncated exam must never read as complete)', () => {
  it('a fully-covered small abstract is complete with no banner', () => {
    const r = assessIntakeCompleteness({ extractedText: 'short abstract', totalSourcePages: 3, processedPages: 3 });
    expect(r.completeness).toBe('complete');
    expect(r.incompletenessReason).toBeNull();
    expect(r.droppedPageCount).toBe(0);
  });

  it('flags pages dropped beyond the processing cap AND enumerates the cause', () => {
    const r = assessIntakeCompleteness({ extractedText: 'abstract text', totalSourcePages: 40, pageCap: 25 });
    expect(r.completeness).toBe('incomplete');
    expect(r.droppedPageCount).toBe(15); // 40 - min(40,25)
    expect(r.incompletenessReason).toContain('15 page(s) were not examined');
    expect(r.incompletenessReason).toContain('25-page processing cap');
    expect(r.incompletenessReason).toContain('INCOMPLETE EXAMINATION');
  });

  it('flags OCR-failed pages and content beyond the lane char budget', () => {
    const r = assessIntakeCompleteness({
      extractedText: 'y'.repeat(150_000),
      totalSourcePages: 10,
      processedPages: 10,
      failedPages: 2,
      laneCharBudget: 120_000,
    });
    expect(r.completeness).toBe('incomplete');
    expect(r.droppedPageCount).toBe(2);
    expect(r.charsBeyondLaneBudget).toBe(30_000);
    expect(r.coveredByLaneBudget).toBe(false);
    expect(r.incompletenessReason).toContain('2 page(s) failed OCR');
    expect(r.incompletenessReason).toContain('exceed the lane ingest budget');
  });
});

describe('T2 — NC-9 OCR honesty (withhold below floor; source-page pincites on critical fields)', () => {
  it('an OCR field below the confidence floor withholds its value but keeps the field + pincite visible', () => {
    const h = applyOcrHonesty({
      field: 'legal_description',
      value: 'Lot 7, Block C ... (garbled)',
      confidence: TITLE_EXAM_OCR_CONFIDENCE_FLOOR - 5,
      sourcePage: 4,
      ocrDerived: true,
    });
    expect(h.withheld).toBe(true);
    expect(h.value).toBeNull();
    expect(h.flag).toBe('withheld');
    expect(h.pincite).toBe('OCR p.4'); // the attorney can still find the page to verify
  });

  it('a confident OCR field keeps its value but is flagged OCR-derived with a pincite', () => {
    const h = applyOcrHonesty({ field: 'testacy_status', value: 'intestate', confidence: 92, sourcePage: 2, ocrDerived: true });
    expect(h.withheld).toBe(false);
    expect(h.value).toBe('intestate');
    expect(h.flag).toBe('ocr_flagged');
    expect(h.pincite).toBe('OCR p.2');
  });

  it('a non-OCR (instrument/record) field is ok with no OCR pincite', () => {
    const h = applyOcrHonesty({ field: 'parties', value: 'Jane Doe', confidence: 100, sourcePage: null, ocrDerived: false });
    expect(h.flag).toBe('ok');
    expect(h.pincite).toBeNull();
  });

  it('an OCR field with no recorded source page still carries an explicit (unrecorded) pincite', () => {
    const h = applyOcrHonesty({ field: 'date', value: '2004-05-01', confidence: 88, sourcePage: null, ocrDerived: true });
    expect(h.pincite).toBe('OCR (source page unrecorded)');
  });

  it('maps an OCR-derived field to a downgraded finding source basis (NC-8/NC-9)', () => {
    const [h] = applyOcrHonestyAll([
      { field: 'instrument_reference', value: 'DB 1234 PG 56', confidence: 95, sourcePage: 7, ocrDerived: true },
    ]);
    const basis = toFindingOcrBasis(h!);
    expect(basis.ocrDerived).toBe(true);
    expect(basis.downgraded).toBe(true); // OCR-only conclusion downgraded until the instrument is reviewed
    expect(basis.ocrSourcePagePincite).toBe('OCR p.7');
  });

  it('covers the NC-9 critical-field set (parties, instrument/recording refs, dates, testacy, legal description)', () => {
    for (const f of ['parties', 'instrument_reference', 'recording_reference', 'date', 'testacy_status', 'legal_description']) {
      expect(TITLE_EXAM_CRITICAL_FIELDS).toContain(f);
    }
  });
});
