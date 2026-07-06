/**
 * MATTER-DROP-1 — uploadMaterialFile unit test. Proves the shared client uploader posts multipart to the
 * EXISTING /api/materials/upload endpoint and surfaces the server error on failure.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadMaterialFile } from '../uploadMaterial.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('uploadMaterialFile', () => {
  it('POSTs multipart (file + matterId) to /api/materials/upload and returns ok on 2xx', async () => {
    const fetchSpy = vi.fn((_url: string, _init: RequestInit) => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal('fetch', fetchSpy);
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    const r = await uploadMaterialFile(file, 'm-1', 'a note');
    expect(r.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/materials/upload');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const fd = init.body as FormData;
    expect(fd.get('matterId')).toBe('m-1');
    expect(fd.get('description')).toBe('a note');
    expect(fd.get('file')).toBeTruthy();
  });

  it('returns the server error message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 413, json: () => Promise.resolve({ message: 'too big' }) } as unknown as Response)));
    const r = await uploadMaterialFile(new File(['x'], 'a.txt'), 'm-1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('too big');
  });

  it('returns a friendly error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    const r = await uploadMaterialFile(new File(['x'], 'a.txt'), 'm-1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('network down');
  });
});
