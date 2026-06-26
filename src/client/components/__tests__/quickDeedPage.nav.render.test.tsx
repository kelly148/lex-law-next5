// @vitest-environment jsdom
/**
 * QuickDeedPage navigation — LIVE-7 (live UAT 2026-06-26).
 *
 * A non-gift (seller-side / category) quickDeed.generate that creates a document must NAVIGATE to it, exactly
 * like the gift path, and must not double-fire. This test drives the seller-side submit with a mutation mock that
 * fires onSuccess (so the page's navigate-on-documentId handler runs) and asserts the navigate target + the
 * double-submit guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const navMock = vi.hoisted(() => vi.fn());
const createMutate = vi.hoisted(() => vi.fn(() => Promise.resolve({ matterId: 'qd-matter-1' })));
const generateMutate = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ documentId: 'doc-1', matterId: 'qd-matter-1', failedClosed: false, failures: [] as string[] })),
);
const mockState = vi.hoisted(() => ({
  deedTypes: [] as Array<{ key: string; title: string; category: string; status: string; quickDeedGenerates: boolean }>,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navMock, Navigate: () => null };
});

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const q = (getData: () => unknown) => () => { React.useRef(null); return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} }; };
  return {
    trpc: {
      useUtils: () => ({ client: { quickDeed: { create: { mutate: createMutate }, generate: { mutate: generateMutate }, proposeIntake: { mutate: vi.fn() } } } }),
      deedDraftAgent: { isEnabled: { useQuery: q(() => ({ enabled: true })) } },
      quickDeed: { listDeedTypes: { useQuery: q(() => mockState.deedTypes) }, previewFacts: { useQuery: q(() => null) } },
    },
  };
});

// useGuardedMutation -> fires onSuccess/onError after the fn resolves, with a synchronous in-flight guard (mirrors
// the real hook) so we can assert the double-submit no-op.
vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: (fn: (i: unknown) => Promise<unknown>, opts: { onSuccess?: (r: unknown, i: unknown) => void; onError?: (e: Error, i: unknown) => void }) => {
    const guard = { inFlight: false };
    return {
      mutate: (input: unknown) => {
        if (guard.inFlight) return;
        guard.inFlight = true;
        Promise.resolve(fn(input)).then(
          (r) => { guard.inFlight = false; opts?.onSuccess?.(r, input); },
          (e) => { guard.inFlight = false; opts?.onError?.(e as Error, input); },
        );
      },
      isPending: false,
      error: null,
    };
  },
}));

vi.mock('../../components/MaterialsDropZone.js', async () => {
  const React = await import('react');
  return { default: (p: { resolveMatterId?: () => Promise<string> }) => React.createElement('button', { type: 'button', 'data-testid': 'quick-deed-dropzone', onClick: () => { void p.resolveMatterId?.(); } }, 'dz') };
});

import { MemoryRouter } from 'react-router-dom';
import QuickDeedPage from '../../pages/QuickDeedPage.js';

const REGISTRY = [
  { key: 'deed_of_gift', title: 'Deed of Gift', category: 'gift', status: 'available', quickDeedGenerates: true },
  { key: 'seller_side', title: 'Seller-Side Conveyance', category: 'seller-side', status: 'available', quickDeedGenerates: true },
  { key: 'deed_into_llc', title: 'Deed Into an LLC', category: 'C3', status: 'available', quickDeedGenerates: true },
];

function renderPage(): HTMLElement {
  const { container } = render(<MemoryRouter><QuickDeedPage /></MemoryRouter>);
  return container;
}

beforeEach(() => { navMock.mockClear(); createMutate.mockClear(); generateMutate.mockClear(); mockState.deedTypes = REGISTRY; });
afterEach(() => cleanup());

describe('QuickDeedPage — LIVE-7 non-gift navigation', () => {
  it('a successful SELLER-SIDE generate navigates to the created document', async () => {
    const c = renderPage();
    fireEvent.change(c.querySelector('[data-testid="quick-deed-type-select"]')!, { target: { value: 'seller_side' } });
    const names = Array.from(c.querySelectorAll('input[placeholder="Full legal name"]')) as HTMLInputElement[];
    fireEvent.change(names[0]!, { target: { value: 'Seller Owner' } });
    fireEvent.change(names[1]!, { target: { value: 'Buyer Person' } });
    fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);

    await waitFor(() => expect(navMock).toHaveBeenCalledTimes(1));
    expect(navMock).toHaveBeenCalledWith('/matters/qd-matter-1/documents/doc-1');
  });

  it('a successful CATEGORY (into-LLC) generate also navigates to the created document', async () => {
    const c = renderPage();
    fireEvent.change(c.querySelector('[data-testid="quick-deed-type-select"]')!, { target: { value: 'deed_into_llc' } });
    fireEvent.change(c.querySelector('input[placeholder="Full legal name"]')!, { target: { value: 'Dahlia Okonkwo' } });
    fireEvent.change(c.querySelector('input[placeholder="CITY OF ALEXANDRIA"]')!, { target: { value: 'CITY OF ALEXANDRIA' } });
    fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);

    await waitFor(() => expect(navMock).toHaveBeenCalledTimes(1));
    expect(navMock).toHaveBeenCalledWith('/matters/qd-matter-1/documents/doc-1');
  });

  it('a second click while the generate is in flight does NOT fire a second generate (double-submit guard)', async () => {
    const c = renderPage();
    fireEvent.change(c.querySelector('[data-testid="quick-deed-type-select"]')!, { target: { value: 'seller_side' } });
    const names = Array.from(c.querySelectorAll('input[placeholder="Full legal name"]')) as HTMLInputElement[];
    fireEvent.change(names[0]!, { target: { value: 'Seller Owner' } });
    fireEvent.change(names[1]!, { target: { value: 'Buyer Person' } });
    const btn = c.querySelector('[data-testid="quick-deed-generate"]')!;
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(generateMutate).toHaveBeenCalledTimes(1));
  });
});
