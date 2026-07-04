// @vitest-environment jsdom
/**
 * DEED-INTAKE-PARITY-1 Inc 2 — QuickDeedPage matter-scoped mode (/matters/:matterId/deed).
 *
 * The SAME Express intake, bound to an existing matter, asserts:
 *   (1) with the flag ON it renders (no redirect) and does NOT show the standalone bypass-and-stamp conflicts
 *       waiver (a matter honors its own conflicts gate);
 *   (2) Generate dispatches with the ROUTE matterId + `enforceConflicts: true`, and NEVER fires the lazy
 *       quickDeed.create (the matter already exists);
 *   (3) with the flag OFF it redirects (the surface does not render).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mockState = vi.hoisted(() => ({ enabled: true, conflictsEnforced: false as boolean }));
const createMutate = vi.hoisted(() => vi.fn(() => Promise.resolve({ matterId: 'lazy-should-not-be-used' })));
const generateMutate = vi.hoisted(() => vi.fn());

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const q = (getData: () => unknown) => () => {
    React.useRef(null);
    return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      useUtils: () => ({ client: { quickDeed: { create: { mutate: createMutate }, generate: { mutate: generateMutate }, proposeIntake: { mutate: vi.fn() }, proposeIntakeSellerSide: { mutate: vi.fn() } } } }),
      deedDraftAgent: { isEnabled: { useQuery: q(() => ({ enabled: mockState.enabled })) } },
      quickDeed: {
        listDeedTypes: { useQuery: q(() => [{ key: 'deed_of_gift', title: 'Deed of Gift', category: 'gift', status: 'available', quickDeedGenerates: true }]) },
        previewFacts: { useQuery: q(() => null) },
        getConflictsSetting: { useQuery: q(() => ({ enforced: mockState.conflictsEnforced })) },
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: (fn: (input: unknown) => unknown) => ({ mutate: (input: unknown) => { fn(input); }, isPending: false, error: null }),
}));

vi.mock('../../components/MaterialsDropZone.js', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', { 'data-testid': 'quick-deed-dropzone' }, 'dropzone') };
});

import QuickDeedPage from '../QuickDeedPage.js';

function renderAt(path: string): HTMLElement {
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/matters/:matterId/deed" element={<QuickDeedPage />} />
        <Route path="/matters/:matterId" element={<div data-testid="matter-page">matter</div>} />
        <Route path="/matters" element={<div data-testid="matters-page">matters</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return container;
}

beforeEach(() => { createMutate.mockClear(); generateMutate.mockClear(); mockState.enabled = true; mockState.conflictsEnforced = false; });
afterEach(() => cleanup());

describe('DEED-INTAKE-PARITY-1 Inc 2 — QuickDeedPage matter-scoped', () => {
  it('flag ON: renders bound to the matter and HIDES the standalone conflicts waiver', () => {
    const c = renderAt('/matters/m-99/deed');
    expect(c.querySelector('[data-testid="quick-deed-page"]')).toBeTruthy();
    // The bypass-and-stamp waiver (shown standalone when enforced===false) must NOT appear in a matter.
    expect(c.querySelector('[data-testid="quick-deed-conflicts-waiver"]')).toBeNull();
  });

  it('Generate dispatches with the route matterId + enforceConflicts, and never fires the lazy create', async () => {
    const c = renderAt('/matters/m-99/deed');
    fireEvent.click(c.querySelector('[data-testid="deed-intake-form-toggle"]')!); // expand the gift form
    const names = Array.from(c.querySelectorAll('input[placeholder="Full legal name"]')) as HTMLInputElement[];
    fireEvent.change(names[0]!, { target: { value: 'Donor Owner' } });
    fireEvent.change(names[1]!, { target: { value: 'Donee Person' } });
    fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);

    await waitFor(() => expect(generateMutate).toHaveBeenCalledTimes(1));
    const arg = generateMutate.mock.calls[0]![0] as { matterId: string; enforceConflicts?: boolean; deedType: string };
    expect(arg.matterId).toBe('m-99'); // the EXISTING matter from the route, not a lazily-created one
    expect(arg.enforceConflicts).toBe(true); // honor the matter's conflicts gate
    expect(arg.deedType).toBe('deed_of_gift');
    expect(createMutate).not.toHaveBeenCalled(); // no lazy auto-matter in matter mode
  });

  it('flag OFF: the surface does not render (redirects to the matter page)', () => {
    mockState.enabled = false;
    const c = renderAt('/matters/m-99/deed');
    expect(c.querySelector('[data-testid="quick-deed-page"]')).toBeNull();
    expect(c.querySelector('[data-testid="matter-page"]')).toBeTruthy();
  });
});
