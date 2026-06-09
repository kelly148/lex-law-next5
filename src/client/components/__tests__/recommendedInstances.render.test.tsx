// @vitest-environment jsdom
/**
 * DOC-CLIENT-TARGET-1 Inc 4 — RecommendedInstances render tests (ci-gotchas #10).
 *
 * Proves the assessment enumerates per-client INSTANCES: an individual type in a multi-client matter
 * expands to one row per client with per-instance status; a joint (party_set) type shows one row
 * naming both; a single-client matter / non-targeted type is not expanded.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const mockState = vi.hoisted(() => ({ parties: [] as unknown[], instances: [] as unknown[] }));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const q = (getData: () => unknown) => () => {
    React.useRef(null);
    return { data: getData(), isLoading: false, isError: false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      matterIntake: { listParties: { useQuery: q(() => mockState.parties) } },
      document: { instancesForType: { useQuery: q(() => mockState.instances) } },
    },
  };
});

import { RecommendedInstances } from '../RecommendedInstances.js';

const MATTER = '22222222-2222-2222-2222-222222222222';
const SARAH = { id: '11111111-1111-1111-1111-111111111111', role: 'client', displayName: 'Sarah Brianne Brown' };
const GREG = { id: '33333333-3333-3333-3333-333333333333', role: 'client', displayName: 'Gregory Edwin Brown' };

function renderRecs(recs: Array<{ documentType?: string; title?: string; rationale?: string }>): HTMLElement {
  const { container } = render(<RecommendedInstances matterId={MATTER} recommendedDocuments={recs} />);
  return container;
}

afterEach(() => cleanup());
beforeEach(() => {
  mockState.parties = [];
  mockState.instances = [];
});

describe('DOC-CLIENT-TARGET-1 RecommendedInstances', () => {
  it('individual type + multi-client -> one row per client, with per-instance status', () => {
    mockState.parties = [SARAH, GREG];
    mockState.instances = [
      { partyId: SARAH.id, displayName: SARAH.displayName, documentId: 'd1', workflowState: 'drafting' },
      { partyId: GREG.id, displayName: GREG.displayName, documentId: null, workflowState: null },
    ];
    const row = renderRecs([{ documentType: 'durable_poa', title: 'Durable POA' }]).querySelector('[data-testid="recommended-instances"]')!;
    expect(row.textContent).toContain('Sarah Brianne Brown');
    expect(row.textContent).toContain('Gregory Edwin Brown');
    expect(row.textContent).toContain('In drafting');
    expect(row.textContent).toContain('Not started');
  });

  it('party_set -> one joint row naming both clients', () => {
    mockState.parties = [SARAH, GREG];
    const row = renderRecs([{ documentType: 'revocable_living_trust', title: 'Revocable Living Trust' }]).querySelector('[data-testid="recommended-joint"]')!;
    expect(row.textContent).toContain('Sarah Brianne Brown and Gregory Edwin Brown');
  });

  it('single-client individual -> NOT expanded (one plain row)', () => {
    mockState.parties = [SARAH];
    const c = renderRecs([{ documentType: 'durable_poa', title: 'Durable POA' }]);
    expect(c.querySelector('[data-testid="recommended-instances"]')).toBeFalsy();
  });

  it('non-targeted type -> shown as the type, not expanded', () => {
    mockState.parties = [SARAH, GREG];
    const c = renderRecs([{ documentType: 'engagement_letter', title: 'Engagement Letter' }]);
    expect(c.querySelector('[data-testid="recommended-instances"]')).toBeFalsy();
    expect(c.querySelector('[data-testid="recommended-joint"]')).toBeFalsy();
  });
});
