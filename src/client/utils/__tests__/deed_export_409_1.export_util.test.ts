/**
 * DEED-EXPORT-409-1 — exportDocument unit tests.
 *
 * Proves the export wrapper (a) fetches GET /api/documents/:id/export, (b) on a 409 (or any non-2xx)
 * returns the server block reason and NEVER downloads the error body — the regression that saved a 409 JSON
 * as `export.json` — and (c) on a 2xx triggers a DOCX download with the Content-Disposition filename.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchDocumentExport,
  downloadDocumentExport,
  triggerBrowserDownload,
} from '../exportDocument.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function okResponse(disposition: string | null): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'Content-Disposition' ? disposition : null) },
    blob: () => Promise.resolve(new Blob(['DOCX'], { type: 'application/octet-stream' })),
  } as unknown as Response;
}

function errorResponse(status: number, body: unknown, jsonThrows = false): Response {
  return {
    ok: false,
    status,
    json: () => (jsonThrows ? Promise.reject(new Error('not json')) : Promise.resolve(body)),
    // A blob() that, if ever called on the error path, would fail the test's intent.
    blob: () => Promise.reject(new Error('blob() must not be called on a non-2xx response')),
  } as unknown as Response;
}

describe('fetchDocumentExport', () => {
  it('GETs the export endpoint and returns the blob + Content-Disposition filename on 200', async () => {
    const fetchSpy = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(okResponse('attachment; filename="Deed of Gift - Hannah Testvendor.docx"')),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const r = await fetchDocumentExport('doc-1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/documents/doc-1/export');
    expect(init.method).toBe('GET');
    expect(r.ok).toBe(true);
    expect(r.filename).toBe('Deed of Gift - Hannah Testvendor.docx');
    expect(r.blob).toBeInstanceOf(Blob);
  });

  it('falls back to document.docx when Content-Disposition has no filename', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okResponse(null))));
    const r = await fetchDocumentExport('doc-1');
    expect(r.ok).toBe(true);
    expect(r.filename).toBe('document.docx');
  });

  it('on a 409 returns the server message + code + status and NEVER reads a downloadable blob', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        errorResponse(409, {
          error: 'DEED_EXPORT_BLOCKED',
          message:
            'This document contains deed / recordable-instrument language but is not a deed produced by the deterministic deed agent.',
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const r = await fetchDocumentExport('doc-1');

    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.code).toBe('DEED_EXPORT_BLOCKED');
    expect(r.error).toContain('deterministic deed agent');
    expect(r.blob).toBeUndefined();
  });

  it('surfaces the D3 sign-off block reason (the gate the original brief did not enumerate)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          errorResponse(409, {
            error: 'D3_SIGNOFF_REQUIRED',
            message: 'Export blocked: this deed requires a source-extracted-facts sign-off before export.',
          }),
        ),
      ),
    );
    const r = await fetchDocumentExport('doc-1');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('D3_SIGNOFF_REQUIRED');
    expect(r.error).toContain('sign-off');
  });

  it('falls back to a generic status message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(errorResponse(409, null, true))));
    const r = await fetchDocumentExport('doc-1');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.code).toBeUndefined();
    expect(r.error).toBe('Export failed (HTTP 409).');
  });

  it('returns a friendly error when fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    const r = await fetchDocumentExport('doc-1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('network down');
  });
});

describe('triggerBrowserDownload', () => {
  it('creates an anchor with the filename and clicks it, then revokes the object URL', () => {
    const clickSpy = vi.fn();
    const anchor: Record<string, unknown> = { click: clickSpy };
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });

    triggerBrowserDownload(new Blob(['x']), 'My Deed.docx');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchor.href).toBe('blob:mock');
    expect(anchor.download).toBe('My Deed.docx');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});

describe('downloadDocumentExport', () => {
  it('triggers a browser download on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(okResponse('attachment; filename="A.docx"'))),
    );
    const createObjectURL = vi.fn(() => 'blob:mock');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ click: vi.fn() })),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });

    const r = await downloadDocumentExport('doc-1');

    expect(r.ok).toBe(true);
    expect(r.filename).toBe('A.docx');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('does NOT trigger any download on a 409 and returns the reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(errorResponse(409, { error: 'DEED_EXPORT_BLOCKED', message: 'blocked reason' })),
      ),
    );
    const createObjectURL = vi.fn(() => 'blob:mock');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ click: vi.fn() })),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });

    const r = await downloadDocumentExport('doc-1');

    expect(r.ok).toBe(false);
    expect(r.error).toBe('blocked reason');
    expect(r.code).toBe('DEED_EXPORT_BLOCKED');
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
