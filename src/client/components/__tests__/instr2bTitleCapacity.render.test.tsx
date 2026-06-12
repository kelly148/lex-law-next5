// @vitest-environment jsdom
/**
 * INSTR-2B-title — New-Matter capacity selector render test.
 *
 * Proves with a real render (ci-gotchas #10 — tsc never renders React) that the New-Matter form
 * surfaces the engagement-capacity election, that it DEFAULTS to 'law_firm' (the safe default), and
 * that the attorney can affirmatively elect 'title_settlement_agent'. The default-to-law_firm
 * assertion is the UI half of the "title is never the default" safety property.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../trpc.js', async () => {
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  return { trpc: { useUtils: () => utilsProxy } };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
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

afterEach(() => cleanup());

describe('INSTR-2B-title — New-Matter capacity selector', () => {
  it('renders the capacity selector defaulting to law_firm, offering both options', () => {
    const c = renderForm();
    const selector = c.querySelector('[data-testid="capacity-selector"]');
    expect(selector).toBeTruthy();
    const select = selector!.querySelector('select') as HTMLSelectElement;
    // Default-safe: the title posture is NEVER the default.
    expect(select.value).toBe('law_firm');
    const optionValues = Array.from(select.querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(optionValues).toEqual(['law_firm', 'title_settlement_agent']);
  });

  it('the attorney can affirmatively elect the settlement-agent capacity', () => {
    const c = renderForm();
    const select = c.querySelector('[data-testid="capacity-selector"] select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'title_settlement_agent' } });
    expect(select.value).toBe('title_settlement_agent');
  });
});
