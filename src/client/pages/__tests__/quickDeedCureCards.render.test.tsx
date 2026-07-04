// @vitest-environment jsdom
/**
 * UB1-W3b-2 — QuickDeedPage renders plain-English CURE CARDS on a fail-closed generate.
 *
 * When quickDeed.generate returns a WITHHELD result (no document; the S5 survivorship gate or any deed gate
 * fired), the page must show a cure-card panel — WHICH field, what's wrong, how to fix-and-regenerate — instead of
 * a bare machine code. The form stays populated so the attorney fixes the field and regenerates in place.
 * Driven through the gift lane (the panel is lane-agnostic — it renders from the server result).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockState = vi.hoisted(() => ({ result: null as unknown }));
const createMutate = vi.hoisted(() => vi.fn(() => Promise.resolve({ matterId: 'qd-matter-1' })));
const generateMutate = vi.hoisted(() => vi.fn(() => Promise.resolve(mockState.result)));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const q = (getData: () => unknown) => () => { React.useRef(null); return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} }; };
  return {
    trpc: {
      useUtils: () => ({ client: { quickDeed: { create: { mutate: createMutate }, generate: { mutate: generateMutate }, proposeIntake: { mutate: vi.fn() }, proposeIntakeSellerSide: { mutate: vi.fn() } } } }),
      deedDraftAgent: { isEnabled: { useQuery: q(() => ({ enabled: true })) } },
      quickDeed: {
        listDeedTypes: { useQuery: q(() => [{ key: 'deed_of_gift', title: 'Deed of Gift', category: 'gift', status: 'available', quickDeedGenerates: true }]) },
        previewFacts: { useQuery: q(() => null) },
        getConflictsSetting: { useQuery: q(() => ({ enforced: false })) },
      },
    },
  };
});

// A useGuardedMutation that actually resolves fn(input) and fires onSuccess/onError (so the page's cure-card
// handling runs), unlike the sync capture used by the other render tests.
vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: (fn: (input: unknown) => unknown, opts?: { onSuccess?: (r: unknown) => void; onError?: (e: Error) => void }) => ({
    mutate: (input: unknown) => { void Promise.resolve(fn(input)).then((r) => opts?.onSuccess?.(r)).catch((e) => opts?.onError?.(e as Error)); },
    isPending: false,
    error: null,
  }),
}));

vi.mock('../../components/MaterialsDropZone.js', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', { 'data-testid': 'quick-deed-dropzone' }, 'dropzone') };
});

import QuickDeedPage from '../QuickDeedPage.js';

const WITHHELD_WITH_CARDS = {
  documentId: null, matterId: 'qd-matter-1', versionId: null, title: null,
  conflictsBypassed: true, conflictsChecked: false, failedClosed: true,
  failures: ['INCOMPLETE_SURVIVORSHIP_CHAIN'],
  cureCards: [{
    flag: 'INCOMPLETE_SURVIVORSHIP_CHAIN',
    field: 'Survivorship chain (co-owners, decedent, and vesting deed)',
    problem: "The survivorship chain is incomplete, or the survivor can't be identified without guessing.",
    fix: 'Fill in both co-owners, the decedent name and date of death, and the vesting deed details, then regenerate.',
  }],
  factsResolved: null, placeholders: [], vesting: null, warranty: null, b6: null,
  recordableFloorOk: null, drafterNotes: [], notes: [], warnings: [],
};

function renderPage(): HTMLElement {
  const { container } = render(<MemoryRouter><QuickDeedPage /></MemoryRouter>);
  return container;
}

// Drive the gift lane to a Generate click.
function generateGift(c: HTMLElement): void {
  fireEvent.click(c.querySelector('[data-testid="deed-intake-form-toggle"]')!);
  const names = Array.from(c.querySelectorAll('input[placeholder="Full legal name"]')) as HTMLInputElement[];
  fireEvent.change(names[0]!, { target: { value: 'Donor Owner' } });
  fireEvent.change(names[1]!, { target: { value: 'Donee Person' } });
  fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);
}

beforeEach(() => { createMutate.mockClear(); generateMutate.mockClear(); mockState.result = WITHHELD_WITH_CARDS; });
afterEach(() => cleanup());

describe('UB1-W3b-2 — QuickDeedPage cure cards on a fail-closed generate', () => {
  it('a WITHHELD result renders the plain-English cure card (field + fix), not a bare machine code', async () => {
    const c = renderPage();
    generateGift(c);

    await waitFor(() => expect(c.querySelector('[data-testid="deed-cure-cards"]')).toBeTruthy());
    const panel = c.querySelector('[data-testid="deed-cure-cards"]')!;
    expect(c.querySelector('[data-testid="cure-card-INCOMPLETE_SURVIVORSHIP_CHAIN"]')).toBeTruthy();
    expect(panel.textContent).toContain('Survivorship chain (co-owners, decedent, and vesting deed)'); // which field
    expect(panel.textContent).toContain('regenerate'); // fix-and-regenerate
    // the raw machine code is NOT the surfaced message:
    expect(panel.textContent).not.toContain('INCOMPLETE_SURVIVORSHIP_CHAIN');
    expect(c.textContent).not.toContain('The deed could not be generated: INCOMPLETE_SURVIVORSHIP_CHAIN');
  });

  it('a successful generate (documentId) renders NO cure-card panel', async () => {
    mockState.result = { ...WITHHELD_WITH_CARDS, documentId: 'doc-1', cureCards: [] };
    const c = renderPage();
    generateGift(c);
    // give the async onSuccess a tick; the panel must never appear
    await waitFor(() => expect(generateMutate).toHaveBeenCalled());
    expect(c.querySelector('[data-testid="deed-cure-cards"]')).toBeNull();
  });
});
