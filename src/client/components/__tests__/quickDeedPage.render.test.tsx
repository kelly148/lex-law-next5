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
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
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
  // W2d — drives trpc.quickDeed.getConflictsSetting; false = the bypass-and-stamp default (waiver shown).
  conflictsEnforced: false as boolean,
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

// The lazy-create matter mutation now resolves a matterId (ensureMatterAsync awaits it).
const createMutate = vi.hoisted(() => vi.fn(() => Promise.resolve({ matterId: 'qd-matter-1' })));
const generateMutate = vi.hoisted(() => vi.fn());
const proposeMutate = vi.hoisted(() => vi.fn());

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
            proposeIntake: { mutate: proposeMutate },
            proposeIntakeSellerSide: { mutate: proposeMutate },
          },
        },
      }),
      deedDraftAgent: {
        isEnabled: { useQuery: q(() => ({ enabled: mockState.enabled })) },
      },
      quickDeed: {
        listDeedTypes: { useQuery: q(() => mockState.deedTypes) },
        previewFacts: { useQuery: q(() => mockState.previewFacts) },
        getConflictsSetting: { useQuery: q(() => ({ enforced: mockState.conflictsEnforced })) },
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

// DEED-INTAKE-REDESIGN-1: the page (via DeedIntake, and the seller lane directly) renders MaterialsDropZone as
// the PRIMARY upload affordance. It owns its own trpc surface (materials.list) + fetch, so stub it to a button
// that fires resolveMatterId — this is the "first real interaction" that lazily creates the owning matter,
// replacing the old "Upload…" button + modal. DeedIntake itself is NOT stubbed (the gift form must render).
vi.mock('../../components/MaterialsDropZone.js', async () => {
  const React = await import('react');
  return {
    default: (props: { resolveMatterId?: () => Promise<string> }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'quick-deed-dropzone',
          onClick: () => { void props.resolveMatterId?.(); },
        },
        'dropzone',
      ),
  };
});

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
  proposeMutate.mockClear();
});
afterEach(() => {
  cleanup();
  mockState.enabled = true;
  mockState.conflictsEnforced = false;
  mockState.deedTypes = [];
  mockState.previewFacts = null;
});

describe('QuickDeedPage — DEED-DRAFT-AGENT-1 QD-1', () => {
  it('W2d: shows the conflicts-waiver notice at generate-time when conflicts are NOT enforced (default)', () => {
    mockState.enabled = true;
    mockState.conflictsEnforced = false;
    mockState.deedTypes = FULL_REGISTRY;
    const c = renderPage();
    expect(c.querySelector('[data-testid="quick-deed-conflicts-waiver"]')).toBeTruthy();
  });

  it('W2d: HIDES the waiver notice when conflicts ARE enforced', () => {
    mockState.enabled = true;
    mockState.conflictsEnforced = true;
    mockState.deedTypes = FULL_REGISTRY;
    const c = renderPage();
    expect(c.querySelector('[data-testid="quick-deed-conflicts-waiver"]')).toBeNull();
  });

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

    // structured gift fields + the Generate button + the PRIMARY drop zone (DEED-INTAKE-REDESIGN-1) render.
    expect(c.querySelector('[data-testid="quick-deed-generate"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="quick-deed-dropzone"]')).toBeTruthy();
    expect(c.textContent).toContain('Grantor(s)');
    expect(c.textContent).toContain('Grantee(s)');
  });

  it('seller-side wired: the option is enabled and selecting it reveals the seller-side fields', () => {
    mockState.enabled = true;
    mockState.deedTypes = [
      { key: 'deed_of_gift', title: 'Deed of Gift', category: 'gift', status: 'available', quickDeedGenerates: true },
      { key: 'seller_side', title: 'Seller-Side Conveyance', category: 'seller-side', status: 'available', quickDeedGenerates: true },
    ];
    const c = renderPage();
    const select = c.querySelector('[data-testid="quick-deed-type-select"]') as HTMLSelectElement;
    const seller = Array.from(select.querySelectorAll('option')).find((o) => o.value === 'seller_side');
    expect(seller!.disabled).toBe(false); // wired -> selectable

    // gift is selected by default -> the seller-side block is not shown
    expect(c.querySelector('[data-testid="quick-deed-seller-fields"]')).toBeNull();
    expect(c.textContent).toContain('Grantor(s) — donor(s)');

    // select seller-side -> the seller-only fields appear, the labels switch, the gift-only fields hide
    fireEvent.change(select, { target: { value: 'seller_side' } });
    expect(c.querySelector('[data-testid="quick-deed-seller-fields"]')).toBeTruthy();
    expect(c.textContent).toContain('Grantor(s) — seller(s)');
    expect(c.textContent).toContain('Grantee(s) — buyer(s)');
    expect(c.textContent).toContain('Consideration (figures)');
  });

  it('ORPHAN GUARD: merely viewing the page (no interaction) does NOT fire quickDeed.create', () => {
    mockState.enabled = true;
    mockState.deedTypes = FULL_REGISTRY;
    renderPage();
    // Lazy create: opening /deed and leaving must persist nothing.
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('LAZY create: the auto-matter is created on the FIRST interaction (the primary drop zone)', () => {
    mockState.enabled = true;
    mockState.deedTypes = FULL_REGISTRY;
    const c = renderPage();
    expect(createMutate).not.toHaveBeenCalled();
    fireEvent.click(c.querySelector('[data-testid="quick-deed-dropzone"]')!);
    expect(createMutate).toHaveBeenCalledTimes(1);
  });

  it('the page-level guard fires create only ONCE across rapid double interaction', () => {
    mockState.enabled = true;
    mockState.deedTypes = FULL_REGISTRY;
    const c = renderPage();
    const zone = c.querySelector('[data-testid="quick-deed-dropzone"]')!;
    fireEvent.click(zone);
    fireEvent.click(zone); // a second interaction while the first create is "in flight" must not re-fire
    expect(createMutate).toHaveBeenCalledTimes(1);
  });

  it('StrictMode: a single interaction still fires create exactly ONCE (double-fire guard intact)', () => {
    mockState.enabled = true;
    mockState.deedTypes = FULL_REGISTRY;
    const c = renderPageStrict();
    expect(createMutate).not.toHaveBeenCalled(); // StrictMode double-render must not auto-create
    fireEvent.click(c.querySelector('[data-testid="quick-deed-dropzone"]')!);
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

  it('gift lane: Generate wraps the cleaned facts with deedType + title and injects the lazily-created matterId', async () => {
    mockState.enabled = true;
    mockState.deedTypes = FULL_REGISTRY;
    const c = renderPage();
    // The gift form is collapsed (drop-first); expand it to fill the parties.
    fireEvent.click(c.querySelector('[data-testid="deed-intake-form-toggle"]')!);
    const names = Array.from(c.querySelectorAll('input[placeholder="Full legal name"]')) as HTMLInputElement[];
    fireEvent.change(names[0]!, { target: { value: 'Marcus Ellison' } }); // grantor (donor)
    fireEvent.change(names[1]!, { target: { value: 'Hannah Ellison' } });  // grantee (donee)
    fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);

    await waitFor(() => expect(generateMutate).toHaveBeenCalledTimes(1));
    const arg = generateMutate.mock.calls[0]![0] as {
      deedType: string; title: string; matterId: string; grantors: unknown[]; grantees: unknown[];
    };
    expect(arg.deedType).toBe('deed_of_gift');
    expect(arg.title).toBe('Deed of Gift');
    expect(arg.matterId).toBe('qd-matter-1'); // injected from the lazily-created matter, never baked into the payload
    expect(arg.grantors).toEqual([{ name: 'Marcus Ellison' }]);
    expect(arg.grantees).toEqual([{ name: 'Hannah Ellison' }]);
  });

  it('seller lane: Generate dispatches the nested sellerSide payload with the injected matterId', async () => {
    mockState.enabled = true;
    mockState.deedTypes = [
      { key: 'deed_of_gift', title: 'Deed of Gift', category: 'gift', status: 'available', quickDeedGenerates: true },
      { key: 'seller_side', title: 'Seller-Side Conveyance', category: 'seller-side', status: 'available', quickDeedGenerates: true },
    ];
    const c = renderPage();
    fireEvent.change(c.querySelector('[data-testid="quick-deed-type-select"]')!, { target: { value: 'seller_side' } });
    const names = Array.from(c.querySelectorAll('input[placeholder="Full legal name"]')) as HTMLInputElement[];
    fireEvent.change(names[0]!, { target: { value: 'Seller Owner' } }); // grantor (seller)
    fireEvent.change(names[1]!, { target: { value: 'Buyer Person' } }); // grantee (buyer)
    fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);

    await waitFor(() => expect(generateMutate).toHaveBeenCalledTimes(1));
    const arg = generateMutate.mock.calls[0]![0] as {
      deedType: string; matterId: string; grantors: unknown[]; grantees: unknown[];
      sellerSide: { title: string };
    };
    expect(arg.deedType).toBe('seller_side');
    expect(arg.matterId).toBe('qd-matter-1');
    expect(arg.grantors).toEqual([{ name: 'Seller Owner' }]);
    expect(arg.grantees).toEqual([{ name: 'Buyer Person' }]);
    expect(arg.sellerSide).toBeTruthy();
    expect(arg.sellerSide.title).toBe('Seller-Side Deed');
  });

  it('into-LLC wired: selecting it reveals the into-LLC form and Generate dispatches the nested intoLlc payload', async () => {
    mockState.enabled = true;
    mockState.deedTypes = [
      { key: 'deed_of_gift', title: 'Deed of Gift', category: 'gift', status: 'available', quickDeedGenerates: true },
      { key: 'deed_into_llc', title: 'Deed Into an LLC', category: 'C3', status: 'available', quickDeedGenerates: true },
    ];
    const c = renderPage();
    const select = c.querySelector('[data-testid="quick-deed-type-select"]') as HTMLSelectElement;
    expect(Array.from(select.querySelectorAll('option')).find((o) => o.value === 'deed_into_llc')!.disabled).toBe(false);

    fireEvent.change(select, { target: { value: 'deed_into_llc' } });
    // the multi-category lane mounts the into-LLC structured form (gift/seller blocks are gone)
    expect(c.querySelector('[data-testid="quick-deed-into_llc-fields"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="quick-deed-seller-fields"]')).toBeNull();

    fireEvent.change(c.querySelector('input[placeholder="Full legal name"]')!, { target: { value: 'Dahlia Okonkwo' } });
    fireEvent.change(c.querySelector('input[placeholder="CITY OF ALEXANDRIA"]')!, { target: { value: 'CITY OF ALEXANDRIA' } });
    fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);

    await waitFor(() => expect(generateMutate).toHaveBeenCalledTimes(1));
    const arg = generateMutate.mock.calls[0]![0] as {
      deedType: string; matterId: string; intoLlc: { grantors: unknown[]; grantorCardinality: string; notaryJurisdiction: { commonwealth: string; locality: string } };
    };
    expect(arg.deedType).toBe('deed_into_llc');
    expect(arg.matterId).toBe('qd-matter-1'); // injected from the lazily-created matter
    expect(arg.intoLlc.grantors).toEqual([{ name: 'Dahlia Okonkwo', maritalStatus: 'unmarried' }]);
    expect(arg.intoLlc.grantorCardinality).toBe('single');
    expect(arg.intoLlc.notaryJurisdiction.locality).toBe('CITY OF ALEXANDRIA');
  });

  it('QUICKDEED-COPY-FIX-1: with every registered type generating, all options are enabled and there is NO blanket "not yet wired" note', () => {
    mockState.enabled = true;
    mockState.deedTypes = [
      { key: 'deed_of_gift', title: 'Deed of Gift', category: 'gift', status: 'available', quickDeedGenerates: true },
      { key: 'seller_side', title: 'Seller-Side Conveyance', category: 'seller-side', status: 'available', quickDeedGenerates: true },
      { key: 'deed_into_llc', title: 'Deed Into an LLC', category: 'C3', status: 'available', quickDeedGenerates: true },
    ];
    const c = renderPage();
    const options = Array.from(
      (c.querySelector('[data-testid="quick-deed-type-select"]') as HTMLSelectElement).querySelectorAll('option'),
    );
    expect(options.length).toBe(3);
    expect(options.every((o) => !o.disabled)).toBe(true); // every registered type generates -> every option enabled
    expect(options.some((o) => (o.textContent ?? '').includes('wiring pending'))).toBe(false); // no per-option suffix
    // The stale blanket sentence is gone — the per-option "— wiring pending" suffix is the sole, self-healing signal.
    expect(c.textContent).not.toContain('not yet wired');
    expect(c.textContent).not.toContain('Other deed types are listed');
  });
});
