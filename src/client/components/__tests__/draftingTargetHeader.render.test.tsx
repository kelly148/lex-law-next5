// @vitest-environment jsdom
/**
 * DOC-CLIENT-TARGET-1 Inc 2 — DraftingTargetHeader render tests (ci-gotchas #10).
 *
 * Proves the sticky principal banner: shows the bound principal for an individual_subject doc, warns
 * when none is bound, renders nothing for a non-individual (joint) type, and links to the other
 * client's existing instance. The mocked useQuery calls a real hook (useRef) so hook counts match prod.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockState = vi.hoisted(() => ({
  bindings: [] as unknown[],
  parties: [] as unknown[],
  instances: [] as unknown[],
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const q = (getData: () => unknown) => () => {
    React.useRef(null);
    return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      document: {
        listParties: { useQuery: q(() => mockState.bindings) },
        instancesForType: { useQuery: q(() => mockState.instances) },
      },
      matterIntake: { listParties: { useQuery: q(() => mockState.parties) } },
    },
  };
});

import { DraftingTargetHeader } from '../DraftingTargetHeader.js';

const DOC = '88888888-8888-8888-8888-888888888888';
const MATTER = '22222222-2222-2222-2222-222222222222';
const SARAH_ID = '11111111-1111-1111-1111-111111111111';
const GREG_ID = '33333333-3333-3333-3333-333333333333';

function renderHeader(documentType: string): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <DraftingTargetHeader documentId={DOC} matterId={MATTER} documentType={documentType} documentTitle="Durable POA" />
    </MemoryRouter>,
  );
  return container;
}

afterEach(() => cleanup());
beforeEach(() => {
  mockState.bindings = [];
  mockState.parties = [];
  mockState.instances = [];
});

describe('DOC-CLIENT-TARGET-1 DraftingTargetHeader', () => {
  it('individual_subject with a bound subject -> shows the principal', () => {
    mockState.bindings = [{ documentId: DOC, partyId: SARAH_ID, roleKey: 'subject' }];
    mockState.parties = [{ id: SARAH_ID, role: 'client', displayName: 'Sarah Brianne Brown' }];
    const c = renderHeader('durable_poa');
    const header = c.querySelector('[data-testid="drafting-target-header"]');
    expect(header).toBeTruthy();
    expect(header!.textContent).toContain('Principal:');
    expect(header!.textContent).toContain('Sarah Brianne Brown');
  });

  it('individual_subject with NO bound subject -> warns to bind one', () => {
    mockState.parties = [{ id: SARAH_ID, role: 'client', displayName: 'Sarah Brianne Brown' }];
    const c = renderHeader('durable_poa');
    expect(c.querySelector('[data-testid="drafting-target-unbound"]')).toBeTruthy();
  });

  it('non-targeted type (derived certificate) -> renders nothing', () => {
    const c = renderHeader('certificate_of_trust');
    expect(c.querySelector('[data-testid="drafting-target-header"]')).toBeFalsy();
  });

  it('party_set (joint trust) -> shows "Applies to" the bound client set', () => {
    mockState.bindings = [
      { documentId: DOC, partyId: SARAH_ID, roleKey: 'settlor' },
      { documentId: DOC, partyId: GREG_ID, roleKey: 'settlor' },
    ];
    mockState.parties = [
      { id: SARAH_ID, role: 'client', displayName: 'Sarah Brianne Brown' },
      { id: GREG_ID, role: 'client', displayName: 'Gregory Edwin Brown' },
    ];
    const c = renderHeader('revocable_living_trust');
    const header = c.querySelector('[data-testid="drafting-target-header"]')!;
    expect(header.textContent).toContain('Applies to:');
    expect(header.textContent).toContain('Sarah Brianne Brown');
    expect(header.textContent).toContain('Gregory Edwin Brown');
  });

  it("links to the other client's existing instance", () => {
    mockState.bindings = [{ documentId: DOC, partyId: SARAH_ID, roleKey: 'subject' }];
    mockState.parties = [
      { id: SARAH_ID, role: 'client', displayName: 'Sarah Brianne Brown' },
      { id: GREG_ID, role: 'client', displayName: 'Gregory Edwin Brown' },
    ];
    mockState.instances = [{ partyId: GREG_ID, displayName: 'Gregory Edwin Brown', documentId: '99999999-9999-9999-9999-999999999999' }];
    const c = renderHeader('durable_poa');
    const header = c.querySelector('[data-testid="drafting-target-header"]')!;
    expect(header.textContent).toContain("Open Gregory Edwin Brown's version");
    const link = header.querySelector('a');
    expect(link?.getAttribute('href')).toContain('/documents/99999999-9999-9999-9999-999999999999');
  });
});
