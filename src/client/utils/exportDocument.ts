/**
 * exportDocument — DEED-EXPORT-409-1: the single client wrapper for the synchronous DOCX export
 * (GET /api/documents/:documentId/export).
 *
 * Replaces a native `<a href download>` anchor whose browser download machinery blindly saved WHATEVER
 * bytes the server returned to disk — including a 409 JSON block reason, which Chrome saved as `export.json`
 * and surfaced as a failed "Site wasn't available" download with no in-app explanation. This wrapper fetches
 * the endpoint and ONLY on a 2xx triggers the browser download; on a non-2xx it returns the server's block
 * reason so the caller can show it in-app and NEVER downloads the error body.
 *
 * This is display / robustness only — it changes NOTHING about the export route or its gates (the LIVE-9
 * deed guard, the conflict gate, the sendability gate, the D3 sign-off gate). The reason string shown to the
 * user is exactly the server's own `message`, so it is correct for whichever gate actually blocks.
 */

export interface DocumentExportResult {
  ok: boolean;
  /** Failure only — the server block reason (or a generic fallback) to show in-app. */
  error?: string;
  /** Failure only — the server error code (e.g. DEED_EXPORT_BLOCKED, D3_SIGNOFF_REQUIRED), when present. */
  code?: string;
  /** Failure only — the HTTP status. */
  status?: number;
  /** Success only — the downloaded filename. */
  filename?: string;
}

/** Success-path shape returned by {@link fetchDocumentExport} before the download is triggered. */
export interface DocumentExportFetch extends DocumentExportResult {
  /** Success only — the DOCX bytes, handed to {@link triggerBrowserDownload}. */
  blob?: Blob;
}

const FILENAME_RE = /filename="([^"]+)"/;

/**
 * Network + error-classification layer. NO DOM side effects, so this is fully unit-testable in a node env
 * by stubbing `fetch`. On a non-2xx response it returns `{ ok: false, error, code, status }` WITHOUT ever
 * reading the body as a downloadable blob — this is the fix for the `export.json` defect. On a 2xx it
 * returns the blob plus the filename parsed from Content-Disposition (falling back to `document.docx`).
 */
export async function fetchDocumentExport(documentId: string): Promise<DocumentExportFetch> {
  let response: Response;
  try {
    response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/export`, {
      method: 'GET',
      credentials: 'same-origin',
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The document could not be exported.' };
  }

  if (!response.ok) {
    // NEVER treat a non-2xx body as a download. Surface the server's block reason instead.
    let error = `Export failed (HTTP ${response.status}).`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      if (body.error) code = body.error;
      if (body.message) error = body.message;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    // Build the result without an explicit `undefined` code (exactOptionalPropertyTypes).
    const failure: DocumentExportFetch = { ok: false, error, status: response.status };
    if (code !== undefined) failure.code = code;
    return failure;
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get('Content-Disposition') ?? '';
  const filenameMatch = FILENAME_RE.exec(contentDisposition);
  const filename = filenameMatch?.[1] ?? 'document.docx';
  return { ok: true, blob, filename };
}

/** DOM side-effect layer — isolated so {@link fetchDocumentExport} stays test-pure. */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * The one-call client API for the Download DOCX control: fetch, and on success trigger the browser download;
 * on failure return the reason for the UI to display. The returned result never carries the blob.
 */
export async function downloadDocumentExport(documentId: string): Promise<DocumentExportResult> {
  const result = await fetchDocumentExport(documentId);
  if (result.ok && result.blob) {
    const filename = result.filename ?? 'document.docx';
    triggerBrowserDownload(result.blob, filename);
    return { ok: true, filename };
  }
  // Failure: return the reason without the blob (there is none on a non-2xx).
  const { blob: _blob, ...rest } = result;
  return rest;
}
