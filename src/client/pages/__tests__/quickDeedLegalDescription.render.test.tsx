// @vitest-environment jsdom
/**
 * DEED-MANUAL-LEGAL-DESC-1 (non-gift lanes) — the optional attorney-verbatim "Legal description — paste verbatim
 * from the source" field on the SIX non-gift /deed lanes (seller-side + into_llc + out_of_llc + tod + confirmation
 * + into_trust). The server already accepts input.legalDescription with firstNonEmpty(input, extracted) precedence
 * for every one of these lanes (deedDraftAgent.ts) — this exposes it in the intake (client-only; no server change).
 *
 * The GIFT/Express lane now has its OWN attorney-entered legal path (DEED-MANUAL-LEGAL-GIFT-1, G3) — the
 * operator-re-ratified exception (external triad review COMPLETE, approve-with-conditions 2026-07-07): a DISTINCT
 * paste control gated by a NON-PRE-CHECKED three-prong affirmation. This file locks that the gift lane uses that
 * affirmation-gated control (NOT the non-gift lanes' plain paste field), and that a gift generate carries an
 * attorney-entered legalDescription ONLY under the full affirmation — an unaffirmed paste never reaches the server.
 *
 * Reuses the QuickDeedPage render harness (mocked trpc + MaterialsDropZone) from quickDeedPage.render.test.tsx.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
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

const REGISTRY = [
  { key: 'deed_of_gift', title: 'Deed of Gift', category: 'gift', status: 'available', quickDeedGenerates: true },
  { key: 'seller_side', title: 'Seller-Side Conveyance', category: 'seller-side', status: 'available', quickDeedGenerates: true },
  { key: 'deed_into_llc', title: 'Deed Into an LLC', category: 'C3', status: 'available', quickDeedGenerates: true },
  { key: 'deed_out_of_llc', title: 'Deed Out of an LLC', category: 'C4', status: 'available', quickDeedGenerates: true },
  { key: 'deed_tod', title: 'Transfer on Death Deed', category: 'C5', status: 'available', quickDeedGenerates: true },
  { key: 'deed_of_confirmation', title: 'Deed of Confirmation', category: 'C1', status: 'available', quickDeedGenerates: true },
  { key: 'deed_into_trust', title: 'Deed Into Trust', category: 'C2', status: 'available', quickDeedGenerates: true },
];

const PASTED = 'ALL that certain lot, Lot 7, Block C, WILLOW GLEN, as recorded in Deed Book 4412 at Page 118.';

type GenArg = Record<string, unknown> & {
  legalDescription?: unknown;
  sellerSide?: { legalDescription?: unknown };
  intoLlc?: { legalDescription?: unknown };
  outOfLlc?: { legalDescription?: unknown };
  tod?: { legalDescription?: unknown };
  confirmation?: { legalDescription?: unknown };
  intoTrust?: { legalDescription?: unknown };
};

/** Each non-gift lane: its legal-field testid, the payload slot that must receive the pasted legal, and a fn that
 *  fills the lane's REQUIRED fields so a generate actually dispatches. */
const LANES: Array<{
  type: string;
  legalTestId: string;
  slot: (a: GenArg) => unknown;
  fillRequired: (c: HTMLElement) => void;
}> = [
  {
    type: 'seller_side',
    legalTestId: 'quick-deed-seller-legal',
    slot: (a) => a.sellerSide?.legalDescription,
    fillRequired: (c) => {
      const names = c.querySelectorAll('input[placeholder="Full legal name"]');
      fireEvent.change(names[0]!, { target: { value: 'Seller One' } }); // grantor (seller)
      fireEvent.change(names[1]!, { target: { value: 'Buyer One' } });  // grantee (buyer)
    },
  },
  {
    type: 'deed_into_llc',
    legalTestId: 'quick-deed-into_llc-legal',
    slot: (a) => a.intoLlc?.legalDescription,
    fillRequired: (c) => {
      fireEvent.change(c.querySelector('input[placeholder="Full legal name"]')!, { target: { value: 'Grantor One' } });
      fireEvent.change(c.querySelector('input[placeholder="CITY OF ALEXANDRIA"]')!, { target: { value: 'CITY OF FAIRFAX' } });
    },
  },
  {
    type: 'deed_out_of_llc',
    legalTestId: 'quick-deed-out_of_llc-legal',
    slot: (a) => a.outOfLlc?.legalDescription,
    fillRequired: (c) => {
      fireEvent.change(c.querySelector('input[placeholder="Universal Title"]')!, { target: { value: 'Universal Title' } });
      fireEvent.change(c.querySelector('input[placeholder="(703) 354-2100"]')!, { target: { value: '(703) 555-1212' } });
      fireEvent.change(c.querySelector('input[placeholder="3031 Fairview Park Drive"]')!, { target: { value: '123 Main St' } });
      fireEvent.change(c.querySelector('input[placeholder="Falls Church, VA 22042"]')!, { target: { value: 'Fairfax, VA 22030' } });
    },
  },
  {
    type: 'deed_tod',
    legalTestId: 'quick-deed-tod-legal',
    slot: (a) => a.tod?.legalDescription,
    fillRequired: (c) => {
      fireEvent.change(c.querySelector('input[placeholder="Full legal name"]')!, { target: { value: 'Transferor One' } });
      fireEvent.change(c.querySelector('input[placeholder="Beneficiary full name"]')!, { target: { value: 'Beneficiary One' } });
      fireEvent.change(c.querySelector('input[placeholder="e.g. joint tenants with the common law right of survivorship"]')!, { target: { value: 'joint tenants with the common law right of survivorship' } });
    },
  },
  {
    type: 'deed_of_confirmation',
    legalTestId: 'quick-deed-confirmation-legal',
    slot: (a) => a.confirmation?.legalDescription,
    fillRequired: (c) => {
      fireEvent.change(c.querySelector('input[placeholder="Marcus T. ELLISON"]')!, { target: { value: 'Marcus T. Ellison' } });
    },
  },
  {
    type: 'deed_into_trust',
    legalTestId: 'quick-deed-into_trust-legal',
    slot: (a) => a.intoTrust?.legalDescription,
    fillRequired: (c) => {
      fireEvent.change(c.querySelector('textarea[placeholder^="Rosalind A. WHITMORE"]')!, { target: { value: 'Ada R. Vance, Trustee of the Vance Family Trust dated Jan 1, 2020' } });
      fireEvent.change(c.querySelector('input[placeholder="ALEXANDRIA"]')!, { target: { value: 'FAIRFAX' } });
      fireEvent.change(c.querySelector('input[placeholder="Full legal name"]')!, { target: { value: 'Ada R. Vance' } }); // grantor StringList
    },
  },
];

function renderPage(): HTMLElement {
  const { container } = render(<MemoryRouter><QuickDeedPage /></MemoryRouter>);
  return container;
}

function selectType(c: HTMLElement, type: string): void {
  fireEvent.change(c.querySelector('[data-testid="quick-deed-type-select"]')!, { target: { value: type } });
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

describe('DEED-MANUAL-LEGAL-DESC-1 — the paste-verbatim legal field is present on every non-gift lane', () => {
  for (const lane of LANES) {
    it(`${lane.type}: renders the "${lane.legalTestId}" field`, () => {
      const c = renderPage();
      selectType(c, lane.type);
      const field = c.querySelector(`[data-testid="${lane.legalTestId}"]`);
      expect(field).toBeTruthy();
      expect((field as HTMLTextAreaElement).tagName).toBe('TEXTAREA');
    });
  }

  it('gift lane: renders the attorney-entered legal control (the G3 exception), NOT the non-gift paste fields', () => {
    const c = renderPage();
    selectType(c, 'deed_of_gift');
    // DEED-MANUAL-LEGAL-GIFT-1 (G3): the gift lane now exposes a DISTINCT attorney-entered VERBATIM legal control —
    // the operator-re-ratified exception — a paste box gated by a non-pre-checked three-prong affirmation.
    expect(c.querySelector('[data-testid="deed-intake-attorney-legal-text"]')).toBeTruthy();
    // It is NOT any of the SIX non-gift lanes' plain paste fields.
    for (const lane of LANES) {
      expect(c.querySelector(`[data-testid="${lane.legalTestId}"]`)).toBeNull();
    }
    // The affirmation control appears only AFTER a legal is entered (non-pre-checked) — absent here (no paste yet).
    expect(c.querySelector('[data-testid="deed-intake-legal-affirmation"]')).toBeNull();
  });
});

describe('DEED-MANUAL-LEGAL-DESC-1 — a pasted legal threads verbatim into that lane\'s generate payload', () => {
  for (const lane of LANES) {
    it(`${lane.type}: the pasted legal reaches the ${lane.type} payload slot exactly as entered`, async () => {
      const c = renderPage();
      selectType(c, lane.type);
      lane.fillRequired(c);
      fireEvent.change(c.querySelector(`[data-testid="${lane.legalTestId}"]`)!, { target: { value: PASTED } });
      fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);

      await waitFor(() => expect(generateMutate).toHaveBeenCalledTimes(1));
      const arg = generateMutate.mock.calls[0]![0] as GenArg;
      expect(lane.slot(arg)).toBe(PASTED);
      // The gift path is never involved: no manual legal ever appears at the TOP LEVEL (the gift-fields slot).
      expect(arg.legalDescription).toBeUndefined();
    });
  }
});

describe('DEED-MANUAL-LEGAL-DESC-1 — an EMPTY legal field is omitted (the extraction fallback is preserved)', () => {
  it('deed_tod: generating with nothing pasted sends legalDescription undefined (server falls back to the extracted legal)', async () => {
    const c = renderPage();
    selectType(c, 'deed_tod');
    LANES.find((l) => l.type === 'deed_tod')!.fillRequired(c);
    // deliberately do NOT touch the legal field
    fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);

    await waitFor(() => expect(generateMutate).toHaveBeenCalledTimes(1));
    const arg = generateMutate.mock.calls[0]![0] as GenArg;
    expect(arg.tod?.legalDescription).toBeUndefined();
  });
});

describe('DEED-MANUAL-LEGAL-GIFT-1 — the gift generate carries an attorney-entered legal ONLY under a full affirmation', () => {
  function fillGiftParties(c: HTMLElement): void {
    fireEvent.click(c.querySelector('[data-testid="deed-intake-form-toggle"]')!); // expand the gift form
    const names = Array.from(c.querySelectorAll('input[placeholder="Full legal name"]')) as HTMLInputElement[];
    fireEvent.change(names[0]!, { target: { value: 'Donor Owner' } });
    fireEvent.change(names[1]!, { target: { value: 'Donee Person' } });
  }

  it('no paste → the gift generate carries NO manual legal (legalDescription null, affirmation null)', async () => {
    const c = renderPage();
    selectType(c, 'deed_of_gift');
    fillGiftParties(c);
    fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);

    await waitFor(() => expect(generateMutate).toHaveBeenCalledTimes(1));
    const arg = generateMutate.mock.calls[0]![0] as GenArg;
    expect(arg.legalDescription).toBeNull();
    expect((arg as Record<string, unknown>)['legalDescriptionAffirmation']).toBeNull();
    expect(arg.intoLlc).toBeUndefined();
    expect(arg.tod).toBeUndefined();
  });

  it('a paste WITHOUT the full affirmation is BLOCKED — the unaffirmed legal never reaches the server (G3)', async () => {
    const c = renderPage();
    selectType(c, 'deed_of_gift');
    fillGiftParties(c);
    fireEvent.change(c.querySelector('[data-testid="deed-intake-attorney-legal-text"]')!, { target: { value: PASTED } });
    // deliberately do NOT check the three affirmation prongs
    fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);

    await waitFor(() => expect(c.querySelector('[data-testid="quick-deed-error"]')).toBeTruthy());
    expect(generateMutate).not.toHaveBeenCalled();
  });

  it('a paste WITH the full three-prong affirmation threads the legal verbatim + the affirmation into the gift payload (G3/G8)', async () => {
    const c = renderPage();
    selectType(c, 'deed_of_gift');
    fillGiftParties(c);
    fireEvent.change(c.querySelector('[data-testid="deed-intake-attorney-legal-text"]')!, { target: { value: PASTED } });
    fireEvent.click(c.querySelector('[data-testid="deed-intake-aff-verbatim"]')!);
    fireEvent.click(c.querySelector('[data-testid="deed-intake-aff-responsible"]')!);
    fireEvent.click(c.querySelector('[data-testid="deed-intake-aff-subject"]')!);
    fireEvent.click(c.querySelector('[data-testid="quick-deed-generate"]')!);

    await waitFor(() => expect(generateMutate).toHaveBeenCalledTimes(1));
    const arg = generateMutate.mock.calls[0]![0] as GenArg;
    expect(arg.legalDescription).toBe(PASTED); // byte-for-byte (G8)
    const aff = (arg as Record<string, unknown>)['legalDescriptionAffirmation'] as Record<string, unknown>;
    expect(aff).toMatchObject({ verbatimFromSource: true, responsibleForAccuracy: true, describesSubjectProperty: true });
    expect(typeof aff['affirmedAt']).toBe('string');
    expect(arg.intoLlc).toBeUndefined();
    expect(arg.tod).toBeUndefined();
  });
});
