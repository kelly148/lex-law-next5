// @vitest-environment jsdom
/**
 * DOC-CLIENT-TARGET-1 Inc 2 — CreateDocumentForm principal-selector render tests.
 *
 * Proves with a real render (ci-gotchas #10 — tsc never renders React) the malpractice-grade UI rule:
 *   - multi-client matter + individual_subject type -> a MANDATORY principal selector appears with NO
 *     pre-selection (empty default), one option per client, and the submit button is DISABLED until a
 *     principal is chosen;
 *   - single-client matter + individual type -> NO selector; the sole client is shown read-only
 *     (auto-bound server-side);
 *   - a party_set (joint) type -> NO principal selector even with two clients.
 *
 * The mocked useQuery calls a real React hook (useRef) so hook counts behave like production.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const MATTER_ID = '22222222-2222-2222-2222-222222222222';

const mockState = vi.hoisted(() => ({ parties: [] as unknown[], instances: [] as unknown[] }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  const q = (getData: () => unknown) => () => {
    React.useRef(null);
    return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      useUtils: () => utilsProxy,
      matterIntake: { listParties: { useQuery: q(() => mockState.parties) } },
      document: { instancesForType: { useQuery: q(() => mockState.instances) } },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import { CreateDocumentForm } from '../../pages/MatterDetail.js';

const party = (id: string, displayName: string): unknown => ({ id, role: 'client', displayName, confirmed: true });

const SARAH = party('11111111-1111-1111-1111-111111111111', 'Sarah Brianne Brown');
const GREG = party('33333333-3333-3333-3333-333333333333', 'Gregory Edwin Brown');

function renderForm(): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <CreateDocumentForm matterId={MATTER_ID} onClose={() => {}} onCreated={() => {}} />
    </MemoryRouter>,
  );
  return container;
}

/** The first <select> is the document-type select. */
function selectType(container: HTMLElement, value: string): void {
  const typeSelect = container.querySelectorAll('select')[0]!;
  fireEvent.change(typeSelect, { target: { value } });
}

afterEach(() => cleanup());
beforeEach(() => {
  mockState.parties = [];
  mockState.instances = [];
});

function pickPrincipal(container: HTMLElement, partyId: string): void {
  const principalSelect = container.querySelector('[data-testid="principal-selector"] select') as HTMLSelectElement;
  fireEvent.change(principalSelect, { target: { value: partyId } });
}

describe('DOC-CLIENT-TARGET-1 CreateDocumentForm — principal selector', () => {
  it('multi-client + individual type -> mandatory selector, no pre-selection, one option per client', () => {
    mockState.parties = [SARAH, GREG];
    const c = renderForm();
    selectType(c, 'durable_poa');

    const selector = c.querySelector('[data-testid="principal-selector"]');
    expect(selector).toBeTruthy();
    const principalSelect = selector!.querySelector('select') as HTMLSelectElement;
    // NO pre-selection — the default value is the empty placeholder option
    expect(principalSelect.value).toBe('');
    const optionLabels = Array.from(principalSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionLabels.some((l) => l?.includes('Sarah Brianne Brown'))).toBe(true);
    expect(optionLabels.some((l) => l?.includes('Gregory Edwin Brown'))).toBe(true);
  });

  it('multi-client + individual type -> submit DISABLED until a principal is chosen, enabled after', () => {
    mockState.parties = [SARAH, GREG];
    const c = renderForm();
    // a title is required too; fill it so only the principal gates the button
    const titleInput = c.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Durable POA' } });
    selectType(c, 'durable_poa');

    const submit = c.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const principalSelect = c.querySelector('[data-testid="principal-selector"] select') as HTMLSelectElement;
    fireEvent.change(principalSelect, { target: { value: '11111111-1111-1111-1111-111111111111' } });
    expect(submit.disabled).toBe(false);
  });

  it('single-client + individual type -> NO selector; sole client shown read-only', () => {
    mockState.parties = [SARAH];
    const c = renderForm();
    selectType(c, 'durable_poa');

    expect(c.querySelector('[data-testid="principal-selector"]')).toBeFalsy();
    const sole = c.querySelector('[data-testid="principal-sole"]');
    expect(sole).toBeTruthy();
    expect(sole!.textContent).toContain('Sarah Brianne Brown');
  });

  it('party_set (joint) type -> NO principal selector even with two clients', () => {
    mockState.parties = [SARAH, GREG];
    const c = renderForm();
    selectType(c, 'revocable_living_trust');
    expect(c.querySelector('[data-testid="principal-selector"]')).toBeFalsy();
    expect(c.querySelector('[data-testid="principal-sole"]')).toBeFalsy();
  });

  it('label tracks the type (Declarant for an advance medical directive)', () => {
    mockState.parties = [SARAH, GREG];
    const c = renderForm();
    selectType(c, 'advance_medical_directive');
    const selector = c.querySelector('[data-testid="principal-selector"]');
    expect(selector).toBeTruthy();
    expect(selector!.textContent).toContain('Declarant');
  });
});

describe('DOC-CLIENT-TARGET-1 CreateDocumentForm — pair affordance + duplicate guard', () => {
  it('pairable individual type + multi-client + principal picked -> offers the matching pair (pre-checked)', () => {
    mockState.parties = [SARAH, GREG];
    const c = renderForm();
    selectType(c, 'durable_poa');
    pickPrincipal(c, '11111111-1111-1111-1111-111111111111'); // Sarah
    const offer = c.querySelector('[data-testid="pair-offer"]');
    expect(offer).toBeTruthy();
    expect(offer!.textContent).toContain('Gregory Edwin Brown');
    expect((offer!.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  });

  it('no offer before a principal is picked', () => {
    mockState.parties = [SARAH, GREG];
    const c = renderForm();
    selectType(c, 'durable_poa');
    expect(c.querySelector('[data-testid="pair-offer"]')).toBeFalsy();
  });

  it('duplicate guard: the other client already has an instance -> link it, do NOT offer to create', () => {
    mockState.parties = [SARAH, GREG];
    mockState.instances = [
      { partyId: '33333333-3333-3333-3333-333333333333', displayName: 'Gregory Edwin Brown', documentId: '99999999-9999-9999-9999-999999999999' },
    ];
    const c = renderForm();
    selectType(c, 'durable_poa');
    pickPrincipal(c, '11111111-1111-1111-1111-111111111111'); // Sarah
    expect(c.querySelector('[data-testid="pair-offer"]')).toBeFalsy();
    const existing = c.querySelector('[data-testid="pair-existing"]');
    expect(existing).toBeTruthy();
    expect(existing!.textContent).toContain("Gregory Edwin Brown's existing");
  });
});
