// @vitest-environment jsdom
/**
 * DEED-INTAKE-PARITY-1 — per-type collapse parity on /deed.
 *
 * The gift lane has always presented an intake-first surface: drop zone + describe box primary, the structured
 * "manual field wall" COLLAPSED behind a "Fill in all fields manually" toggle, and a generate attempt with gaps
 * EXPANDS the form and red-rings the missing required fields. This asserts the OTHER six lanes now match:
 *   (1) every lane (seller + into_llc + out_of_llc + tod + confirmation + into_trust) mounts with its structured
 *       fields COLLAPSED (a `hidden` class) and a toggle present; clicking the toggle EXPANDS them;
 *   (2) highlight-missing: a collapsed generate with gaps expands the form, red-rings the missing required field,
 *       and does NOT dispatch generate (never a silent block).
 *
 * Reuses the QuickDeedPage render harness (mocked trpc + MaterialsDropZone) from quickDeedPage.render.test.tsx.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockState = vi.hoisted(() => ({
  enabled: true,
  conflictsEnforced: false as boolean,
  deedTypes: [] as Array<{ key: string; title: string; category: string; status: string; quickDeedGenerates: boolean }>,
}));

const createMutate = vi.hoisted(() => vi.fn(() => Promise.resolve({ matterId: 'qd-matter-1' })));
const generateMutate = vi.hoisted(() => vi.fn());
const proposeMutate = vi.hoisted(() => vi.fn());

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const q = (getData: () => unknown) => () => {
    React.useRef(null);
    return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  const quickDeedClient = {
    create: { mutate: createMutate },
    generate: { mutate: generateMutate },
    proposeIntake: { mutate: proposeMutate },
    proposeIntakeSellerSide: { mutate: proposeMutate },
    proposeIntakeIntoLlc: { mutate: proposeMutate },
    proposeIntakeOutOfLlc: { mutate: proposeMutate },
    proposeIntakeTod: { mutate: proposeMutate },
    proposeIntakeConfirmation: { mutate: proposeMutate },
    proposeIntakeIntoTrust: { mutate: proposeMutate },
  };
  return {
    trpc: {
      useUtils: () => ({ client: { quickDeed: quickDeedClient } }),
      deedDraftAgent: { isEnabled: { useQuery: q(() => ({ enabled: mockState.enabled })) } },
      quickDeed: {
        listDeedTypes: { useQuery: q(() => mockState.deedTypes) },
        previewFacts: { useQuery: q(() => null) },
        getConflictsSetting: { useQuery: q(() => ({ enforced: mockState.conflictsEnforced })) },
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: (fn: (input: unknown) => unknown) => ({
    mutate: (input: unknown) => { fn(input); },
    isPending: false,
    error: null,
  }),
}));

vi.mock('../../components/MaterialsDropZone.js', async () => {
  const React = await import('react');
  return {
    default: (props: { resolveMatterId?: () => Promise<string> }) =>
      React.createElement('button', { type: 'button', 'data-testid': 'quick-deed-dropzone', onClick: () => { void props.resolveMatterId?.(); } }, 'dropzone'),
  };
});

import QuickDeedPage from '../QuickDeedPage.js';

// Every wired non-gift type generates, so each option is selectable.
const REGISTRY = [
  { key: 'deed_of_gift', title: 'Deed of Gift', category: 'gift', status: 'available', quickDeedGenerates: true },
  { key: 'seller_side', title: 'Seller-Side Conveyance', category: 'seller-side', status: 'available', quickDeedGenerates: true },
  { key: 'deed_into_llc', title: 'Deed Into an LLC', category: 'C3', status: 'available', quickDeedGenerates: true },
  { key: 'deed_out_of_llc', title: 'Deed Out of an LLC', category: 'C4', status: 'available', quickDeedGenerates: true },
  { key: 'deed_tod', title: 'Transfer on Death Deed', category: 'C5', status: 'available', quickDeedGenerates: true },
  { key: 'deed_of_confirmation', title: 'Deed of Confirmation', category: 'C1', status: 'available', quickDeedGenerates: true },
  { key: 'deed_into_trust', title: 'Deed Into Trust', category: 'C2', status: 'available', quickDeedGenerates: true },
];

// Each non-gift lane: the collapse container testid + its toggle testid.
const LANES = [
  { type: 'seller_side', fields: 'quick-deed-seller-form', toggle: 'quick-deed-seller-form-toggle' },
  { type: 'deed_into_llc', fields: 'quick-deed-into_llc-fields', toggle: 'quick-deed-into_llc-fields-toggle' },
  { type: 'deed_out_of_llc', fields: 'quick-deed-out_of_llc-fields', toggle: 'quick-deed-out_of_llc-fields-toggle' },
  { type: 'deed_tod', fields: 'quick-deed-tod-fields', toggle: 'quick-deed-tod-fields-toggle' },
  { type: 'deed_of_confirmation', fields: 'quick-deed-confirmation-fields', toggle: 'quick-deed-confirmation-fields-toggle' },
  { type: 'deed_into_trust', fields: 'quick-deed-into_trust-fields', toggle: 'quick-deed-into_trust-fields-toggle' },
];

function renderPage(): HTMLElement {
  const { container } = render(<MemoryRouter><QuickDeedPage /></MemoryRouter>);
  return container;
}

beforeEach(() => {
  createMutate.mockClear();
  generateMutate.mockClear();
  proposeMutate.mockClear();
  mockState.enabled = true;
  mockState.conflictsEnforced = false;
  mockState.deedTypes = REGISTRY;
});
afterEach(() => cleanup());

describe('DEED-INTAKE-PARITY-1 — every /deed lane is intake-first (collapsed) with a manual toggle', () => {
  for (const lane of LANES) {
    it(`${lane.type}: structured fields are COLLAPSED by default and the manual toggle EXPANDS them`, () => {
      const c = renderPage();
      fireEvent.change(c.querySelector('[data-testid="quick-deed-type-select"]')!, { target: { value: lane.type } });

      const fields = c.querySelector(`[data-testid="${lane.fields}"]`);
      expect(fields).toBeTruthy(); // in the DOM…
      expect(fields!.className).toContain('hidden'); // …but collapsed (parity with the gift lane)

      const toggle = c.querySelector(`[data-testid="${lane.toggle}"]`);
      expect(toggle).toBeTruthy();
      expect(toggle!.textContent).toContain('Fill in all fields manually');

      fireEvent.click(toggle!);
      expect(c.querySelector(`[data-testid="${lane.fields}"]`)!.className).not.toContain('hidden'); // expanded
      expect(c.querySelector(`[data-testid="${lane.toggle}"]`)!.textContent).toContain('Hide the deed facts');
    });
  }
});

describe('DEED-INTAKE-PARITY-1 — highlight-missing (expand + ring) on a generate attempt with gaps', () => {
  it('into_llc: a collapsed Generate with no grantor expands the form, rings the grantor, and does NOT dispatch', () => {
    const c = renderPage();
    fireEvent.change(c.querySelector('[data-testid="quick-deed-type-select"]')!, { target: { value: 'deed_into_llc' } });
    expect(c.querySelector('[data-testid="quick-deed-into_llc-fields"]')!.className).toContain('hidden');

    fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);

    expect(generateMutate).not.toHaveBeenCalled(); // never a silent (or a blank) dispatch
    expect(c.querySelector('[data-testid="quick-deed-into_llc-fields"]')!.className).not.toContain('hidden'); // expanded
    const grantor = c.querySelector('input[placeholder="Full legal name"]') as HTMLInputElement;
    expect(grantor.className).toContain('border-red-400'); // the missing required field is ringed
  });

  it('seller_side: a collapsed Generate with no parties expands the form, rings the grantor/grantee, and does NOT dispatch', () => {
    const c = renderPage();
    fireEvent.change(c.querySelector('[data-testid="quick-deed-type-select"]')!, { target: { value: 'seller_side' } });
    expect(c.querySelector('[data-testid="quick-deed-seller-form"]')!.className).toContain('hidden');

    fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);

    expect(generateMutate).not.toHaveBeenCalled();
    expect(c.querySelector('[data-testid="quick-deed-seller-form"]')!.className).not.toContain('hidden'); // expanded
    const firstName = c.querySelector('input[placeholder="Full legal name"]') as HTMLInputElement;
    expect(firstName.className).toContain('border-red-400'); // the missing grantor is ringed
  });
});
