// @vitest-environment jsdom
/**
 * CAPACITY-ELECTION-UX (R4) — New-Matter capacity selector render test.
 * (Originally INSTR-2B-title; updated for the affirmative-election UI gate.)
 *
 * Proves with a real render (ci-gotchas #10 — tsc never renders React) that the New-Matter form:
 *   - surfaces the engagement-capacity election and starts UNSELECTED (the title posture — and now any
 *     posture — is never the default; "— Select capacity —" is the seeded option);
 *   - REQUIRES an affirmative election: an empty capacity blocks submit, shows an inline error, and does
 *     NOT call create (R4 intake-blocking);
 *   - on an affirmative pick, submits the chosen engagementCapacity (which makes create stamp the marker).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mutateSpy } = vi.hoisted(() => ({ mutateSpy: vi.fn() }));

vi.mock('../../trpc.js', async () => {
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  return { trpc: { useUtils: () => utilsProxy } };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: mutateSpy, isPending: false, error: null }),
}));

import { CreateMatterForm } from '../../pages/MatterDashboard.js';

function renderForm(): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <CreateMatterForm onClose={() => {}} onCreated={() => {}} />
    </MemoryRouter>,
  );
  return container;
}

afterEach(() => {
  cleanup();
  mutateSpy.mockClear();
});

describe('CAPACITY-ELECTION-UX — New-Matter capacity selector (required, starts unselected)', () => {
  it('renders the capacity selector UNSELECTED, with a "— Select capacity —" option plus both capacities', () => {
    const c = renderForm();
    const selector = c.querySelector('[data-testid="capacity-selector"]');
    expect(selector).toBeTruthy();
    const select = selector!.querySelector('select') as HTMLSelectElement;
    // R4: no posture is pre-selected — an affirmative election is required.
    expect(select.value).toBe('');
    const optionValues = Array.from(select.querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(optionValues).toEqual(['', 'law_firm', 'title_settlement_agent']);
  });

  it('the attorney can affirmatively elect the settlement-agent capacity', () => {
    const c = renderForm();
    const select = c.querySelector('[data-testid="capacity-selector"] select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'title_settlement_agent' } });
    expect(select.value).toBe('title_settlement_agent');
  });

  it('R4: an empty capacity BLOCKS submit — shows an inline error and never calls create', () => {
    const c = renderForm();
    // Title is required first; fill it so submit reaches the capacity gate.
    const titleInput = c.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Smith Matter' } });
    // Capacity left unselected ('').
    fireEvent.submit(c.querySelector('form') as HTMLFormElement);
    expect(mutateSpy).not.toHaveBeenCalled();
    expect(c.textContent).toContain('Capacity is required');
  });

  it('R4: with a title + an affirmative capacity, submit calls create with the chosen capacity', () => {
    const c = renderForm();
    fireEvent.change(c.querySelector('input[type="text"]') as HTMLInputElement, { target: { value: 'Smith Matter' } });
    fireEvent.change(c.querySelector('[data-testid="capacity-selector"] select') as HTMLSelectElement, {
      target: { value: 'law_firm' },
    });
    fireEvent.submit(c.querySelector('form') as HTMLFormElement);
    expect(mutateSpy).toHaveBeenCalledTimes(1);
    expect(mutateSpy.mock.calls[0]![0]).toMatchObject({ title: 'Smith Matter', engagementCapacity: 'law_firm' });
  });
});
