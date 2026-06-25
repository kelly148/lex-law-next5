/**
 * deedUploadFormats.ts — MONSTER BUILD 2 E2: the SINGLE source of truth for which upload formats the deed
 * materials dropzone accepts and how the server routes each to a text-extraction branch. Shared by the server
 * upload endpoint (src/server/index.ts) AND the client dropzone (MaterialsDrawer) so the two cannot drift.
 *
 * The extraction itself is already built (MATERIALS-DROPZONE-1): docx -> mammoth; text -> utf-8; pdf -> pdf.js
 * text layer with a scanned-PDF OCR fallback; image -> tesseract OCR. E2 only WIDENS the accepted set:
 *   + .md            -> text  (utf-8, same as .txt)
 *   + .tif/.tiff/.webp -> image (OCR; raster formats tesseract decodes — a format it cannot read fails CLOSED to
 *                        'failed', never a silent/garbled extraction).
 *
 * DELIBERATELY NOT accepted (each needs a NEW dependency = an operator-gated decision, NOT added here):
 *   .doc  — legacy binary Word (mammoth reads .docx only; needs a separate .doc parser)
 *   .heic — needs a HEIC->JPEG conversion step before OCR
 * These are surfaced (UNSUPPORTED_NEEDS_DEP), never silently dropped.
 */

/** Which server extraction branch a file routes to. 'unsupported' => stored, extractionStatus 'not_supported'. */
export type UploadBranch = 'docx' | 'text' | 'pdf' | 'image' | 'unsupported';

/** File EXTENSION (lowercase, no dot) -> extraction branch. */
const EXT_BRANCH: Readonly<Record<string, Exclude<UploadBranch, 'unsupported'>>> = {
  docx: 'docx',
  txt: 'text',
  md: 'text',
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  tif: 'image',
  tiff: 'image',
  webp: 'image',
};

/** MIME type (lowercase) -> extraction branch. */
const MIME_BRANCH: Readonly<Record<string, Exclude<UploadBranch, 'unsupported'>>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'text',
  'text/markdown': 'text',
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/tiff': 'image',
  'image/webp': 'image',
};

/**
 * PURE: route an uploaded file (by MIME and/or extension) to its extraction branch. Extension wins when known
 * (the most reliable signal across browsers/OSes); MIME is the fallback; otherwise 'unsupported'.
 */
export function routeUploadFormat(mimeType: string | null | undefined, ext: string | null | undefined): UploadBranch {
  const e = (ext ?? '').toLowerCase().replace(/^\./, '');
  const m = (mimeType ?? '').toLowerCase().trim();
  return EXT_BRANCH[e] ?? MIME_BRANCH[m] ?? 'unsupported';
}

/** True if the file is an accepted deed-materials upload (the client dropzone's accept predicate). */
export function isAcceptedUpload(mimeType: string | null | undefined, ext: string | null | undefined): boolean {
  return routeUploadFormat(mimeType, ext) !== 'unsupported';
}

/** Accepted extensions (client dropzone validation + the `accept` attribute). */
export const ACCEPTED_UPLOAD_EXTENSIONS: readonly string[] = Object.keys(EXT_BRANCH);

/** Accepted MIME types (client dropzone validation + the `accept` attribute). */
export const ACCEPTED_UPLOAD_MIME: readonly string[] = Object.keys(MIME_BRANCH);

/** The `accept` attribute value for the dropzone <input type="file">. */
export const ACCEPTED_UPLOAD_ATTR: string = [
  ...ACCEPTED_UPLOAD_EXTENSIONS.map((x) => `.${x}`),
  ...ACCEPTED_UPLOAD_MIME,
].join(',');

/** Human-friendly accepted-formats label for the dropzone UI. */
export const ACCEPTED_UPLOAD_LABEL = 'Word, PDF, text/markdown, PNG, JPEG, TIFF, WebP';

/** Formats deliberately excluded because each needs a NEW dependency (operator-gated; surfaced, not silent). */
export const UNSUPPORTED_NEEDS_DEP: readonly string[] = ['doc', 'heic'];
