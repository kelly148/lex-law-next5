/**
 * ocrPipeline.ts — MATERIALS-DROPZONE-1 Increment B: orchestrate async OCR for a material.
 *
 * The upload endpoint has NO blob storage (the file bytes live only in the request buffer), so OCR
 * runs IN-PROCESS, fire-and-forget, capturing that buffer in a closure — it survives until OCR
 * finishes (the REVIEWER-ASYNC-FANOUT-1 pattern). The material is stored 'processing' up front and
 * updated to 'extracted' / 'low_confidence' / 'failed' when OCR completes; the client polls while
 * anything is 'processing'.
 *
 * Honesty: a 'low_confidence' (or 'failed') result is excluded from the assessment context by the
 * analysisContext predicate, so garbled/empty OCR never reaches an assessment.
 */
import { ocrImage, classifyOcr, type OcrClassification } from './ocrExtract.js';
import { rasterizePdfToImages } from './pdfRasterize.js';
import { updateMaterialExtraction } from '../db/queries/materials.js';

export type OcrKind = 'image' | 'scanned_pdf';

// Bound how many upload buffers we hold in memory at once (each captured in a fire-and-forget
// closure until OCR drains). Beyond this, a new request is shed to 'failed' WITHOUT capturing its
// buffer, so worst-case memory is bounded (≤ MAX_INFLIGHT_OCR × the 50 MB upload cap).
const MAX_INFLIGHT_OCR = 8;
let _inFlightOcr = 0;

/**
 * PURE predicate: a digital-PDF text extraction that succeeded but returned empty text ('partial',
 * per pdfExtract.ts) is a scanned PDF with no text layer → route it to OCR.
 */
export function pdfNeedsOcr(pdfExtractionStatus: 'extracted' | 'partial' | 'failed'): boolean {
  return pdfExtractionStatus === 'partial';
}

/** Run OCR over an image buffer, or over the rasterized pages of a scanned PDF, and classify. */
export async function runMaterialOcr(kind: OcrKind, buffer: Buffer): Promise<OcrClassification> {
  try {
    const pages = kind === 'image' ? [buffer] : await rasterizePdfToImages(buffer);
    if (pages.length === 0) {
      return { textContent: null, extractionStatus: 'failed', extractionError: 'No page images to OCR.' };
    }
    const texts: string[] = [];
    const confidences: number[] = [];
    for (const page of pages) {
      const { text, meanConfidence } = await ocrImage(page);
      const trimmed = text.trim();
      if (trimmed.length > 0) texts.push(trimmed);
      if (meanConfidence > 0) confidences.push(meanConfidence);
    }
    const combined = texts.join('\n\n');
    const meanConfidence =
      confidences.length > 0 ? confidences.reduce((a, c) => a + c, 0) / confidences.length : 0;
    return classifyOcr(combined, meanConfidence);
  } catch (err) {
    return {
      textContent: null,
      extractionStatus: 'failed',
      extractionError: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fire-and-forget: OCR the captured buffer in the background, then write the result onto the
 * material. Never throws into the caller (the upload request has already returned). If the DB write
 * fails the row stays 'processing' — a future MATERIALS-BACKFILL re-extraction sweep can retry it.
 */
export function startMaterialOcrInBackground(params: {
  materialId: string;
  userId: string;
  kind: OcrKind;
  buffer: Buffer;
}): void {
  const { materialId, userId, kind, buffer } = params;

  // Load-shed when too many OCR jobs are already in flight: mark this material 'failed' (so it never
  // hangs at 'processing') and return WITHOUT capturing the buffer in a long-lived closure.
  if (_inFlightOcr >= MAX_INFLIGHT_OCR) {
    void updateMaterialExtraction(materialId, userId, {
      textContent: null,
      extractionStatus: 'failed',
      extractionError: 'OCR is busy; please remove and re-add this file in a moment.',
    }).catch(() => {
      /* best-effort */
    });
    return;
  }

  _inFlightOcr += 1;
  void (async () => {
    try {
      const result = await runMaterialOcr(kind, buffer);
      try {
        await updateMaterialExtraction(materialId, userId, result);
      } catch {
        /* best-effort: leave the row 'processing' for a backfill sweep to retry */
      }
    } finally {
      _inFlightOcr -= 1;
    }
  })();
}
