// @vitest-environment jsdom
/**
 * MaterialsDropZone — LIVE-8 (no nested form) + LIVE-10 (auto-commit on attach), live UAT 2026-06-26.
 *
 * LIVE-8: the dropzone must NOT render its own <form> — when it did, nesting it inside the seller/category
 * <form> made the "Upload" button do a native GET ("/deed?") that reloaded the page + reset the form. It now
 * renders a <div> with a type="button" Upload button.
 * LIVE-10: with autoCommit, an attached file uploads immediately (no separate "Upload" click), so the doc-derived
 * facts resolve before generate. The general drawer (no autoCommit) keeps the explicit stage-then-Upload model.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const invalidateMock = vi.hoisted(() => vi.fn());
vi.mock('../../trpc.js', () => ({ trpc: { useUtils: () => ({ materials: { list: { invalidate: invalidateMock } } }) } }));

import MaterialsDropZone from '../MaterialsDropZone.js';

function docxFile(name = 'deed.docx'): File {
  return new File(['x'], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
const fetchMock = () => (global as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch;

afterEach(() => cleanup());
beforeEach(() => {
  invalidateMock.mockClear();
  (global as unknown as { fetch: unknown }).fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response));
});

describe('MaterialsDropZone — LIVE-8 no nested form', () => {
  it('does NOT render a <form> element (so nesting it inside a parent form cannot trigger a native submit/reload)', () => {
    const { container } = render(<MaterialsDropZone resolveMatterId={() => Promise.resolve('m')} />);
    expect(container.querySelector('form')).toBeNull();
  });

  it('the manual Upload button is type="button", not a submit', () => {
    const { getByText } = render(<MaterialsDropZone resolveMatterId={() => Promise.resolve('m')} />);
    fireEvent.drop(getByText(/Drag & drop/i).closest('[data-testid="materials-drop-zone"]')!, { dataTransfer: { files: [docxFile()] } });
    expect((getByText('Upload') as HTMLButtonElement).type).toBe('button');
  });
});

describe('MaterialsDropZone — LIVE-10 auto-commit on attach', () => {
  it('with autoCommit, an attached file uploads immediately WITHOUT an "Upload" click, and onUploaded fires', async () => {
    const onUploaded = vi.fn();
    const { getByTestId, queryByText } = render(
      <MaterialsDropZone resolveMatterId={() => Promise.resolve('m-auto')} onUploaded={onUploaded} autoCommit />,
    );
    fireEvent.drop(getByTestId('materials-drop-zone'), { dataTransfer: { files: [docxFile()] } });

    await waitFor(() => expect(fetchMock()).toHaveBeenCalledTimes(1));
    expect(fetchMock().mock.calls[0]![0]).toBe('/api/materials/upload');
    const body = (fetchMock().mock.calls[0]![1] as RequestInit).body as FormData;
    expect(body.get('matterId')).toBe('m-auto');
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    // the manual Upload button is hidden in autoCommit mode (the commit happens on drop)
    expect(queryByText('Upload')).toBeNull();
  });

  it('REGRESSION: WITHOUT autoCommit, attaching a file does NOT upload until the Upload button is clicked', async () => {
    const { getByTestId, getByText } = render(<MaterialsDropZone resolveMatterId={() => Promise.resolve('m')} />);
    fireEvent.drop(getByTestId('materials-drop-zone'), { dataTransfer: { files: [docxFile()] } });
    // attach alone does not upload
    expect(fetchMock()).not.toHaveBeenCalled();
    fireEvent.click(getByText('Upload'));
    await waitFor(() => expect(fetchMock()).toHaveBeenCalledTimes(1));
  });
});
