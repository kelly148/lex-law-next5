/**
 * pdfExtract.ts — MATERIALS-EXTRACTION-1 (Bug B): server-side PDF TEXT extraction.
 *
 * The upload endpoint previously extracted only .docx (mammoth) and .txt; PDFs landed
 * extractionStatus='not_supported', textContent=null — so an uploaded PDF intake packet never reached the
 * assessment/drafting context (the keystone of the Brown-intake gap). This extracts a PDF's TEXT LAYER via
 * `unpdf` (MIT; wraps a serverless build of Mozilla's pdf.js).
 *
 * SCOPE: digital text-layer PDFs only. OCR for SCANNED PDFs is explicitly DEFERRED — a scan has no text
 * layer, so extraction returns empty text -> extractionStatus 'partial' with an explanatory note (mirrors the
 * existing docx 'partial' behavior), never a silent empty 'extracted'.
 *
 * The unpdf call is injected (`extractFn`) so the pure status-MAPPING is unit-tested; the real extraction
 * runs live in the upload path.
 */

export type ExtractionOutcomeStatus = 'extracted' | 'partial' | 'failed';

export interface PdfExtractResult {
  textContent: string | null;
  extractionStatus: ExtractionOutcomeStatus;
  extractionError: string | null;
}

/** Default extractor: unpdf (pdf.js text layer). Dynamic import keeps the ESM-only dep out of module init. */
async function defaultPdfExtract(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  // mergePages:true yields a single string; widen to unknown so both shapes are handled defensively.
  const out: unknown = (await extractText(pdf, { mergePages: true })).text;
  return Array.isArray(out) ? out.join('\n') : typeof out === 'string' ? out : '';
}

/**
 * Extract a PDF's text and map to the storage extractionStatus. text present -> 'extracted'; succeeded but
 * empty (likely a scan) -> 'partial' (+ OCR-deferred note); a thrown error -> 'failed' (+ message).
 */
export async function extractPdfText(
  buffer: Buffer,
  extractFn: (b: Buffer) => Promise<string> = defaultPdfExtract,
): Promise<PdfExtractResult> {
  try {
    const raw = await extractFn(buffer);
    const merged = (raw ?? '').trim();
    if (merged.length > 0) {
      return { textContent: merged, extractionStatus: 'extracted', extractionError: null };
    }
    return {
      textContent: null,
      extractionStatus: 'partial',
      extractionError: 'No extractable text layer (likely a scanned PDF); OCR is not yet supported.',
    };
  } catch (err) {
    return {
      textContent: null,
      extractionStatus: 'failed',
      extractionError: err instanceof Error ? err.message : String(err),
    };
  }
}
