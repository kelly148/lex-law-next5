// @vitest-environment jsdom
/**
 * MATERIALS-DROPZONE-1 (Increment A) — drag-and-drop drop zone render + routing gate.
 *
 * Pins the genuinely-new frontend behavior in MaterialsDrawer's UploadForm:
 *   1. A real drop zone — drag-active visual state on dragenter, reverts on dragleave.
 *   2. Dropped files route through the SAME /api/materials/upload path the click flow uses
 *      (one code path, not a parallel one) — the load-bearing invariant from the build prompt.
 *   3. Multi-file drop — every queued file is sent.
 *   4. Unsupported types get a friendly inline reject and never reach the upload path.
 *   5. Click-to-browse still works and hits the same endpoint as drop.
 *
 * tRPC + useGuardedMutation are mocked the same way as the #310 / REVIEW-UX-REDESIGN-1
 * render suites (the mocked useQuery calls a real useRef so hook counts match production).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const { MATTER_ID } = vi.hoisted(() => ({
  MATTER_ID: '44444444-4444-4444-4444-444444444444',
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  const q = (data: unknown) => () => {
    React.useRef(null);
    return { data, isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      useUtils: () => utilsProxy,
      materials: { list: { useQuery: q([]) } },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import MaterialsDrawer from '../MaterialsDrawer.js';

const DRAWER_PROPS = { matterId: MATTER_ID, matterTitle: 'Test Matter', clientName: 'Test Client', onClose: () => {} };

function okFetch() {
  return vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response));
}

// Succeeds on every call EXCEPT the Nth (1-based), which returns a server reject —
// lets us exercise the partial-failure bookkeeping with a multi-file upload.
function failNthFetch(n: number) {
  let call = 0;
  return vi.fn((_url: string, _init?: RequestInit) => {
    call += 1;
    if (call === n) {
      return Promise.resolve({
        ok: false,
        status: 413,
        json: () => Promise.resolve({ message: 'File exceeds 50 MB limit' }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
  });
}

function docxFile(name = 'brief.docx'): File {
  return new File(['hello world'], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

// Render the drawer and switch into upload mode.
function renderUpload() {
  const result = render(<MaterialsDrawer {...DRAWER_PROPS} />);
  fireEvent.click(result.getByText('Upload File'));
  return result;
}

afterEach(() => cleanup());
beforeEach(() => {
  (global as unknown as { fetch: unknown }).fetch = okFetch();
});

describe('MATERIALS-DROPZONE-1 — drag-active visual state', () => {
  it('shows the drop zone and toggles a drag-active prompt on dragenter / dragleave', () => {
    const { getByTestId, getByText, queryByText } = renderUpload();
    const zone = getByTestId('materials-drop-zone');
    expect(getByText(/Drag .* drop files here/)).toBeTruthy();

    fireEvent.dragEnter(zone, { dataTransfer: { files: [] } });
    expect(getByText('Drop files to add them')).toBeTruthy();

    fireEvent.dragLeave(zone, { dataTransfer: { files: [] } });
    expect(queryByText('Drop files to add them')).toBeNull();
  });
});

describe('MATERIALS-DROPZONE-1 — drop routes through the existing upload path', () => {
  it('a dropped file is queued and uploaded via POST /api/materials/upload', async () => {
    const { getByTestId, getByText } = renderUpload();
    const zone = getByTestId('materials-drop-zone');

    fireEvent.drop(zone, { dataTransfer: { files: [docxFile()] } });
    // Queued, not silently swallowed.
    expect(getByTestId('materials-upload-queue').textContent).toContain('brief.docx');

    fireEvent.click(getByText('Upload'));

    await waitFor(() => {
      const fetchMock = (global as unknown as { fetch: ReturnType<typeof okFetch> }).fetch;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![0]).toBe('/api/materials/upload');
      expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    });
  });

  it('multi-file drop sends every file through the same path', async () => {
    const { getByTestId, getByText } = renderUpload();
    const zone = getByTestId('materials-drop-zone');

    fireEvent.drop(zone, { dataTransfer: { files: [docxFile('a.docx'), docxFile('b.docx')] } });
    fireEvent.click(getByText('Upload 2 files'));

    await waitFor(() => {
      const fetchMock = (global as unknown as { fetch: ReturnType<typeof okFetch> }).fetch;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const call of fetchMock.mock.calls) expect(call[0]).toBe('/api/materials/upload');
    });
  });
});

describe('MATERIALS-DROPZONE-1 — unsupported types are rejected, not swallowed', () => {
  it('drops an unsupported file → friendly reject, nothing queued, no upload', () => {
    const { getByTestId, queryByTestId } = renderUpload();
    const zone = getByTestId('materials-drop-zone');

    const bad = new File(['MZ'], 'tool.exe', { type: 'application/x-msdownload' });
    fireEvent.drop(zone, { dataTransfer: { files: [bad] } });

    expect(getByTestId('materials-upload-rejects').textContent).toContain('tool.exe');
    expect(queryByTestId('materials-upload-queue')).toBeNull();

    const fetchMock = (global as unknown as { fetch: ReturnType<typeof okFetch> }).fetch;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a mixed drop queues the good file AND rejects the bad one (partition, not all-or-nothing)', () => {
    const { getByTestId } = renderUpload();
    const zone = getByTestId('materials-drop-zone');

    const bad = new File(['MZ'], 'tool.exe', { type: 'application/x-msdownload' });
    fireEvent.drop(zone, { dataTransfer: { files: [docxFile('good.docx'), bad] } });

    expect(getByTestId('materials-upload-queue').textContent).toContain('good.docx');
    expect(getByTestId('materials-upload-rejects').textContent).toContain('tool.exe');
  });

  it('rejects a file over the 50 MB cap with a friendly notice, nothing queued, no upload', () => {
    const { getByTestId, queryByTestId } = renderUpload();
    const zone = getByTestId('materials-drop-zone');

    const big = docxFile('big.docx');
    Object.defineProperty(big, 'size', { value: 60 * 1024 * 1024 }); // accepted type, over the cap
    fireEvent.drop(zone, { dataTransfer: { files: [big] } });

    expect(getByTestId('materials-upload-rejects').textContent).toMatch(/exceeds|50 MB/);
    expect(queryByTestId('materials-upload-queue')).toBeNull();

    const fetchMock = (global as unknown as { fetch: ReturnType<typeof okFetch> }).fetch;
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('MATERIALS-DROPZONE-1 — partial upload failure keeps only the failed file queued', () => {
  it('on a 2-file upload where the 2nd fails: success drops out, failure stays, error shown, form stays open', async () => {
    (global as unknown as { fetch: unknown }).fetch = failNthFetch(2); // 1st ok, 2nd → 413
    const { getByTestId, getByText } = renderUpload();
    const zone = getByTestId('materials-drop-zone');

    fireEvent.drop(zone, { dataTransfer: { files: [docxFile('ok.docx'), docxFile('bad.docx')] } });
    fireEvent.click(getByText('Upload 2 files'));

    await waitFor(() => {
      const fetchMock = (global as unknown as { fetch: ReturnType<typeof failNthFetch> }).fetch;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      // The succeeded file is gone from the queue; the failed file remains for retry.
      const queue = getByTestId('materials-upload-queue').textContent ?? '';
      expect(queue).toContain('bad.docx');
      expect(queue).not.toContain('ok.docx');
      // The server message surfaces, and the form did NOT close (drop zone still mounted).
      expect(getByText(/exceeds 50 MB/)).toBeTruthy();
      expect(getByTestId('materials-drop-zone')).toBeTruthy();
    });
  });
});

describe('MATERIALS-DROPZONE-1 — click-to-browse still works (same endpoint as drop)', () => {
  it('selecting a file via the hidden input uploads through /api/materials/upload', async () => {
    const { getByText, container } = renderUpload();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.multiple).toBe(true);

    fireEvent.change(input, { target: { files: [docxFile('clicked.docx')] } });
    fireEvent.click(getByText('Upload'));

    await waitFor(() => {
      const fetchMock = (global as unknown as { fetch: ReturnType<typeof okFetch> }).fetch;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![0]).toBe('/api/materials/upload');
    });
  });
});
