/**
 * ocrExtract.ts — MATERIALS-DROPZONE-1 Increment B: in-process image OCR via tesseract.js.
 *
 * NO EGRESS: tesseract.js fetches its language model from a CDN BY DEFAULT. We override `langPath`
 * to a LOCAL bundled model (assets/tessdata/eng.traineddata, gzip:false) and disable the cache, so
 * nothing is fetched at runtime. The WASM core is resolved locally by tesseract.js's own Node
 * `require('tesseract.js-core/...')` (no corePath / no CDN needed in Node). Pure JS + WASM — no
 * native addon, no system package (works on the node:alpine runtime image).
 *
 * OCR is CPU-heavy (~hundreds of MB + seconds per page), so a SINGLE lazily-created worker is
 * shared and work is serialized through a promise chain — bounding memory to one worker regardless
 * of how many uploads arrive at once.
 *
 * HONESTY FLOOR (guardrail 4): classifyOcr() is a PURE function. Below the confidence floor — or
 * with empty output — it returns 'low_confidence' with textContent: NULL. Nulling the text at the
 * data layer (rather than only filtering it in the assessment) is deliberate: it guarantees garbled
 * OCR can never reach ANY consumer — the assessment, drafting, regeneration, review, or outline —
 * because every material reader gates inclusion on non-empty textContent. The user still sees the
 * 'low_confidence' status + the confidence in extractionError.
 */
import path from 'node:path';
import type { Worker as TesseractWorker } from 'tesseract.js';

// Local bundled model directory (committed: assets/tessdata/eng.traineddata). Resolved from the
// process CWD, matching how index.ts resolves dist/ (Railway runs `node dist/server/index.js` from /app).
const LANG_PATH = path.resolve(process.cwd(), 'assets', 'tessdata');
const LANG = 'eng';

/** Mean-confidence floor (0–100). Below this, OCR output is treated as untrustworthy. */
export const OCR_CONFIDENCE_FLOOR = 60;

export type OcrOutcomeStatus = 'extracted' | 'low_confidence' | 'failed';

export interface OcrClassification {
  textContent: string | null;
  extractionStatus: OcrOutcomeStatus;
  extractionError: string | null;
}

/**
 * PURE: decide the stored status from OCR text + mean confidence. Empty output or sub-floor
 * confidence → 'low_confidence' with NULL text — untrustworthy OCR is never persisted, so it cannot
 * reach drafting / review / outline / the assessment (all of which include only materials with
 * non-empty textContent). The confidence is surfaced in extractionError. Trustworthy → 'extracted'.
 */
export function classifyOcr(rawText: string, meanConfidence: number): OcrClassification {
  const text = (rawText ?? '').trim();
  if (text.length === 0) {
    return {
      textContent: null,
      extractionStatus: 'low_confidence',
      extractionError: 'OCR produced no readable text.',
    };
  }
  if (meanConfidence < OCR_CONFIDENCE_FLOOR) {
    return {
      textContent: null, // withhold sub-floor text at the data layer (honesty floor)
      extractionStatus: 'low_confidence',
      extractionError:
        `OCR confidence ${Math.round(meanConfidence)}% is below the ${OCR_CONFIDENCE_FLOOR}% floor; ` +
        'result withheld (not used for drafting, review, outline, or assessment).',
    };
  }
  return { textContent: text, extractionStatus: 'extracted', extractionError: null };
}

// ── Single shared worker + serial queue ───────────────────────────────────────────────────────
let _workerPromise: Promise<TesseractWorker> | null = null;

async function getWorker(): Promise<TesseractWorker> {
  if (_workerPromise === null) {
    const p = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      return createWorker(LANG, OEM.LSTM_ONLY, {
        langPath: LANG_PATH, // LOCAL model dir — overrides the default CDN
        gzip: false, // bundled eng.traineddata is uncompressed
        cacheMethod: 'none', // never write/read a cache; never fall back to a fetch
        logger: () => {},
        errorHandler: () => {},
      });
    })();
    _workerPromise = p;
    // Don't cache a REJECTED init — a transient failure must not disable OCR for the process
    // lifetime. Identity-guard the reset so a concurrent re-init isn't clobbered.
    p.catch(() => {
      if (_workerPromise === p) _workerPromise = null;
    });
  }
  return _workerPromise;
}

// Promise-chain mutex: one recognize() at a time, so concurrent uploads don't spawn N workers.
let _chain: Promise<unknown> = Promise.resolve();
function runSerial<T>(task: () => Promise<T>): Promise<T> {
  const result = _chain.then(task, task);
  _chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** OCR a single image buffer (PNG/JPEG). Returns the recognized text + mean confidence (0–100). */
export async function ocrImage(image: Buffer): Promise<{ text: string; meanConfidence: number }> {
  return runSerial(async () => {
    const worker = await getWorker();
    const { data } = await worker.recognize(image);
    const text = typeof data.text === 'string' ? data.text : '';
    const meanConfidence = typeof data.confidence === 'number' ? data.confidence : 0;
    return { text, meanConfidence };
  });
}

/** Tear down the shared worker (best-effort; for graceful shutdown / tests). */
export async function terminateOcrWorker(): Promise<void> {
  if (_workerPromise === null) return;
  const p = _workerPromise;
  _workerPromise = null;
  try {
    const worker = await p;
    await worker.terminate();
  } catch {
    /* already gone */
  }
}
