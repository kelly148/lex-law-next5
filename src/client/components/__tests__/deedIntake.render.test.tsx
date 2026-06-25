// @vitest-environment jsdom
/**
 * DeedIntake render test — DEED-INTAKE-REDESIGN-1.
 *
 * The shared gift-intake experience mounted on both the Quick Deed page and the matter "Gift Deed Draft" modal:
 *   1. the PRIMARY drop zone + the free-associate box + a collapsed structured form render;
 *   2. free-associate "proposed" pre-fills the donee + expands the form for confirmation (PROPOSE-ONLY: it never
 *      submits — onSubmit is not called by proposing);
 *   3. "needs_clarification" surfaces the model's questions (no guessed proposal);
 *   4. "blocked" (egress inert in prod) shows a clean notice, never a partial proposal;
 *   5. submit blocks without a grantor, and otherwise emits the cleaned gift payload (matterId/title injected by
 *      the parent, not here).
 *
 * trpc + useGuardedMutation are mocked in the established render-suite style (the mocked useQuery calls a real
 * useRef so hook counts match production); MaterialsDropZone is stubbed (it owns its own trpc surface + fetch).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mockState = vi.hoisted(() => ({
  previewFacts: null as null | {
    hasMaterials: boolean;
    locality: string | null;
    granteeAddress: string | null;
    derivationCandidate: string | null;
    resolved: { legalDescription: boolean; parcelId: boolean; assessedValue: boolean; locality: boolean; propertyAddress: boolean };
    warnings: string[];
  },
}));
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

beforeEach(() => {
  proposeMock.mockReset();
});
afterEach(() => {
  cleanup();
  mockState.previewFacts = null;
});

describe('DeedIntake — DEED-INTAKE-REDESIGN-1', () => {
  it('renders the primary drop zone, the free-associate box, and a collapsed structured form', () => {
    const { container } = renderIntake();
    expect(container.querySelector('[data-testid="deed-intake-dropzone"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="deed-intake-freetext"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="quick-deed-generate"]')).toBeTruthy();
    // The structured fields exist but are collapsed by default (drop zone + free-associate are primary).
    expect(container.querySelector('[data-testid="deed-intake-fields"]')?.className).toContain('hidden');
  });

  it('free-associate "proposed" pre-fills the donee and expands the form (PROPOSE-ONLY, no submit)', async () => {
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
      const names = Array.from(container.querySelectorAll('input[placeholder="Full legal name"]')) as HTMLInputElement[];
      expect(names.some((n) => n.value === 'Hannah Ellison')).toBe(true);
      // The form auto-expands so the attorney confirms the proposed facts.
      expect(container.querySelector('[data-testid="deed-intake-fields"]')?.className).not.toContain('hidden');
    });
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
    fireEvent.click(getByTestId('deed-intake-form-toggle')); // expand to fill
    const names = Array.from(container.querySelectorAll('input[placeholder="Full legal name"]')) as HTMLInputElement[];
    fireEvent.change(names[0]!, { target: { value: '  Marcus Ellison ' } }); // grantor
    fireEvent.change(names[1]!, { target: { value: 'Hannah Ellison' } }); // grantee
    fireEvent.click(getByTestId('quick-deed-generate'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const p = onSubmit.mock.calls[0]![0];
    expect(p.grantors).toEqual([{ name: 'Marcus Ellison' }]); // trimmed, no empty descriptor
    expect(p.grantees).toEqual([{ name: 'Hannah Ellison' }]);
    expect(p.granteesAreMarriedCouple).toBe(false);
  });
});
