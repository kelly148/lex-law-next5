// @vitest-environment jsdom
/**
 * MATERIALS-DROPZONE-1 Increment B — MaterialCard renders the async-OCR status chips.
 * Guards the client display change (ci-gotchas #10: a changed client component needs a render test;
 * the mocked tRPC useQuery calls a real useRef so a hooks violation could actually surface).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const { MATERIALS } = vi.hoisted(() => {
  const m = (id: string, filename: string, extractionStatus: string) => ({
    id,
    filename,
    description: null,
    tags: [] as string[],
    pinned: false,
    uploadSource: 'upload' as const,
    extractionStatus,
    deletedAt: null as string | null,
    fileSize: 2048,
    createdAt: '2026-06-09T12:00:00.000Z',
  });
  return {
    MATERIALS: [
      m('a1', 'scan.png', 'processing'),
      m('b2', 'blurry.jpg', 'low_confidence'),
      m('c3', 'notes.txt', 'extracted'),
    ],
  };
});

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  return {
    trpc: {
      useUtils: () => utilsProxy,
      materials: {
        list: {
          useQuery: () => {
            React.useRef(null);
            return { data: MATERIALS, isLoading: false, isError: false, error: null, refetch: () => {} };
          },
        },
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import MaterialsDrawer from '../MaterialsDrawer.js';

afterEach(() => cleanup());

describe('MATERIALS-DROPZONE-1 Inc B — OCR status chips', () => {
  it('renders the processing ("OCR…") and low_confidence chips alongside extracted', () => {
    const { getByText } = render(
      <MaterialsDrawer matterId="55555555-5555-5555-5555-555555555555" onClose={() => {}} />,
    );
    expect(getByText(/OCR/)).toBeTruthy(); // 'processing' chip relabelled "OCR…"
    expect(getByText('low confidence')).toBeTruthy(); // 'low_confidence' chip
    expect(getByText('extracted')).toBeTruthy();
  });
});
