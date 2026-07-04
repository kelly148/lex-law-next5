// @vitest-environment jsdom
/**
 * DEED-INTAKE-PARITY-1 Inc 2 — MatterDetail CreateDocumentForm routes "Deed" to the matter-scoped Express intake.
 *
 * Asserts:
 *   (1) documentType = deed + agent ENABLED -> the guided deed-intake CTA replaces the generic create form
 *       (no Title field, no "Create Document" button), and "Continue to the deed intake" navigates to
 *       /matters/:matterId/deed;
 *   (2) documentType = deed + agent OFF -> the generic create form renders unchanged (no CTA, Create Document
 *       present) — flag-off behavior is byte-for-byte;
 *   (3) a NON-deed type + agent enabled -> the generic create form (the CTA is deed-only).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const MATTER_ID = '22222222-2222-2222-2222-222222222222';
const mockState = vi.hoisted(() => ({ deedEnabled: true }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  const q = (getData: () => unknown) => () => { React.useRef(null); return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} }; };
  return {
    trpc: {
      useUtils: () => utilsProxy,
      matterIntake: { listParties: { useQuery: q(() => []) } },
      document: { instancesForType: { useQuery: q(() => []) } },
      deedDraftAgent: { isEnabled: { useQuery: q(() => ({ enabled: mockState.deedEnabled })) } },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import { CreateDocumentForm } from '../../pages/MatterDetail.js';

function renderForm(): HTMLElement {
  const { container } = render(
    <MemoryRouter initialEntries={[`/matters/${MATTER_ID}`]}>
      <Routes>
        <Route path="/matters/:matterId" element={<CreateDocumentForm matterId={MATTER_ID} onClose={() => {}} onCreated={() => {}} />} />
        <Route path="/matters/:matterId/deed" element={<div data-testid="deed-intake-route">deed intake</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return container;
}

function selectType(c: HTMLElement, value: string): void {
  fireEvent.change(c.querySelectorAll('select')[0]!, { target: { value } });
}

beforeEach(() => { mockState.deedEnabled = true; });
afterEach(() => cleanup());

describe('DEED-INTAKE-PARITY-1 Inc 2 — deed routes to the matter Express intake', () => {
  it('deed + agent ENABLED: the guided deed-intake CTA replaces the generic create form', () => {
    const c = renderForm();
    selectType(c, 'deed');
    expect(c.querySelector('[data-testid="deed-express-cta"]')).toBeTruthy();
    // the generic create form is suppressed for the deed express path
    expect(c.querySelector('button[type="submit"]')).toBeNull();
    expect(c.textContent).not.toContain('Create Document');
  });

  it('deed + agent ENABLED: "Continue to the deed intake" navigates to /matters/:id/deed', () => {
    const c = renderForm();
    selectType(c, 'deed');
    fireEvent.click(c.querySelector('[data-testid="deed-express-continue"]')!);
    expect(c.querySelector('[data-testid="deed-intake-route"]')).toBeTruthy();
  });

  it('deed + agent OFF: the generic create form renders unchanged (no CTA)', () => {
    mockState.deedEnabled = false;
    const c = renderForm();
    selectType(c, 'deed');
    expect(c.querySelector('[data-testid="deed-express-cta"]')).toBeNull();
    expect(c.querySelector('button[type="submit"]')).toBeTruthy(); // generic Create Document present
    expect(c.textContent).toContain('Create Document');
  });

  it('a non-deed type + agent enabled: the generic create form (the CTA is deed-only)', () => {
    const c = renderForm();
    selectType(c, 'engagement_letter');
    expect(c.querySelector('[data-testid="deed-express-cta"]')).toBeNull();
    expect(c.querySelector('button[type="submit"]')).toBeTruthy();
  });
});
