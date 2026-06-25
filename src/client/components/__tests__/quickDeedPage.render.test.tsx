// @vitest-environment jsdom
/**
 * QuickDeedPage render test — DEED-DRAFT-AGENT-1 QUICK DEED (QD-1).
 *
 * Mounts the flag-gated single-screen Quick Deed surface with a mocked trpc layer and asserts:
 *   (1) when enabled, the deed-type selector lists gift ENABLED + the other categories DISABLED
 *       ("wiring pending"), and the structured gift fields + Generate button render without a
 *       hooks/render violation;
 *   (2) ORPHAN GUARD: merely viewing /deed and leaving does NOT fire quickDeed.create (LAZY create);
 *       the auto-matter is created only on the FIRST real interaction (opening Materials);
 *   (3) when the flag is OFF, the surface does not render (redirects to /matters);
 *   (4) StrictMode: a single interaction still fires create exactly ONCE (double-fire guard intact).
 *
 * MaterialsDrawer is mocked (it has its own trpc surface); useGuardedMutation is mocked to a
 * synchronous capture so we can assert when create() fires.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

interface PreviewFacts {
  hasMaterials: boolean;
  locality: string | null;
  granteeAddress: string | null;
  derivationCandidate: string | null;
  resolved: { legalDescription: boolean; parcelId: boolean; assessedValue: boolean; locality: boolean; propertyAddress: boolean };
  warnings: string[];
}
const mockState = vi.hoisted(() => ({
  enabled: true,
  deedTypes: [] as Array<{ key: string; title: string; category: string; status: string; quickDeedGenerates: boolean }>,
  previewFacts: null as null | {
    hasMaterials: boolean;
    locality: string | null;
    granteeAddress: string | null;
    derivationCandidate: string | null;
    resolved: { legalDescription: boolean; parcelId: boolean; assessedValue: boolean; locality: boolean; propertyAddress: boolean };
    warnings: string[];
  },
}));

// Capture the create mutation fired on mount (the auto-matter).
const createMutate = vi.hoisted(() => vi.fn());
const generateMutate = vi.hoisted(() => vi.fn());

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const q = (getData: () => unknown) => () => {
    React.useRef(null);
    return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      useUtils: () => ({
        client: {
          quickDeed: {
            create: { mutate: createMutate },
            generate: { mutate: generateMutate },
          },
        },
      }),
      deedDraftAgent: {
        isEnabled: { useQuery: q(() => ({ enabled: mockState.enabled })) },
      },
      quickDeed: {
        listDeedTypes: { useQuery: q(() => mockState.deedTypes) },
        previewFacts: { useQuery: q(() => mockState.previewFacts) },
      },
    },
  };
});

// useGuardedMutation -> a thin wrapper that exposes mutate (calls through to the captured fn) + isPending.
vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: (fn: (input: unknown) => unknown) => ({
    mutate: (input: unknown) => { fn(input); },
    isPending: false,
    error: null,
  }),
}));

// MaterialsDrawer has its own trpc surface — stub it so the page test stays focused.
vi.mock('../../components/MaterialsDrawer.js', () => ({
  default: () => null,
}));

import QuickDeedPage from '../../pages/QuickDeedPage.js';

const FULL_REGISTRY = [
  { key: 'deed_of_gift', title: 'Deed of Gift', category: 'gift', status: 'available', quickDeedGenerates: true },
  { key: 'seller_side', title: 'Seller-Side Conveyance', category: 'seller-side', status: 'available', quickDeedGenerates: false },
  { key: 'deed_into_llc', title: 'Deed Into an LLC', category: 'C3', status: 'available', quickDeedGenerates: false },
];

function renderPage(): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <QuickDeedPage />
    </MemoryRouter>,
  );
  return container;
}

function renderPageStrict(): HTMLElement {
  const { container } = render(
    <StrictMode>
      <MemoryRouter>
        <QuickDeedPage />
      </MemoryRouter>
    </StrictMode>,
  );
  return container;
}

beforeEach(() => {
  createMutate.mockClear();
  generateMutate.mockClear();
});
afterEach(() => {
  cleanup();
  mockState.enabled = true;
  mockState.deedTypes = [];
  mockState.previewFacts = null;
});

describe('QuickDeedPage — DEED-DRAFT-AGENT-1 QD-1', () => {
  it('renders the type selector (gift enabled, others disabled), gift fields, and Generate when enabled', () => {
    mockState.enabled = true;
    mockState.deedTypes = FULL_REGISTRY;
    const c = renderPage();

    expect(c.querySelector('[data-testid="quick-deed-page"]')).toBeTruthy();
    const select = c.querySelector('[data-testid="quick-deed-type-select"]') as HTMLSelectElement | null;
    expect(select).toBeTruthy();

    const options = Array.from(select!.querySelectorAll('option'));
    const gift = options.find((o) => o.value === 'deed_of_gift');
    const seller = options.find((o) => o.value === 'seller_side');
    const llc = options.find((o) => o.value === 'deed_into_llc');
    expect(gift).toBeTruthy();
    expect(gift!.disabled).toBe(false); // gift generates
    expect(seller!.disabled).toBe(true); // listed but wiring pending
    expect(llc!.disabled).toBe(true);
    expect(seller!.textContent).toContain('wiring pending');

    // structured gift fields + the Generate button + the materials entry point render.
    expect(c.querySelector('[data-testid="quick-deed-generate"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="quick-deed-materials-button"]')).toBeTruthy();
    expect(c.textContent).toContain('Grantor(s)');
    expect(c.textContent).toContain('Grantee(s)');
  });

  it('ORPHAN GUARD: merely viewing the page (no interaction) does NOT fire quickDeed.create', () => {
    mockState.enabled = true;
    mockState.deedTypes = FULL_REGISTRY;
    renderPage();
    // Lazy create: opening /deed and leaving must persist nothing.
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('LAZY create: the auto-matter is created on the FIRST interaction (opening Materials)', () => {
    mockState.enabled = true;
    mockState.deedTypes = FULL_REGISTRY;
    const c = renderPage();
    expect(createMutate).not.toHaveBeenCalled();
    fireEvent.click(c.querySelector('[data-testid="quick-deed-materials-button"]')!);
    expect(createMutate).toHaveBeenCalledTimes(1);
  });

  it('the page-level guard fires create only ONCE across rapid double interaction', () => {
    mockState.enabled = true;
    mockState.deedTypes = FULL_REGISTRY;
    const c = renderPage();
    const btn = c.querySelector('[data-testid="quick-deed-materials-button"]')!;
    fireEvent.click(btn);
    fireEvent.click(btn); // a second click while the first create is "in flight" must not re-fire
    expect(createMutate).toHaveBeenCalledTimes(1);
  });

  it('StrictMode: a single interaction still fires create exactly ONCE (double-fire guard intact)', () => {
    mockState.enabled = true;
    mockState.deedTypes = FULL_REGISTRY;
    const c = renderPageStrict();
    expect(createMutate).not.toHaveBeenCalled(); // StrictMode double-render must not auto-create
    fireEvent.click(c.querySelector('[data-testid="quick-deed-materials-button"]')!);
    expect(createMutate).toHaveBeenCalledTimes(1);
  });

  it('does not render the surface when the flag is OFF (redirects); create is never fired', () => {
    mockState.enabled = false;
    const c = renderPage();
    expect(c.querySelector('[data-testid="quick-deed-page"]')).toBeNull();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('Layer 1 (E1b) pre-fill: extracted locality + situs grantee-address fill the empty fields + a candidate hint', () => {
    mockState.enabled = true;
    mockState.deedTypes = FULL_REGISTRY;
    mockState.previewFacts = {
      hasMaterials: true,
      locality: 'Fairfax County',
      granteeAddress: '4120 Cedar Run Lane, Manassas, VA 20109',
      derivationCandidate: 'in Deed Book 3000 at Page 100',
      resolved: { legalDescription: true, parcelId: true, assessedValue: true, locality: true, propertyAddress: true },
      warnings: [],
    } satisfies PreviewFacts;
    const c = renderPage();
    expect(c.querySelector('[data-testid="quick-deed-prefill-note"]')).toBeTruthy();
    const locality = c.querySelector('[data-testid="quick-deed-locality"]') as HTMLInputElement;
    const addr = c.querySelector('[data-testid="quick-deed-grantee-address"]') as HTMLInputElement;
    expect(locality.value).toBe('Fairfax County');
    expect(addr.value).toBe('4120 Cedar Run Lane, Manassas, VA 20109');
    expect(c.querySelector('[data-testid="quick-deed-derivation-candidate"]')?.textContent).toContain('in Deed Book 3000 at Page 100');
  });

  it('Layer 1 (E1b) pre-fill: no materials -> no pre-fill banner, fields stay empty', () => {
    mockState.enabled = true;
    mockState.deedTypes = FULL_REGISTRY;
    mockState.previewFacts = null;
    const c = renderPage();
    expect(c.querySelector('[data-testid="quick-deed-prefill-note"]')).toBeNull();
    const locality = c.querySelector('[data-testid="quick-deed-locality"]') as HTMLInputElement;
    expect(locality.value).toBe('');
  });
});
