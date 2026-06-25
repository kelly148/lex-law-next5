// @vitest-environment jsdom
/**
 * MaterialsDropZone lazy-matter seam (DEED-INTAKE-REDESIGN-1, spec §4).
 *
 * The existing materialsDropzone1 suite drives the matterId-PROVIDED path (the drawer). This pins the genuinely
 * new matterId-ABSENT path used by the Quick Deed lane: the owning matter is resolved (created) ONLY on the
 * FIRST accepted file — never on mere render — and the upload posts against the resolved id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const invalidateMock = vi.hoisted(() => vi.fn());

vi.mock('../../trpc.js', () => ({
  trpc: { useUtils: () => ({ materials: { list: { invalidate: invalidateMock } } }) },
}));

import MaterialsDropZone from '../MaterialsDropZone.js';

function docxFile(name = 'deed.docx'): File {
  return new File(['x'], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

afterEach(() => cleanup());
beforeEach(() => {
  invalidateMock.mockClear();
  (global as unknown as { fetch: unknown }).fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response));
});

describe('MaterialsDropZone — lazy-matter seam (spec §4)', () => {
  it('does NOT resolve/create the owning matter on mere render (orphan guard)', () => {
    const resolveMatterId = vi.fn(() => Promise.resolve('m-lazy'));
    render(<MaterialsDropZone resolveMatterId={resolveMatterId} />);
    expect(resolveMatterId).not.toHaveBeenCalled();
  });

  it('resolves the matter on the FIRST accepted file, and only once', () => {
    const resolveMatterId = vi.fn(() => Promise.resolve('m-lazy'));
    const { getByTestId } = render(<MaterialsDropZone resolveMatterId={resolveMatterId} />);
    const zone = getByTestId('materials-drop-zone');
    fireEvent.drop(zone, { dataTransfer: { files: [docxFile('a.docx')] } });
    expect(resolveMatterId).toHaveBeenCalledTimes(1);
    // A second accepted file must NOT create a second matter (resolveStartedRef guards it).
    fireEvent.drop(zone, { dataTransfer: { files: [docxFile('b.docx')] } });
    expect(resolveMatterId).toHaveBeenCalledTimes(1);
  });

  it('a rejected (unsupported) file does NOT resolve the matter — only an accepted file is a real interaction', () => {
    const resolveMatterId = vi.fn(() => Promise.resolve('m-lazy'));
    const { getByTestId } = render(<MaterialsDropZone resolveMatterId={resolveMatterId} />);
    const bad = new File(['MZ'], 'tool.exe', { type: 'application/x-msdownload' });
    fireEvent.drop(getByTestId('materials-drop-zone'), { dataTransfer: { files: [bad] } });
    expect(resolveMatterId).not.toHaveBeenCalled();
  });

  it('uploads against the resolved matterId (POST /api/materials/upload with the lazy id)', async () => {
    const resolveMatterId = vi.fn(() => Promise.resolve('m-lazy'));
    const { getByTestId, getByText } = render(<MaterialsDropZone resolveMatterId={resolveMatterId} />);
    fireEvent.drop(getByTestId('materials-drop-zone'), { dataTransfer: { files: [docxFile()] } });
    fireEvent.click(getByText('Upload'));

    await waitFor(() => {
      const fetchMock = (global as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![0]).toBe('/api/materials/upload');
      const body = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
      expect(body.get('matterId')).toBe('m-lazy');
    });
  });
});
