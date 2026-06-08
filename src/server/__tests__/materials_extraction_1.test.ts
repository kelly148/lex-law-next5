/**
 * MATERIALS-EXTRACTION-1 (Bug B) — extractPdfText unit tests.
 *
 * (1) REAL end-to-end: a minimal digital PDF is extracted via unpdf (pdf.js) and mapped to
 *     extractionStatus='extracted' with the text — proving the keystone (PDFs now reach textContent).
 * (2) Pure status-MAPPING via an injected extractor: empty text (scan; OCR deferred) -> 'partial' with a
 *     note; a thrown error -> 'failed' with the message. So a budget/OCR gap is never a silent empty success.
 */
import { describe, it, expect } from 'vitest';
import { extractPdfText } from '../intake/pdfExtract.js';

// A minimal valid 1-page PDF whose text layer is "Hello PDF Bug B" (built in-repo; see test comment).
const MINIMAL_PDF_B64 =
  'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNjEyIDc5Ml0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggNTI+PnN0cmVhbQpCVCAvRjEgMjQgVGYgNzIgNzAwIFRkIChIZWxsbyBQREYgQnVnIEIpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iajw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+ZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSL1NpemUgNj4+CiUlRU9G';

describe('MATERIALS-EXTRACTION-1 — extractPdfText', () => {
  it('REAL: extracts a digital PDF text layer via unpdf -> extracted', async () => {
    const buf = Buffer.from(MINIMAL_PDF_B64, 'base64');
    const r = await extractPdfText(buf);
    expect(r.extractionStatus).toBe('extracted');
    expect(r.textContent).toContain('Hello PDF Bug B');
    expect(r.extractionError).toBeNull();
  });

  it('empty text (scanned PDF; OCR deferred) -> partial with an explanatory note, never a silent empty extracted', async () => {
    const r = await extractPdfText(Buffer.from('x'), async () => '   ');
    expect(r.extractionStatus).toBe('partial');
    expect(r.textContent).toBeNull();
    expect(r.extractionError).toMatch(/scanned|OCR/i);
  });

  it('a thrown extractor error -> failed with the message (no throw escapes)', async () => {
    const r = await extractPdfText(Buffer.from('x'), async () => { throw new Error('corrupt pdf'); });
    expect(r.extractionStatus).toBe('failed');
    expect(r.textContent).toBeNull();
    expect(r.extractionError).toBe('corrupt pdf');
  });

  it('extracted text is trimmed', async () => {
    const r = await extractPdfText(Buffer.from('x'), async () => '  some text  ');
    expect(r.textContent).toBe('some text');
    expect(r.extractionStatus).toBe('extracted');
  });
});
