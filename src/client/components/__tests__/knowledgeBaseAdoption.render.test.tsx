// @vitest-environment jsdom
/**
 * R2 #6 — KnowledgeBasePanel adoption-surface render tests (ci-gotchas #10: render, don't trust tsc).
 *
 * Proves the R2 #6 deltas on the KB surface render correctly from the existing reads:
 *  - candidate-vs-adopted — an already-adopted candidate reads as "Adopted" (snapshotted posture)
 *    and does NOT re-offer the adopt act; a not-yet-adopted candidate offers it;
 *  - deliberate-commit — the adopt act uses the standardized DeliberateActButton affordance;
 *  - provenance — surfaced candidates carry the ProvenanceBadge;
 *  - show-ready states — a loading skeleton and a designed (never-blank) error notice;
 *  - no blue (R1-CLEANUP-1 / R2 #5 — semantic --wa- tints only) on this surface.
 *
 * The mocked useQuery calls a real React hook (useRef) so hook counts behave like production.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

interface QState { data: unknown; isLoading?: boolean; isError?: boolean }
const mock = vi.hoisted(() => ({
  matter: { data: { paKey: null } } as QState,
  candidates: { data: [] as unknown } as QState,
  memos: { data: [] as unknown } as QState,
  adoptions: { data: [] as unknown } as QState,
  analysis: { data: null } as QState,
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  const utilsProxy: unknown = new Proxy(function () {}, { get: () => utilsProxy, apply: () => undefined });
  const asQuery = (s: QState) => () => {
    React.useRef(null);
    return { data: s.data, isLoading: s.isLoading ?? false, isError: s.isError ?? false, error: null, refetch: () => {} };
  };
  return {
    trpc: {
      useUtils: () => utilsProxy,
      matter: { get: { useQuery: asQuery(mock.matter) } },
      matterIntake: { getAnalysis: { useQuery: asQuery(mock.analysis) } },
      practiceKb: {
        surfaceCandidates: { useQuery: asQuery(mock.candidates) },
        listMemosForMatter: { useQuery: asQuery(mock.memos) },
        listAdoptions: { useQuery: asQuery(mock.adoptions) },
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
}));

import KnowledgeBasePanel from '../KnowledgeBasePanel.js';

const MATTER_ID = '11111111-1111-1111-1111-111111111111';
const ADOPTED_MEMO = '22222222-2222-2222-2222-222222222222';
const FRESH_MEMO = '33333333-3333-3333-3333-333333333333';

const candidate = (memoId: string, title: string) => ({
  memoId,
  title,
  practiceArea: 'real_estate',
  jurisdiction: 'VA',
  verificationStatus: 'unverified',
  privilegeTag: 'matter_confidential',
  crossMatter: false,
  currencyWarning: 'Currency not verified — re-verify against current law.',
  matchReasons: ['practice_area'],
});

const adoption = (memoId: string) => ({
  id: '44444444-4444-4444-4444-444444444444',
  userId: MATTER_ID,
  matterId: MATTER_ID,
  documentId: null,
  kbMemoId: memoId,
  kbMemoUpdatedAtAtAdoption: null,
  verificationStatusAtAdoption: 'attorney_verified_current',
  lastVerifiedAtAtAdoption: null,
  kbDerived: true,
  currencyVerifiedForOutbound: false,
  adoptedByEventId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

function open(container: HTMLElement) {
  const header = container.querySelector('button');
  if (header) fireEvent.click(header);
}

afterEach(() => cleanup());
beforeEach(() => {
  mock.matter = { data: { paKey: null } };
  mock.candidates = { data: [] };
  mock.memos = { data: [] };
  mock.adoptions = { data: [] };
  mock.analysis = { data: null };
});

describe('KnowledgeBasePanel — R2 #6 adoption surface', () => {
  it('distinguishes adopted from not-yet-adopted; adopt is a deliberate-commit act', () => {
    mock.candidates = { data: [candidate(ADOPTED_MEMO, 'Adopted memo'), candidate(FRESH_MEMO, 'Fresh memo')] };
    mock.adoptions = { data: [adoption(ADOPTED_MEMO)] };
    const { container } = render(<KnowledgeBasePanel matterId={MATTER_ID} />);
    open(container);
    const t = container.textContent ?? '';

    // Candidate-vs-adopted: the adopted one reads "Adopted" with its snapshotted posture.
    expect(container.querySelector('[data-testid="kb-candidate-adopted"]')).toBeTruthy();
    expect(t).toContain('Adopted into this matter');
    expect(t).toContain('attorney verified current'); // snapshotted verificationStatusAtAdoption, underscores stripped

    // Exactly one un-adopted candidate → exactly one deliberate-act adopt button.
    const adoptActs = Array.from(container.querySelectorAll('[data-deliberate-act="true"]'))
      .filter((el) => (el.textContent ?? '').includes('Adopt into this matter'));
    expect(adoptActs.length).toBe(1);
  });

  it('surfaced candidates carry a provenance badge and no blue', () => {
    mock.candidates = { data: [candidate(FRESH_MEMO, 'Fresh memo')] };
    const { container } = render(<KnowledgeBasePanel matterId={MATTER_ID} />);
    open(container);
    expect(container.querySelector('[data-testid="provenance-badge"]')).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/blue/); // R1-CLEANUP-1 / R2 #5: semantic --wa- tints only
  });

  it('shows a loading skeleton (not blank) before candidates resolve', () => {
    mock.candidates = { data: undefined, isLoading: true };
    const { container } = render(<KnowledgeBasePanel matterId={MATTER_ID} />);
    open(container);
    expect(container.querySelector('[data-testid="kb-candidates-loading"]')).toBeTruthy();
  });

  it('degrades to a designed inline notice (never blank) on load error', () => {
    mock.candidates = { data: undefined, isError: true };
    const { container } = render(<KnowledgeBasePanel matterId={MATTER_ID} />);
    open(container);
    expect(container.querySelector('[data-testid="kb-candidates-error"]')).toBeTruthy();
    expect(container.textContent ?? '').toContain('intact');
  });
});
