// @vitest-environment jsdom
/**
 * DeedIntake render test — DEED-INTAKE-REDESIGN-1 + DEED-EXPRESS-1 (inc1, Gift).
 *
 * The shared gift-intake experience mounted on both the Quick Deed page and the matter "Gift Deed Draft" modal:
 *   1. the PRIMARY drop zone + the free-associate box + a COLLAPSED structured form render;
 *   2. free-associate "proposed" pre-fills the donee but (DEED-EXPRESS-1) NO LONGER force-expands the form — it
 *      stays collapsed behind the Express surface (PROPOSE-ONLY: it never submits — onSubmit is not called);
 *   3. "needs_clarification" surfaces the model's questions (no guessed proposal);
 *   4. "blocked" (egress inert in prod) shows a clean notice, never a partial proposal;
 *   5. submit blocks without a grantor, and otherwise emits the cleaned gift payload (matterId/title injected by
 *      the parent, not here);
 *   6. DEED-EXPRESS-1: an upload no longer force-expands the form; the grantor is auto-seeded from the prior
 *      deed's grantee of record flagged "confirm grantor"; Generate submits in ONE CLICK when the merged required
 *      set is complete (form stays collapsed) and EXPANDS + HIGHLIGHTS only the missing required field otherwise.
 *
 * trpc + useGuardedMutation are mocked in the established render-suite style (the mocked useQuery calls a real
 * useRef so hook counts match production); MaterialsDropZone is stubbed (it owns its own trpc surface + fetch).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

type PreviewFacts = {
  hasMaterials: boolean;
  locality: string | null;
  granteeAddress: string | null;
  derivationCandidate: string | null;
  granteeOfRecord: string | null;
  granteeOfRecordNames: string[];
  grantorOfRecord: string | null;
  resolved: {
    legalDescription: boolean;
    parcelId: boolean;
    assessedValue: boolean;
    locality: boolean;
    propertyAddress: boolean;
    granteeOfRecord: boolean;
  };
  warnings: string[];
};

const mockState = vi.hoisted(() => ({ previewFacts: null as null | PreviewFacts }));
const proposeMock = vi.hoisted(() => vi.fn());

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const q = (getData: () => unknown) => () => {
    React.useRef(null);
    return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      useUtils: () => ({ client: { quickDeed: { proposeIntake: { mutate: proposeMock } } } }),
      quickDeed: { previewFacts: { useQuery: q(() => mockState.previewFacts) } },
    },
  };
});

// useGuardedMutation: a faithful stand-in that runs the thunk and routes the result through onSuccess/onError.
vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: (
    fn: (input: unknown) => Promise<unknown>,
    opts: { onSuccess?: (r: unknown) => void; onError?: (e: Error) => void },
  ) => ({
    isPending: false,
    mutate: (input: unknown) => {
      Promise.resolve(fn(input)).then((r) => opts.onSuccess?.(r)).catch((e) => opts.onError?.(e as Error));
    },
  }),
}));

// MaterialsDropZone owns its own trpc surface + fetch — stub it; DeedIntake wraps it in deed-intake-dropzone.
vi.mock('../../components/MaterialsDropZone.js', () => ({ default: () => null }));

import DeedIntake from '../DeedIntake.js';

function renderIntake() {
  const onSubmit = vi.fn();
  const result = render(
    <DeedIntake matterId="matter-1" resolveMatterId={() => Promise.resolve('matter-1')} onSubmit={onSubmit} />,
  );
  return { ...result, onSubmit };
}

// Build a previewFacts payload with sensible Express defaults (everything resolved, no prior grantee), overridable.
function pf(over: Omit<Partial<PreviewFacts>, 'resolved'> & { resolved?: Partial<PreviewFacts['resolved']> } = {}): PreviewFacts {
  const { resolved, ...rest } = over;
  return {
    hasMaterials: true,
    locality: 'Prince William County',
    granteeAddress: '123 Cedar Run Lane',
    derivationCandidate: null,
    granteeOfRecord: null,
    granteeOfRecordNames: [],
    grantorOfRecord: null,
    warnings: [],
    ...rest,
    resolved: {
      legalDescription: true,
      parcelId: true,
      assessedValue: true,
      locality: true,
      propertyAddress: true,
      granteeOfRecord: false,
      ...(resolved ?? {}),
    },
  };
}

const proposeDonee = (name = 'Hannah Ellison', relationship = "the Grantor's daughter") => ({
  status: 'proposed' as const,
  proposal: { grantees: [{ name, relationship }], granteesAreMarriedCouple: false, overrides: {} },
});

const fieldsHidden = (container: HTMLElement): boolean =>
  (container.querySelector('[data-testid="deed-intake-fields"]')?.className ?? '').includes('hidden');

const nameInputs = (container: HTMLElement): HTMLInputElement[] =>
  Array.from(container.querySelectorAll('input[placeholder="Full legal name"]')) as HTMLInputElement[];

beforeEach(() => {
  proposeMock.mockReset();
});
afterEach(() => {
  cleanup();
  mockState.previewFacts = null;
});

describe('DeedIntake — DEED-INTAKE-REDESIGN-1 + DEED-EXPRESS-1', () => {
  it('renders the primary drop zone, the free-associate box, and a collapsed structured form', () => {
    const { container } = renderIntake();
    expect(container.querySelector('[data-testid="deed-intake-dropzone"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="deed-intake-freetext"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="quick-deed-generate"]')).toBeTruthy();
    // The structured fields exist but are collapsed by default (drop zone + free-associate are primary).
    expect(fieldsHidden(container)).toBe(true);
  });

  it('free-associate "proposed" pre-fills the donee but DEED-EXPRESS-1 keeps the form COLLAPSED (PROPOSE-ONLY, no submit)', async () => {
    proposeMock.mockResolvedValue({
      status: 'proposed',
      proposal: {
        grantees: [{ name: 'Hannah Ellison', relationship: "the Grantor's daughter" }],
        granteesAreMarriedCouple: false,
        overrides: { fileNumber: '36-2024-0001' },
      },
    });
    const { container, getByTestId, onSubmit } = renderIntake();
    fireEvent.change(getByTestId('deed-intake-freetext'), { target: { value: 'gift the house to my daughter Hannah' } });
    fireEvent.click(getByTestId('deed-intake-propose'));

    await waitFor(() => {
      expect(container.querySelector('[data-testid="deed-intake-proposed-note"]')).toBeTruthy();
      expect(nameInputs(container).some((n) => n.value === 'Hannah Ellison')).toBe(true);
    });
    // DEED-EXPRESS-1: a proposal pre-fills the (still-collapsed) form — it no longer force-expands it.
    expect(fieldsHidden(container)).toBe(true);
    // PROPOSE-ONLY: proposing never generates.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('free-associate "needs_clarification" surfaces the questions, fills nothing', async () => {
    proposeMock.mockResolvedValue({ status: 'needs_clarification', questions: ['Who are the donee(s) of this gift deed?'] });
    const { container, getByTestId } = renderIntake();
    fireEvent.change(getByTestId('deed-intake-freetext'), { target: { value: 'someone gets the place' } });
    fireEvent.click(getByTestId('deed-intake-propose'));

    await waitFor(() => {
      expect(container.querySelector('[data-testid="deed-intake-clarify"]')?.textContent).toContain('Who are the donee(s)');
    });
    expect(container.querySelector('[data-testid="deed-intake-proposed-note"]')).toBeNull();
  });

  it('free-associate "blocked" (egress inert) shows a clean notice, never a proposal', async () => {
    proposeMock.mockResolvedValue({ status: 'blocked', reason: 'provider_not_allowlisted' });
    const { container, getByTestId } = renderIntake();
    fireEvent.change(getByTestId('deed-intake-freetext'), { target: { value: 'gift to Hannah' } });
    fireEvent.click(getByTestId('deed-intake-propose'));

    await waitFor(() => {
      const blocked = container.querySelector('[data-testid="deed-intake-blocked"]');
      expect(blocked).toBeTruthy();
      expect(blocked?.textContent).toContain('provider_not_allowlisted');
    });
    expect(container.querySelector('[data-testid="deed-intake-proposed-note"]')).toBeNull();
  });

  it('blocks submit without a grantor name (no onSubmit) and expands the form to show the error', () => {
    const { container, getByTestId, onSubmit } = renderIntake();
    fireEvent.click(getByTestId('quick-deed-generate'));
    expect(container.querySelector('[data-testid="quick-deed-error"]')?.textContent).toContain('grantor (donor) name is required');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('emits the cleaned gift payload on submit (matterId/title injected by the parent, not here)', () => {
    const { container, getByTestId, onSubmit } = renderIntake();
    fireEvent.click(getByTestId('deed-intake-form-toggle')); // expand to fill (manual fallback)
    const names = nameInputs(container);
    fireEvent.change(names[0]!, { target: { value: '  Marcus Ellison ' } }); // grantor
    fireEvent.change(names[1]!, { target: { value: 'Hannah Ellison' } }); // grantee
    fireEvent.click(getByTestId('quick-deed-generate'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const p = onSubmit.mock.calls[0]![0];
    expect(p.grantors).toEqual([{ name: 'Marcus Ellison' }]); // trimmed, no empty descriptor
    expect(p.grantees).toEqual([{ name: 'Hannah Ellison' }]);
    expect(p.granteesAreMarriedCouple).toBe(false);
  });

  // ── DEED-EXPRESS-1 (inc1) ──────────────────────────────────────────────────────────────────────

  it('DEED-EXPRESS-1: an upload (hasMaterials) no longer force-expands the form, and with no prior grantee there is no seed/banner', () => {
    mockState.previewFacts = pf(); // hasMaterials true, everything resolved, granteeOfRecordNames: []
    const { container } = renderIntake();
    expect(fieldsHidden(container)).toBe(true); // collapsed despite materials being read
    // inverse seed invariant: no prior grantee → no grantor pre-fill, no "confirm grantor" banner
    expect(container.querySelector('[data-testid="deed-intake-grantor-confirm"]')).toBeNull();
    expect(nameInputs(container).every((n) => n.value === '')).toBe(true);
  });

  it('DEED-EXPRESS-1: auto-seeds the grantor from the prior deed grantee of record, flagged + amber-highlighted "confirm grantor"', () => {
    mockState.previewFacts = pf({ granteeOfRecordNames: ['Marcus T. Ellison'], resolved: { granteeOfRecord: true } });
    const { container } = renderIntake();
    const banner = container.querySelector('[data-testid="deed-intake-grantor-confirm"]');
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('Marcus T. Ellison');
    // the grantor field was pre-filled (visible even while collapsed) AND highlighted amber as a confirm prompt
    expect(nameInputs(container).some((n) => n.value === 'Marcus T. Ellison')).toBe(true);
    expect(nameInputs(container)[0]!.className).toContain('border-amber-400');
  });

  it('DEED-EXPRESS-1: auto-seeds BOTH grantors from a married-couple prior deed (the canonical gift)', () => {
    mockState.previewFacts = pf({ granteeOfRecordNames: ['Marcus T. Ellison', 'Priya Ellison'], resolved: { granteeOfRecord: true } });
    const { container } = renderIntake();
    const banner = container.querySelector('[data-testid="deed-intake-grantor-confirm"]');
    expect(banner?.textContent).toContain('Marcus T. Ellison');
    expect(banner?.textContent).toContain('Priya Ellison');
    const seeded = nameInputs(container).map((n) => n.value);
    expect(seeded).toContain('Marcus T. Ellison');
    expect(seeded).toContain('Priya Ellison'); // one grantor row per owner of record
  });

  it('DEED-EXPRESS-1: the "Confirm grantor(s)" button clears the banner + amber highlight', () => {
    mockState.previewFacts = pf({ granteeOfRecordNames: ['Marcus T. Ellison'], resolved: { granteeOfRecord: true } });
    const { container, getByTestId } = renderIntake();
    expect(container.querySelector('[data-testid="deed-intake-grantor-confirm"]')).toBeTruthy();
    fireEvent.click(getByTestId('deed-intake-grantor-confirm-ok'));
    expect(container.querySelector('[data-testid="deed-intake-grantor-confirm"]')).toBeNull();
    expect(nameInputs(container)[0]!.className).not.toContain('border-amber-400');
  });

  it('DEED-EXPRESS-1: editing the seeded grantor (taking ownership) clears the confirm banner', () => {
    mockState.previewFacts = pf({ granteeOfRecordNames: ['Marcus T. Ellison'], resolved: { granteeOfRecord: true } });
    const { container } = renderIntake();
    expect(container.querySelector('[data-testid="deed-intake-grantor-confirm"]')).toBeTruthy();
    fireEvent.change(nameInputs(container)[0]!, { target: { value: 'Marcus Thomas Ellison' } });
    expect(container.querySelector('[data-testid="deed-intake-grantor-confirm"]')).toBeNull();
  });

  it('DEED-EXPRESS-1: never clobbers an attorney-entered grantor when previewFacts resolves later (async race)', () => {
    mockState.previewFacts = pf({ granteeOfRecordNames: [], resolved: { granteeOfRecord: false } });
    const onSubmit = vi.fn();
    const { container, getByTestId, rerender } = render(
      <DeedIntake matterId="matter-1" resolveMatterId={() => Promise.resolve('matter-1')} onSubmit={onSubmit} />,
    );
    fireEvent.click(getByTestId('deed-intake-form-toggle')); // expand to type a grantor first
    fireEvent.change(nameInputs(container)[0]!, { target: { value: 'Attorney Typed Grantor' } });
    // the upload finishes AFTER the attorney typed → previewFacts now carries a prior grantee of record
    mockState.previewFacts = pf({ granteeOfRecordNames: ['Marcus T. Ellison'], resolved: { granteeOfRecord: true } });
    rerender(
      <DeedIntake matterId="matter-1" resolveMatterId={() => Promise.resolve('matter-1')} onSubmit={onSubmit} />,
    );
    // the seed must NOT overwrite the attorney's grantor, and no confirm banner appears
    expect(nameInputs(container)[0]!.value).toBe('Attorney Typed Grantor');
    expect(container.querySelector('[data-testid="deed-intake-grantor-confirm"]')).toBeNull();
  });

  it('DEED-EXPRESS-1: Generate submits in ONE CLICK when the merged set is complete, WITHOUT expanding the form', async () => {
    mockState.previewFacts = pf({ granteeOfRecordNames: ['Marcus T. Ellison'], resolved: { granteeOfRecord: true } });
    proposeMock.mockResolvedValue(proposeDonee('Hannah Ellison'));
    const { container, getByTestId, onSubmit } = renderIntake();

    // describe the deal → the donee is parsed in (grantor was auto-seeded; legal is resolved)
    fireEvent.change(getByTestId('deed-intake-freetext'), { target: { value: 'gift to my daughter Hannah' } });
    fireEvent.click(getByTestId('deed-intake-propose'));
    await waitFor(() => expect(nameInputs(container).some((n) => n.value === 'Hannah Ellison')).toBe(true));
    expect(fieldsHidden(container)).toBe(true); // still collapsed after the proposal

    fireEvent.click(getByTestId('quick-deed-generate'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const p = onSubmit.mock.calls[0]![0];
    expect(p.grantors).toEqual([{ name: 'Marcus T. Ellison' }]);
    expect(p.grantees[0].name).toBe('Hannah Ellison');
    // one-click: the form did NOT expand
    expect(fieldsHidden(container)).toBe(true);
  });

  it('DEED-EXPRESS-1: Generate with a missing grantee EXPANDS + HIGHLIGHTS only that field (grantor not highlighted)', () => {
    // grantor auto-seeded + legal resolved; grantee left missing (no proposal) → only the grantee is missing
    mockState.previewFacts = pf({ granteeOfRecordNames: ['Marcus T. Ellison'], resolved: { granteeOfRecord: true } });
    const { container, getByTestId, onSubmit } = renderIntake();
    expect(fieldsHidden(container)).toBe(true);

    fireEvent.click(getByTestId('quick-deed-generate'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(fieldsHidden(container)).toBe(false); // expanded to show the highlighted missing field
    expect(container.querySelector('[data-testid="quick-deed-error"]')?.textContent).toContain('grantee (donee) name is required');

    const names = nameInputs(container);
    expect(names[1]!.className).toContain('border-red-400'); // grantee highlighted
    expect(names[0]!.className).not.toContain('border-red-400'); // grantor (present) NOT highlighted as missing
  });

  it('DEED-EXPRESS-1: Generate with an unreadable legal description EXPANDS + warns; does not one-click', async () => {
    // grantor seeded + grantee parsed, but the legal could not be extracted (withheld) → the legal is missing
    mockState.previewFacts = pf({ granteeOfRecordNames: ['Marcus T. Ellison'], resolved: { granteeOfRecord: true, legalDescription: false } });
    proposeMock.mockResolvedValue(proposeDonee('Hannah Ellison'));
    const { container, getByTestId, onSubmit } = renderIntake();
    fireEvent.change(getByTestId('deed-intake-freetext'), { target: { value: 'gift to my daughter Hannah' } });
    fireEvent.click(getByTestId('deed-intake-propose'));
    await waitFor(() => expect(nameInputs(container).some((n) => n.value === 'Hannah Ellison')).toBe(true));

    fireEvent.click(getByTestId('quick-deed-generate'));
    expect(onSubmit).not.toHaveBeenCalled(); // the express one-click is withheld when the legal is unreadable
    expect(fieldsHidden(container)).toBe(false); // expanded
    expect(container.querySelector('[data-testid="deed-intake-legal-missing"]')).toBeTruthy();
    // the parties are present → neither grantor nor grantee is highlighted as missing
    const names = nameInputs(container);
    expect(names[0]!.className).not.toContain('border-red-400');
    expect(names[1]!.className).not.toContain('border-red-400');
  });

  it('DEED-EXPRESS-1: the manual fallback toggle expands the full form at any time', () => {
    const { container, getByTestId } = renderIntake();
    expect(fieldsHidden(container)).toBe(true);
    fireEvent.click(getByTestId('deed-intake-form-toggle'));
    expect(fieldsHidden(container)).toBe(false);
  });
});
